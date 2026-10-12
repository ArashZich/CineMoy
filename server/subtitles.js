// Subtitle aggregation: finds Farsi (or other) subtitles from several providers,
// downloads them, fixes encoding (Windows-1256 is common for Persian) and returns cues.
import crypto from 'node:crypto';
import { isUtf8 } from 'node:buffer';
import AdmZip from 'adm-zip';
import iconv from 'iconv-lite';

export const DEFAULT_SUB_ADDONS = ['https://opensubtitles-v3.strem.io'];

// Language aliases per provider. ISO 639-1 → names used by different sources.
const LANGS = {
  fa: { iso3: ['per', 'fas', 'fa'], subdl: 'FA', label: 'فارسی' },
  en: { iso3: ['eng', 'en'], subdl: 'EN', label: 'English' },
  ar: { iso3: ['ara', 'ar'], subdl: 'AR', label: 'العربية' },
  tr: { iso3: ['tur', 'tr'], subdl: 'TR', label: 'Türkçe' },
};

// Only URLs that a provider returned can be downloaded later (prevents the
// /api/subtitle endpoint from being used as an open proxy).
const registry = new Map();
function register(entry) {
  const id = crypto.createHash('sha1').update(entry.url).digest('hex').slice(0, 16);
  registry.set(id, entry);
  if (registry.size > 3000) registry.delete(registry.keys().next().value);
  return id;
}

const UA = { 'User-Agent': 'CineMoy/0.1' };
const timeout = () => AbortSignal.timeout(20000);

function splitId(id) {
  const [imdb, season, episode] = id.split(':');
  return { imdb, season: season && Number(season), episode: episode && Number(episode) };
}

// --- Providers -------------------------------------------------------------

async function stremioAddon(base, { type, id, langs }) {
  base = base.replace(/^stremio:\/\//i, 'https://').replace(/\/manifest\.json$/i, '').replace(/\/+$/, '');
  const res = await fetch(`${base}/subtitles/${type}/${encodeURIComponent(id)}.json`, { headers: UA, signal: timeout() });
  if (!res.ok) throw new Error(`${res.status}`);
  const { subtitles = [] } = await res.json();
  const host = new URL(base).host.replace(/^www\./, '');
  const provider = host.includes('opensubtitles') ? 'OpenSubtitles' : host;
  const out = [];
  for (const s of subtitles) {
    const lang = Object.keys(LANGS).find(k => langs.includes(k) && LANGS[k].iso3.includes(String(s.lang).toLowerCase()));
    if (!lang) continue;
    out.push({
      provider, lang,
      label: s.movieReleaseName || s.subtitleFileName || `#${s.id}`,
      file: s.subtitleFileName,
      downloads: Number(s.g) || 0,
      ref: register({ url: s.url, zip: false, hint: s.SubEncoding, lang }),
    });
  }
  return out;
}

async function subdl(apiKey, { type, id, langs }) {
  if (!apiKey) return [];
  const { imdb, season, episode } = splitId(id);
  const codes = langs.map(l => LANGS[l]?.subdl).filter(Boolean).join(',');
  const p = new URLSearchParams({ api_key: apiKey, imdb_id: imdb, languages: codes, subs_per_page: '30', type: type === 'series' ? 'tv' : 'movie' });
  if (season) p.set('season_number', season);
  if (episode) p.set('episode_number', episode);
  const res = await fetch(`https://api.subdl.com/api/v1/subtitles?${p}`, { headers: UA, signal: timeout() });
  const data = await res.json().catch(() => ({}));
  if (!data.status) throw new Error(data.error || data.message || `HTTP ${res.status}`);
  return (data.subtitles || []).map(s => {
    const lang = Object.keys(LANGS).find(k => LANGS[k].subdl === String(s.lang || s.language).toUpperCase()) || langs[0];
    return {
      provider: 'SubDL', lang,
      label: s.release_name || s.name,
      file: s.name,
      author: s.author,
      ref: register({ url: `https://dl.subdl.com${s.url}`, zip: true, lang, season, episode }),
    };
  });
}

export async function search({ type, id, langs = ['fa'], subdlKey, addons = DEFAULT_SUB_ADDONS }) {
  const jobs = [
    ...addons.filter(Boolean).map(a => ['addon ' + a, stremioAddon(a, { type, id, langs })]),
    ['SubDL', subdl(subdlKey, { type, id, langs })],
  ];
  const settled = await Promise.allSettled(jobs.map(j => j[1]));
  const results = [], errors = [];
  settled.forEach((r, i) => r.status === 'fulfilled' ? results.push(...r.value) : errors.push(`${jobs[i][0]}: ${r.reason.message}`));
  // Requested language order first, then most downloaded.
  results.sort((a, b) => langs.indexOf(a.lang) - langs.indexOf(b.lang) || (b.downloads || 0) - (a.downloads || 0));
  return { subtitles: results, errors };
}

// --- Download + decode + parse --------------------------------------------

const SUB_EXT = /\.(srt|vtt|ass|ssa|sub)$/i;

function pickFromZip(buf, season, episode) {
  const entries = new AdmZip(buf).getEntries().filter(e => !e.isDirectory && SUB_EXT.test(e.entryName));
  if (!entries.length) throw new Error('No subtitle file inside archive');
  if (season && episode) {
    const patterns = [
      new RegExp(`s0*${season}[ ._-]*e0*${episode}(?!\\d)`, 'i'),
      new RegExp(`(?<!\\d)0*${season}x0*${episode}(?!\\d)`, 'i'),
      new RegExp(`(?:e|ep|episode)[ ._-]*0*${episode}(?!\\d)`, 'i'),
    ];
    for (const re of patterns) {
      const m = entries.find(e => re.test(e.entryName));
      if (m) return m.getData();
    }
  }
  const srt = entries.filter(e => /\.srt$/i.test(e.entryName));
  return (srt[0] || entries[0]).getData();
}

function decode(buf, hint, lang) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return iconv.decode(buf.subarray(2), 'utf16le');
  if (buf[0] === 0xfe && buf[1] === 0xff) return iconv.decode(buf.subarray(2), 'utf16be');
  // isUtf8 (not TextDecoder's fatal mode): Node on Android is built without full ICU,
  // where the strict TextDecoder throws even for valid UTF-8.
  if (isUtf8(buf)) return buf.toString('utf8').replace(/^﻿/, '');
  let enc = (hint || '').toLowerCase().replace(/^cp/, 'windows-');
  if (!enc || enc.includes('utf') || !iconv.encodingExists(enc)) enc = lang === 'en' ? 'windows-1252' : 'windows-1256';
  return iconv.decode(buf, enc);
}

