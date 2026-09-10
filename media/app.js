'use strict';

const vscode = acquireVsCodeApi();
const $ = (id) => document.getElementById(id);
const state = { profiles: [], filterPresets: [], events: [], excludedStrings: [], selectedRows: new Set(), selectionAnchor: null, nextRowNumber: 1, status: 'idle', formatted: false };

const eventDefinitions = [
  [10, 'RPC:Completed', true], [11, 'RPC:Starting', true],
  [12, 'SQL:BatchCompleted', true], [13, 'SQL:BatchStarting', true],
  [40, 'SQL:StmtStarting', true], [41, 'SQL:StmtCompleted', true],
  [42, 'SP:Starting', true], [43, 'SP:Completed', true],
  [44, 'SP:StmtStarting', true], [45, 'SP:StmtCompleted', true],
  [14, 'Audit Login', false], [15, 'Audit Logout', false], [17, 'ExistingConnection', false],
  [33, 'Exception', false], [137, 'Blocked process report', false], [162, 'User Error Message', false]
];

const filterColumns = [
  ['textData', 'TextData', 'string'], ['loginName', 'LoginName', 'string'],
  ['databaseName', 'DatabaseName', 'string'], ['applicationName', 'ApplicationName', 'string'],
  ['hostName', 'HostName', 'string'], ['spid', 'SPID', 'number'], ['duration', 'Duration', 'number'],
  ['reads', 'Reads', 'number'], ['writes', 'Writes', 'number'], ['cpu', 'CPU', 'number']
];

function initialize() {
  renderEventOptions();
  bindActions();
  updateStatus('idle');
  vscode.postMessage({ type: 'ready' });
}

function bindActions() {
  $('newProfile').addEventListener('click', () => openProfileEditor());
  $('editProfile').addEventListener('click', () => {
    const profile = selectedProfile();
    if (profile) openProfileEditor(profile);
  });
  $('cancelProfile').addEventListener('click', closeProfileEditor);
  $('useTraceCredentials').addEventListener('change', updateTraceCredentialsVisibility);
  $('saveProfile').addEventListener('click', saveProfile);
  $('deleteProfile').addEventListener('click', deleteProfile);
  $('importProfiles').addEventListener('click', () => vscode.postMessage({ type: 'importProfiles' }));
  $('exportProfiles').addEventListener('click', () => vscode.postMessage({ type: 'exportProfiles' }));
  $('profileSelect').addEventListener('change', () => {
    if ($('profileSelect').value === '__open_storage__') {
      vscode.postMessage({ type: 'openProfileStorage', profileType: 'server' });
      $('profileSelect').value = $('profileSelect').dataset.lastValue || '';
      return;
    }
    $('profileSelect').dataset.lastValue = $('profileSelect').value;
    $('editProfile').disabled = !selectedProfile();
  });
  $('start').addEventListener('click', startTrace);
  $('pause').addEventListener('click', () => vscode.postMessage({ type: 'pause' }));
  $('end').addEventListener('click', () => vscode.postMessage({ type: 'end' }));
  $('clear').addEventListener('click', clearEvents);
  $('addServerFilter').addEventListener('click', () => addServerFilterRow());
  $('filterPresetSelect').addEventListener('change', () => {
    if ($('filterPresetSelect').value === '__open_storage__') {
      vscode.postMessage({ type: 'openProfileStorage', profileType: 'filter' });
      $('filterPresetSelect').value = $('filterPresetSelect').dataset.lastValue || '';
      return;
    }
    $('filterPresetSelect').dataset.lastValue = $('filterPresetSelect').value;
    applySelectedFilterPreset();
  });
  $('newFilterPreset').addEventListener('click', () => {
    $('filterPresetSelect').value = '';
    $('filterPresetName').value = '';
    $('deleteFilterPreset').disabled = true;
    $('saveFilterPreset').textContent = '저장';
    $('filterPresetSelect').dataset.lastValue = '';
    $('filterPresetName').focus();
  });
  $('saveFilterPreset').addEventListener('click', saveFilterPreset);
  $('deleteFilterPreset').addEventListener('click', deleteFilterPreset);
  $('resetFilters').addEventListener('click', () => {
    $('filterPresetSelect').value = '';
    $('filterPresetName').value = '';
    $('deleteFilterPreset').disabled = true;
    $('saveFilterPreset').textContent = '저장';
    $('filterPresetSelect').dataset.lastValue = '';
    resetFilters();
    showToast('필터를 초기화했습니다.', false);
  });
  $('textFilter').addEventListener('input', renderEvents);
  $('eventFilter').addEventListener('input', renderEvents);
  $('loginFilter').addEventListener('input', renderEvents);
  $('databaseFilter').addEventListener('input', renderEvents);
  $('excludeInput').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const value = $('excludeInput').value.trim();
    if (value && !state.excludedStrings.includes(value)) state.excludedStrings.push(value);
    $('excludeInput').value = '';
    renderExcludedStrings();
    renderEvents();
  });
  $('formatSql').addEventListener('click', () => {
    state.formatted = !state.formatted;
    $('formatSql').classList.toggle('active', state.formatted);
    renderSqlDetail();
  });
  $('copySql').addEventListener('click', () => {
    const text = selectedEvents().map((event) => event.textData || '').filter(Boolean).join('\n\n');
    if (text) vscode.postMessage({ type: 'copy', text });
  });
  $('sqlDetail').addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLocaleLowerCase();
    if (key === 'a') {
      event.preventDefault();
      event.stopImmediatePropagation();
      selectSqlDetailText();
    } else if (key === 'c') {
      const selectedText = selectedSqlDetailText();
      if (selectedText) {
        event.preventDefault();
        event.stopImmediatePropagation();
        vscode.postMessage({ type: 'copy', text: selectedText });
      }
    }
  }, true);
  $('sqlDetail').addEventListener('beforeinput', (event) => event.preventDefault());
  $('sqlDetail').addEventListener('paste', (event) => event.preventDefault());
  $('sqlDetail').addEventListener('drop', (event) => event.preventDefault());
}

