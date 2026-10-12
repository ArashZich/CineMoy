// Downloads nodejs-mobile (Node 18 for Android) and unpacks headers + libnode.so per ABI
// into android/app/libnode/. Not committed to git (~180 MB).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

const VERSION = 'v18.20.4';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = path.join(root, 'android', '.cache');
const zipPath = path.join(cache, `nodejs-mobile-${VERSION}-android.zip`);
const dest = path.join(root, 'android', 'app', 'libnode');

if (!fs.existsSync(zipPath)) {
  fs.mkdirSync(cache, { recursive: true });
  const url = `https://github.com/nodejs-mobile/nodejs-mobile/releases/download/${VERSION}/nodejs-mobile-${VERSION}-android.zip`;
  console.log(`Downloading ${url} …`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  fs.writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
}

fs.rmSync(dest, { recursive: true, force: true });
const zip = new AdmZip(zipPath);
for (const e of zip.getEntries()) {
  if (e.isDirectory || !/^(bin\/[^/]+\/libnode\.so|include\/node\/.+)$/.test(e.entryName)) continue;
  const out = path.join(dest, e.entryName);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, e.getData());
}
console.log(`libnode ${VERSION} → android/app/libnode (${fs.readdirSync(path.join(dest, 'bin')).join(', ')})`);
