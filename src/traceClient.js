'use strict';

const { Connection, Request, TYPES } = require('tedious');
const { TraceRowParser, EVENT_NAMES } = require('./traceProtocol');

const DEFAULT_EVENT_IDS = [10, 11, 12, 13, 40, 41, 42, 43, 44, 45];
const CAPTURE_COLUMNS = [1, 3, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 22, 34, 35, 48, 51, 64];
const FILTER_COLUMNS = {
  textData: { id: 1, type: 'string' },
  hostName: { id: 8, type: 'string' },
  applicationName: { id: 10, type: 'string' },
  loginName: { id: 11, type: 'string' },
  spid: { id: 12, type: 'int' },
  duration: { id: 13, type: 'long' },
  reads: { id: 16, type: 'long' },
  writes: { id: 17, type: 'long' },
  cpu: { id: 18, type: 'int' },
  databaseName: { id: 35, type: 'string' }
};

class LegacyTraceClient {
  constructor({ onEvent, onStatus, onError, onExpired }) {
    this.onEvent = onEvent;
    this.onStatus = onStatus;
    this.onError = onError;
    this.onExpired = onExpired;
    this.state = 'idle';
    this.traceId = null;
    this.streamConnection = null;
    this.controlConnection = null;
    this.readerRequest = null;
    this.expiryTimer = null;
    this.expiresAtMs = null;
    this.maxDurationMinutes = null;
    this.expiring = false;
    this.parser = new TraceRowParser((event) => this.onEvent(event));
  }

  async start(profile, options = {}) {
    if (this.state === 'paused') return this.resume();
    if (!['idle', 'ended', 'error'].includes(this.state)) throw new Error('이미 Trace가 실행 중입니다.');
    this.state = 'starting';
    this.onStatus(this.state);
    const credentials = profile.useTraceCredentials
      ? { user: profile.traceUser, password: profile.tracePassword }
      : { user: profile.user, password: profile.password };
    try {
      const config = buildConnectionConfig(profile, credentials);
      this.streamConnection = await connect(config);
      this.controlConnection = await connect(config);
      const maxDurationMinutes = normalizeMaxDuration(options.maxDurationMinutes);
      this.maxDurationMinutes = maxDurationMinutes;
      const expiresAt = new Date(Date.now() + maxDurationMinutes * 60 * 1000);
      this.expiresAtMs = expiresAt.getTime();
      const serverStopTime = await getServerStopTime(this.streamConnection, maxDurationMinutes);
      this.traceId = await createTrace(this.streamConnection, serverStopTime);
      const eventIds = normalizeEventIds(options.eventIds);
      await configureEvents(this.streamConnection, this.traceId, eventIds, CAPTURE_COLUMNS);
      for (const filter of normalizeFilters(options.serverFilters)) {
        await setFilter(this.streamConnection, this.traceId, filter);
      }
      await setTraceStatus(this.streamConnection, this.traceId, 1);
      this.state = 'running';
      this.onStatus(this.state, { traceId: this.traceId, expiresAt: expiresAt.toISOString() });
      this.expiryTimer = setTimeout(() => this.expire(), Math.max(0, this.expiresAtMs - Date.now()));
      this.beginRead();
    } catch (error) {
      await this.cleanupAfterFailure();
      throw error;
    }
  }

  async pause() {
    if (this.state !== 'running') throw new Error('실행 중인 Trace만 정지할 수 있습니다.');
    await setTraceStatus(this.controlConnection, this.traceId, 0);
    this.state = 'paused';
    this.onStatus(this.state, { traceId: this.traceId });
  }

  async resume() {
    if (this.state !== 'paused') throw new Error('정지된 Trace만 재개할 수 있습니다.');
    await setTraceStatus(this.controlConnection, this.traceId, 1);
    this.state = 'running';
    this.onStatus(this.state, { traceId: this.traceId });
    this.beginRead();
  }

  async end() {
    clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    if (!this.traceId) {
      this.state = 'ended';
      this.onStatus(this.state);
      return;
    }
    const traceId = this.traceId;
    const wasRunning = this.state === 'running';
    this.state = 'ending';
    this.onStatus(this.state, { traceId });
    try {
      if (wasRunning) await setTraceStatus(this.controlConnection, traceId, 0);
      await setTraceStatus(this.controlConnection, traceId, 2);
    } finally {
      this.parser.flush();
      this.readerRequest = null;
      this.traceId = null;
      closeConnection(this.streamConnection);
      closeConnection(this.controlConnection);
      this.streamConnection = null;
      this.controlConnection = null;
      this.expiresAtMs = null;
      this.maxDurationMinutes = null;
      this.state = 'ended';
      this.onStatus(this.state);
    }
  }