function renderEventOptions() {
  const target = $('eventOptions');
  for (const [id, name, checked] of eventDefinitions) {
    const label = document.createElement('label');
    label.className = 'inline';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = String(id);
    input.checked = checked;
    label.append(input, document.createTextNode(` ${name}`));
    target.append(label);
  }
}

function openProfileEditor(profile) {
  const value = profile || {};
  $('profileId').value = value.id || '';
  $('profileScope').value = value.scope || 'custom';
  $('profileName').value = value.name || '';
  $('server').value = value.server || '';
  $('port').value = String(value.port || 1433);
  $('database').value = value.database || '';
  $('user').value = value.user || '';
  $('password').value = value.password || '';
  $('useTraceCredentials').checked = Boolean(value.useTraceCredentials);
  $('traceUser').value = value.traceUser || '';
  $('tracePassword').value = value.tracePassword || '';
  $('encrypt').checked = value.encrypt !== false;
  $('trustServerCertificate').checked = value.trustServerCertificate !== false;
  $('deleteProfile').classList.toggle('hidden', !value.id || value.scope === 'shared');
  $('saveProfile').textContent = value.scope === 'shared' ? '개인 사본 저장' : '저장';
  updateTraceCredentialsVisibility();
  $('profileEditor').classList.remove('hidden');
  $('profileName').focus();
}

function closeProfileEditor() {
  $('profileEditor').classList.add('hidden');
}

function updateTraceCredentialsVisibility() {
  $('traceCredentials').classList.toggle('hidden', !$('useTraceCredentials').checked);
}

function saveProfile() {
  const profile = {
    id: $('profileId').value || undefined,
    scope: $('profileScope').value || 'custom',
    name: $('profileName').value,
    server: $('server').value,
    port: Number($('port').value || 1433),
    database: $('database').value,
    user: $('user').value,
    password: $('password').value,
    useTraceCredentials: $('useTraceCredentials').checked,
    traceUser: $('traceUser').value,
    tracePassword: $('tracePassword').value,
    encrypt: $('encrypt').checked,
    trustServerCertificate: $('trustServerCertificate').checked
  };
  vscode.postMessage({ type: 'saveProfile', profile });
  closeProfileEditor();
}

