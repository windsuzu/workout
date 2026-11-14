import { AppError, clone } from '../domain/model.js';

export class Repository {
  constructor(store) { this.store = store; }
  async get(key) { return (await this.store.getWithMetadata(key, { type: 'json', consistency: 'strong' }))?.data ?? null; }
  async put(key, value) { await this.store.setJSON(key, value); return value; }
  async remove(key) { await this.store.delete(key); }
  async update(key, updater) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const entry = await this.store.getWithMetadata(key, { type: 'json', consistency: 'strong' });
      if (entry && !entry.etag) throw new AppError('Storage version is unavailable. Please retry.', 503, 'storage_unavailable');
      const next = await updater(entry ? clone(entry.data) : null);
      if (next === undefined) return entry?.data ?? null;
      const result = await this.store.setJSON(key, next, entry ? { onlyIfMatch: entry.etag } : { onlyIfNew: true });
      if (result.modified) return next;
    }
    throw new AppError('Another device is saving. Please retry.', 409, 'write_conflict');
  }
  async list(prefix) {
    const rows = [];
    for await (const page of this.store.list({ prefix, paginate: true })) {
      for (const blob of page.blobs) { const value = await this.get(blob.key); if (value) rows.push(value); }
    }
    return rows;
  }
}
