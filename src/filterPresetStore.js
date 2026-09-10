'use strict';
const vscode = require('vscode');

class FilterPresetStore {
  constructor(context) {
    this.context = context;
    this.sharedFile = vscode.Uri.joinPath(context.extensionUri, 'data', 'filter-profiles.json');
    this.customFile = vscode.Uri.joinPath(context.globalStorageUri, 'filter-profiles.json');
  }

  async load() {
    const shared = (await readPresets(this.sharedFile)).map((preset) => ({ ...preset, scope: 'shared' }));
    if (!(await exists(this.customFile))) await this.saveCustom([]);
    const custom = await readPresets(this.customFile);
    return [...shared, ...custom.map((preset) => ({ ...preset, scope: 'custom' }))];
  }

  async saveCustom(presets) {
    await vscode.workspace.fs.createDirectory(this.context.globalStorageUri);
    const body = JSON.stringify({ version: 1, profiles: presets.map(normalizeFilterPreset) }, null, 2);
    await vscode.workspace.fs.writeFile(this.customFile, Buffer.from(body, 'utf8'));
  }

  async revealCustomFile() {
    if (!(await exists(this.customFile))) await this.saveCustom([]);
    await vscode.commands.executeCommand('revealFileInOS', this.customFile);
  }
}

async function readPresets(file) {
  try {
    const bytes = await vscode.workspace.fs.readFile(file);
    return validateFilterPresetDocument(JSON.parse(Buffer.from(bytes).toString('utf8'))).presets;
  } catch (error) {
    if (error && (error.code === 'FileNotFound' || error.code === 'ENOENT')) return [];
    throw error;
  }
}
async function exists(file) { try { await vscode.workspace.fs.stat(file); return true; } catch (_) { return false; } }

function normalizeFilterPreset(preset) {
  const filters = preset.filters || {};
  return {
    id: String(preset.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`), name: String(preset.name || '').trim(),
    filters: {
      eventIds: Array.isArray(filters.eventIds) ? filters.eventIds.map(Number).filter(Number.isInteger) : [],
      serverFilters: Array.isArray(filters.serverFilters) ? filters.serverFilters : [], textFilter: String(filters.textFilter || ''),
      eventFilter: String(filters.eventFilter || ''), loginFilter: String(filters.loginFilter || '')
    }
  };
}

function validateFilterPresetDocument(document) {
  const source = Array.isArray(document) ? document : document && (document.profiles || document.presets);
  if (!Array.isArray(source)) throw new Error('필터 프로필 JSON에 profiles 배열이 없습니다.');
  return { version: 1, presets: source.map(normalizeFilterPreset).filter((preset) => preset.name) };
}
module.exports = { FilterPresetStore, normalizeFilterPreset, validateFilterPresetDocument };