function deleteProfile() {
  const id = $('profileId').value;
  if (id) vscode.postMessage({ type: 'deleteProfile', id });
  closeProfileEditor();
}

function renderProfiles(selectedId) {
  const select = $('profileSelect');
  const selectedAfterSave = selectedId && state.profiles.find((profile) => profile.id === selectedId && profile.scope === 'custom');
  const previous = selectedAfterSave ? profileKey(selectedAfterSave) : select.value;
  select.replaceChildren();
  const storage = document.createElement('option');
  storage.value = '__open_storage__';
  storage.textContent = '📂 개인 서버 프로필 파일 열기…';
  select.append(storage);
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = state.profiles.length ? '연결 프로필 선택' : '새 프로필을 만들어주세요';
  placeholder.selected = true;
  select.append(placeholder);
  for (const profile of state.profiles) {
    const option = document.createElement('option');
    option.value = profileKey(profile);
    option.textContent = `${profile.scope === 'shared' ? '[공용]' : '[개인]'} ${profile.name} — ${profile.server}/${profile.database || 'master'}`;
    select.append(option);
  }
  if (state.profiles.some((profile) => profileKey(profile) === previous)) select.value = previous;
  select.dataset.lastValue = select.value;
  $('editProfile').disabled = !selectedProfile();
}

function selectedProfile() {
  return state.profiles.find((profile) => profileKey(profile) === $('profileSelect').value);
}

function profileKey(profile) {
  return `${profile.scope}:${profile.id}`;
}

function addServerFilterRow(initial) {
  const row = document.createElement('div');
  row.className = 'filter-row';
  const column = document.createElement('select');
  for (const [value, label] of filterColumns) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    column.append(option);
  }
  const operator = document.createElement('select');
  const refreshOperators = () => {
    const type = filterColumns.find((item) => item[0] === column.value)[2];
    const items = type === 'string'
      ? [[0, '='], [1, '≠'], [6, 'LIKE'], [7, 'NOT LIKE']]
      : [[0, '='], [1, '≠'], [2, '>'], [3, '<'], [4, '≥'], [5, '≤']];
    operator.replaceChildren(...items.map(([value, label]) => {
      const option = document.createElement('option');
      option.value = String(value);
      option.textContent = label;
      return option;
    }));
  };
  column.addEventListener('change', refreshOperators);
  const value = document.createElement('input');
  value.placeholder = '필터 값';
  const logic = document.createElement('select');
  logic.innerHTML = '<option value="0">AND</option><option value="1">OR</option>';
  const remove = document.createElement('button');
  remove.textContent = '삭제';
  remove.addEventListener('click', () => row.remove());
  row.append(column, operator, value, logic, remove);
  $('serverFilters').append(row);
  if (initial) {
    column.value = initial.column;
    refreshOperators();
    operator.value = String(initial.comparisonOperator);
    value.value = String(initial.value);
    logic.value = String(initial.logicalOperator);
  } else refreshOperators();
}

function collectServerFilters() {
  return [...document.querySelectorAll('.filter-row')].map((row) => ({
    column: row.children[0].value,
    comparisonOperator: Number(row.children[1].value),
    value: row.children[2].value,
    logicalOperator: Number(row.children[3].value)
  })).filter((filter) => filter.value !== '');
}

