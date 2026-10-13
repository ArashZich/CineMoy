// Bundles the server into one Node 18-compatible file for Android (nodejs-mobile is Node 18).
// Output: dist-node/server/index.mjs + dist-node/web/ (the UI it serves).
//
// Native addons can't run on Android without per-ABI builds, so they are stubbed:
//  - webrtc-polyfill / node-datachannel: WebRTC peers (browser-only swarms) — not needed.
//  - utp-native, bufferutil, utf-8-validate, fs-native-extensions: optional speed-ups that the
//    libraries already load inside try/catch and fall back from.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist-node');

const OPTIONAL_NATIVE = ['node-datachannel', 'utp-native', 'bufferutil', 'utf-8-validate', 'fs-native-extensions'];

const stubs = {
  name: 'android-stubs',
  setup(b) {
    b.onResolve({ filter: /^webrtc-polyfill$/ }, () => ({ path: 'webrtc', namespace: 'stub' }));
    b.onResolve({ filter: new RegExp(`^(${OPTIONAL_NATIVE.join('|')})(/.*)?$`) }, () => ({ path: 'native', namespace: 'stub' }));
    b.onLoad({ filter: /^webrtc$/, namespace: 'stub' }, () => ({
      contents: `class Unsupported { constructor() { throw new Error('WebRTC is not available in this build'); } }
        export const RTCPeerConnection = Unsupported, RTCSessionDescription = Unsupported, RTCIceCandidate = Unsupported;
        export default { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate };`,
      loader: 'js',
    }));
    b.onLoad({ filter: /^native$/, namespace: 'stub' }, () => ({
      contents: `throw new Error('native addon not available in this build');`,
      loader: 'js',
    }));
  },
};

fs.rmSync(out, { recursive: true, force: true });
await build({
  entryPoints: [path.join(root, 'server', 'index.js')],
  outfile: path.join(out, 'server', 'index.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  minify: true,
  legalComments: 'none',
  plugins: [stubs],
  // CommonJS dependencies call require() for Node built-ins; give the ESM bundle a real require.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'warning',
});
fs.cpSync(path.join(root, 'web'), path.join(out, 'web'), { recursive: true });
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
fs.writeFileSync(path.join(out, 'package.json'), JSON.stringify({ name: 'cinemoy-engine', version, type: 'module', main: 'server/index.mjs' }, null, 2));
const size = fs.statSync(path.join(out, 'server', 'index.mjs')).size;
console.log(`dist-node ready (server bundle ${(size / 1024).toFixed(0)} KB)`);

// The Android app ships it as assets/nodejs-project.
const androidAssets = path.join(root, 'android', 'app', 'src', 'main', 'assets', 'nodejs-project');
if (fs.existsSync(path.join(root, 'android'))) {
  fs.rmSync(androidAssets, { recursive: true, force: true });
  fs.cpSync(out, androidAssets, { recursive: true });
  console.log('copied to android/app/src/main/assets/nodejs-project');
}
