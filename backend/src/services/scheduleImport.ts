import type { PoolClient } from 'pg';
import { getPoolLeagueDefinition } from '../config/poolLeagues';
import { getPoolTypeDefinition } from '../config/poolTypes';
import { syncPoolGameBoardNumbers } from './poolBoardNumbers';

type PoolScheduleContext = {
  id: number;
  season: number | null;
  pool_type: string | null;
  primary_team: string | null;
  team_name: string | null;
  team_id: number | null;
  primary_sport_team_id: number | null;
  sport_team_id: number | null;
  sport_code: string | null;
  league_code: string | null;
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
  sportCode: string;
  leagueCode: string;
};

type ImportedScheduleEntry = {
  weekNum: number;
  espnEventId: string | null;
  espnEventUid: string | null;
  opponent: string;
  opponentAbbreviation: string | null;
  opponentEspnTeamId: string | null;
  opponentEspnTeamUid: string | null;
  opponentSlug: string | null;
  gameDate: string;
  kickoffAt: string | null;
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

const toKickoffAt = (value: string): string | null => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
};

const addDays = (value: string, days: number): string => {
  const parsed = new Date(value);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
};

const getRegularSeasonWeekCount = (leagueCode: string | null | undefined, season: number): number => {
  const definition = getPoolLeagueDefinition(leagueCode);

  if (definition.leagueCode === 'NFL') {
    return season >= 2021 ? 18 : 17;
  }

  if (definition.leagueCode === 'NCAAF') {
    return 12;
  }

  return 0;
};

const buildEspnTeamsUrl = (leagueCode: string | null | undefined): string => {
  const definition = getPoolLeagueDefinition(leagueCode);
  const needsLargeLimit = definition.leagueCode === 'NCAAF' || definition.leagueCode === 'NCAAB';
  return `https://site.api.espn.com/apis/site/v2/sports/${definition.espnPath}/teams${needsLargeLimit ? '?limit=500' : ''}`;
};

const buildEspnScheduleUrl = (team: EspnTeam, season: number): string => {
  const definition = getPoolLeagueDefinition(team.leagueCode);
  return `https://site.api.espn.com/apis/site/v2/sports/${definition.espnPath}/teams/${encodeURIComponent(team.id)}/schedule?season=${season}&seasontype=2`;
};

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

const fetchEspnTeams = async (leagueCode: string | null | undefined): Promise<EspnTeam[]> => {
  const definition = getPoolLeagueDefinition(leagueCode);
  const response = await fetch(buildEspnTeamsUrl(definition.leagueCode));

  if (!response.ok) {
    throw new Error(`${definition.label} teams request failed with status ${response.status}`);
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
      sportCode: definition.sportCode,
      leagueCode: definition.leagueCode
    }));
};

export const syncSportTeamsForLeague = async (
  client: PoolClient,
  leagueCode: string | null | undefined
): Promise<number> => {
  const teams = await fetchEspnTeams(leagueCode);

  for (const team of teams) {
    await upsertSportTeamFromEspn(client, team);
  }

  return teams.length;
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
  const leagueDefinition = getPoolLeagueDefinition(pool.league_code);
  const hints = [pool.primary_team, pool.team_name].map((value) => normalize(value)).filter(Boolean);
  if (hints.length === 0) {
    throw new Error('This pool does not have a preferred team configured yet.');
  }

  const teams = await fetchEspnTeams(leagueDefinition.leagueCode);

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
    throw new Error(`Could not find a ${leagueDefinition.label} team match for ${[pool.team_name, pool.primary_team].filter(Boolean).join(' / ')}.`);
  }

  return best.team;
};

const fetchSeasonSchedule = async (team: EspnTeam, season: number): Promise<ImportedScheduleEntry[]> => {
  const response = await fetch(buildEspnScheduleUrl(team, season));

  if (!response.ok) {
    throw new Error(`ESPN schedule request failed with status ${response.status}`);
  }

  const data = (await response.json()) as {
    events?: Array<{
      id?: string;
      uid?: string;
      date?: string;
      week?: { number?: number };
      competitions?: Array<{
        id?: string;
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
  const useWeekNumbers = getPoolLeagueDefinition(team.leagueCode).sportCode === 'FOOTBALL';
  const byWeek = new Map<number, ImportedScheduleEntry>();
  let sequenceNumber = 0;

  for (const event of data.events ?? []) {
    const competition = event.competitions?.[0];
    if (!competition) {
      continue;
    }

    let weekNum = useWeekNumbers ? Number(event.week?.number ?? 0) : sequenceNumber + 1;
    if (!Number.isFinite(weekNum) || weekNum <= 0 || byWeek.has(weekNum)) {
      weekNum = sequenceNumber + 1;
    }

    const competitors = competition.competitors ?? [];
    const opponent = competitors.find((entry) => {
      const displayName = normalize(entry.team?.displayName);
      const shortName = normalize(entry.team?.shortDisplayName);
      const abbreviation = normalize(entry.team?.abbreviation);
      return displayName !== teamHint && shortName !== teamHint && abbreviation !== normalize(team.abbreviation);
    });

    const espnGameDate = competition.date ?? event.date ?? '';

    byWeek.set(weekNum, {
      weekNum,
      espnEventId: event.id ?? competition.id ?? null,
      espnEventUid: event.uid ?? null,
      opponent: opponent?.team?.displayName ?? opponent?.team?.shortDisplayName ?? 'BYE',
      opponentAbbreviation: opponent?.team?.abbreviation ?? null,
      opponentEspnTeamId: opponent?.team?.id ?? null,
      opponentEspnTeamUid: opponent?.team?.uid ?? null,
      opponentSlug: opponent?.team?.slug ?? null,
      gameDate: toDateOnly(espnGameDate),
      kickoffAt: toKickoffAt(espnGameDate),
      isBye: false
    });

    sequenceNumber += 1;
  }

  if (byWeek.size === 0) {
    throw new Error(`No regular-season schedule was returned for ${team.displayName} in ${season}.`);
  }

  const totalWeeks = getRegularSeasonWeekCount(team.leagueCode, season);

  if (useWeekNumbers && totalWeeks > 0) {
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
        espnEventId: null,
        espnEventUid: null,
        opponent: 'BYE',
        opponentAbbreviation: null,
        opponentEspnTeamId: null,
        opponentEspnTeamUid: null,
        opponentSlug: null,
        gameDate: estimatedDate,
        kickoffAt: null,
        isBye: true
      });
    }
  }

  return Array.from(byWeek.values()).sort((left, right) => left.weekNum - right.weekNum);
};