function renderFilterPresets(selectedId) {
  const select = $('filterPresetSelect');
  const selectedAfterSave = selectedId && state.filterPresets.find((preset) => preset.id === selectedId && preset.scope === 'custom');
  const previous = selectedAfterSave ? profileKey(selectedAfterSave) : select.value;
  select.replaceChildren();
  const storage = document.createElement('option');
  storage.value = '__open_storage__';
  storage.textContent = '📂 개인 필터 프로필 파일 열기…';
  select.append(storage);
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = state.filterPresets.length ? '필터 프로필 선택' : '저장된 필터 프로필 없음';
  placeholder.selected = true;
  select.append(placeholder);
  for (const preset of state.filterPresets) {
    const option = document.createElement('option');
    option.value = profileKey(preset);
    option.textContent = `${preset.scope === 'shared' ? '[공용]' : '[개인]'} ${preset.name}`;
    select.append(option);
  }
  if (state.filterPresets.some((preset) => profileKey(preset) === previous)) select.value = previous;
  select.dataset.lastValue = select.value;
  const selected = selectedFilterPreset();
  $('filterPresetName').value = selected ? selected.name : '';
  $('deleteFilterPreset').disabled = !selected || selected.scope === 'shared';
  $('saveFilterPreset').textContent = selected && selected.scope === 'shared' ? '개인 사본 저장' : '저장';
}

function selectedFilterPreset() {
  return state.filterPresets.find((preset) => profileKey(preset) === $('filterPresetSelect').value);
}

function collectFilterPreset() {
  const selected = selectedFilterPreset();
  return {
    id: selected ? selected.id : undefined,
    scope: selected ? selected.scope : 'custom',
    name: $('filterPresetName').value,
    filters: {
      eventIds: [...document.querySelectorAll('#eventOptions input:checked')].map((input) => Number(input.value)),
      serverFilters: collectServerFilters(),
      textFilter: $('textFilter').value,
      eventFilter: $('eventFilter').value,
      loginFilter: $('loginFilter').value,
      databaseFilter: $('databaseFilter').value,
      excludedStrings: [...state.excludedStrings]
    }
  };
}

function saveFilterPreset() {
  if (!$('filterPresetName').value.trim()) {
    showToast('필터 프로필 이름을 입력하세요.', true);
    return;
  }
  vscode.postMessage({ type: 'saveFilterPreset', preset: collectFilterPreset() });
}

function deleteFilterPreset() {
  const preset = selectedFilterPreset();
  if (preset) {
    vscode.postMessage({ type: 'deleteFilterPreset', id: preset.id });
    resetFilters();
  }
}

function applySelectedFilterPreset() {
  const preset = selectedFilterPreset();
  $('deleteFilterPreset').disabled = !preset || preset.scope === 'shared';
  $('saveFilterPreset').textContent = preset && preset.scope === 'shared' ? '개인 사본 저장' : '저장';
  $('filterPresetName').value = preset ? preset.name : '';
  if (!preset) {
    resetFilters();
    return;
  }
  const filters = preset.filters || {};
  const eventIds = new Set(filters.eventIds || []);
  for (const input of document.querySelectorAll('#eventOptions input')) {
    input.checked = eventIds.has(Number(input.value));
  }
  $('serverFilters').replaceChildren();
  for (const filter of filters.serverFilters || []) addServerFilterRow(filter);
  $('textFilter').value = filters.textFilter || '';
  $('eventFilter').value = filters.eventFilter || '';
  $('loginFilter').value = filters.loginFilter || '';
  $('databaseFilter').value = filters.databaseFilter || '';
  state.excludedStrings = Array.isArray(filters.excludedStrings) ? [...filters.excludedStrings] : [];
  renderExcludedStrings();
  renderEvents();
}

function resetFilters() {
  const defaults = new Map(eventDefinitions.map(([id, , checked]) => [id, checked]));
  for (const input of document.querySelectorAll('#eventOptions input')) {
    input.checked = defaults.get(Number(input.value)) === true;
  }
  $('serverFilters').replaceChildren();
  $('textFilter').value = '';
  $('eventFilter').value = '';
  $('loginFilter').value = '';
  $('databaseFilter').value = '';
  state.excludedStrings = [];
  renderExcludedStrings();
  renderEvents();
}

function renderExcludedStrings() {
  const target = $('excludeChips');
  target.replaceChildren();
  for (const value of state.excludedStrings) {
    const chip = document.createElement('span');
    chip.className = 'exclude-chip';
    const text = document.createElement('span');
    text.textContent = value;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `${value} 제외 문자열 제거`);
    remove.addEventListener('click', () => {
      state.excludedStrings = state.excludedStrings.filter((item) => item !== value);
      renderExcludedStrings();
      renderEvents();
    });
    chip.append(text, remove);
    target.append(chip);
  }
}

