import { mkdir, readFile, writeFile, rename, readdir, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export class FileStore {
  constructor(directory = '.local-data') { this.directory = resolve(directory); this.locks = new Map(); }
  path(key) { return resolve(this.directory, Buffer.from(key).toString('base64url') + '.json'); }
  async getWithMetadata(key) {
    try { const raw = await readFile(this.path(key), 'utf8'); return { data: JSON.parse(raw).data, etag: createHash('sha256').update(raw).digest('hex') }; }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async setJSON(key, data, options = {}) {
    const previous = this.locks.get(key) || Promise.resolve();
    const pending = previous.catch(() => {}).then(async () => {
      await mkdir(this.directory, { recursive: true }); const old = await this.getWithMetadata(key);
      if ((options.onlyIfNew && old) || (options.onlyIfMatch && options.onlyIfMatch !== old?.etag)) return { modified: false };
      const raw = JSON.stringify({ key, data }), file = this.path(key), temporary = file + '.' + randomUUID();
      await writeFile(temporary, raw, { mode: 0o600 }); await rename(temporary, file);
      return { modified: true, etag: createHash('sha256').update(raw).digest('hex') };
    });
    this.locks.set(key, pending); try { return await pending; } finally { if (this.locks.get(key) === pending) this.locks.delete(key); }
  }
  async delete(key) { try { await unlink(this.path(key)); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  async *list({ prefix }) {
    let files; try { files = await readdir(this.directory); } catch (error) { if (error.code === 'ENOENT') { yield { blobs: [] }; return; } throw error; }
    const blobs = [];
    for (const file of files.filter(f => f.endsWith('.json'))) { const key = Buffer.from(file.slice(0, -5), 'base64url').toString(); if (key.startsWith(prefix)) blobs.push({ key }); }
    yield { blobs };
  }
}
