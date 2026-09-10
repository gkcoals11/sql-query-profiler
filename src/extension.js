'use strict';

const vscode = require('vscode');
const { ProfileStore, normalizeProfile } = require('./profileStore');
const { LegacyTraceClient } = require('./traceClient');

let activePanel;

function activate(context) {
  context.subscriptions.push(vscode.commands.registerCommand('legacySqlTraceProfiler.open', async () => {
    if (activePanel) {
      activePanel.reveal();
      return;
    }
    activePanel = new ProfilerPanel(context);
    await activePanel.initialize();
  }));
}

async function deactivate() {
  if (activePanel) await activePanel.dispose();
}

class ProfilerPanel {
  constructor(context) {
    this.context = context;
    this.store = new ProfileStore(context);
    this.profiles = [];
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
      onError: (error) => this.reportError(error)
    });
    this.panel.webview.html = renderHtml(this.panel.webview, context.extensionUri);
    this.panel.webview.onDidReceiveMessage((message) => this.handleMessage(message), null, context.subscriptions);
    this.panel.onDidDispose(() => {
      this.trace.dispose();
      activePanel = undefined;
    }, null, context.subscriptions);
  }

  async initialize() {
    try {
      this.profiles = await this.store.load();
    } catch (error) {
      this.reportError(error);
    }
  }

  reveal() {
    this.panel.reveal(vscode.ViewColumn.One);
  }

  async handleMessage(message) {
    try {
      switch (message.type) {
        case 'ready':
          this.post({ type: 'profiles', profiles: this.profiles });
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
        case 'start':
          await this.startTrace(message);
          break;
        case 'pause':
          await this.trace.pause();
          break;
        case 'end':
          await this.trace.end();
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
    const profile = normalizeProfile(input || {});
    if (!profile.name || !profile.server || !profile.user) {
      throw new Error('프로필 이름, 서버, 기본 계정은 필수입니다.');
    }
    if (profile.useTraceCredentials && !profile.traceUser) {
      throw new Error('Trace 전용 계정을 사용하려면 계정명을 입력하세요.');
    }
    const index = this.profiles.findIndex((item) => item.id === profile.id);
    if (index >= 0) this.profiles[index] = profile;
    else this.profiles.push(profile);
    await this.store.save(this.profiles);
    this.post({ type: 'profiles', profiles: this.profiles, selectedId: profile.id });
    this.post({ type: 'toast', message: '연결 프로필을 저장했습니다.' });
  }

  async deleteProfile(id) {
    this.profiles = this.profiles.filter((profile) => profile.id !== id);
    await this.store.save(this.profiles);
    this.post({ type: 'profiles', profiles: this.profiles });
  }

  async importProfiles() {
    const imported = await this.store.importFromFile();
    if (!imported) return;
    const byId = new Map(this.profiles.map((profile) => [profile.id, profile]));
    for (const profile of imported) byId.set(profile.id, profile);
    this.profiles = [...byId.values()];
    await this.store.save(this.profiles);
    this.post({ type: 'profiles', profiles: this.profiles });
    this.post({ type: 'toast', message: `${imported.length}개 프로필을 가져왔습니다.` });
  }

  async exportProfiles() {
    const saved = await this.store.exportToFile(this.profiles);
    if (saved) this.post({ type: 'toast', message: '비밀번호를 포함한 프로필 JSON을 내보냈습니다.' });
  }

  async startTrace(message) {
    const profile = this.profiles.find((item) => item.id === message.profileId);
    if (!profile) throw new Error('사용할 연결 프로필을 선택하세요.');
    await this.trace.start(profile, {
      eventIds: message.eventIds,
      serverFilters: message.serverFilters
    });
  }

  post(message) {
    if (this.panel) this.panel.webview.postMessage(message);
  }

  reportError(error) {
    const message = error instanceof Error ? error.message : String(error);
    this.post({ type: 'error', message });
    vscode.window.showErrorMessage(`Legacy SQL Trace Profiler: ${message}`);
  }

  async dispose() {
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
    <span id="eventCount">0 / 0건</span>
  </section>

  <main class="workspace">
    <section class="grid-wrap">
      <table>
        <thead><tr><th>#</th><th>EventClass</th><th>TextData</th><th>LoginName</th></tr></thead>
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
      <pre id="sqlDetail"><code>선택한 이벤트의 SQL 전문이 여기에 표시됩니다.</code></pre>
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