function startTrace() {
  const profile = selectedProfile();
  if (!profile) {
    showToast('연결 프로필을 선택하세요.', true);
    return;
  }
  const eventIds = [...document.querySelectorAll('#eventOptions input:checked')].map((input) => Number(input.value));
  if (!eventIds.length) {
    showToast('수집 이벤트를 하나 이상 선택하세요.', true);
    return;
  }
  vscode.postMessage({
    type: 'start',
    profileId: profile.id,
    profileScope: profile.scope,
    eventIds,
    serverFilters: collectServerFilters(),
    maxDurationMinutes: Number($('maxTraceMinutes').value || 30)
  });
}

function appendEvent(event) {
  event.rowNumber = state.nextRowNumber;
  state.nextRowNumber += 1;
  state.events.push(event);
  if (state.events.length > 10000) {
    const removed = state.events.shift();
    state.selectedRows.delete(removed.rowNumber);
    if (state.selectionAnchor === removed.rowNumber) state.selectionAnchor = null;
  }
  renderEvents();
}

function clearEvents() {
  state.events = [];
  state.selectedRows.clear();
  state.selectionAnchor = null;
  state.nextRowNumber = 1;
  renderEvents();
  renderSqlDetail();
}

function visibleEvents() {
  const text = $('textFilter').value.toLocaleLowerCase();
  const event = $('eventFilter').value.toLocaleLowerCase();
  const login = $('loginFilter').value.toLocaleLowerCase();
  const database = $('databaseFilter').value.toLocaleLowerCase();
  const excluded = state.excludedStrings.map((value) => value.toLocaleLowerCase());
  return state.events.filter((item) =>
    item.isSystem || (
    (!text || String(item.textData || '').toLocaleLowerCase().includes(text)) &&
    (!event || String(item.eventClass || '').toLocaleLowerCase().includes(event)) &&
    (!login || String(item.loginName || '').toLocaleLowerCase().includes(login)) &&
    (!database || String(item.databaseName || '').toLocaleLowerCase().includes(database)) &&
    !excluded.some((value) => String(item.textData || '').toLocaleLowerCase().includes(value) || String(item.eventClass || '').toLocaleLowerCase().includes(value)))
  );
}

function renderEvents() {
  const rows = $('eventRows');
  rows.replaceChildren();
  const visible = visibleEvents();
  for (const event of visible) {
    const tr = document.createElement('tr');
    if (event.isSystem) tr.classList.add('system-event');
    if (state.selectedRows.has(event.rowNumber)) tr.classList.add('selected');
    const values = [event.rowNumber, event.eventClass, oneLine(event.textData), event.loginName || '', event.databaseName || ''];
    values.forEach((value, index) => {
      const td = document.createElement('td');
      td.textContent = String(value == null ? '' : value);
      if (index === 2) td.title = event.textData || '';
      tr.append(td);
    });
    tr.addEventListener('click', (clickEvent) => selectEvent(event, clickEvent.shiftKey, visible));
    rows.append(tr);
  }
  $('emptyState').classList.toggle('hidden', visible.length > 0);
  $('eventCount').textContent = `${visible.length} / ${state.events.length}건`;
}

function renderSqlDetail() {
  const code = $('sqlDetail').querySelector('code');
  code.replaceChildren();
  const selected = selectedEvents();
  if (!selected.length) {
    code.textContent = '선택한 이벤트의 SQL 전문이 여기에 표시됩니다.';
    return;
  }
  const raw = selected.map((event) => event.textData || '').filter(Boolean).join('\n\n');
  const text = state.formatted ? formatSql(raw) : raw;
  highlightSql(code, text);
}

function selectedEvents() {
  return state.events.filter((event) => state.selectedRows.has(event.rowNumber));
}

function selectSqlDetailText() {
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents($('sqlDetail').querySelector('code'));
  selection.removeAllRanges();
  selection.addRange(range);
}

