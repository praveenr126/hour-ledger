import { Pool, type PoolClient } from 'pg';

export function createDbPool(databaseUrl: string): Pool {
  return new Pool({
    connectionString: databaseUrl,
    max: 20,
    idleTimeoutMillis: 30000
  });
}

export async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