  async expire() {
    if (this.expiring || !['running', 'paused'].includes(this.state)) return;
    const maxDurationMinutes = this.maxDurationMinutes || 5;
    this.expiring = true;
    try {
      await this.end();
      if (this.onExpired) this.onExpired({ maxDurationMinutes });
    } catch (error) {
      this.onError(error);
    } finally {
      this.expiring = false;
    }
  }

  async dispose() {
    if (this.traceId) {
      try { await this.end(); } catch (_) { /* best-effort cleanup */ }
    }
    closeConnection(this.streamConnection);
    closeConnection(this.controlConnection);
  }

  beginRead() {
    if (this.readerRequest || this.state !== 'running') return;
    const request = new Request('sp_trace_getdata', (error) => {
      if (this.readerRequest === request) this.readerRequest = null;
      this.parser.flush();
      if (error && this.state === 'running') {
        if (this.expiresAtMs && Date.now() >= this.expiresAtMs - 5000) {
          this.expire();
          return;
        }
        this.cleanupAfterFailure().finally(() => this.onError(error));
        return;
      }
      if (!error && this.state === 'running') setImmediate(() => this.beginRead());
    });
    request.addParameter('traceid', TYPES.Int, this.traceId);
    request.addParameter('records', TYPES.Int, 0);
    request.on('row', (columns) => {
      const columnId = Number(columns[0] && columns[0].value);
      const raw = columns[2] && columns[2].value;
      this.parser.push(columnId, Buffer.isBuffer(raw) ? raw : Buffer.from(raw || []));
    });
    this.readerRequest = request;
    this.streamConnection.callProcedure(request);
  }

  async cleanupAfterFailure() {
    clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    this.expiresAtMs = null;
    this.maxDurationMinutes = null;
    const traceId = this.traceId;
    if (traceId && this.controlConnection) {
      try { await setTraceStatus(this.controlConnection, traceId, 0); } catch (_) { /* ignored */ }
      try { await setTraceStatus(this.controlConnection, traceId, 2); } catch (_) { /* ignored */ }
    }
    closeConnection(this.streamConnection);
    closeConnection(this.controlConnection);
    this.streamConnection = null;
    this.controlConnection = null;
    this.traceId = null;
    this.state = 'error';
    this.onStatus(this.state);
  }
}

function buildConnectionConfig(profile, credentials) {
  let server = profile.server.trim();
  let instanceName;
  const separator = server.indexOf('\\');
  if (separator >= 0) {
    instanceName = server.slice(separator + 1);
    server = server.slice(0, separator);
  }
  const options = {
    database: profile.database || 'master',
    encrypt: profile.encrypt !== false,
    trustServerCertificate: profile.trustServerCertificate !== false,
    connectTimeout: 15000,
    requestTimeout: 0,
    appName: 'Legacy SQL Trace Profiler'
  };
  if (instanceName) options.instanceName = instanceName;
  else options.port = Number(profile.port || 1433);
  return {
    server,
    authentication: {
      type: 'default',
      options: { userName: credentials.user, password: credentials.password }
    },
    options
  };
}

function connect(config) {
  return new Promise((resolve, reject) => {
    const connection = new Connection(config);
    const onError = (error) => reject(error);
    connection.once('error', onError);
    connection.connect((error) => {
      connection.removeListener('error', onError);
      if (error) reject(error);
      else {
        connection.on('error', () => { /* request callbacks report operational errors */ });
        resolve(connection);
      }
    });
  });
}

async function testProfileConnection(profile) {
  const credentials = profile.useTraceCredentials
    ? { user: profile.traceUser, password: profile.tracePassword }
    : { user: profile.user, password: profile.password };
  const connection = await connect(buildConnectionConfig(profile, credentials));
  try {
    return await queryConnectionInfo(connection);
  } finally {
    closeConnection(connection);
  }
}

function queryConnectionInfo(connection) {
  return new Promise((resolve, reject) => {
    let info;
    const sql = `SELECT
      CONVERT(nvarchar(128), SERVERPROPERTY('ProductVersion')) AS productVersion,
      CONVERT(nvarchar(128), SERVERPROPERTY('Edition')) AS edition,
      DB_NAME() AS databaseName,
      HAS_PERMS_BY_NAME(NULL, NULL, 'ALTER TRACE') AS hasAlterTrace`;
    const request = new Request(sql, (error) => {
      if (error) reject(error);
      else if (!info) reject(new Error('연결 정보를 확인하지 못했습니다.'));
      else resolve(info);
    });
    request.on('row', (columns) => {
      info = Object.fromEntries(columns.map((column) => [column.metadata.colName, column.value]));
      info.hasAlterTrace = Number(info.hasAlterTrace) === 1;
    });
    connection.execSql(request);
  });
}