function selectedSqlDetailText() {
  const selection = window.getSelection();
  const detail = $('sqlDetail');
  if (!selection || !selection.rangeCount || !detail.contains(selection.anchorNode) || !detail.contains(selection.focusNode)) return '';
  return selection.toString();
}

function selectEvent(event, extendRange, visible) {
  const anchorIndex = visible.findIndex((item) => item.rowNumber === state.selectionAnchor);
  const targetIndex = visible.findIndex((item) => item.rowNumber === event.rowNumber);
  state.selectedRows.clear();
  if (extendRange && anchorIndex >= 0 && targetIndex >= 0) {
    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);
    for (const item of visible.slice(start, end + 1)) state.selectedRows.add(item.rowNumber);
  } else {
    state.selectedRows.add(event.rowNumber);
    state.selectionAnchor = event.rowNumber;
  }
  renderEvents();
  renderSqlDetail();
}

function highlightSql(target, sql) {
  const tokenPattern = /(--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|\b(?:SELECT|FROM|WHERE|JOIN|INNER|LEFT|RIGHT|FULL|ON|AND|OR|INSERT|INTO|VALUES|UPDATE|SET|DELETE|EXEC|EXECUTE|DECLARE|BEGIN|END|AS|CASE|WHEN|THEN|ELSE|NULL|IS|NOT|IN|EXISTS|ORDER|BY|GROUP|HAVING|TOP|DISTINCT|CREATE|ALTER|DROP|PROCEDURE|RETURN)\b|\b\d+(?:\.\d+)?\b)/gi;
  let offset = 0;
  for (const match of sql.matchAll(tokenPattern)) {
    if (match.index > offset) target.append(document.createTextNode(sql.slice(offset, match.index)));
    const span = document.createElement('span');
    const token = match[0];
    span.className = token.startsWith('--') || token.startsWith('/*') ? 'sql-comment'
      : token.startsWith("'") ? 'sql-string'
        : /^\d/.test(token) ? 'sql-number' : 'sql-keyword';
    span.textContent = token;
    target.append(span);
    offset = match.index + token.length;
  }
  if (offset < sql.length) target.append(document.createTextNode(sql.slice(offset)));
}

function formatSql(sql) {
  return sql.replace(/\s+(FROM|WHERE|(?:INNER|LEFT|RIGHT|FULL)\s+JOIN|JOIN|GROUP\s+BY|ORDER\s+BY|HAVING|VALUES|SET)\b/gi, '\n$1')
    .replace(/\s+(AND|OR)\s+/gi, '\n  $1 ')
    .trim();
}

function oneLine(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function updateStatus(status, details) {
  state.status = status;
  const labels = { idle: '대기', starting: '연결 중', running: '수집 중', paused: '정지', ending: '종료 중', ended: '종료', error: '오류' };
  $('status').textContent = `${labels[status] || status}${details && details.traceId ? ` · Trace ${details.traceId}` : ''}`;
  $('status').className = `status ${status}`;
  $('start').disabled = ['running', 'starting', 'ending'].includes(status);
  $('start').textContent = status === 'paused' ? '▶ 재개' : '▶ 시작';
  $('pause').disabled = status !== 'running';
  $('end').disabled = !['running', 'paused'].includes(status);
  $('profileSelect').disabled = ['running', 'paused', 'starting', 'ending'].includes(status);
}

function showToast(message, error) {
  const toast = $('toast');
  toast.textContent = message;
  toast.className = error ? 'show error' : 'show';
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => { toast.className = ''; }, 3000);
}

window.addEventListener('message', ({ data }) => {
  switch (data.type) {
    case 'profiles':
      state.profiles = data.profiles || [];
      renderProfiles(data.selectedId);
      break;
    case 'filterPresets':
      state.filterPresets = data.presets || [];
      renderFilterPresets(data.selectedId);
      break;
    case 'traceEvent': appendEvent(data.event); break;
    case 'status': updateStatus(data.status, data.details); break;
    case 'toast': showToast(data.message, false); break;
    case 'error': showToast(data.message, true); break;
    default: break;
  }
});

initialize();
