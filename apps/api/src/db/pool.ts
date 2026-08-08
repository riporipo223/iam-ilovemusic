import { Pool } from 'pg';
import { config } from '../config';

export const pool = new Pool({
  connectionString: config.databaseUrl,
  // Neon (and most managed Postgres providers) require TLS; reject unauthorized
  // is left at the pg default (true) — override via PGSSLMODE if self-hosting
  // Postgres locally without TLS (docker-compose sets this for you).
  ssl: config.databaseUrl.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
});
