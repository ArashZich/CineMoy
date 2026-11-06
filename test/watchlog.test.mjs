import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toJalali, faDigits, fmtDate, fmtClock, dayLabel, groupByDay,
  recordWatch, seedFromProgress, watchStats, MIN_SECONDS, MAX_ENTRIES,
} from '../web/watchlog.js';

const movie = (over = {}) => ({ id: 'tt1', type: 'movie', name: 'A', videoId: 'tt1', pos: 600, dur: 6000, ...over });
const episode = (n, over = {}) => ({ id: 'tt2', type: 'series', name: 'B', videoId: `tt2:1:${n}`, season: 1, episode: n, pos: 600, dur: 3000, ...over });
const at = (...a) => new Date(...a).getTime();

test('toJalali: known dates, including the leap day of 1403', () => {
  assert.deepEqual(toJalali(2026, 11, 7), [1405, 8, 16]);
  assert.deepEqual(toJalali(2025, 3, 21), [1404, 1, 1]);
  assert.deepEqual(toJalali(2025, 3, 20), [1403, 12, 30]);
  assert.deepEqual(toJalali(2024, 3, 20), [1403, 1, 1]);
  assert.deepEqual(toJalali(2000, 1, 1), [1378, 10, 11]);
});

test('toJalali: agrees with the Intl Persian calendar on every day of 1990-2060', () => {
  const fmt = new Intl.DateTimeFormat('en-US-u-ca-persian', { timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric' });
  const bad = [];
  for (let t = Date.UTC(1990, 0, 1); t <= Date.UTC(2060, 11, 31); t += 86400000) {
    const d = new Date(t);
    const parts = Object.fromEntries(fmt.formatToParts(d).map(p => [p.type, p.value]));
    const want = [parseInt(parts.year), parseInt(parts.month), parseInt(parts.day)].join('/');
    const got = toJalali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()).join('/');
    if (want !== got) bad.push(`${d.toISOString().slice(0, 10)}: want ${want}, got ${got}`);
  }
  assert.equal(bad.length, 0, `${bad.length} mismatches: ${bad.slice(0, 10).join('; ')}`);
});

test('dates and clock in both calendars', () => {
  const ts = at(2026, 10, 7, 9, 5);
  assert.equal(fmtDate(ts, 'jalali'), 'شنبه ۱۶ آبان ۱۴۰۵');
  assert.equal(fmtDate(ts, 'gregorian'), 'Sat, Nov 7, 2026');
  assert.equal(fmtClock(ts, 'jalali'), '۰۹:۰۵');
  assert.equal(fmtClock(ts, 'gregorian'), '09:05');
  assert.equal(faDigits(1405), '۱۴۰۵');
});

test('dayLabel: today, yesterday across a year boundary, older days', () => {
  const now = at(2027, 0, 1, 0, 30);
  assert.equal(dayLabel(at(2027, 0, 1, 0, 1), 'gregorian', now), 'Today · Fri, Jan 1, 2027');
  assert.equal(dayLabel(at(2026, 11, 31, 23, 59), 'gregorian', now), 'Yesterday · Thu, Dec 31, 2026');
  assert.equal(dayLabel(at(2026, 11, 30, 12), 'gregorian', now), 'Wed, Dec 30, 2026');
  assert.match(dayLabel(at(2026, 11, 31, 23, 59), 'jalali', now), /^دیروز · /);
  assert.match(dayLabel(at(2027, 0, 1, 12), 'jalali', now), /^امروز · /);
});

test('groupByDay: splits at midnight, newest day first, whatever the input order', () => {
  const late = { at: at(2026, 10, 6, 23, 59) }, early = { at: at(2026, 10, 7, 0, 1) }, noon = { at: at(2026, 10, 7, 12) };
  const days = groupByDay([late, early, noon]);
  assert.equal(days.length, 2);
  assert.deepEqual(days[0].items, [noon, early]);
  assert.deepEqual(days[1].items, [late]);
});

test('recordWatch: a short try is not history', () => {
  const log = [];
  assert.equal(recordWatch(log, movie({ pos: MIN_SECONDS - 1 })), log);
  assert.equal(recordWatch(log, movie({ pos: NaN })), log);
});

test('recordWatch: an update moves the title to the front and keeps its first date', () => {
  let log = recordWatch([], movie(), 1000);
  log = recordWatch(log, episode(1), 2000);
  log = recordWatch(log, movie({ pos: 900 }), 3000);
  assert.equal(log.length, 2);
  assert.deepEqual([log[0].key, log[0].first, log[0].at, log[0].pos], ['movie:tt1', 1000, 3000, 900]);
});

test('recordWatch: each episode has its own entry', () => {
  const log = recordWatch(recordWatch([], episode(1)), episode(2));
  assert.deepEqual(log.map(e => e.episode), [2, 1]);
});

test('recordWatch: reaching the end counts one view, however many updates follow', () => {
  let log = recordWatch([], movie({ pos: 5600 }));
  log = recordWatch(log, movie({ pos: 5800 }));
  log = recordWatch(log, movie({ pos: 5990 }));
  assert.equal(log[0].views, 1);
});

test('recordWatch: a seek back near the end is the same viewing, a restart is a new one', () => {
  let log = recordWatch([], movie({ pos: 5800 }));
  log = recordWatch(log, movie({ pos: 4200 }));
  log = recordWatch(log, movie({ pos: 5800 }));
  assert.equal(log[0].views, 1);
  log = recordWatch(log, movie({ pos: 100 }));
  log = recordWatch(log, movie({ pos: 5800 }));
  assert.equal(log[0].views, 2);
});

test('recordWatch: unknown duration does not throw or finish the title', () => {
  const log = recordWatch([], movie({ dur: 0 }));
  assert.equal(log[0].views, 0);
});

test('recordWatch: the oldest entry goes when the log is full', () => {
  let log = [];
  for (let i = 0; i <= MAX_ENTRIES; i++) log = recordWatch(log, movie({ id: `m${i}`, videoId: `m${i}` }), i);
  assert.equal(log.length, MAX_ENTRIES);
  assert.equal(log[0].id, `m${MAX_ENTRIES}`);
  assert.ok(!log.some(e => e.id === 'm0'));
});

test('seedFromProgress: keeps the old dates, skips short and known titles', () => {
  const log = recordWatch([], movie(), 5000);
  const seeded = seedFromProgress(log, {
    tt1: movie({ updated: 1 }),
    tt2: episode(3, { updated: 9000 }),
    tt3: movie({ id: 'tt3', videoId: 'tt3', updated: 2000 }),
    tt4: movie({ id: 'tt4', videoId: 'tt4', pos: 10, updated: 3000 }),
  });
  assert.deepEqual(seeded.map(e => [e.key, e.at]), [['series:tt2:1:3', 9000], ['movie:tt1', 5000], ['movie:tt3', 2000]]);
});

test('watchStats: finished, under way and rewatched titles', () => {
  let log = recordWatch([], movie({ pos: 5800 }));                       // finished: 6000
  log = recordWatch(log, movie({ pos: 200 }));                           // rewatching: + 200
  log = recordWatch(log, episode(1));                                    // under way: + 600
  log = recordWatch(log, episode(2, { pos: 2900 }));                     // finished: + 3000
  log = recordWatch(log, movie({ id: 'tt9', videoId: 'tt9', pos: 100 })); // under way: + 100
  assert.deepEqual(watchStats(log), { movies: 2, episodes: 2, series: 1, seconds: 9900 });
  assert.deepEqual(watchStats([]), { movies: 0, episodes: 0, series: 0, seconds: 0 });
});
