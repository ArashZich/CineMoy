// CineMoy server: serves the web UI + API + torrent streaming engine.
// Run standalone (`npm start`) for web/TV use, or embedded by Electron on Windows.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import * as addons from './addons.js';
import * as subs from './subtitles.js';
import * as torrent from './torrent.js';
import * as ffmpeg from './transcode.js';
import { options } from './options.js';

const WEB_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');

// Debrid links returned by Torrentio, keyed by an opaque id so ffmpeg is never
// pointed at arbitrary client-supplied URLs.
const directLinks = new Map();
const refFor = url => {
  const id = crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
  directLinks.set(id, url);
  if (directLinks.size > 2000) directLinks.delete(directLinks.keys().next().value);
  return id;
};

const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => {
  console.error(req.path, e.message);
  if (!res.headersSent) res.status(502).json({ error: e.message });
});

export function createApp(ctx) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => { res.setHeader('Access-Control-Allow-Origin', '*'); next(); });

  const sourceUrl = q => {
    if (q.ref) {
      const u = directLinks.get(q.ref);
      if (!u) throw new Error('Unknown source');
      return u;
    }
    if (!/^[a-f0-9]{40}$/i.test(q.hash || '')) throw new Error('Bad hash');
    const idx = q.idx === undefined || q.idx === '' ? 'auto' : Number(q.idx);
    const p = new URLSearchParams({ s: Number(q.s) || 0, e: Number(q.e) || 0 });
    [].concat(q.tr || []).forEach(t => p.append('tr', t));
    return `http://127.0.0.1:${ctx.port}/stream/${q.hash}/${idx}?${p}`;
  };

  app.get('/api/config', (req, res) => res.json({
    ffmpeg: ffmpeg.available,
    defaults: { torrentio: addons.DEFAULT_TORRENTIO, subtitleAddons: subs.DEFAULT_SUB_ADDONS },
  }));

  app.get('/api/catalog', wrap(async (req, res) => {
    const { type, list, q, genre, skip } = req.query;
    res.json(await addons.catalog({ type, list, q, genre, skip }));
  }));

  app.get('/api/meta/:type/:id', wrap(async (req, res) => {
    res.json(await addons.meta(req.params.type, req.params.id));
  }));

  app.get('/api/streams/:type/:id', wrap(async (req, res) => {
    const list = await addons.streams(req.params.type, req.params.id, req.query.addon);
    res.json(list.map(s => (s.url ? { ...s, ref: refFor(s.url) } : s)));
  }));

  app.get('/api/subtitles/:type/:id', wrap(async (req, res) => {
    const langs = String(req.query.langs || 'fa').split(',').filter(Boolean);
    const extra = String(req.query.addons || '').split(',').map(s => s.trim()).filter(Boolean);
    res.json(await subs.search({
      type: req.params.type, id: req.params.id, langs,
      subdlKey: req.query.subdl,
      addons: [...new Set([...subs.DEFAULT_SUB_ADDONS, ...extra])],
    }));
  }));

  app.get('/api/subtitle/:ref', wrap(async (req, res) => {
    res.json({ cues: await subs.fetchCues(req.params.ref) });
  }));

  app.get('/api/subtitle/:ref/vtt', wrap(async (req, res) => {
    const cues = await subs.fetchCues(req.params.ref);
    res.type('text/vtt; charset=utf-8').send(subs.toVtt(cues, Number(req.query.offset) || 0));
  }));

  // Local subtitle file uploaded from the player ("Load from file…").
  app.post('/api/parse', express.raw({ type: '*/*', limit: '8mb' }), wrap(async (req, res) => {
    res.json({ cues: subs.parseBuffer(req.body, String(req.query.lang || 'fa')) });
  }));

  app.get('/api/status/:hash', (req, res) => res.json(torrent.status(req.params.hash)));

  app.get('/api/probe', wrap(async (req, res) => {
    if (!ffmpeg.available) return res.json({ available: false });
    res.json({ available: true, ...(await ffmpeg.probe(sourceUrl(req.query))) });
  }));

  app.get('/transcode', wrap(async (req, res) => {
    if (!ffmpeg.available) return res.status(501).json({ error: 'ffmpeg not installed' });
    await ffmpeg.transcode(sourceUrl(req.query), req.query, res);
  }));

  app.get('/stream/:hash/:idx', torrent.streamHandler);
  app.head('/stream/:hash/:idx', torrent.streamHandler);

  app.use(express.static(WEB_DIR)); // ETag revalidation, so app updates show up immediately
  return app;
}

export function startServer({ port = options.port, host = options.host } = {}) {
  // The app needs its real port (port 0 = random) for internal ffmpeg → stream URLs.
  const ctx = { port };
  const app = createApp(ctx);
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      ctx.port = server.address().port;
      resolve({ server, port: ctx.port });
    });
    server.once('error', reject);
  });
}

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
}

// Compare real paths: on Android the app's files dir is reached through a symlink
// (/data/user/0/… → /data/data/…), so the URL and argv spellings differ.
const realOrSelf = p => { try { return fs.realpathSync(p); } catch { return p; } };
const isMain = !!process.argv[1] && realOrSelf(fileURLToPath(import.meta.url)) === realOrSelf(path.resolve(process.argv[1]));
if (isMain) {
  const { port } = await startServer();
  console.log(`CineMoy running:\n  http://localhost:${port}`);
  if (options.host === '0.0.0.0') for (const ip of lanAddresses()) console.log(`  http://${ip}:${port}   (open this on your TV / phone)`);
  console.log(ffmpeg.available ? 'ffmpeg found: compatibility mode enabled.' : 'ffmpeg not found: HEVC/AC3/DTS files may not play. Install ffmpeg to enable compatibility mode.');
  const stop = () => { torrent.shutdown(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
