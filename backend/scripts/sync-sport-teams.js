const path = require('path');
const dotenv = require('dotenv');
const { Client } = require('pg');

const envPaths = [
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

const sources = [
  {
    label: 'NFL',
    sportCode: 'FOOTBALL',
    leagueCode: 'NFL',
    url: 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams'
  },
  {
    label: 'MLB',
    sportCode: 'BASEBALL',
    leagueCode: 'MLB',
    url: 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams'
  },
  {
    label: 'NCAAF',
    sportCode: 'FOOTBALL',
    leagueCode: 'NCAAF',
    url: 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams?limit=500'
  },
  {
    label: 'NCAAB',
    sportCode: 'BASKETBALL',
    leagueCode: 'NCAAB',
    url: 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams?limit=500'
  }
];

const toHexColor = (value) => {
  const cleaned = String(value ?? '').trim().replace(/^#/, '');
  return /^[0-9a-fA-F]{6}$/.test(cleaned) ? `#${cleaned.toUpperCase()}` : null;
};

const ensureSchema = async (client) => {
  await client.query(`
    ALTER TABLE football_pool.sport_team
      ADD COLUMN IF NOT EXISTS sport_code VARCHAR(16) NOT NULL DEFAULT 'FOOTBALL',
      ADD COLUMN IF NOT EXISTS league_code VARCHAR(16) NOT NULL DEFAULT 'NFL',
      ADD COLUMN IF NOT EXISTS abbreviation VARCHAR(16),
      ADD COLUMN IF NOT EXISTS espn_team_id VARCHAR(32),
      ADD COLUMN IF NOT EXISTS espn_team_uid VARCHAR(64),
      ADD COLUMN IF NOT EXISTS espn_slug VARCHAR(128);

    CREATE UNIQUE INDEX IF NOT EXISTS ux_sport_team_scoped_name
      ON football_pool.sport_team (sport_code, league_code, name);

    CREATE UNIQUE INDEX IF NOT EXISTS ux_sport_team_espn_uid
      ON football_pool.sport_team (espn_team_uid)
      WHERE espn_team_uid IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS ux_sport_team_espn_id
      ON football_pool.sport_team (sport_code, league_code, espn_team_id)
      WHERE espn_team_id IS NOT NULL;
  `);
};

const fetchEspnTeams = async (source) => {
  const response = await fetch(source.url);
  if (!response.ok) {
    throw new Error(`${source.label} teams request failed with status ${response.status}`);
  }

  const data = await response.json();
  const entries = data?.sports?.[0]?.leagues?.[0]?.teams ?? [];

  return entries
    .map((entry) => entry?.team)
    .filter((team) => team?.id && team?.uid && team?.displayName)
    .map((team) => ({
      name: team.displayName,
      abbreviation: team.abbreviation ?? null,
      primaryColor: toHexColor(team.color),
      logoUrl: team.logos?.[0]?.href ?? null,
      sportCode: source.sportCode,
      leagueCode: source.leagueCode,
      espnTeamId: String(team.id),
      espnTeamUid: String(team.uid),
      espnSlug: team.slug ?? null
    }));
};

const upsertTeam = async (client, team) => {
  await client.query(
    `INSERT INTO football_pool.sport_team (
       name,
       abbreviation,
       primary_color,
       logo_url,
       sport_code,
       league_code,
       espn_team_id,
       espn_team_uid,
       espn_slug
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (espn_team_uid) DO UPDATE
     SET name = EXCLUDED.name,
         abbreviation = COALESCE(NULLIF(EXCLUDED.abbreviation, ''), football_pool.sport_team.abbreviation),
         primary_color = COALESCE(NULLIF(football_pool.sport_team.primary_color, ''), EXCLUDED.primary_color),
         logo_url = COALESCE(NULLIF(football_pool.sport_team.logo_url, ''), EXCLUDED.logo_url),
         sport_code = EXCLUDED.sport_code,
         league_code = EXCLUDED.league_code,
         espn_team_id = EXCLUDED.espn_team_id,
         espn_team_uid = EXCLUDED.espn_team_uid,
         espn_slug = COALESCE(NULLIF(EXCLUDED.espn_slug, ''), football_pool.sport_team.espn_slug)`,
    [
      team.name,
      team.abbreviation,
      team.primaryColor,
      team.logoUrl,
      team.sportCode,
      team.leagueCode,
      team.espnTeamId,
      team.espnTeamUid,
      team.espnSlug
    ]
  );
};

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await ensureSchema(client);

    for (const source of sources) {
      const teams = await fetchEspnTeams(source);
      await client.query('BEGIN');

      try {
        for (const team of teams) {
          await upsertTeam(client, team);
        }

        await client.query('COMMIT');
        console.log(`[sport-team-sync] ${source.label}: synced ${teams.length} teams`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`[sport-team-sync] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
