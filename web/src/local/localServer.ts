/**
 * Modo "solo navegador" (versión publicada en GitHub Pages).
 *
 * Ejecuta la misma lógica que el servidor (server/src/routes.ts) dentro del navegador,
 * con SQLite compilado a WebAssembly (sql.js). La base de datos se guarda en IndexedDB
 * de este dispositivo: nunca sale de él, salvo que exportes una copia.
 */
import initSqlJs, { type Database, type SqlValue } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { initSchema, type DB, type Statement } from '../../../server/src/schema';
import { errorResponse, registerRoutes, type Req, type Res, type Router } from '../../../server/src/routes';
import { seedDemo } from '../../../server/src/demo';

const IDB_NAME = 'bisy';
const IDB_STORE = 'db';
const IDB_KEY = 'main';

// ---------- Persistencia en IndexedDB ----------

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadBytes(): Promise<Uint8Array | null> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const r = db.transaction(IDB_STORE).objectStore(IDB_STORE).get(IDB_KEY);
    r.onsuccess = () => resolve((r.result as Uint8Array) ?? null);
    r.onerror = () => reject(r.error);
  });
}

async function saveBytes(bytes: Uint8Array): Promise<void> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(IDB_STORE, 'readwrite');
    t.objectStore(IDB_STORE).put(bytes, IDB_KEY);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

// ---------- Adaptador sql.js -> interfaz DB (como node:sqlite) ----------

function bindable(params: unknown[]): SqlValue[] {
  return params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : (p as SqlValue)));
}

function adapt(sql: Database): DB {
  return {
    exec: (q) => {
      sql.exec(q);
    },
    prepare: (q): Statement => ({
      get: (...params) => {
        const st = sql.prepare(q);
        try {
          st.bind(bindable(params));
          return st.step() ? st.getAsObject() : undefined;
        } finally {
          st.free();
        }
      },
      all: (...params) => {
        const st = sql.prepare(q);
        try {
          st.bind(bindable(params));
          const rows: any[] = [];
          while (st.step()) rows.push(st.getAsObject());
          return rows;
        } finally {
          st.free();
        }
      },
      run: (...params) => {
        sql.run(q, bindable(params));
        const changes = sql.getRowsModified();
        const id = sql.exec('SELECT last_insert_rowid()')[0]?.values[0][0] ?? 0;
        return { changes, lastInsertRowid: Number(id) };
      },
    }),
  };
}

// ---------- Enrutador mínimo compatible con registerRoutes ----------

type Handler = (req: Req, res: Res) => unknown;
interface Route {
  method: string;
  re: RegExp;
  keys: string[];
  handler: Handler;
}

class MiniRouter implements Router {
  routes: Route[] = [];
  private add(method: string, path: string, handler: Handler) {
    const keys: string[] = [];
    const re = new RegExp('^' + path.replace(/:([A-Za-z]+)/g, (_m, k) => (keys.push(k), '([^/]+)')) + '$');
    this.routes.push({ method, re, keys, handler });
  }
  get(p: string, h: Handler) { this.add('GET', p, h); }
  post(p: string, h: Handler) { this.add('POST', p, h); }
  put(p: string, h: Handler) { this.add('PUT', p, h); }
  delete(p: string, h: Handler) { this.add('DELETE', p, h); }
}

// ---------- Servidor local ----------

let sqlDb: Database | null = null;
let router: MiniRouter | null = null;
let ready: Promise<void> | null = null;

async function start() {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const saved = await loadBytes();
  sqlDb = saved ? new SQL.Database(saved) : new SQL.Database();
  const db = adapt(sqlDb);
  initSchema(db);
  router = new MiniRouter();
  registerRoutes(router, db, { mode: 'local', bank: null, baseCurrency: 'EUR' });
  // Pide al navegador que no borre los datos por falta de espacio / inactividad
  navigator.storage?.persist?.().catch(() => undefined);
  if (!saved) await persist();
}

function ensureStarted() {
  ready ??= start();
  return ready;
}

async function persist() {
  if (!sqlDb) return;
  const bytes = sqlDb.export();
  sqlDb.exec('PRAGMA foreign_keys = ON;'); // export() restablece los pragmas
  await saveBytes(bytes);
}

let writeQueue: Promise<void> = Promise.resolve();

export async function handle(method: string, path: string, body?: unknown): Promise<{ status: number; data: unknown }> {
  await ensureStarted();
  const url = new URL(path, 'http://local');
  const route = router!.routes.find((r) => r.method === method && r.re.test(url.pathname));
  if (!route) return { status: 404, data: { error: `Ruta no encontrada: ${method} ${url.pathname}` } };
  const m = url.pathname.match(route.re)!;
  const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
  const query = Object.fromEntries(url.searchParams.entries());

  let reqBody: any = body;
  let file: Req['file'];
  if (body instanceof FormData) {
    reqBody = {};
    for (const [k, v] of body.entries()) {
      if (v instanceof File) file = { buffer: new Uint8Array(await v.arrayBuffer()) };
      else reqBody[k] = v;
    }
  }

  let status = 200;
  let data: unknown = undefined;
  const res: Res = {
    status(c) {
      status = c;
      return res;
    },
    json(d) {
      data = d;
      return res;
    },
    end() {
      return res;
    },
  };
  try {
    await route.handler({ params, query, body: reqBody ?? {}, file }, res);
  } catch (e) {
    const r = errorResponse(e);
    return { status: r.status, data: r.body };
  }
  if (method !== 'GET') {
    writeQueue = writeQueue.then(persist);
    await writeQueue;
  }
  return { status, data };
}

// ---------- Copias de seguridad ----------

/** Descarga la base de datos como archivo .db (compatible con la versión de servidor). */
export async function exportBackup() {
  await ensureStarted();
  const bytes = sqlDb!.export();
  sqlDb!.exec('PRAGMA foreign_keys = ON;');
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/x-sqlite3' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bisy-${new Date().toISOString().slice(0, 10)}.db`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Sustituye todos los datos por los de un archivo .db. */
export async function importBackup(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const header = new TextDecoder().decode(bytes.slice(0, 15));
  if (header !== 'SQLite format 3') throw new Error('El archivo no es una copia de Bisy (.db)');
  await saveBytes(bytes);
  ready = null;
  sqlDb?.close();
  await ensureStarted();
  await persist();
}

export async function resetAll(withDemo: boolean) {
  await ensureStarted();
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  sqlDb?.close();
  sqlDb = new SQL.Database();
  const db = adapt(sqlDb);
  initSchema(db);
  if (withDemo) seedDemo(db);
  router = new MiniRouter();
  registerRoutes(router, db, { mode: 'local', bank: null, baseCurrency: 'EUR' });
  ready = Promise.resolve();
  await persist();
}
