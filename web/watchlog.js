// Watch history and calendar dates. Pure functions (no DOM, no storage), so node:test can run them.
// The Jalali conversion is done here because the Intl Persian calendar is not on every TV runtime.

export const FINISHED_AT = 0.93;  // same point where Continue watching drops a title
export const MIN_SECONDS = 60;    // a shorter try of a stream is not history
export const MAX_ENTRIES = 1000;  // keeps the log far below the localStorage limit
const REWATCH_BELOW = 0.5;        // going back this far starts a new viewing

const keyOf = w => `${w.type}:${w.videoId || w.id}`;

// Returns the log with this playback update at the front (the same log when it is too short to count).
// One entry per movie or episode; `views` counts how many times it reached the end.
export function recordWatch(log, w, now = Date.now()) {
  const key = keyOf(w);
  const old = log.find(e => e.key === key);
  if (!old && !(w.pos >= MIN_SECONDS)) return log;
  const ratio = w.dur ? w.pos / w.dur : 0;
  const atEnd = ratio >= FINISHED_AT;
  const entry = {
    key, id: w.id, videoId: w.videoId, type: w.type, name: w.name, poster: w.poster, year: w.year,
    season: w.season, episode: w.episode, epTitle: w.epTitle,
    pos: w.pos, dur: w.dur,
    first: old?.first ?? w.at ?? now,
    at: w.at ?? now,
    views: (old?.views || 0) + (atEnd && !old?.fin ? 1 : 0),
    fin: atEnd || (!!old?.fin && ratio >= REWATCH_BELOW),
  };
  return [entry, ...log.filter(e => e !== old)].slice(0, MAX_ENTRIES);
}

// Titles already in Continue watching become history the first time the app runs with this feature.
export function seedFromProgress(log, progressAll) {
  const known = new Set(log.map(e => e.key));
  const fresh = Object.values(progressAll)
    .filter(p => p.pos >= MIN_SECONDS && !known.has(keyOf(p)))
    .map(p => recordWatch([], { ...p, at: p.updated })[0]);
  return [...log, ...fresh].sort((a, b) => b.at - a.at).slice(0, MAX_ENTRIES);
}

// Finished viewings count in full; a viewing still under way counts up to where it stopped.
export function watchStats(log) {
  const series = new Set();
  let movies = 0, episodes = 0, seconds = 0;
  for (const e of log) {
    if (e.type === 'series') { episodes++; series.add(e.id); } else movies++;
    seconds += e.views * (e.dur || 0) + (e.fin ? 0 : e.pos || 0);
  }
  return { movies, episodes, series: series.size, seconds };
}

// ---------------------------------------------------------------- calendars
const JALALI_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
const JALALI_DAYS = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_STARTS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

export const faDigits = v => String(v).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);

// month is 1-12 on both sides.
export function toJalali(gy, gm, gd) {
  const leapYear = gm > 2 ? gy + 1 : gy;
  let days = 355666 + 365 * gy + Math.floor((leapYear + 3) / 4) - Math.floor((leapYear + 99) / 100)
    + Math.floor((leapYear + 399) / 400) + gd + MONTH_STARTS[gm - 1];
  let jy = -1595 + 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  return days < 186
    ? [jy, 1 + Math.floor(days / 31), 1 + (days % 31)]
    : [jy, 7 + Math.floor((days - 186) / 30), 1 + ((days - 186) % 30)];
}

// The date in the device's time zone, e.g. "شنبه ۱۶ آبان ۱۴۰۵" or "Sat, Nov 7, 2026".
export function fmtDate(ts, calendar) {
  const d = new Date(ts);
  if (calendar !== 'jalali') return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  const [y, m, day] = toJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return `${JALALI_DAYS[d.getDay()]} ${faDigits(day)} ${JALALI_MONTHS[m - 1]} ${faDigits(y)}`;
}

export function fmtClock(ts, calendar) {
  const d = new Date(ts);
  const text = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return calendar === 'jalali' ? faDigits(text) : text;
}

const dayStart = ts => { const d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };

export function dayLabel(ts, calendar, now = Date.now()) {
  const today = dayStart(now), n = new Date(today);
  const yesterday = new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1).getTime();
  const day = dayStart(ts);
  const jalali = calendar === 'jalali';
  const prefix = day === today ? (jalali ? 'امروز' : 'Today') : day === yesterday ? (jalali ? 'دیروز' : 'Yesterday') : '';
  return (prefix ? `${prefix} · ` : '') + fmtDate(ts, calendar);
}

// Entries of the same local day together, newest day first.
export function groupByDay(log) {
  const days = new Map();
  for (const e of [...log].sort((a, b) => b.at - a.at)) {
    const day = dayStart(e.at);
    if (!days.has(day)) days.set(day, []);
    days.get(day).push(e);
  }
  return [...days].map(([day, items]) => ({ day, items }));
}
