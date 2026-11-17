/**
 * Datos de ejemplo para probar la app: `npm run seed` (crea server/data/bisy-demo.db).
 * Para usarla: DB_PATH=./server/data/bisy-demo.db npm run dev
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { seedDemo } from './demo.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.resolve(here, '../data/bisy-demo.db');
for (const f of [file, `${file}-wal`, `${file}-shm`]) if (fs.existsSync(f)) fs.rmSync(f);
seedDemo(openDb(file));
console.log(`Base de datos de ejemplo creada en ${file}`);
