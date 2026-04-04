import type { PoolClient } from 'pg';

type PoolScheduleContext = {
  id: number;
  season: number | null;
  primary_team: string | null;
  team_name: string | null;
};

type EspnTeam = {
  id: string;
  displayName: string;
  shortDisplayName: string;
  abbreviation: string;
  slug: string;
  name: string;
};

type ImportedScheduleEntry = {
  weekNum: number;
  opponent: string;
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
            displayName?: string;
            shortDisplayName?: string;
            abbreviation?: string;
            slug?: string;
            name?: string;
          };
        }>;
      }>;
    }>;
  };

  const teams = data.sports?.[0]?.leagues?.[0]?.teams ?? [];

  return teams
    .map((entry) => entry.team)
    .filter((team): team is NonNullable<typeof team> => Boolean(team?.id && team?.displayName))
    .map((team) => ({
      id: team.id ?? '',
      displayName: team.displayName ?? '',
      shortDisplayName: team.shortDisplayName ?? '',
      abbreviation: team.abbreviation ?? '',
      slug: team.slug ?? '',
      name: team.name ?? ''
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
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${team.abbreviation.toLowerCase()}/schedule?season=${season}&seasontype=2`
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
            displayName?: string;
            shortDisplayName?: string;
            abbreviation?: string;
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
      gameDate: estimatedDate,
      isBye: true
    });
  }

  return Array.from(byWeek.values()).sort((left, right) => left.weekNum - right.weekNum);
};

export const importPoolScheduleFromEspn = async (client: PoolClient, poolId: number): Promise<ImportSummary> => {
  const poolResult = await client.query<PoolScheduleContext>(
    `SELECT p.id, p.season, p.primary_team, t.team_name
     FROM football_pool.pool p
     LEFT JOIN football_pool.team t ON t.id = p.team_id
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

  await client.query('LOCK TABLE football_pool.game IN EXCLUSIVE MODE');

  const existingResult = await client.query<{
    id: number;
    week_num: number | null;
    opponent: string | null;
    game_dt: string | null;
  }>(
    `SELECT id, week_num, opponent, game_dt
     FROM football_pool.game
     WHERE pool_id = $1
     ORDER BY COALESCE(week_num, 999), game_dt ASC, id ASC`,
    [poolId]
  );

  const existingByWeek = new Map<number, { id: number }>();
  const existingSignatures = new Set<string>();

  for (const row of existingResult.rows) {
    if (row.week_num != null && !existingByWeek.has(Number(row.week_num))) {
      existingByWeek.set(Number(row.week_num), { id: Number(row.id) });
    }

    existingSignatures.add(
      [
        row.week_num != null ? String(Number(row.week_num)) : '',
        normalize(row.opponent),
        row.game_dt ? toDateOnly(String(row.game_dt)) : ''
      ].join('|')
    );
  }

  const nextIdResult = await client.query<{ next_id: number }>(
    `SELECT COALESCE(MAX(id), 0) + 1 AS next_id
     FROM football_pool.game`
  );

  let nextId = Number(nextIdResult.rows[0]?.next_id ?? 1);
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const byeWeeks: number[] = [];

  for (const entry of importedSchedule) {
    if (entry.isBye) {
      byeWeeks.push(entry.weekNum);
    }

    const existing = existingByWeek.get(entry.weekNum);
    const signature = [String(entry.weekNum), normalize(entry.opponent), entry.gameDate].join('|');

    if (existing || existingSignatures.has(signature)) {
      skipped += 1;
      continue;
    }

    await client.query(
      `INSERT INTO football_pool.game (id, pool_id, week_num, opponent, game_dt, is_simulation)
       VALUES ($1, $2, $3, $4, $5, FALSE)`,
      [nextId, poolId, entry.weekNum, entry.opponent, entry.gameDate]
    );

    created += 1;
    nextId += 1;
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
};
