// Builds the Android APKs (phone + Android TV): bundles the engine, fetches libnode if missing,
// then runs Gradle with Android Studio's bundled Java. Output: android/app/build/outputs/apk/release/
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const android = path.join(root, 'android');
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run(process.execPath, [path.join(root, 'scripts', 'bundle-server.mjs')]);
if (!fs.existsSync(path.join(android, 'app', 'libnode', 'bin'))) run(process.execPath, [path.join(root, 'scripts', 'fetch-libnode.mjs')]);

const env = { ...process.env };
if (!env.JAVA_HOME) {
  const jbr = ['C:/Program Files/Android/Android Studio/jbr', '/Applications/Android Studio.app/Contents/jbr/Contents/Home', '/opt/android-studio/jbr']
    .find(p => fs.existsSync(p));
  if (jbr) env.JAVA_HOME = jbr;
}
if (!env.ANDROID_HOME && !fs.existsSync(path.join(android, 'local.properties'))) {
  const sdk = [path.join(os.homedir(), 'AppData/Local/Android/Sdk'), path.join(os.homedir(), 'Library/Android/sdk'), path.join(os.homedir(), 'Android/Sdk')]
    .find(p => fs.existsSync(p));
  if (sdk) fs.writeFileSync(path.join(android, 'local.properties'), `sdk.dir=${sdk.replace(/\\/g, '/')}\n`);
}

const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
run(gradlew, ['assembleRelease', '--console=plain'], { cwd: android, env });
console.log('\nAPKs: android/app/build/outputs/apk/release/');
