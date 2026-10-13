// Optional FFmpeg "compatibility mode": browsers/TVs can't decode HEVC, AC3, DTS, etc.
// When ffmpeg is installed we remux/transcode on the fly to fragmented MP4 (H.264 + AAC).
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';

// Apps opened from the macOS Finder don't get the shell's PATH, so look in Homebrew's folders too.
const findTool = name => {
  const dirs = process.platform === 'darwin' ? ['/opt/homebrew/bin', '/usr/local/bin'] : [];
  return dirs.map(d => `${d}/${name}`).find(p => fs.existsSync(p)) || name;
};
const FFMPEG = process.env.FFMPEG_PATH || findTool('ffmpeg');
const FFPROBE = process.env.FFPROBE_PATH || findTool('ffprobe');
export const available = spawnSync(FFMPEG, ['-version']).status === 0 && spawnSync(FFPROBE, ['-version']).status === 0;

const BROWSER_VIDEO = ['h264', 'vp8', 'vp9', 'av1'];
const BROWSER_AUDIO = ['aac', 'mp3', 'opus', 'vorbis', 'flac'];

const probeCache = new Map();
export function probe(inputUrl) {
  if (probeCache.has(inputUrl)) return probeCache.get(inputUrl);
  const p = new Promise((resolve, reject) => {
    const proc = spawn(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', inputUrl]);
    let out = '';
    proc.stdout.on('data', d => (out += d));
    const timer = setTimeout(() => proc.kill('SIGKILL'), 90000);
    proc.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error('ffprobe failed'));
      const j = JSON.parse(out);
      const v = j.streams.find(s => s.codec_type === 'video');
      const audio = j.streams.filter(s => s.codec_type === 'audio').map((s, i) => ({
        index: i, codec: s.codec_name, channels: s.channels,
        lang: s.tags?.language || '', title: s.tags?.title || '',
      }));
      const tenBit = /10/.test(v?.pix_fmt || '');
      resolve({
        duration: Number(j.format?.duration) || 0,
        video: v && { codec: v.codec_name, width: v.width, height: v.height, pixFmt: v.pix_fmt },
        audio,
        browserSafe: !!v && BROWSER_VIDEO.includes(v.codec_name) && !(v.codec_name === 'h264' && tenBit)
          && (!audio.length || BROWSER_AUDIO.includes(audio[0].codec)),
      });
    });
  });
  p.catch(() => probeCache.delete(inputUrl));
  probeCache.set(inputUrl, p);
  if (probeCache.size > 50) probeCache.delete(probeCache.keys().next().value);
  return p;
}

export async function transcode(inputUrl, { start = 0, audio = 0 }, res) {
  const info = await probe(inputUrl).catch(() => null);
  const copyVideo = info?.video?.codec === 'h264' && !/10/.test(info.video.pixFmt || '');
  const args = [
    '-hide_banner', '-loglevel', 'error',
    '-ss', String(Math.max(0, Number(start) || 0)),
    '-i', inputUrl,
    '-map', '0:v:0', '-map', `0:a:${Number(audio) || 0}?`,
    ...(copyVideo
      ? ['-c:v', 'copy']
      : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-vf', "scale='min(1920,iw)':-2"]),
    '-c:a', 'aac', '-ac', '2', '-b:a', '192k',
    '-sn', '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    'pipe:1',
  ];
  const proc = spawn(FFMPEG, args);
  res.setHeader('Content-Type', 'video/mp4');
  proc.stdout.pipe(res);
  proc.stderr.on('data', d => console.error('[ffmpeg]', String(d).trim()));
  res.on('close', () => proc.kill('SIGKILL'));
}
