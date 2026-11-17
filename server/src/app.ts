import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DB } from './schema.js';
import { errorResponse, registerRoutes, type RouteOptions, type Router } from './routes.js';

export function createApp(db: DB, opts: RouteOptions = {}) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
  app.use('/api/import/csv', upload.single('file')); // también cubre /api/import/csv/preview

  /** Copia de seguridad: archivo .db compatible con la versión web (Ajustes → Tus datos → Restaurar). */
  app.get('/api/backup', (_req, res) => {
    const tmp = path.join(os.tmpdir(), `bisy-backup-${Date.now()}.db`);
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    res.download(tmp, `bisy-${new Date().toISOString().slice(0, 10)}.db`, () => fs.rm(tmp, () => undefined));
  });

  const r = express.Router();
  registerRoutes(r as unknown as Router, db, { ...opts, mode: 'server' });
  app.use('/api', r);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const { status, body } = errorResponse(err);
    res.status(status).json(body);
  });
  return app;
}
