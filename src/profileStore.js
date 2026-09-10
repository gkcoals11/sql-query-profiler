'use strict';

const vscode = require('vscode');

class ProfileStore {
  constructor(context) {
    this.context = context;
    this.file = vscode.Uri.joinPath(context.globalStorageUri, 'profiles.json');
  }

  async load() {
    try {
      const bytes = await vscode.workspace.fs.readFile(this.file);
      return validateDocument(JSON.parse(Buffer.from(bytes).toString('utf8'))).profiles;
    } catch (error) {
      if (error && (error.code === 'FileNotFound' || error.code === 'ENOENT')) return [];
      throw error;
    }
  }

  async save(profiles) {
    await vscode.workspace.fs.createDirectory(this.context.globalStorageUri);
    const body = JSON.stringify({ version: 1, profiles: profiles.map(normalizeProfile) }, null, 2);
    await vscode.workspace.fs.writeFile(this.file, Buffer.from(body, 'utf8'));
  }

  async importFromFile() {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { 'Profiler profiles': ['json'] },
      openLabel: '프로필 가져오기'
    });
    if (!picked || !picked[0]) return null;
    const bytes = await vscode.workspace.fs.readFile(picked[0]);
    return validateDocument(JSON.parse(Buffer.from(bytes).toString('utf8'))).profiles;
  }

  async exportToFile(profiles) {
    const target = await vscode.window.showSaveDialog({
      filters: { 'Profiler profiles': ['json'] },
      defaultUri: vscode.Uri.file('legacy-sql-trace-profiles.json'),
      saveLabel: '프로필 내보내기'
    });
    if (!target) return false;
    const body = JSON.stringify({ version: 1, profiles: profiles.map(normalizeProfile) }, null, 2);
    await vscode.workspace.fs.writeFile(target, Buffer.from(body, 'utf8'));
    return true;
  }
}

function normalizeProfile(profile) {
  const port = Number(profile.port || 1433);
  return {
    id: String(profile.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`),
    name: String(profile.name || '').trim(),
    server: String(profile.server || '').trim(),
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 1433,
    database: String(profile.database || '').trim(),
    user: String(profile.user || '').trim(),
    password: String(profile.password || ''),
    useTraceCredentials: Boolean(profile.useTraceCredentials),
    traceUser: String(profile.traceUser || '').trim(),
    tracePassword: String(profile.tracePassword || ''),
    trustServerCertificate: profile.trustServerCertificate !== false,
    encrypt: profile.encrypt !== false
  };
}

function validateDocument(document) {
  const source = Array.isArray(document) ? document : document && document.profiles;
  if (!Array.isArray(source)) throw new Error('프로필 JSON에 profiles 배열이 없습니다.');
  const profiles = source.map(normalizeProfile);
  for (const profile of profiles) {
    if (!profile.name || !profile.server || !profile.user) {
      throw new Error('각 프로필에는 name, server, user가 필요합니다.');
    }
    if (profile.useTraceCredentials && !profile.traceUser) {
      throw new Error(`${profile.name}: Trace 전용 계정명이 없습니다.`);
    }
  }
  return { version: 1, profiles };
}

module.exports = { ProfileStore, normalizeProfile, validateDocument };
