const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const dotenv = require('dotenv');
const { deriveTestDatabaseUrl } = require('./clean-db-data');

const targetArg = process.argv.find((arg) => arg.startsWith('--target='));
const requestedTarget = targetArg?.split('=')[1] === 'test' ? 'test' : 'dev';
const isTestLike = requestedTarget === 'test' || process.env.NODE_ENV === 'test' || process.env.APP_ENV === 'test';

const envPaths = [
  ...(isTestLike
    ? [
        path.resolve(process.cwd(), '.env.test'),
        path.resolve(process.cwd(), 'backend/.env.test'),
        path.resolve(__dirname, '..', '.env.test')
      ]
    : []),
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), 'backend/.env'),
  path.resolve(__dirname, '..', '.env')
];

for (const envPath of envPaths) {
  const result = dotenv.config({ path: envPath, override: false });
  if (!result.error) {
    break;
  }
}

async function ensureMigrationTable(client) {
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS football_pool;

    CREATE TABLE IF NOT EXISTS football_pool.schema_migrations (
      file_name VARCHAR PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function getAppliedMigrations(client) {
  const result = await client.query(`
    SELECT file_name
    FROM football_pool.schema_migrations
    ORDER BY file_name
  `);

  return new Set(result.rows.map((row) => row.file_name));
}

async function run() {
  const baseDatabaseUrl = requestedTarget === 'test'
    ? process.env.TEST_DATABASE_URL || process.env.DATABASE_URL
    : process.env.DATABASE_URL;

  if (!baseDatabaseUrl) {
    throw new Error(requestedTarget === 'test' ? 'TEST_DATABASE_URL or DATABASE_URL is required' : 'DATABASE_URL is required');
  }

  const databaseUrl = requestedTarget === 'test' ? deriveTestDatabaseUrl(baseDatabaseUrl) : baseDatabaseUrl;
  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, '') || 'postgres');
  console.log(`[db:migrate] Target database ${databaseName}${requestedTarget === 'test' ? ' (isolated test db)' : ''}`);

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await ensureMigrationTable(client);

    const migrationsDir = path.join(__dirname, '..', 'migrations');
    const files = fs
      .readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    const appliedMigrations = await getAppliedMigrations(client);

    for (const file of files) {
      if (appliedMigrations.has(file)) {
        console.log(`Skipping migration: ${file}`);
        continue;
      }

      const fullPath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(fullPath, 'utf8');

      console.log(`Applying migration: ${file}`);

      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          `INSERT INTO football_pool.schema_migrations (file_name) VALUES ($1)`,
          [file]
        );
        await client.query('COMMIT');
        console.log(`Applied migration: ${file}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Failed migration ${file}: ${error.message}`);
      }
    }
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
