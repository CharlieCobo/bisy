import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { EnableBankingProvider } from './bank/enablebanking.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const dbPath = path.resolve(root, process.env.DB_PATH ?? 'server/data/bisy.db');
const db = openDb(dbPath);
const bank = EnableBankingProvider.fromEnv();
const app = createApp(db, { bank, baseCurrency: process.env.BASE_CURRENCY ?? 'EUR' });

// En producción, el mismo servidor sirve el frontend compilado
const webDist = path.resolve(root, 'web/dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
}

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`Bisy API en http://localhost:${port}  (BD: ${dbPath})`);
  console.log(bank ? 'Conexión bancaria: Enable Banking activa' : 'Conexión bancaria: no configurada (solo CSV)');
});