function callProcedure(connection, name, configure) {
  return new Promise((resolve, reject) => {
    const output = {};
    let returnStatus = 0;
    const request = new Request(name, (error, rowCount) => {
      if (error) reject(error);
      else resolve({ output, returnStatus, rowCount });
    });
    request.on('returnValue', (parameterName, value) => { output[parameterName] = value; });
    request.on('returnStatus', (value) => { returnStatus = value; });
    configure(request);
    connection.callProcedure(request);
  });
}

async function createTrace(connection, stopTime) {
  const result = await callProcedure(connection, 'sp_trace_create', (request) => {
    request.addOutputParameter('traceid', TYPES.Int);
    request.addParameter('options', TYPES.Int, 1);
    request.addParameter('trace_file', TYPES.NVarChar, null);
    request.addParameter('maxfilesize', TYPES.BigInt, null);
    request.addParameter('stoptime', TYPES.DateTime, stopTime);
    request.addParameter('filecount', TYPES.Int, null);
  });
  if (result.returnStatus) throw new Error(`sp_trace_create 실패 (${result.returnStatus})`);
  const traceId = Number(result.output.traceid);
  if (!Number.isInteger(traceId) || traceId <= 0) throw new Error('SQL Server가 유효한 Trace ID를 반환하지 않았습니다.');
  return traceId;
}

function getServerStopTime(connection, minutes) {
  return new Promise((resolve, reject) => {
    let stopTime;
    const request = new Request('SELECT DATEADD(minute, @minutes, GETDATE()) AS stopTime', (error) => {
      if (error) reject(error);
      else if (!(stopTime instanceof Date)) reject(new Error('SQL Server 안전 종료 시간을 확인하지 못했습니다.'));
      else resolve(stopTime);
    });
    request.addParameter('minutes', TYPES.Int, minutes);
    request.on('row', (columns) => { stopTime = columns[0] && columns[0].value; });
    connection.execSql(request);
  });
}

async function configureEvents(connection, traceId, eventIds, columnIds) {
  for (const eventId of eventIds) {
    for (const columnId of columnIds) {
      await callProcedure(connection, 'sp_trace_setevent', (request) => {
        request.addParameter('traceid', TYPES.Int, traceId);
        request.addParameter('eventid', TYPES.Int, eventId);
        request.addParameter('columnid', TYPES.Int, columnId);
        request.addParameter('on', TYPES.Bit, true);
      });
    }
  }
}

async function setFilter(connection, traceId, filter) {
  const definition = FILTER_COLUMNS[filter.column];
  if (!definition) throw new Error(`지원하지 않는 서버 필터 컬럼: ${filter.column}`);
  await callProcedure(connection, 'sp_trace_setfilter', (request) => {
    request.addParameter('traceid', TYPES.Int, traceId);
    request.addParameter('columnid', TYPES.Int, definition.id);
    request.addParameter('logical_operator', TYPES.Int, filter.logicalOperator);
    request.addParameter('comparison_operator', TYPES.Int, filter.comparisonOperator);
    if (definition.type === 'string') request.addParameter('value', TYPES.NVarChar, String(filter.value));
    else if (definition.type === 'long') request.addParameter('value', TYPES.BigInt, String(filter.value));
    else request.addParameter('value', TYPES.Int, Number(filter.value));
  });
}

async function setTraceStatus(connection, traceId, status) {
  if (!connection) throw new Error('Trace 제어 연결이 없습니다.');
  await callProcedure(connection, 'sp_trace_setstatus', (request) => {
    request.addParameter('traceid', TYPES.Int, traceId);
    request.addParameter('status', TYPES.Int, status);
  });
}

function normalizeEventIds(eventIds) {
  const source = Array.isArray(eventIds) && eventIds.length ? eventIds : DEFAULT_EVENT_IDS;
  return [...new Set(source.map(Number).filter((id) => Number.isInteger(id) && EVENT_NAMES[id]))];
}

function normalizeMaxDuration(value) {
  const minutes = Number(value);
  return Number.isInteger(minutes) && minutes >= 5 && minutes <= 30 && minutes % 5 === 0 ? minutes : 5;
}

function normalizeFilters(filters) {
  if (!Array.isArray(filters)) return [];
  return filters.filter((filter) => filter && FILTER_COLUMNS[filter.column] && String(filter.value ?? '') !== '')
    .map((filter) => ({
      column: filter.column,
      logicalOperator: Number(filter.logicalOperator) === 1 ? 1 : 0,
      comparisonOperator: Math.max(0, Math.min(7, Number(filter.comparisonOperator) || 0)),
      value: filter.value
    }));
}

function closeConnection(connection) {
  if (!connection) return;
  try { connection.close(); } catch (_) { /* ignored */ }
}

module.exports = {
  LegacyTraceClient,
  buildConnectionConfig,
  normalizeEventIds,
  normalizeFilters,
  normalizeMaxDuration,
  DEFAULT_EVENT_IDS,
  CAPTURE_COLUMNS,
  FILTER_COLUMNS,
  testProfileConnection
};
