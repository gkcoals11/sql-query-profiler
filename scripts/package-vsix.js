'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-sql-profiler-vsix-'));
const extensionDir = path.join(stage, 'extension');
const output = path.join(root, 'outputs', `legacy-sql-trace-profiler-${manifest.version}.vsix`);

try {
  fs.mkdirSync(extensionDir, { recursive: true });
  for (const file of ['package.json', 'README.md', 'CHANGELOG.md']) fs.copyFileSync(path.join(root, file), path.join(extensionDir, file));
  fs.cpSync(path.join(root, 'dist'), path.join(extensionDir, 'dist'), { recursive: true });
  fs.cpSync(path.join(root, 'media'), path.join(extensionDir, 'media'), { recursive: true });
  fs.writeFileSync(path.join(stage, '[Content_Types].xml'), contentTypes(), 'utf8');
  fs.writeFileSync(path.join(stage, 'extension.vsixmanifest'), vsixManifest(manifest), 'utf8');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  if (fs.existsSync(output)) fs.rmSync(output);
  const result = createArchive(stage, output);
  if (result.status !== 0) throw new Error(result.stderr || 'zip failed');
  console.log(output);
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}

function createArchive(stageDirectory, outputFile) {
  if (process.platform === 'win32') {
    const source = path.join(stageDirectory, '*').replace(/'/g, "''");
    const zipOutput = `${outputFile}.zip`;
    const destination = zipOutput.replace(/'/g, "''");
    if (fs.existsSync(zipOutput)) fs.rmSync(zipOutput);
    const result = spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `Compress-Archive -Path '${source}' -DestinationPath '${destination}' -Force`
    ], { encoding: 'utf8' });
    if (result.status === 0) fs.renameSync(zipOutput, outputFile);
    return result;
  }
  return spawnSync('zip', ['-q', '-r', outputFile, '[Content_Types].xml', 'extension.vsixmanifest', 'extension'], {
    cwd: stageDirectory,
    encoding: 'utf8'
  });
}

function contentTypes() {
  return `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json"/><Default Extension="js" ContentType="application/javascript"/>
  <Default Extension="css" ContentType="text/css"/><Default Extension="md" ContentType="text/markdown"/>
  <Default Extension="map" ContentType="application/json"/><Default Extension="vsixmanifest" ContentType="text/xml"/>
</Types>`;
}

function vsixManifest(pkg) {
  return `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata><Identity Language="en-US" Id="${xml(pkg.name)}" Version="${xml(pkg.version)}" Publisher="${xml(pkg.publisher)}"/>
    <DisplayName>${xml(pkg.displayName)}</DisplayName><Description xml:space="preserve">${xml(pkg.description)}</Description>
    <Tags>mssql,sql server,profiler,trace</Tags><Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value="${xml(pkg.engines.vscode)}"/><Property Id="Microsoft.VisualStudio.Services.Content.Pricing" Value="Free"/></Properties>
  </Metadata>
  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code" Version="[1.85.0,)"/></Installation><Dependencies/>
  <Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/><Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true"/><Asset Type="Microsoft.VisualStudio.Services.Content.Changelog" Path="extension/CHANGELOG.md" Addressable="true"/></Assets>
</PackageManifest>`;
}
function xml(value) { return String(value).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c])); }
