import type { PoolClient } from 'pg';

type PoolScheduleContext = {
  id: number;
  season: number | null;
  primary_team: string | null;
  team_name: string | null;
  team_id: number | null;
  sport_team_id: number | null;
  espn_team_id: string | null;
  espn_team_uid: string | null;
}

type EspnTeam = {
  id: string;
  uid: string;
  displayName: string;
  shortDisplayName: string;
  abbreviation: string;
  slug: string;
  name: string;
  color: string | null;
  logoUrl: string | null;
  sportCode: 'FOOTBALL';
  leagueCode: 'NFL';
};

type ImportedScheduleEntry = {
  weekNum: number;
  opponent: string;
  opponentAbbreviation: string | null;
  opponentEspnTeamId: string | null;
  opponentEspnTeamUid: string | null;
  opponentSlug: string | null;
  gameDate: string;
  isBye: boolean;
};

type ImportSummary = {
  season: number;
  teamName: string;
  created: number;
  updated: number;
  skipped: number;
  totalWeeks: number;
  byeWeeks: number[];
};

const normalize = (value: string | null | undefined): string =>
  (value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');

const toDateOnly = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ESPN game date: ${value}`);
  }

  return parsed.toISOString().slice(0, 10);
};

const addDays = (value: string, days: number): string => {
  const parsed = new Date(value);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
};

const getRegularSeasonWeekCount = (season: number): number => (season >= 2021 ? 18 : 17);

const toHexColor = (value: string | null | undefined): string | null => {
  const cleaned = (value ?? '').trim().replace(/^#/, '');
  return /^[0-9a-fA-F]{6}$/.test(cleaned) ? `#${cleaned.toUpperCase()}` : null;
};