const toSec = (h, m, s, ms) => (+h) * 3600 + (+m) * 60 + (+s) + (+(ms || 0).toString().padEnd(3, '0')) / 1000;
const clean = t => t
  .replace(/\{\\[^}]*\}/g, '')          // ASS override tags {\an8}
  .replace(/<\/?(?!i>|b>|u>)[^>]*>/g, '') // keep only <i>/<b>/<u>
  .replace(/\\N/g, '\n').trim();

export function parse(text) {
  text = text.replace(/\r\n?/g, '\n');
  const cues = [];
  if (/^\s*\[Script Info\]/i.test(text) || /^Dialogue:/m.test(text)) {
    for (const line of text.split('\n')) {
      const m = line.match(/^Dialogue:\s*[^,]*,(\d+):(\d+):(\d+)[.:](\d+),(\d+):(\d+):(\d+)[.:](\d+),(?:[^,]*,){6}(.*)$/);
      if (m) cues.push({ s: toSec(m[1], m[2], m[3], m[4] + '0'), e: toSec(m[5], m[6], m[7], m[8] + '0'), t: clean(m[9]) });
    }
  } else {
    const re = /(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})\s*-->\s*(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})[^\n]*\n([\s\S]*?)(?=\n\s*\n|$)/g;
    let m;
    while ((m = re.exec(text))) {
      const t = clean(m[9].replace(/\n\d+\s*$/, ''));
      if (t) cues.push({ s: toSec(m[1] || 0, m[2], m[3], m[4]), e: toSec(m[5] || 0, m[6], m[7], m[8]), t });
    }
  }
  return cues.sort((a, b) => a.s - b.s);
}

// Arabic Yeh/Kaf → Persian forms (old Windows-1256 subtitles often use the Arabic letters).
const persianize = t => t.replace(/ي/g, 'ی').replace(/ك/g, 'ک');

export function parseBuffer(buf, lang, { hint, season, episode } = {}) {
  if (!buf?.length) throw new Error('Empty file');
  if (buf[0] === 0x50 && buf[1] === 0x4b) buf = pickFromZip(buf, season, episode);
  let text = decode(buf, hint, lang);
  if (lang === 'fa') text = persianize(text);
  const cues = parse(text);
  if (!cues.length) throw new Error('Could not parse subtitle file');
  return cues;
}

// WebVTT for native players (Android ExoPlayer). offset (seconds) shifts every cue.
const vttTime = s => {
  const ms = Math.round(Math.max(0, s) * 1000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}.${p(ms % 1000, 3)}`;
};
export function toVtt(cues, offset = 0) {
  return 'WEBVTT\n\n' + cues
    .filter(c => c.e + offset > 0)
    .map(c => `${vttTime(c.s + offset)} --> ${vttTime(c.e + offset)}\n${c.t.replace(/-->/g, '→').replace(/\n\s*\n/g, '\n')}`)
    .join('\n\n') + '\n';
}

export async function fetchCues(ref) {
  const entry = registry.get(ref);
  if (!entry) throw new Error('Unknown subtitle (search again)');
  if (entry.cues) return entry.cues;
  const res = await fetch(entry.url, { headers: UA, signal: timeout() });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  entry.cues = parseBuffer(Buffer.from(await res.arrayBuffer()), entry.lang, entry);
  return entry.cues;
}
