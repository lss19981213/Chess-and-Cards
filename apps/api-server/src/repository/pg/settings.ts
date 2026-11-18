import type pg from 'pg';

export async function getSetting<T>(pool: pg.Pool, key: string): Promise<T | null> {
  const res = await pool.query<{ value: T }>(
    `select value from app_settings where key = $1`,
    [key],
  );
  if (res.rowCount === 0) return null;
  return res.rows[0]?.value ?? null;
}

export async function setSetting<T>(pool: pg.Pool, key: string, value: T): Promise<void> {
  await pool.query(
    `insert into app_settings (key, value, updated_at)
     values ($1, $2::jsonb, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}
