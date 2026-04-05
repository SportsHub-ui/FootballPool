const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const dotenv = require('dotenv');

const envPaths = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), 'backend/.env'),
  path.resolve(__dirname, '..', '.env')
];

for (const envPath of envPaths) {
  const result = dotenv.config({ path: envPath, override: true });
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
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

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
