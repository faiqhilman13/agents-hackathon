import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Research, ResearchInput } from '../shared/schema';

export class Store {
  db: DatabaseSync;
  constructor(dir: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const databasePath=join(dir, 'margin.sqlite');
    this.db = new DatabaseSync(databasePath);
    chmodSync(databasePath, 0o600);
    this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS research (id TEXT PRIMARY KEY, request_id TEXT UNIQUE NOT NULL, data TEXT NOT NULL);');
  }
  list(): Research[] {
    return (this.db.prepare('SELECT data FROM research ORDER BY rowid DESC').all() as {data:string}[]).map(r => JSON.parse(r.data));
  }
  get(id: string): Research | undefined {
    const row = this.db.prepare('SELECT data FROM research WHERE id=?').get(id) as {data:string} | undefined;
    return row && JSON.parse(row.data);
  }
  create(input: ResearchInput): { item: Research; created: boolean } {
    const existing = this.db.prepare('SELECT data FROM research WHERE request_id=?').get(input.requestId) as {data:string} | undefined;
    if (existing) return { item: JSON.parse(existing.data), created: false };
    const now = new Date().toISOString();
    const item: Research = { id: randomUUID(), requestId: input.requestId, input, createdAt: now, updatedAt: now,
      status:'queued', stage:'Waiting to research', progress:0, sources:[], mode:'extractive', warnings:[],
      notes:'', favorite:false, collection:input.collection || 'Reading list', inLibrary:false };
    this.db.prepare('INSERT INTO research VALUES (?,?,?)').run(item.id, item.requestId, JSON.stringify(item));
    return { item, created:true };
  }
  update(id: string, changes: Partial<Research>): Research {
    const current = this.get(id); if (!current) throw new Error('Research not found.');
    const item = { ...current, ...changes, id: current.id, updatedAt: new Date().toISOString() };
    this.db.prepare('UPDATE research SET data=? WHERE id=?').run(JSON.stringify(item), id);
    return item;
  }
  delete(id: string) { this.db.prepare('DELETE FROM research WHERE id=?').run(id); }
  close() { this.db.close(); }
}
