import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { initSchema, type DB } from './schema.js';

export type { DB } from './schema.js';
export { tx } from './schema.js';

export function openDb(file = process.env.DB_PATH ?? path.resolve(process.cwd(), 'data/bisy.db')): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  initSchema(db as unknown as DB);
  return db as unknown as DB;
}
