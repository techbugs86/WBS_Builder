// dotenv must load BEFORE we read process.env. When migrate.ts is imported
// from src/index.ts the env is already loaded — but the standalone
// `npm run migrate` script invokes us via `tsx -e` which skips index.ts,
// so we self-load here. Idempotent: a second .config() call is a no-op.
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Apply schema.sql + migrate.sql against the configured database.
 *
 * - schema.sql contains the base CREATE TABLE statements (current schema-of-record).
 * - migrate.sql contains incremental ALTER / additive changes that get layered
 *   on top of the base schema. Both files use IF NOT EXISTS / column-existence
 *   guards so they're idempotent — safe to re-run on every startup.
 *
 * Running both means a brand-new DB (test or otherwise) is initialised from
 * empty to current shape in one call. To skip in production, set SKIP_MIGRATIONS=1.
 *
 * We open a one-shot connection with multipleStatements:true rather than using
 * the pooled connection, because:
 *   1. The pool intentionally disables multi-statement execution to prevent
 *      SQL injection in normal app queries.
 *   2. Splitting the SQL ourselves is brittle (the files use PREPARE/EXECUTE
 *      blocks with embedded semicolons that simple-split would break).
 */
export async function runMigrations(): Promise<void> {
  if (process.env['SKIP_MIGRATIONS'] === '1') {
    console.log('[migrate] SKIP_MIGRATIONS=1 — skipping');
    return;
  }

  const dbHost = process.env['DB_HOST'] ?? 'localhost';
  const dbPort = parseInt(process.env['DB_PORT'] ?? '3306', 10);
  const dbUser = process.env['DB_USER'] ?? 'root';
  const dbPass = process.env['DB_PASS'] ?? '';
  const dbName = process.env['DB_NAME'] ?? 'wbs_builder';

  // Loud, helpful diagnostic — without leaking the password — so when this
  // fails the user sees exactly which env file's values were loaded.
  console.log(`[migrate] connecting to ${dbHost}:${dbPort}/${dbName} as user="${dbUser}" (password ${dbPass ? 'set' : 'EMPTY'})`);
  if (!dbPass) {
    console.error(
      '[migrate] DB_PASS is empty in process.env.\n' +
      '         If you ran `npm run migrate:test`, this means your apps/api/.env.test\n' +
      '         is missing DB_PASS (or DB_USER). Copy them from apps/api/.env and retry.',
    );
  }

  // Mirror the SSL toggle from db/index.ts so migrations work against TiDB Cloud.
  const useSsl = (process.env['DB_SSL'] ?? '').toLowerCase() === 'true';

  const connection = await mysql.createConnection({
    host: dbHost,
    port: dbPort,
    user: dbUser,
    password: dbPass,
    database: dbName,
    multipleStatements: true,
    ...(useSsl ? { ssl: { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true } } : {}),
  });

  try {
    // schema.sql is the base schema (CREATE TABLE statements). Apply first so
    // a fresh test DB has the foundational tables before incremental migrations
    // try to ALTER them. migrate.sql is incremental on top.
    await applySqlFile(connection, 'schema.sql');
    await applySqlFile(connection, 'migrate.sql');
  } finally {
    await connection.end();
  }
}

async function applySqlFile(connection: mysql.Connection, filename: string): Promise<void> {
  const sqlPath = resolve(__dirname, filename);
  let sql: string;
  try {
    sql = await readFile(sqlPath, 'utf8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[migrate] ${filename} not found at ${sqlPath} — skipping. (${msg})`);
    return;
  }

  // Strip leading CREATE DATABASE / USE statements — the connection has its
  // database set explicitly via DB_NAME, so the SQL files must be portable
  // across dev (wbs_builder), test (wbs_builder_test), or any other name.
  const cleaned = sql
    .replace(/^\s*CREATE\s+DATABASE[^;]+;\s*/im, '')
    .replace(/^\s*USE\s+\w+\s*;\s*/im, '');

  const start = Date.now();
  try {
    await connection.query(cleaned);
    const elapsed = Date.now() - start;
    console.log(`[migrate] applied ${filename} in ${elapsed}ms`);
  } catch (err) {
    // Tolerate idempotency-related errors so a re-run never breaks startup.
    const msg = err instanceof Error ? err.message : String(err);
    if (/already exists|Duplicate (column|key)|ER_DUP_/i.test(msg)) {
      console.warn(`[migrate] non-fatal duplicate-object error in ${filename} — continuing. (${msg})`);
      return;
    }
    console.error(`[migrate] ${filename} failed:`, msg);
    throw err;
  }
}
