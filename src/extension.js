'use strict';

const vscode = require('vscode');
const { ProfileStore, normalizeProfile } = require('./profileStore');
const { FilterPresetStore, normalizeFilterPreset } = require('./filterPresetStore');
const { LegacyTraceClient } = require('./traceClient');

let activePanel;

function activate(context) {
  const openProfiler = async () => {
    if (activePanel) {
      activePanel.reveal();
      return;
    }
    activePanel = new ProfilerPanel(context);
    await activePanel.initialize();
  };
  context.subscriptions.push(vscode.commands.registerCommand('legacySqlTraceProfiler.open', async () => {
    await openProfiler();
  }));
  context.subscriptions.push(vscode.window.registerTreeDataProvider('legacySqlTraceProfiler.actions', {
    getTreeItem: (item) => item,
    getChildren: () => {
      const item = new vscode.TreeItem('프로파일러 열기', vscode.TreeItemCollapsibleState.None);
      item.description = 'SQL Trace 수집 및 조회';
      item.iconPath = new vscode.ThemeIcon('database');
      item.command = { command: 'legacySqlTraceProfiler.open', title: '프로파일러 열기' };
      return [item];
    }
  }));
}

async function deactivate() {
  if (activePanel) await activePanel.dispose();
}

class ProfilerPanel {
  constructor(context) {
    this.context = context;
    this.store = new ProfileStore(context);
    this.filterPresetStore = new FilterPresetStore(context);
    this.profiles = [];
    this.filterPresets = [];
    this.profileWatchers = [];
    this.profileReloadTimer = null;
    this.panel = vscode.window.createWebviewPanel(
      'legacySqlTraceProfiler',
      'Legacy SQL Trace Profiler',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
      }
    );
    this.trace = new LegacyTraceClient({
      onEvent: (event) => this.post({ type: 'traceEvent', event }),
      onStatus: (status, details) => this.post({ type: 'status', status, details }),
      onError: (error) => this.reportError(error, true),
      onExpired: ({ maxDurationMinutes }) => this.postSystemEvent('Profiler:Info', `설정한 ${maxDurationMinutes}분의 수집 시간이 끝나 프로파일링을 종료했습니다.`)
    });
    this.panel.webview.html = renderHtml(this.panel.webview, context.extensionUri);
    this.panel.webview.onDidReceiveMessage((message) => this.handleMessage(message), null, context.subscriptions);
    this.watchProfileFiles();
    this.panel.onDidDispose(() => {
      this.trace.dispose();
      this.disposeProfileWatchers();
      activePanel = undefined;
    }, null, context.subscriptions);
  }

  async initialize() {
    try {
      this.profiles = await this.store.load();
      this.filterPresets = await this.filterPresetStore.load();
      this.post({ type: 'profiles', profiles: this.profiles });
      this.post({ type: 'filterPresets', presets: this.filterPresets });
    } catch (error) {
      this.reportError(error);
    }
  }

  watchProfileFiles() {
    const targets = [
      [this.context.extensionUri, 'data/server-profiles.json'],
      [this.context.extensionUri, 'data/filter-profiles.json'],
      [this.context.globalStorageUri, 'server-profiles.json'],
      [this.context.globalStorageUri, 'filter-profiles.json']
    ];
    for (const [base, pattern] of targets) {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(base, pattern));
      const scheduleReload = () => {
        clearTimeout(this.profileReloadTimer);
        this.profileReloadTimer = setTimeout(() => this.reloadProfilesFromDisk(), 150);
      };
      watcher.onDidCreate(scheduleReload);
      watcher.onDidChange(scheduleReload);
      watcher.onDidDelete(scheduleReload);
      this.profileWatchers.push(watcher);
    }
  }

  async reloadProfilesFromDisk() {
    try {
      this.profiles = await this.store.load();
      this.filterPresets = await this.filterPresetStore.load();
      this.post({ type: 'profiles', profiles: this.profiles });
      this.post({ type: 'filterPresets', presets: this.filterPresets });
      this.post({ type: 'toast', message: '프로필 파일 변경사항을 반영했습니다.' });
    } catch (error) {
      this.reportError(error, ['start', 'pause', 'end'].includes(message.type));
    }
  }

  disposeProfileWatchers() {
    clearTimeout(this.profileReloadTimer);
    this.profileReloadTimer = null;
    for (const watcher of this.profileWatchers) watcher.dispose();
    this.profileWatchers = [];
  }

  reveal() {
    this.panel.reveal(vscode.ViewColumn.One);
  }

  async handleMessage(message) {
    try {
      switch (message.type) {
        case 'ready':
          this.post({ type: 'profiles', profiles: this.profiles });
          this.post({ type: 'filterPresets', presets: this.filterPresets });
          this.post({ type: 'status', status: this.trace.state });
          break;
        case 'saveProfile':
          await this.saveProfile(message.profile);
          break;
        case 'deleteProfile':
          await this.deleteProfile(String(message.id));
          break;
        case 'importProfiles':
          await this.importProfiles();
          break;
        case 'exportProfiles':
          await this.exportProfiles();
          break;
        case 'saveFilterPreset':
          await this.saveFilterPreset(message.preset);
          break;
        case 'deleteFilterPreset':
          await this.deleteFilterPreset(String(message.id));
          break;
        case 'openProfileStorage':
          if (message.profileType === 'filter') await this.filterPresetStore.revealCustomFile();
          else await this.store.revealCustomFile();
          break;
        case 'start':
          await this.startTrace(message);
          break;
        case 'pause':
          await this.trace.pause();
          break;
        case 'end':
          await this.trace.end();
          this.postSystemEvent('Profiler:Info', '사용자 요청으로 프로파일링이 종료되었습니다.');
          break;
        case 'copy':
          await vscode.env.clipboard.writeText(String(message.text || ''));
          this.post({ type: 'toast', message: 'SQL을 클립보드에 복사했습니다.' });
          break;
        default:
          break;
      }
    } catch (error) {
      this.reportError(error);
    }
  }

  async saveProfile(input) {
    const sharedCopy = input && input.scope === 'shared';
    const profile = normalizeProfile(sharedCopy ? { ...input, id: undefined } : (input || {}));
    profile.scope = 'custom';
    if (!profile.name || !profile.server || !profile.user) {
      throw new Error('프로필 이름, 서버, 기본 계정은 필수입니다.');
    }
    if (profile.useTraceCredentials && !profile.traceUser) {
      throw new Error('Trace 전용 계정을 사용하려면 계정명을 입력하세요.');
    }
    const index = this.profiles.findIndex((item) => item.id === profile.id && item.scope === 'custom');
    if (index >= 0) this.profiles[index] = profile;
    else this.profiles.push(profile);
    await this.store.saveCustom(this.profiles.filter((item) => item.scope === 'custom'));
    this.post({ type: 'profiles', profiles: this.profiles, selectedId: profile.id });
    this.post({ type: 'toast', message: '연결 프로필을 저장했습니다.' });
  }

  async deleteProfile(id) {
    this.profiles = this.profiles.filter((profile) => profile.id !== id || profile.scope === 'shared');
    await this.store.saveCustom(this.profiles.filter((profile) => profile.scope === 'custom'));
    this.post({ type: 'profiles', profiles: this.profiles });
  }

  async importProfiles() {
    const imported = await this.store.importFromFile();
    if (!imported) return;
    const byId = new Map(this.profiles.map((profile) => [profile.id, profile]));
    for (const input of imported) {
      const collidesWithShared = this.profiles.some((profile) => profile.id === input.id && profile.scope === 'shared');
      const profile = { ...normalizeProfile(collidesWithShared ? { ...input, id: undefined } : input), scope: 'custom' };
      byId.set(profile.id, profile);
    }
    this.profiles = [...byId.values()];
    await this.store.saveCustom(this.profiles.filter((profile) => profile.scope === 'custom'));
    this.post({ type: 'profiles', profiles: this.profiles });
    this.post({ type: 'toast', message: `${imported.length}개 프로필을 가져왔습니다.` });
  }

  async exportProfiles() {
    const saved = await this.store.exportToFile(this.profiles);
    if (saved) this.post({ type: 'toast', message: '비밀번호를 포함한 프로필 JSON을 내보냈습니다.' });
  }

  async saveFilterPreset(input) {
    const sharedCopy = input && input.scope === 'shared';
    const preset = normalizeFilterPreset(sharedCopy ? { ...input, id: undefined } : (input || {}));
    preset.scope = 'custom';
    if (!preset.name) throw new Error('필터 프로필 이름을 입력하세요.');
    const index = this.filterPresets.findIndex((item) => item.id === preset.id && item.scope === 'custom');
    if (index >= 0) this.filterPresets[index] = preset;
    else this.filterPresets.push(preset);
    await this.filterPresetStore.saveCustom(this.filterPresets.filter((item) => item.scope === 'custom'));
    this.post({ type: 'filterPresets', presets: this.filterPresets, selectedId: preset.id });
    this.post({ type: 'toast', message: sharedCopy ? '공용 필터 프로필을 개인 프로필로 복사했습니다.' : '필터 프로필을 저장했습니다.' });
  }

  async deleteFilterPreset(id) {
    this.filterPresets = this.filterPresets.filter((preset) => preset.id !== id || preset.scope === 'shared');
    await this.filterPresetStore.saveCustom(this.filterPresets.filter((preset) => preset.scope === 'custom'));
    this.post({ type: 'filterPresets', presets: this.filterPresets });
    this.post({ type: 'toast', message: '필터 프로필을 삭제했습니다.' });
  }

  async startTrace(message) {
    const profile = this.profiles.find((item) => item.id === message.profileId && item.scope === message.profileScope);
    if (!profile) throw new Error('사용할 연결 프로필을 선택하세요.');
    await this.trace.start(profile, {
      eventIds: message.eventIds,
      serverFilters: message.serverFilters,
      maxDurationMinutes: message.maxDurationMinutes
    });
  }

  post(message) {
    if (this.panel) this.panel.webview.postMessage(message);
  }

  postSystemEvent(eventClass, textData) {
    this.post({ type: 'traceEvent', event: { eventClass, textData, isSystem: true } });
  }

  reportError(error, includeEvent = false) {
    const message = error instanceof Error ? error.message : String(error);
    if (includeEvent) this.postSystemEvent('Profiler:Error', `${message} 오류로 프로파일링이 종료되었습니다.`);
    this.post({ type: 'error', message });
    vscode.window.showErrorMessage(`Legacy SQL Trace Profiler: ${message}`);
  }

  async dispose() {
    this.disposeProfileWatchers();
    await this.trace.dispose();
    if (this.panel) this.panel.dispose();
  }
}

