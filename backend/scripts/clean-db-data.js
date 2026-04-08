const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { Client } = require('pg');

const rootDir = path.resolve(__dirname, '..');

const mutableTables = [
  'football_pool.api_usage_metric',
  'football_pool.game_square_numbers',
  'football_pool.ingestion_run_log',
  'football_pool.notification_log',
  'football_pool.notification_template',
  'football_pool.pool_game',
  'football_pool.pool_payout_rule',
  'football_pool.pool_simulation_state',
  'football_pool.square',
  'football_pool.uploaded_image',
  'football_pool.user_pool',
  'football_pool.winnings_ledger',
  'football_pool.game',
  'football_pool.pool',
  'football_pool.member_organization',
  'football_pool.organization',
  'football_pool.users'
];

const loadEnvFile = (envPath) => {
  if (!fs.existsSync(envPath)) {
    return false;
  }

  dotenv.config({ path: envPath, override: false });
  return true;
};

const quoteIdentifier = (value) => `"${String(value).replace(/"/g, '""')}"`;

const getDatabaseName = (connectionString) => {
  const parsed = new URL(connectionString);
  return decodeURIComponent(parsed.pathname.replace(/^\//, '') || 'postgres');
};

const deriveTestDatabaseUrl = (value) => {
  const parsed = new URL(value);
  const databaseName = getDatabaseName(value);

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
  const databaseName = getDatabaseName(connectionString);
  const adminUrl = new URL(connectionString);
  adminUrl.pathname = '/postgres';

  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();

  try {
    const existsResult = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName]);

    if ((existsResult.rowCount ?? 0) === 0) {
      await client.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
      console.log(`[db-clean] Created missing database ${databaseName}.`);
    }

    return true;
  } finally {
    await client.end();
  }
};

const assertSafeDatabaseName = (databaseName, target) => {
  if (target === 'test') {
    if (!/test/i.test(databaseName)) {
      throw new Error(`Refusing to clean non-test database "${databaseName}" in test mode.`);
    }
    return;
  }

  if (!/(^dev|dev$|development)/i.test(databaseName)) {
    throw new Error(
      `Refusing to clean database "${databaseName}". The dev cleanup command only runs against development databases by default.`
    );
  }
};

const loadEnvironment = (target) => {
  const envCandidates = [
    ...(target === 'test'
      ? [
          path.join(rootDir, '.env.test'),
          path.join(process.cwd(), '.env.test'),
          path.join(process.cwd(), 'backend/.env.test')
        ]
      : []),
    path.join(rootDir, '.env'),
    path.join(process.cwd(), '.env'),
    path.join(process.cwd(), 'backend/.env')
  ];

  for (const envPath of envCandidates) {
    if (loadEnvFile(envPath)) {
      break;
    }
  }
};

const cleanDatabase = async (connectionString, options = {}) => {
  const target = options.target === 'test' ? 'test' : 'dev';
  const databaseName = getDatabaseName(connectionString);
  assertSafeDatabaseName(databaseName, target);

  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query(`
      TRUNCATE TABLE
        ${mutableTables.join(',\n        ')}
      RESTART IDENTITY CASCADE
    `);
    await client.query('COMMIT');
    console.log(`[db-clean] Cleared mutable FootballPool data from ${databaseName}.`);
    console.log('[db-clean] Preserved reference data in football_pool.sport_team and football_pool.schema_migrations.');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
};

const main = async () => {
  const targetArg = process.argv.find((arg) => arg.startsWith('--target='));
  const target = targetArg?.split('=')[1] === 'test' ? 'test' : 'dev';

  loadEnvironment(target);

  const baseDatabaseUrl = target === 'test'
    ? process.env.TEST_DATABASE_URL || process.env.DATABASE_URL
    : process.env.DATABASE_URL;

  if (!baseDatabaseUrl) {
    throw new Error(target === 'test'
      ? 'TEST_DATABASE_URL or DATABASE_URL is required to clean the test database.'
      : 'DATABASE_URL is required to clean the development database.');
  }

  const resolvedDatabaseUrl = target === 'test' ? deriveTestDatabaseUrl(baseDatabaseUrl) : baseDatabaseUrl;

  if (target === 'test') {
    try {
      await ensureDatabaseExists(resolvedDatabaseUrl);
      await cleanDatabase(resolvedDatabaseUrl, { target });
      return;
    } catch (error) {
      const fallbackDevUrl = process.env.DATABASE_URL || baseDatabaseUrl;
      const fallbackDevName = getDatabaseName(fallbackDevUrl);

      if (/(^dev|dev$|development)/i.test(fallbackDevName)) {
        console.warn(
          `[db-clean] Could not access or create ${getDatabaseName(resolvedDatabaseUrl)}; cleaning ${fallbackDevName} instead so local automated test data does not accumulate. ${error instanceof Error ? error.message : String(error)}`
        );
        await cleanDatabase(fallbackDevUrl, { target: 'dev' });
        return;
      }

      throw error;
    }
  }

  await cleanDatabase(resolvedDatabaseUrl, { target });
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`[db-clean] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}

module.exports = {
  cleanDatabase,
  deriveTestDatabaseUrl,
  ensureDatabaseExists,
  getDatabaseName
};
