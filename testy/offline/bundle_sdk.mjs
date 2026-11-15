// Buduje prawdziwe moduły Firebase 10.14.1 (te same, które strona bierze z gstatic) jako pliki ESM do lokalnego "CDN" testu startu offline.
// Użycie: node bundle_sdk.mjs <katalog z node_modules firebase i esbuild> <adres CDN, np. http://127.0.0.1:8612/firebasejs/10.14.1/>
import { createRequire } from 'node:module';
import path from 'node:path';
const [dir, cdn] = process.argv.slice(2);
const require = createRequire(path.join(dir, 'package.json'));
const esbuild = require('esbuild');
const appExt = { name: 'appext', setup(b) { b.onResolve({ filter: /^@firebase\/app$/ }, () => ({ path: cdn + 'firebase-app.js', external: true })); } };
const mk = (name, entry) => esbuild.build({
  stdin: { contents: `export * from '${entry}';`, resolveDir: dir }, bundle: true, format: 'esm',
  outfile: path.join(dir, 'cdn', 'firebasejs', '10.14.1', name + '.js'), plugins: name === 'firebase-app' ? [] : [appExt], platform: 'browser', minify: true, logLevel: 'error' });
await mk('firebase-app', 'firebase/app'); await mk('firebase-auth', 'firebase/auth'); await mk('firebase-firestore', 'firebase/firestore'); await mk('firebase-app-check', 'firebase/app-check');
