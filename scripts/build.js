'use strict';
const path = require('path');
const esbuild = require('esbuild');

esbuild.build({
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
}).catch(() => process.exit(1));