function renderHtml(webview, extensionUri) {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'app.js'));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'styles.css'));
  const nonce = makeNonce();
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${styleUri}">
  <title>Legacy SQL Trace Profiler</title>
</head>
<body>
  <header class="toolbar">
    <select id="profileSelect" aria-label="연결 프로필"></select>
    <button id="newProfile">새 프로필</button>
    <button id="editProfile">편집</button>
    <button id="importProfiles">가져오기</button>
    <button id="exportProfiles">내보내기</button>
    <span class="spacer"></span>
    <button id="start" class="primary">▶ 시작</button>
    <button id="pause">Ⅱ 정지</button>
    <button id="end">■ 종료</button>
    <button id="clear">결과 지우기</button>
    <span id="status" class="status idle">대기</span>
  </header>

  <section id="profileEditor" class="card hidden" aria-label="연결 프로필 편집">
    <div class="section-title">연결 프로필</div>
    <input id="profileId" type="hidden">
    <input id="profileScope" type="hidden">
    <div class="form-grid">
      <label>프로필 이름<input id="profileName" autocomplete="off"></label>
      <label>서버<input id="server" placeholder="server 또는 server\\instance" autocomplete="off"></label>
      <label>포트<input id="port" type="number" value="1433" min="1" max="65535"></label>
      <label>데이터베이스<input id="database" autocomplete="off"></label>
      <label>기본 계정<input id="user" autocomplete="username"></label>
      <label>기본 비밀번호<input id="password" type="password" autocomplete="current-password"></label>
    </div>
    <label class="inline"><input id="useTraceCredentials" type="checkbox"> 별도 Trace 전용 계정 사용</label>
    <div id="traceCredentials" class="form-grid hidden">
      <label>Trace 계정<input id="traceUser" autocomplete="username"></label>
      <label>Trace 비밀번호<input id="tracePassword" type="password" autocomplete="current-password"></label>
    </div>
    <div class="options">
      <label class="inline"><input id="encrypt" type="checkbox" checked> 암호화 연결</label>
      <label class="inline"><input id="trustServerCertificate" type="checkbox" checked> 서버 인증서 신뢰</label>
    </div>
    <div class="actions">
      <button id="saveProfile" class="primary">저장</button>
      <button id="deleteProfile" class="danger">삭제</button>
      <button id="cancelProfile">닫기</button>
    </div>
    <p class="hint">비밀번호는 요청한 사양에 따라 프로필 JSON에 평문으로 저장되며 내보내기 파일에도 포함됩니다.</p>
  </section>

  <details class="card settings">
    <summary>이벤트 및 서버 필터</summary>
    <div class="preset-toolbar">
      <select id="filterPresetSelect" aria-label="필터 프로필"><option value="">필터 프로필 선택</option></select>
      <input id="filterPresetName" placeholder="필터 프로필 이름" aria-label="필터 프로필 이름">
      <button id="newFilterPreset">새 필터 프로필</button>
      <button id="saveFilterPreset" class="primary">저장</button>
      <button id="deleteFilterPreset" class="danger" disabled>삭제</button>
      <button id="resetFilters">필터 초기화</button>
      <label class="duration-field">안전 자동 종료(분)<select id="maxTraceMinutes"><option>5</option><option>10</option><option>15</option><option>20</option><option>25</option><option selected>30</option></select></label>
    </div>
    <div class="settings-grid">
      <fieldset>
        <legend>수집 이벤트</legend>
        <div id="eventOptions" class="checkbox-grid"></div>
      </fieldset>
      <fieldset>
        <legend>수집 전 서버 필터</legend>
        <div id="serverFilters"></div>
        <button id="addServerFilter">필터 추가</button>
      </fieldset>
    </div>
  </details>

  <section class="screen-filters card">
    <label>TextData 필터<input id="textFilter" placeholder="포함할 내용"></label>
    <label>EventClass 필터<input id="eventFilter" placeholder="예: RPC"></label>
    <label>LoginName 필터<input id="loginFilter" placeholder="예: cubeerp"></label>
    <label>DatabaseName 필터<input id="databaseFilter" placeholder="예: SampleDb"></label>
    <span id="eventCount">0 / 0건</span>
    <div class="exclude-area">
      <label>제외 문자열<input id="excludeInput" placeholder="입력 후 Enter" autocomplete="off"></label>
      <div id="excludeChips" class="exclude-chips" aria-label="제외 문자열 목록"></div>
    </div>
  </section>

  <main class="workspace">
    <section class="grid-wrap">
      <table>
        <thead><tr><th>#</th><th>EventClass</th><th>TextData</th><th>LoginName</th><th>DatabaseName</th></tr></thead>
        <tbody id="eventRows"></tbody>
      </table>
      <div id="emptyState" class="empty">프로필을 선택하고 시작을 누르세요.</div>
    </section>
    <section class="detail">
      <div class="detail-toolbar">
        <strong>SQL 상세</strong>
        <button id="formatSql">줄바꿈 정리</button>
        <button id="copySql">SQL 복사</button>
      </div>
      <pre id="sqlDetail" tabindex="0" contenteditable="true" role="textbox" aria-readonly="true" aria-multiline="true" aria-label="선택된 이벤트의 SQL 상세" spellcheck="false"><code>선택한 이벤트의 SQL 전문이 여기에 표시됩니다.</code></pre>
    </section>
  </main>
  <div id="toast" role="status" aria-live="polite"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function makeNonce() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let i = 0; i < 32; i += 1) value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  return value;
}

module.exports = { activate, deactivate };
