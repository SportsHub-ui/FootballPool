const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { spawnSync } = require('child_process');
const { Client } = require('pg');

const rootDir = path.resolve(__dirname, '..');

const loadEnvFile = (envPath) => {
  if (!fs.existsSync(envPath)) {
    return false;
  }

  dotenv.config({ path: envPath, override: false });
  return true;
};

const quoteIdentifier = (value) => `"${String(value).replace(/"/g, '""')}"`;

const deriveTestDatabaseUrl = (value) => {
  const parsed = new URL(value);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, '') || 'postgres');

  if (!databaseName) {
    throw new Error('DATABASE_URL must include a database name.');
  }

  if (!/test/i.test(databaseName)) {
    parsed.pathname = `/${encodeURIComponent(`${databaseName}_test`)}`;
  }

  return parsed.toString();
};

const ensureDatabaseExists = async (connectionString) => {
  const targetUrl = new URL(connectionString);
  const databaseName = decodeURIComponent(targetUrl.pathname.replace(/^\//, '') || 'postgres');
  const adminUrl = new URL(connectionString);
  adminUrl.pathname = '/postgres';

  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();

  try {
    const existsResult = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName]);

    if ((existsResult.rowCount ?? 0) === 0) {
      await client.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
      console.log(`[test-runner] Created test database ${databaseName}`);
    }

    return true;
  } finally {
    await client.end();
  }
};

const runCommand = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status);
  }
};

const main = async () => {
  process.env.NODE_ENV = 'test';
  process.env.APP_ENV = 'test';

  const envCandidates = [
    path.join(rootDir, '.env.test'),
    path.join(process.cwd(), '.env.test'),
    path.join(process.cwd(), 'backend/.env.test'),
    path.join(rootDir, '.env'),
    path.join(process.cwd(), '.env'),
    path.join(process.cwd(), 'backend/.env')
  ];

  for (const envPath of envCandidates) {
    if (loadEnvFile(envPath)) {
      break;
    }
  }

  const baseDatabaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

  if (!baseDatabaseUrl) {
    throw new Error('DATABASE_URL or TEST_DATABASE_URL is required to run tests safely.');
  }

  const fallbackDatabaseUrl = baseDatabaseUrl;
  process.env.DATABASE_URL = deriveTestDatabaseUrl(baseDatabaseUrl);

  const targetDatabaseName = decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.replace(/^\//, '') || 'postgres');
  console.log(`[test-runner] Using test database ${targetDatabaseName}`);

  try {
    await ensureDatabaseExists(process.env.DATABASE_URL);
  } catch (error) {
    process.env.DATABASE_URL = fallbackDatabaseUrl;
    process.env.FOOTBALL_POOL_DISABLE_TEST_RESET = 'true';
    console.warn(
      `[test-runner] Could not provision ${targetDatabaseName}; running in non-destructive mode against the configured database. ${error instanceof Error ? error.message : String(error)}`
    );
  }

  runCommand(process.execPath, [path.join(rootDir, 'scripts', 'run-migrations.js')]);

  const vitestArgs = process.argv.slice(2);
  runCommand(process.execPath, [path.join(rootDir, 'node_modules', 'vitest', 'vitest.mjs'), ...vitestArgs]);
};

main().catch((error) => {
  console.error(`[test-runner] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
