import { Pool } from 'pg';
import { env } from './env';

const resolveDatabaseName = (value: string): string => {
  try {
    return decodeURIComponent(new URL(value).pathname.replace(/^\//, '') || 'postgres');
  } catch {
    return 'unknown';
  }
};

const databaseName = resolveDatabaseName(env.DATABASE_URL);

if (env.APP_ENV !== 'test' && /test/i.test(databaseName)) {
  console.warn(
    `[db] Warning: the backend is connected to test database "${databaseName}". Data created in this session is disposable and may be cleared by automated tests.`
  );
}

export const db = new Pool({
  connectionString: env.DATABASE_URL
});
