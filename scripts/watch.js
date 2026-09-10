'use strict';
const path = require('path');
const esbuild = require('esbuild');

async function watch() {
  const context = await esbuild.context({
    entryPoints: [path.join(__dirname, '..', 'src', 'extension.js')],
    bundle: true,
    outfile: path.join(__dirname, '..', 'dist', 'extension.js'),
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    external: ['vscode'],
    sourcemap: true,
    legalComments: 'eof',
    logLevel: 'info'
  });
  await context.watch();
  console.log('Extension 빌드 감시 중: 변경 후 Extension Development Host를 다시 로드하세요.');
}

watch().catch(() => process.exit(1));