export async function importSchedule(client: PoolClient, poolId: number): Promise<ImportSummary> {
  const poolResult = await client.query<PoolScheduleContext>(
    `SELECT p.id,
            p.season,
            p.pool_type,
            p.primary_team,
            p.primary_sport_team_id,
            p.sport_code,
            p.league_code,
            t.team_name,
            t.id AS team_id,
            COALESCE(p.primary_sport_team_id, t.sport_team_id) AS sport_team_id,
            COALESCE(pool_team.espn_team_id, org_team.espn_team_id) AS espn_team_id,
            COALESCE(pool_team.espn_team_uid, org_team.espn_team_uid) AS espn_team_uid
     FROM football_pool.pool p
     LEFT JOIN football_pool.organization t ON t.id = p.team_id
     LEFT JOIN football_pool.sport_team pool_team ON pool_team.id = p.primary_sport_team_id
     LEFT JOIN football_pool.sport_team org_team ON org_team.id = t.sport_team_id
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

  if (getPoolTypeDefinition(pool.pool_type).code !== 'season') {
    throw new Error('Fill Schedule currently supports season pools only. Add playoff or tournament matchups manually on the Schedules page.');
  }

  const team = await findEspnTeam(pool);
  const importedSchedule = await fetchSeasonSchedule(team, Number(pool.season));
  const primarySportTeamId = await upsertSportTeamFromEspn(client, team);

  await client.query(
    `UPDATE football_pool.pool
     SET primary_sport_team_id = $2,
         primary_team = $3,
         sport_code = $4,
         league_code = $5
     WHERE id = $1`,
    [poolId, primarySportTeamId, team.displayName, team.sportCode, team.leagueCode]
  );

  if (pool.team_id != null) {
    await client.query(
      `UPDATE football_pool.organization
       SET sport_team_id = $2
       WHERE id = $1
         AND COALESCE(sport_team_id, 0) <> $2`,
      [pool.team_id, primarySportTeamId]
    );
  }

  let created = 0;
  let skipped = 0;
  let updated = 0;
  const byeWeeks: number[] = [];

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
      [pool.season, entry.weekNum, primarySportTeamId]
    );
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
          sportCode: team.sportCode,
          leagueCode: team.leagueCode
        });
      } else {
        const oppResult = await client.query<{ id: number }>(
          `SELECT id
           FROM football_pool.sport_team
           WHERE league_code = $1
             AND sport_code = $2
             AND (LOWER(name) = $3 OR LOWER(name) LIKE '%' || $3 || '%')
           LIMIT 1`,
          [team.leagueCode, team.sportCode, entry.opponent.toLowerCase()]
        );
        opponentTeamId = oppResult.rows[0]?.id ?? null;
      }
    }

    let gameId: number;
    if (existingGame.rows[0]) {
      gameId = existingGame.rows[0].id;
      updated += 1;
      await client.query(
        `UPDATE football_pool.game
         SET away_team_id = COALESCE($2, away_team_id),
             game_date = COALESCE($3::date, game_date),
             kickoff_at = COALESCE($4::timestamptz, kickoff_at, game_date::timestamp),
             espn_event_id = COALESCE($5, espn_event_id),
             espn_event_uid = COALESCE($6, espn_event_uid),
             updated_at = NOW()
         WHERE id = $1`,
        [gameId, opponentTeamId, entry.gameDate, entry.kickoffAt, entry.espnEventId, entry.espnEventUid]
      );
    } else {
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
           espn_event_id,
           espn_event_uid,
           scores_by_quarter,
           created_at,
           updated_at
         )
         VALUES (
           $1,
           $2,
           $3,
           $4,
           $5::date,
           COALESCE($6::timestamptz, $5::date::timestamp),
           'scheduled',
           FALSE,
           $7,
           $8,
           '{}'::jsonb,
           NOW(),
           NOW()
         )
         RETURNING id`,
        [pool.season, entry.weekNum, primarySportTeamId, opponentTeamId, entry.gameDate, entry.kickoffAt, entry.espnEventId, entry.espnEventUid]
      );
      gameId = insertResult.rows[0].id;
    }
    gameByWeek.set(entry.weekNum, gameId);
  }

  // Link games to this pool in pool_game
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
       VALUES ($1, $2, NULL, NULL, NOW(), NOW())`,
      [poolId, gameId]
    );
    created += 1;
  }

  await syncPoolGameBoardNumbers(client, poolId);

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

