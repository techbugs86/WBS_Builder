import mysql from 'mysql2/promise';

// TiDB Cloud / managed MySQL hosts require TLS. Local MySQL on Windows
// usually doesn't. Set DB_SSL=true in production env to enable TLS.
const useSsl = (process.env['DB_SSL'] ?? '').toLowerCase() === 'true';

const pool = mysql.createPool({
  host: process.env['DB_HOST'] ?? 'localhost',
  port: parseInt(process.env['DB_PORT'] ?? '3306', 10),
  user: process.env['DB_USER'] ?? 'root',
  password: process.env['DB_PASS'] ?? '',
  database: process.env['DB_NAME'] ?? 'wbs_builder',
  waitForConnections: true,
  connectionLimit: 10,
  timezone: '+00:00',
  ...(useSsl ? { ssl: { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true } } : {}),
});

// Accept anything mysql2 can serialize. Includes Express's `string | string[]`
// route params and JSON-stringified blobs. mysql2 validates at execute time.
type Params = unknown[];

export async function query<T>(sql: string, params?: Params): Promise<T[]> {
  const [rows] = await pool.execute(sql, params as never);
  return rows as T[];
}

export async function queryOne<T>(sql: string, params?: Params): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function execute(sql: string, params?: Params): Promise<{ affectedRows: number; insertId: number }> {
  const [result] = await pool.execute(sql, params as never);
  return result as { affectedRows: number; insertId: number };
}

export default pool;