const upsertSportTeamFromEspn = async (client: PoolClient, team: EspnTeam): Promise<number> => {
  const result = await client.query<{ id: number }>(
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
         espn_slug = COALESCE(NULLIF(EXCLUDED.espn_slug, ''), football_pool.sport_team.espn_slug)
     RETURNING id`,
    [
      team.displayName,
      team.abbreviation,
      team.color,
      team.logoUrl,
      team.sportCode,
      team.leagueCode,
      team.id,
      team.uid,
      team.slug
    ]
  );

  return Number(result.rows[0].id);
};

const fetchEspnTeams = async (): Promise<EspnTeam[]> => {
  const response = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams');

  if (!response.ok) {
    throw new Error(`ESPN teams request failed with status ${response.status}`);
  }

  const data = (await response.json()) as {
    sports?: Array<{
      leagues?: Array<{
        teams?: Array<{
          team?: {
            id?: string;
            uid?: string;
            displayName?: string;
            shortDisplayName?: string;
            abbreviation?: string;
            slug?: string;
            name?: string;
            color?: string;
            logos?: Array<{ href?: string }>;
          };
        }>;
      }>;
    }>;
  };

  const teams = data.sports?.[0]?.leagues?.[0]?.teams ?? [];

  return teams
    .map((entry) => entry.team)
    .filter((team): team is NonNullable<typeof team> => Boolean(team?.id && team?.uid && team?.displayName))
    .map((team) => ({
      id: team.id ?? '',
      uid: team.uid ?? '',
      displayName: team.displayName ?? '',
      shortDisplayName: team.shortDisplayName ?? '',
      abbreviation: team.abbreviation ?? '',
      slug: team.slug ?? '',
      name: team.name ?? '',
      color: toHexColor(team.color),
      logoUrl: team.logos?.[0]?.href ?? null,
      sportCode: 'FOOTBALL' as const,
      leagueCode: 'NFL' as const
    }));
};

const scoreTeamMatch = (team: EspnTeam, hints: string[]): number => {
  const candidates = [team.displayName, team.shortDisplayName, team.abbreviation, team.slug, team.name]
    .map((value) => normalize(value))
    .filter(Boolean);

  let score = 0;

  for (const hint of hints) {
    for (const candidate of candidates) {
      if (candidate === hint) {
        score = Math.max(score, 100);
      } else if (candidate.includes(hint) || hint.includes(candidate)) {
        score = Math.max(score, 75);
      }
    }
  }

  return score;
};

const findEspnTeam = async (pool: PoolScheduleContext): Promise<EspnTeam> => {
  const hints = [pool.team_name, pool.primary_team].map((value) => normalize(value)).filter(Boolean);
  if (hints.length === 0) {
    throw new Error('This pool does not have a preferred team configured yet.');
  }

  const teams = await fetchEspnTeams();

  if (pool.espn_team_uid) {
    const exactUidMatch = teams.find((team) => team.uid === pool.espn_team_uid);
    if (exactUidMatch) {
      return exactUidMatch;
    }
  }

  if (pool.espn_team_id) {
    const exactIdMatch = teams.find((team) => team.id === pool.espn_team_id);
    if (exactIdMatch) {
      return exactIdMatch;
    }
  }

  const best = teams
    .map((team) => ({ team, score: scoreTeamMatch(team, hints) }))
    .sort((left, right) => right.score - left.score)[0];

  if (!best || best.score <= 0) {
    throw new Error(`Could not find an NFL team match for ${[pool.team_name, pool.primary_team].filter(Boolean).join(' / ')}.`);
  }

  return best.team;
};

const fetchSeasonSchedule = async (team: EspnTeam, season: number): Promise<ImportedScheduleEntry[]> => {
  const response = await fetch(
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${encodeURIComponent(team.id)}/schedule?season=${season}&seasontype=2`
  );

  if (!response.ok) {
    throw new Error(`ESPN schedule request failed with status ${response.status}`);
  }

  const data = (await response.json()) as {
    events?: Array<{
      date?: string;
      week?: { number?: number };
      competitions?: Array<{
        date?: string;
        competitors?: Array<{
          team?: {
            id?: string;
            uid?: string;
            displayName?: string;
            shortDisplayName?: string;
            abbreviation?: string;
            slug?: string;
          };
        }>;
      }>;
    }>;
  };

  const teamHint = normalize(team.displayName || team.shortDisplayName || team.abbreviation);
  const byWeek = new Map<number, ImportedScheduleEntry>();

  for (const event of data.events ?? []) {
    const competition = event.competitions?.[0];
    const weekNum = Number(event.week?.number ?? 0);

    if (!competition || !Number.isFinite(weekNum) || weekNum <= 0) {
      continue;
    }

    const competitors = competition.competitors ?? [];
    const opponent = competitors.find((entry) => {
      const displayName = normalize(entry.team?.displayName);
      const shortName = normalize(entry.team?.shortDisplayName);
      const abbreviation = normalize(entry.team?.abbreviation);
      return displayName !== teamHint && shortName !== teamHint && abbreviation !== normalize(team.abbreviation);
    });

    byWeek.set(weekNum, {
      weekNum,
      opponent: opponent?.team?.displayName ?? opponent?.team?.shortDisplayName ?? 'BYE',
      opponentAbbreviation: opponent?.team?.abbreviation ?? null,
      opponentEspnTeamId: opponent?.team?.id ?? null,
      opponentEspnTeamUid: opponent?.team?.uid ?? null,
      opponentSlug: opponent?.team?.slug ?? null,
      gameDate: toDateOnly(competition.date ?? event.date ?? ''),
      isBye: false
    });
  }

  if (byWeek.size === 0) {
    throw new Error(`No regular-season schedule was returned for ${team.displayName} in ${season}.`);
  }

  const totalWeeks = getRegularSeasonWeekCount(season);

  for (let weekNum = 1; weekNum <= totalWeeks; weekNum += 1) {
    if (byWeek.has(weekNum)) {
      continue;
    }

    const previousWeek = Array.from(byWeek.values())
      .filter((entry) => entry.weekNum < weekNum)
      .sort((left, right) => right.weekNum - left.weekNum)[0];
    const nextWeek = Array.from(byWeek.values())
      .filter((entry) => entry.weekNum > weekNum)
      .sort((left, right) => left.weekNum - right.weekNum)[0];

    const estimatedDate = previousWeek
      ? addDays(previousWeek.gameDate, 7)
      : nextWeek
        ? addDays(nextWeek.gameDate, -7)
        : `${season}-09-01`;

    byWeek.set(weekNum, {
      weekNum,
      opponent: 'BYE',
      opponentAbbreviation: null,
      opponentEspnTeamId: null,
      opponentEspnTeamUid: null,
      opponentSlug: null,
      gameDate: estimatedDate,
      isBye: true
    });
  }

  return Array.from(byWeek.values()).sort((left, right) => left.weekNum - right.weekNum);
};


