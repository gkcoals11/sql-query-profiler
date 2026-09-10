'use strict';

const COLUMN_TYPES = {
  1: 'string', 2: 'bytes', 3: 'int', 4: 'long', 5: 'int', 6: 'string', 7: 'string',
  8: 'string', 9: 'int', 10: 'string', 11: 'string', 12: 'int', 13: 'long',
  14: 'datetime', 15: 'datetime', 16: 'long', 17: 'long', 18: 'int', 19: 'long',
  20: 'int', 21: 'int', 22: 'int', 23: 'int', 24: 'int', 25: 'int', 26: 'string',
  27: 'int', 28: 'int', 29: 'int', 30: 'int', 31: 'int', 32: 'int', 33: 'int',
  34: 'string', 35: 'string', 36: 'string', 37: 'string', 38: 'string', 39: 'string',
  40: 'string', 41: 'bytes', 42: 'string', 43: 'bytes', 44: 'int', 45: 'string',
  46: 'string', 47: 'string', 48: 'long', 49: 'int', 50: 'long', 51: 'long',
  52: 'long', 53: 'long', 54: 'guid', 55: 'int', 56: 'long', 57: 'int', 58: 'int',
  59: 'string', 60: 'int', 61: 'int', 62: 'int', 63: 'bytes', 64: 'string', 65: 'bytes'
};

const COLUMN_NAMES = {
  1: 'textData', 3: 'databaseId', 5: 'lineNumber', 8: 'hostName', 9: 'clientProcessId',
  10: 'applicationName', 11: 'loginName', 12: 'spid', 13: 'duration', 14: 'startTime',
  15: 'endTime', 16: 'reads', 17: 'writes', 18: 'cpu', 22: 'objectId',
  27: 'eventClassId', 34: 'objectName', 35: 'databaseName', 48: 'rowCounts',
  51: 'eventSequence', 64: 'sessionLoginName'
};

const EVENT_NAMES = {
  10: 'RPC:Completed', 11: 'RPC:Starting', 12: 'SQL:BatchCompleted', 13: 'SQL:BatchStarting',
  14: 'Audit Login', 15: 'Audit Logout', 17: 'ExistingConnection', 33: 'Exception',
  40: 'SQL:StmtStarting', 41: 'SQL:StmtCompleted', 42: 'SP:Starting', 43: 'SP:Completed',
  44: 'SP:StmtStarting', 45: 'SP:StmtCompleted', 137: 'Blocked process report',
  162: 'User Error Message'
};

function decodeValue(columnId, raw) {
  if (!Buffer.isBuffer(raw)) return raw;
  const type = COLUMN_TYPES[columnId] || 'bytes';
  if (type === 'string') return raw.toString('utf16le').replace(/\u0000+$/g, '');
  if (type === 'int') return raw.length >= 4 ? raw.readInt32LE(0) : 0;
  if (type === 'long') {
    if (raw.length < 8) return 0;
    const value = raw.readBigInt64LE(0);
    return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString();
  }
  if (type === 'datetime') {
    if (raw.length < 16) return null;
    const year = raw.readUInt16LE(0);
    const month = raw.readUInt16LE(2);
    const day = raw.readUInt16LE(6);
    const hour = raw.readUInt16LE(8);
    const minute = raw.readUInt16LE(10);
    const second = raw.readUInt16LE(12);
    const millisecond = raw.readUInt16LE(14);
    if (!year || !month || !day) return null;
    const local = new Date(year, month - 1, day, hour, minute, second, millisecond);
    return Number.isNaN(local.valueOf()) ? null : local.toISOString();
  }
  if (type === 'guid' && raw.length >= 16) return raw.toString('hex');
  return raw.toString('base64');
}

class TraceRowParser {
  constructor(onEvent) {
    this.onEvent = onEvent;
    this.current = null;
  }

  push(columnId, raw) {
    if (columnId === 65526) {
      this.flush();
      const eventClassId = Buffer.isBuffer(raw) && raw.length >= 2 ? raw.readUInt16LE(0) : 0;
      this.current = { eventClassId, eventClass: EVENT_NAMES[eventClassId] || `Event ${eventClassId}` };
      return;
    }
    if (!this.current || columnId < 1 || columnId > 65) return;
    const name = COLUMN_NAMES[columnId] || `column${columnId}`;
    this.current[name] = decodeValue(columnId, raw);
  }

  flush() {
    if (!this.current) return;
    const event = this.current;
    this.current = null;
    this.onEvent(event);
  }
}

module.exports = { TraceRowParser, decodeValue, EVENT_NAMES, COLUMN_NAMES, COLUMN_TYPES };
