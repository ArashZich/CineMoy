// Chunk store that keeps every torrent piece in its own small file.
//
// Used on 32-bit systems (most Android TV boxes): there, Node's file positions wrap around past
// 2 GiB, so writing a large video into one file corrupts its beginning. With one file per piece
// no read or write position ever gets near that limit.
import fs from 'node:fs';
import path from 'node:path';

export default class PieceStore {
  constructor(chunkLength, opts = {}) {
    this.chunkLength = Number(chunkLength);
    if (!this.chunkLength) throw new Error('First argument must be a chunk length');
    this.length = Number(opts.length) || Infinity;
    this.lastChunkLength = this.length % this.chunkLength || this.chunkLength;
    this.lastIndex = Math.ceil(this.length / this.chunkLength) - 1;
    this.dir = path.join(opts.path || opts.rootDir || '.', '.pieces');
    this.closed = false;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  _file(index) {
    return path.join(this.dir, String(index));
  }

  put(index, buf, cb = () => {}) {
    if (this.closed) return queueMicrotask(() => cb(new Error('Storage is closed')));
    const expected = index === this.lastIndex ? this.lastChunkLength : this.chunkLength;
    if (buf.length !== expected) return queueMicrotask(() => cb(new Error(`Invalid buffer length: ${buf.length} (expected ${expected})`)));
    fs.writeFile(this._file(index), buf, err => cb(err || null));
  }

  get(index, opts, cb) {
    if (typeof opts === 'function') { cb = opts; opts = null; }
    if (this.closed) return queueMicrotask(() => cb(new Error('Storage is closed')));
    fs.readFile(this._file(index), (err, buf) => {
      if (err) return cb(err.code === 'ENOENT' ? new Error('Chunk not found') : err);
      if (!opts) return cb(null, buf);
      const offset = opts.offset || 0;
      const length = opts.length ?? buf.length - offset;
      cb(null, buf.subarray(offset, offset + length));
    });
  }

  close(cb = () => {}) {
    this.closed = true;
    queueMicrotask(() => cb(null));
  }

  destroy(cb = () => {}) {
    this.closed = true;
    fs.rm(this.dir, { recursive: true, force: true }, err => cb(err || null));
  }
}