export async function importSchedule(client: PoolClient, poolId: number): Promise<ImportSummary> {
  const poolResult = await client.query<PoolScheduleContext>(
    `SELECT p.id,
            p.season,
            p.primary_team,
            t.team_name,
            t.id AS team_id,
            t.sport_team_id,
            st.espn_team_id,
            st.espn_team_uid
     FROM football_pool.pool p
     LEFT JOIN football_pool.organization t ON t.id = p.team_id
     LEFT JOIN football_pool.sport_team st ON st.id = t.sport_team_id
     WHERE p.id = $1
     LIMIT 1`,
    [poolId]
  );

  const pool = poolResult.rows[0];
  if (!pool) {
    throw new Error('Pool not found.');
  }
  if (!pool.season) {
    throw new Error('This pool does not have a season year configured.');
  }

  const team = await findEspnTeam(pool);
  const importedSchedule = await fetchSeasonSchedule(team, Number(pool.season));
  const nflTeamId = await upsertSportTeamFromEspn(client, team);

  if (pool.team_id != null) {
    await client.query(
      `UPDATE football_pool.organization
       SET sport_team_id = $2
       WHERE id = $1
         AND COALESCE(sport_team_id, 0) <> $2`,
      [pool.team_id, nflTeamId]
    );
  }

  // Map of weekNum to normalized game id
  const gameByWeek = new Map<number, number>();
  // Insert or find all normalized shared games for this team
  for (const entry of importedSchedule) {
    if (entry.isBye) continue;
    // Try to find an existing normalized game row
    const existingGame = await client.query<{ id: number }>(
      `SELECT id
       FROM football_pool.game
       WHERE season_year = $1
         AND week_number = $2
         AND (home_team_id = $3 OR away_team_id = $3)
       LIMIT 1`,
      [pool.season, entry.weekNum, nflTeamId]
    );
    let gameId: number;
    if (existingGame.rows[0]) {
      gameId = existingGame.rows[0].id;
    } else {
      // Find opponent NFL team id
      let opponentTeamId: number | null = null;
      if (entry.opponent && entry.opponent !== 'BYE') {
        if (entry.opponentEspnTeamUid && entry.opponentEspnTeamId) {
          opponentTeamId = await upsertSportTeamFromEspn(client, {
            id: entry.opponentEspnTeamId,
            uid: entry.opponentEspnTeamUid,
            displayName: entry.opponent,
            shortDisplayName: entry.opponent,
            abbreviation: entry.opponentAbbreviation ?? '',
            slug: entry.opponentSlug ?? '',
            name: entry.opponent,
            color: null,
            logoUrl: null,
            sportCode: 'FOOTBALL',
            leagueCode: 'NFL'
          });
        } else {
          const oppResult = await client.query<{ id: number }>(
            `SELECT id
             FROM football_pool.sport_team
             WHERE league_code = 'NFL'
               AND sport_code = 'FOOTBALL'
               AND (LOWER(name) = $1 OR LOWER(name) LIKE '%' || $1 || '%')
             LIMIT 1`,
            [entry.opponent.toLowerCase()]
          );
          opponentTeamId = oppResult.rows[0]?.id ?? null;
        }
      }
      // Insert a new normalized game row
      const insertResult = await client.query<{ id: number }>(
        `INSERT INTO football_pool.game (
           season_year,
           week_number,
           home_team_id,
           away_team_id,
           game_date,
           kickoff_at,
           state,
           is_simulation,
           scores_by_quarter,
           created_at,
           updated_at
         )
         VALUES ($1, $2, $3, $4, $5::date, $5::timestamp, 'scheduled', FALSE, '{}'::jsonb, NOW(), NOW())
         RETURNING id`,
        [pool.season, entry.weekNum, nflTeamId, opponentTeamId, entry.gameDate]
      );
      gameId = insertResult.rows[0].id;
    }
    gameByWeek.set(entry.weekNum, gameId);
  }

  // Link games to this pool in pool_game
  let created = 0;
  let skipped = 0;
  let updated = 0;
  const byeWeeks: number[] = [];
  for (const entry of importedSchedule) {
    if (entry.isBye) {
      byeWeeks.push(entry.weekNum);
      continue;
    }
    const gameId = gameByWeek.get(entry.weekNum);
    if (!gameId) continue;
    // Check if pool_game already exists
    const exists = await client.query<{ id: number }>(
      `SELECT id FROM football_pool.pool_game WHERE pool_id = $1 AND game_id = $2`,
      [poolId, gameId]
    );
    if (exists.rows[0]) {
      skipped += 1;
      continue;
    }
    await client.query(
      `INSERT INTO football_pool.pool_game (pool_id, game_id, row_numbers, column_numbers, created_at, updated_at)
       VALUES ($1, $2, '[]', '[]', NOW(), NOW())`,
      [poolId, gameId]
    );
    created += 1;
  }

  return {
    season: Number(pool.season),
    teamName: team.displayName,
    created,
    updated,
    skipped,
    totalWeeks: importedSchedule.length,
    byeWeeks
  };
}

export const importPoolScheduleFromEspn = importSchedule;

