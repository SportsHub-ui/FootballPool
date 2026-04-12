import type { PoolClient } from 'pg';
import { db } from '../config/db';
import { env } from '../config/env';
import { getActiveScoreSegmentNumbers, getPoolLeagueDefinition } from '../config/poolLeagues';
import {
  processGameScoresWithClient,
  type QuarterScoresInput,
  type ScoreProcessingResult
} from './scoreProcessing';
import { recordApiUsage } from './apiUsage';
import { publishScoreIngestionEvent } from './scoreIngestionEvents';

export type IngestionSource = 'mock' | 'payload' | 'espn';

export interface IngestionGameTarget {
  gameId: number;
  gameDate: string;
  kickoffAt: string | null;
  espnEventId: string | null;
  espnEventUid: string | null;
  homeTeam: string;
  awayTeam: string;
  homeAbbreviation: string | null;
  awayAbbreviation: string | null;
  homeEspnTeamId: string | null;
  awayEspnTeamId: string | null;
  homeEspnTeamUid: string | null;
  awayEspnTeamUid: string | null;
  sportCode: string;
  leagueCode: string;
  state: string;
  currentQuarter: number | null;
  timeRemainingInQuarter: string | null;
}

export interface GameIngestionUpdate {
  gameId: number;
  source: IngestionSource;
  scores: QuarterScoresInput;
  state: string;
  currentQuarter: number | null;
  timeRemainingInQuarter: string | null;
  espnEventId?: string | null;
  espnEventUid?: string | null;
  detectedAt: string;
}

export interface IngestGameScoresResult {
  gameId: number;
  source: IngestionSource;
  scores: QuarterScoresInput;
  updated: boolean;
  processed: boolean;
  state: string;
  currentQuarter: number | null;
  timeRemainingInQuarter: string | null;
  results: ScoreProcessingResult[];
}

interface GameLookupRow {
  game_id: number;
  game_date: string;
  kickoff_at: string | null;
  espn_event_id: string | null;
  espn_event_uid: string | null;
  home_team: string | null;
  away_team: string | null;
  home_abbreviation: string | null;
  away_abbreviation: string | null;
  home_espn_team_id: string | null;
  away_espn_team_id: string | null;
  home_espn_team_uid: string | null;
  away_espn_team_uid: string | null;
  sport_code: string | null;
  league_code: string | null;
  state: string | null;
  current_quarter: number | null;
  time_remaining_in_quarter: string | null;
}

type QuarterKey = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';
type QuarterScoreMap = Partial<Record<QuarterKey, { home?: number | null; away?: number | null }>>;

type EspnCompetitor = {
  homeAway?: string;
  score?: string;
  linescores?: Array<{ value?: number | string; displayValue?: string }>;
  team?: {
    id?: string;
    uid?: string;
    displayName?: string;
    shortDisplayName?: string;
    abbreviation?: string;
    slug?: string;
  };
};

type EspnCompetition = {
  competitors?: EspnCompetitor[];
  status?: {
    type?: {
      completed?: boolean;
      state?: string;
      description?: string;
      detail?: string;
      shortDetail?: string;
    };
    displayClock?: string;
    period?: number;
  };
};

type EspnScoreboardResponse = {
  events?: Array<{
    id?: string;
    uid?: string;
    competitions?: EspnCompetition[];
  }>;
};

type MatchedEspnCompetition = {
  eventId: string | null;
  eventUid: string | null;
  competition: EspnCompetition;
};

const EMPTY_SCORES: QuarterScoresInput = {
  q1PrimaryScore: null,
  q1OpponentScore: null,
  q2PrimaryScore: null,
  q2OpponentScore: null,
  q3PrimaryScore: null,
  q3OpponentScore: null,
  q4PrimaryScore: null,
  q4OpponentScore: null,
  q5PrimaryScore: null,
  q5OpponentScore: null,
  q6PrimaryScore: null,
  q6OpponentScore: null,
  q7PrimaryScore: null,
  q7OpponentScore: null,
  q8PrimaryScore: null,
  q8OpponentScore: null,
  q9PrimaryScore: null,
  q9OpponentScore: null
};

const scoreboardCache = new Map<string, { expiresAt: number; data: EspnScoreboardResponse }>();

const setQuarterScoresOnInput = (
  scores: QuarterScoresInput,
  quarter: number,
  values: { primaryScore: number | null; opponentScore: number | null }
): void => {
  if (quarter === 1) {
    scores.q1PrimaryScore = values.primaryScore;
    scores.q1OpponentScore = values.opponentScore;
    return;
  }
  if (quarter === 2) {
    scores.q2PrimaryScore = values.primaryScore;
    scores.q2OpponentScore = values.opponentScore;
    return;
  }
  if (quarter === 3) {
    scores.q3PrimaryScore = values.primaryScore;
    scores.q3OpponentScore = values.opponentScore;
    return;
  }
  if (quarter === 4) {
    scores.q4PrimaryScore = values.primaryScore;
    scores.q4OpponentScore = values.opponentScore;
    return;
  }
  if (quarter === 5) {
    scores.q5PrimaryScore = values.primaryScore;
    scores.q5OpponentScore = values.opponentScore;
    return;
  }
  if (quarter === 6) {
    scores.q6PrimaryScore = values.primaryScore;
    scores.q6OpponentScore = values.opponentScore;
    return;
  }
  if (quarter === 7) {
    scores.q7PrimaryScore = values.primaryScore;
    scores.q7OpponentScore = values.opponentScore;
    return;
  }
  if (quarter === 8) {
    scores.q8PrimaryScore = values.primaryScore;
    scores.q8OpponentScore = values.opponentScore;
    return;
  }

  scores.q9PrimaryScore = values.primaryScore;
  scores.q9OpponentScore = values.opponentScore;
};

const getQuarterScoresFromInput = (
  scores: QuarterScoresInput,
  quarter: number
): { primaryScore: number | null; opponentScore: number | null } => {
  if (quarter === 1) return { primaryScore: scores.q1PrimaryScore, opponentScore: scores.q1OpponentScore };
  if (quarter === 2) return { primaryScore: scores.q2PrimaryScore, opponentScore: scores.q2OpponentScore };
  if (quarter === 3) return { primaryScore: scores.q3PrimaryScore, opponentScore: scores.q3OpponentScore };
  if (quarter === 4) return { primaryScore: scores.q4PrimaryScore, opponentScore: scores.q4OpponentScore };
  if (quarter === 5) return { primaryScore: scores.q5PrimaryScore, opponentScore: scores.q5OpponentScore };
  if (quarter === 6) return { primaryScore: scores.q6PrimaryScore, opponentScore: scores.q6OpponentScore };
  if (quarter === 7) return { primaryScore: scores.q7PrimaryScore, opponentScore: scores.q7OpponentScore };
  if (quarter === 8) return { primaryScore: scores.q8PrimaryScore, opponentScore: scores.q8OpponentScore };
  return { primaryScore: scores.q9PrimaryScore, opponentScore: scores.q9OpponentScore };
};

const buildDeterministicMockScores = (gameId: number, leagueCode?: string | null): QuarterScoresInput => {
  const base = (gameId * 7) % 10;
  const scores: QuarterScoresInput = { ...EMPTY_SCORES };
  const activeSegments = getActiveScoreSegmentNumbers(leagueCode);

  for (const quarter of activeSegments) {
    const offset = (quarter - 1) * 10;
    setQuarterScoresOnInput(scores, quarter, {
      primaryScore: ((base + quarter + 2) % 10) + offset,
      opponentScore: ((base + quarter + 6) % 10) + offset
    });
  }

  return scores;
};

const normalize = (value: string): string => value.trim().toLowerCase();

const matchesTeamName = (candidate: string, expected: string): boolean => {
  const normalizedCandidate = normalize(candidate);
  const normalizedExpected = normalize(expected);

  if (!normalizedCandidate || !normalizedExpected) {
    return false;
  }

  return (
    normalizedCandidate === normalizedExpected ||
    normalizedCandidate.includes(normalizedExpected) ||
    normalizedExpected.includes(normalizedCandidate)
  );
};

const toCentralDateKey = (date: Date = new Date()): string => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';

  return `${year}-${month}-${day}`;
};

const toYyyyMmDd = (date: Date): string => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
};

const toNullableScore = (value: unknown): number | null => {
  if (value == null || value === '') {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const toQuarterScoreMap = (value: unknown): QuarterScoreMap => {
  if (!value) {
    return {};
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as QuarterScoreMap;
    } catch {
      return {};
    }
  }

  if (typeof value === 'object') {
    return value as QuarterScoreMap;
  }

  return {};
};

const toCumulativeQuarterScores = (lineScores: unknown): Array<number | null> => {
  if (!Array.isArray(lineScores) || lineScores.length === 0) {
    return Array.from({ length: 9 }, () => null);
  }

  let runningTotal = 0;
  let sequenceBroken = false;

  return Array.from({ length: 9 }, (_, index) => {
    if (sequenceBroken) {
      return null;
    }

    const entry = lineScores[index];
    const value =
      entry && typeof entry === 'object'
        ? toNullableScore((entry as { value?: unknown; displayValue?: unknown }).value ?? (entry as { value?: unknown; displayValue?: unknown }).displayValue)
        : null;

    if (value == null) {
      sequenceBroken = true;
      return null;
    }

    runningTotal += value;
    return runningTotal;
  });
};

const buildFallbackQuarterScoresFromFinal = (primaryFinal: number, opponentFinal: number): QuarterScoresInput => {
  const q1Primary = Math.floor(primaryFinal * 0.2);
  const q2Primary = Math.floor(primaryFinal * 0.5);
  const q3Primary = Math.floor(primaryFinal * 0.75);
  const q4Primary = primaryFinal;

  const q1Opponent = Math.floor(opponentFinal * 0.2);
  const q2Opponent = Math.floor(opponentFinal * 0.5);
  const q3Opponent = Math.floor(opponentFinal * 0.75);
  const q4Opponent = opponentFinal;

  return {
    ...EMPTY_SCORES,
    q1PrimaryScore: q1Primary,
    q1OpponentScore: q1Opponent,
    q2PrimaryScore: q2Primary,
    q2OpponentScore: q2Opponent,
    q3PrimaryScore: q3Primary,
    q3OpponentScore: q3Opponent,
    q4PrimaryScore: q4Primary,
    q4OpponentScore: q4Opponent
  };
};

const buildSportAwareScoresFromCompetition = (
  target: IngestionGameTarget,
  primaryCompetitor: EspnCompetitor | null | undefined,
  opponentCompetitor: EspnCompetitor | null | undefined,
  state: string,
  currentQuarter?: number | null
): QuarterScoresInput => {
  const primaryCumulative = toCumulativeQuarterScores(primaryCompetitor?.linescores);
  const opponentCumulative = toCumulativeQuarterScores(opponentCompetitor?.linescores);
  const primaryFinal = toNullableScore(primaryCompetitor?.score);
  const opponentFinal = toNullableScore(opponentCompetitor?.score);
  const normalizedSport = String(target.sportCode ?? '').trim().toUpperCase();
  const normalizedLeague = String(target.leagueCode ?? '').trim().toUpperCase();

  if (normalizedSport === 'BASEBALL') {
    const scores: QuarterScoresInput = { ...EMPTY_SCORES };
    const liveInning = currentQuarter != null && Number.isFinite(Number(currentQuarter)) ? Number(currentQuarter) : null;

    for (let inning = 1; inning <= 8; inning += 1) {
      setQuarterScoresOnInput(scores, inning, {
        primaryScore: primaryCumulative[inning - 1] ?? null,
        opponentScore: opponentCumulative[inning - 1] ?? null
      });
    }

    const shouldPopulateFinalInning =
      primaryFinal != null &&
      opponentFinal != null &&
      (state === 'completed' || (state === 'in_progress' && (liveInning ?? 0) >= 9));

    if (shouldPopulateFinalInning) {
      setQuarterScoresOnInput(scores, 9, {
        primaryScore: primaryFinal,
        opponentScore: opponentFinal
      });
    }

    return scores;
  }

  if (normalizedLeague === 'NCAAB') {
    return {
      ...EMPTY_SCORES,
      q1PrimaryScore: primaryCumulative[0] ?? null,
      q1OpponentScore: opponentCumulative[0] ?? null,
      q9PrimaryScore: state === 'completed' ? (primaryCumulative[1] ?? primaryFinal) : null,
      q9OpponentScore: state === 'completed' ? (opponentCumulative[1] ?? opponentFinal) : null
    };
  }

  if (normalizedSport === 'HOCKEY') {
    return {
      ...EMPTY_SCORES,
      q1PrimaryScore: primaryCumulative[0] ?? null,
      q1OpponentScore: opponentCumulative[0] ?? null,
      q2PrimaryScore: primaryCumulative[1] ?? null,
      q2OpponentScore: opponentCumulative[1] ?? null,
      q9PrimaryScore: state === 'completed' ? (primaryCumulative[2] ?? primaryFinal) : null,
      q9OpponentScore: state === 'completed' ? (opponentCumulative[2] ?? opponentFinal) : null
    };
  }

  const quarterBreakdownExists =
    primaryCumulative.slice(0, 4).some((value) => value != null) &&
    opponentCumulative.slice(0, 4).some((value) => value != null);

  if (quarterBreakdownExists) {
    return {
      ...EMPTY_SCORES,
      q1PrimaryScore: primaryCumulative[0] ?? null,
      q1OpponentScore: opponentCumulative[0] ?? null,
      q2PrimaryScore: primaryCumulative[1] ?? null,
      q2OpponentScore: opponentCumulative[1] ?? null,
      q3PrimaryScore: primaryCumulative[2] ?? null,
      q3OpponentScore: opponentCumulative[2] ?? null,
      q4PrimaryScore: primaryCumulative[3] ?? (state === 'completed' ? primaryFinal : null),
      q4OpponentScore: opponentCumulative[3] ?? (state === 'completed' ? opponentFinal : null)
    };
  }

  if (primaryFinal != null && opponentFinal != null && state !== 'scheduled') {
    return buildFallbackQuarterScoresFromFinal(primaryFinal, opponentFinal);
  }

  return { ...EMPTY_SCORES };
};

const inferGameStateFromScores = (scores: QuarterScoresInput, leagueCode?: string | null): string => {
  const activeSegments = getActiveScoreSegmentNumbers(leagueCode);
  const finalQuarter = activeSegments[activeSegments.length - 1] ?? 4;
  const finalScores = getQuarterScoresFromInput(scores, finalQuarter);

  if (finalScores.primaryScore != null && finalScores.opponentScore != null) {
    return 'completed';
  }

  if (activeSegments.some((quarter) => {
    const quarterScores = getQuarterScoresFromInput(scores, quarter);
    return quarterScores.primaryScore != null || quarterScores.opponentScore != null;
  })) {
    return 'in_progress';
  }

  return 'scheduled';
};

const normalizeGameState = (value: unknown): string => {
  const raw = normalize(String(value ?? 'scheduled'));

  if (!raw) {
    return 'scheduled';
  }

  if (['postponed', 'ppd', 'rescheduled', 'delayed', 'suspended', 'cancelled', 'canceled'].some((keyword) => raw.includes(keyword))) {
    return 'scheduled';
  }

  if (['final', 'completed', 'complete', 'closed', 'finished'].some((keyword) => raw.includes(keyword))) {
    return 'completed';
  }

  if (
    raw === 'in' ||
    raw.startsWith('in ') ||
    raw.startsWith('in_') ||
    ['live', 'progress', 'halftime', 'midgame'].some((keyword) => raw.includes(keyword))
  ) {
    return 'in_progress';
  }

  return 'scheduled';
};

const inferCurrentQuarter = (scores: QuarterScoresInput, preferredQuarter?: number | null, leagueCode?: string | null): number | null => {
  if (preferredQuarter != null && Number.isFinite(Number(preferredQuarter))) {
    return Number(preferredQuarter);
  }

  const activeSegments = getActiveScoreSegmentNumbers(leagueCode);

  for (let index = activeSegments.length - 1; index >= 0; index -= 1) {
    const quarter = activeSegments[index];
    const quarterScores = getQuarterScoresFromInput(scores, quarter);
    if (quarterScores.primaryScore != null || quarterScores.opponentScore != null) {
      return quarter;
    }
  }

  return null;
};

const scoresEqual = (left: QuarterScoresInput, right: QuarterScoresInput): boolean => (
  left.q1PrimaryScore === right.q1PrimaryScore &&
  left.q1OpponentScore === right.q1OpponentScore &&
  left.q2PrimaryScore === right.q2PrimaryScore &&
  left.q2OpponentScore === right.q2OpponentScore &&
  left.q3PrimaryScore === right.q3PrimaryScore &&
  left.q3OpponentScore === right.q3OpponentScore &&
  left.q4PrimaryScore === right.q4PrimaryScore &&
  left.q4OpponentScore === right.q4OpponentScore &&
  left.q5PrimaryScore === right.q5PrimaryScore &&
  left.q5OpponentScore === right.q5OpponentScore &&
  left.q6PrimaryScore === right.q6PrimaryScore &&
  left.q6OpponentScore === right.q6OpponentScore &&
  left.q7PrimaryScore === right.q7PrimaryScore &&
  left.q7OpponentScore === right.q7OpponentScore &&
  left.q8PrimaryScore === right.q8PrimaryScore &&
  left.q8OpponentScore === right.q8OpponentScore &&
  left.q9PrimaryScore === right.q9PrimaryScore &&
  left.q9OpponentScore === right.q9OpponentScore
);

const buildScoresByQuarterJson = (scores: QuarterScoresInput): QuarterScoreMap => ({
  '1': { home: scores.q1PrimaryScore, away: scores.q1OpponentScore },
  '2': { home: scores.q2PrimaryScore, away: scores.q2OpponentScore },
  '3': { home: scores.q3PrimaryScore, away: scores.q3OpponentScore },
  '4': { home: scores.q4PrimaryScore, away: scores.q4OpponentScore },
  '5': { home: scores.q5PrimaryScore, away: scores.q5OpponentScore },
  '6': { home: scores.q6PrimaryScore, away: scores.q6OpponentScore },
  '7': { home: scores.q7PrimaryScore, away: scores.q7OpponentScore },
  '8': { home: scores.q8PrimaryScore, away: scores.q8OpponentScore },
  '9': { home: scores.q9PrimaryScore, away: scores.q9OpponentScore }
});

const extractScoresFromDbValue = (
  scoresByQuarter: unknown,
  finalScoreHome?: unknown,
  finalScoreAway?: unknown
): QuarterScoresInput => {
  const map = toQuarterScoreMap(scoresByQuarter);

  return {
    ...EMPTY_SCORES,
    q1PrimaryScore: toNullableScore(map['1']?.home),
    q1OpponentScore: toNullableScore(map['1']?.away),
    q2PrimaryScore: toNullableScore(map['2']?.home),
    q2OpponentScore: toNullableScore(map['2']?.away),
    q3PrimaryScore: toNullableScore(map['3']?.home),
    q3OpponentScore: toNullableScore(map['3']?.away),
    q4PrimaryScore: toNullableScore(map['4']?.home) ?? toNullableScore(finalScoreHome),
    q4OpponentScore: toNullableScore(map['4']?.away) ?? toNullableScore(finalScoreAway),
    q5PrimaryScore: toNullableScore(map['5']?.home),
    q5OpponentScore: toNullableScore(map['5']?.away),
    q6PrimaryScore: toNullableScore(map['6']?.home),
    q6OpponentScore: toNullableScore(map['6']?.away),
    q7PrimaryScore: toNullableScore(map['7']?.home),
    q7OpponentScore: toNullableScore(map['7']?.away),
    q8PrimaryScore: toNullableScore(map['8']?.home),
    q8OpponentScore: toNullableScore(map['8']?.away),
    q9PrimaryScore: toNullableScore(map['9']?.home),
    q9OpponentScore: toNullableScore(map['9']?.away)
  };
};

const mapLookupRow = (row: GameLookupRow): IngestionGameTarget => ({
  gameId: Number(row.game_id),
  gameDate: String(row.game_date),
  kickoffAt: row.kickoff_at ?? null,
  espnEventId: row.espn_event_id ?? null,
  espnEventUid: row.espn_event_uid ?? null,
  homeTeam: row.home_team ?? '',
  awayTeam: row.away_team ?? '',
  homeAbbreviation: row.home_abbreviation ?? null,
  awayAbbreviation: row.away_abbreviation ?? null,
  homeEspnTeamId: row.home_espn_team_id ?? null,
  awayEspnTeamId: row.away_espn_team_id ?? null,
  homeEspnTeamUid: row.home_espn_team_uid ?? null,
  awayEspnTeamUid: row.away_espn_team_uid ?? null,
  sportCode: row.sport_code ?? 'FOOTBALL',
  leagueCode: row.league_code ?? 'NFL',
  state: normalizeGameState(row.state),
  currentQuarter: row.current_quarter != null ? Number(row.current_quarter) : null,
  timeRemainingInQuarter: row.time_remaining_in_quarter ?? null
});

const loadGameTargetWithClient = async (client: PoolClient, gameId: number): Promise<IngestionGameTarget | null> => {
  const result = await client.query<GameLookupRow>(
    `SELECT g.id AS game_id,
            g.game_date::text AS game_date,
            COALESCE(g.kickoff_at::text, g.game_date::timestamp::text) AS kickoff_at,
            g.espn_event_id,
            g.espn_event_uid,
            COALESCE(primary_team.name, '') AS home_team,
            COALESCE(opponent_team.name, '') AS away_team,
            primary_team.abbreviation AS home_abbreviation,
            opponent_team.abbreviation AS away_abbreviation,
            primary_team.espn_team_id AS home_espn_team_id,
            opponent_team.espn_team_id AS away_espn_team_id,
            primary_team.espn_team_uid AS home_espn_team_uid,
            opponent_team.espn_team_uid AS away_espn_team_uid,
            primary_team.sport_code AS sport_code,
            primary_team.league_code AS league_code,
            COALESCE(g.state, 'scheduled') AS state,
            g.current_quarter,
            g.time_remaining_in_quarter
     FROM football_pool.game g
     LEFT JOIN football_pool.sport_team primary_team ON primary_team.id = g.home_team_id
     LEFT JOIN football_pool.sport_team opponent_team ON opponent_team.id = g.away_team_id
     WHERE g.id = $1
     LIMIT 1`,
    [gameId]
  );

  return result.rows[0] ? mapLookupRow(result.rows[0]) : null;
};

export const listTodayGameTargetsForIngestion = async (at: Date = new Date()): Promise<IngestionGameTarget[]> => {
  const dateKey = toCentralDateKey(at);
  const client = await db.connect();

  try {
    const result = await client.query<GameLookupRow>(
      `SELECT g.id AS game_id,
              g.game_date::text AS game_date,
              COALESCE(g.kickoff_at::text, g.game_date::timestamp::text) AS kickoff_at,
              g.espn_event_id,
              g.espn_event_uid,
              COALESCE(primary_team.name, '') AS home_team,
              COALESCE(opponent_team.name, '') AS away_team,
              primary_team.abbreviation AS home_abbreviation,
              opponent_team.abbreviation AS away_abbreviation,
              primary_team.espn_team_id AS home_espn_team_id,
              opponent_team.espn_team_id AS away_espn_team_id,
              primary_team.espn_team_uid AS home_espn_team_uid,
              opponent_team.espn_team_uid AS away_espn_team_uid,
              primary_team.sport_code AS sport_code,
              primary_team.league_code AS league_code,
              COALESCE(g.state, 'scheduled') AS state,
              g.current_quarter,
              g.time_remaining_in_quarter
       FROM football_pool.game g
       LEFT JOIN football_pool.sport_team primary_team ON primary_team.id = g.home_team_id
       LEFT JOIN football_pool.sport_team opponent_team ON opponent_team.id = g.away_team_id
       WHERE g.game_date = $1::date
         AND UPPER(COALESCE(opponent_team.name, '')) <> 'BYE'
       ORDER BY g.game_date ASC, g.id ASC`,
      [dateKey]
    );

    return result.rows.map(mapLookupRow);
  } finally {
    client.release();
  }
};

const getScoreboardCacheTtlMs = (): number => Math.max(15_000, env.SCORE_INGEST_ACTIVE_INTERVAL_SECONDS * 1000);

const fetchScoreboardForDate = async (
  leagueCode: string | null | undefined,
  dateParam: string
): Promise<EspnScoreboardResponse> => {
  const definition = getPoolLeagueDefinition(leagueCode);
  const cacheKey = `${definition.leagueCode}:${dateParam}`;
  const now = Date.now();
  const cached = scoreboardCache.get(cacheKey);

  if (cached && cached.expiresAt > now) {
    return cached.data;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.SCORE_INGEST_REQUEST_TIMEOUT_MS);
  const startedAt = Date.now();
  let statusCode = 0;

  try {
    const response = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/${definition.espnPath}/scoreboard?dates=${dateParam}`,
      { signal: controller.signal }
    );

    statusCode = response.status;

    if (!response.ok) {
      throw new Error(`ESPN request failed with status ${response.status}`);
    }

    const data = (await response.json()) as EspnScoreboardResponse;
    scoreboardCache.set(cacheKey, {
      expiresAt: now + getScoreboardCacheTtlMs(),
      data
    });

    return data;
  } finally {
    clearTimeout(timeout);
    recordApiUsage({
      metricType: 'external_api',
      provider: 'espn',
      routeKey: `/site.api.espn.com/apis/site/v2/sports/${definition.espnPath}/scoreboard`,
      method: 'GET',
      statusCode,
      durationMs: Date.now() - startedAt,
      occurredAt: new Date()
    });
  }
};

const getDisplayNames = (competitor: EspnCompetitor | null | undefined): string[] => (
  [competitor?.team?.displayName, competitor?.team?.shortDisplayName, competitor?.team?.abbreviation].filter(
    (value): value is string => Boolean(value)
  )
);

const matchesEspnTeamIdentity = (
  competitor: EspnCompetitor | null | undefined,
  expected: { id?: string | null; uid?: string | null; name?: string; abbreviation?: string | null }
): boolean => {
  const competitorUid = competitor?.team?.uid?.trim() ?? '';
  const competitorId = competitor?.team?.id?.trim() ?? '';

  if (expected.uid && competitorUid && competitorUid === expected.uid) {
    return true;
  }

  if (expected.id && competitorId && competitorId === expected.id) {
    return true;
  }

  return getDisplayNames(competitor).some(
    (value) => matchesTeamName(value, expected.name ?? '') || matchesTeamName(value, expected.abbreviation ?? '')
  );
};

const findMatchingCompetition = (
  target: IngestionGameTarget,
  scoreboard: EspnScoreboardResponse
): MatchedEspnCompetition | null => {
  for (const event of scoreboard.events ?? []) {
    const competition = event.competitions?.[0];
    if (!competition || !competition.competitors || competition.competitors.length < 2) {
      continue;
    }

    if (
      (target.espnEventUid && event.uid && event.uid.trim() === target.espnEventUid.trim()) ||
      (target.espnEventId && event.id && event.id.trim() === target.espnEventId.trim())
    ) {
      return {
        eventId: event.id?.trim() ?? null,
        eventUid: event.uid?.trim() ?? null,
        competition
      };
    }

    const expectedPrimary = target.homeTeam || env.SCORE_INGEST_PRIMARY_TEAM || '';
    const expectedOpponent = target.awayTeam;

    const directMatch =
      matchesEspnTeamIdentity(competition.competitors[0], {
        id: target.homeEspnTeamId,
        uid: target.homeEspnTeamUid,
        name: expectedPrimary,
        abbreviation: target.homeAbbreviation
      }) &&
      matchesEspnTeamIdentity(competition.competitors[1], {
        id: target.awayEspnTeamId,
        uid: target.awayEspnTeamUid,
        name: expectedOpponent,
        abbreviation: target.awayAbbreviation
      });

    const swappedMatch =
      matchesEspnTeamIdentity(competition.competitors[0], {
        id: target.awayEspnTeamId,
        uid: target.awayEspnTeamUid,
        name: expectedOpponent,
        abbreviation: target.awayAbbreviation
      }) &&
      matchesEspnTeamIdentity(competition.competitors[1], {
        id: target.homeEspnTeamId,
        uid: target.homeEspnTeamUid,
        name: expectedPrimary,
        abbreviation: target.homeAbbreviation
      });

    if (directMatch || swappedMatch) {
      return {
        eventId: event.id?.trim() ?? null,
        eventUid: event.uid?.trim() ?? null,
        competition
      };
    }
  }

  return null;
};

const buildEspnUpdateFromCompetition = (
  gameId: number,
  target: IngestionGameTarget,
  competition: EspnCompetition,
  eventIdentifiers?: { eventId?: string | null; eventUid?: string | null }
): GameIngestionUpdate => {
  const competitors = competition.competitors ?? [];
  const expectedPrimary = target.homeTeam || env.SCORE_INGEST_PRIMARY_TEAM || '';

  const primaryCompetitor =
    competitors.find((competitor) => getDisplayNames(competitor).some((name) => matchesTeamName(name, expectedPrimary))) ??
    competitors[0];
  const opponentCompetitor = competitors.find((competitor) => competitor !== primaryCompetitor) ?? competitors[1];

  const state = normalizeGameState(
    competition.status?.type?.completed
      ? 'completed'
      : competition.status?.type?.description ??
          competition.status?.type?.detail ??
          competition.status?.type?.state ??
          target.state
  );

  const liveQuarter = toNullableScore(competition.status?.period) ?? target.currentQuarter ?? null;
  const scores = buildSportAwareScoresFromCompetition(target, primaryCompetitor, opponentCompetitor, state, liveQuarter);
  const detailParts = [
    competition.status?.displayClock,
    competition.status?.type?.shortDetail,
    competition.status?.type?.detail
  ]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
  const combinedDetail = detailParts.length > 0 ? Array.from(new Set(detailParts)).join(' • ') : null

  return {
    gameId,
    source: 'espn',
    scores,
    state,
    currentQuarter: liveQuarter ?? inferCurrentQuarter(scores, target.currentQuarter),
    timeRemainingInQuarter: combinedDetail ?? target.timeRemainingInQuarter ?? null,
    espnEventId: eventIdentifiers?.eventId ?? target.espnEventId ?? null,
    espnEventUid: eventIdentifiers?.eventUid ?? target.espnEventUid ?? null,
    detectedAt: new Date().toISOString()
  };
};

const getScoresFromEspn = async (gameId: number): Promise<GameIngestionUpdate> => {
  const client = await db.connect();

  try {
    const target = await loadGameTargetWithClient(client, gameId);

    if (!target) {
      throw new Error('Game not found for ESPN ingestion');
    }

    if (normalize(target.awayTeam) === 'bye') {
      throw new Error('BYE weeks do not have scores to ingest');
    }

    const dateValue = new Date(`${target.gameDate}T12:00:00.000Z`);
    const candidateDates = Array.from(
      new Set([
        toYyyyMmDd(dateValue),
        toYyyyMmDd(new Date(dateValue.getTime() - 24 * 60 * 60 * 1000)),
        toYyyyMmDd(new Date(dateValue.getTime() + 24 * 60 * 60 * 1000))
      ])
    );

    let matchedCompetition: MatchedEspnCompetition | null = null;
    for (const candidateDate of candidateDates) {
      const scoreboard = await fetchScoreboardForDate(target.leagueCode, candidateDate);
      matchedCompetition = findMatchingCompetition(target, scoreboard);
      if (matchedCompetition) {
        break;
      }
    }

    if (!matchedCompetition) {
      return {
        gameId,
        source: 'espn',
        scores: EMPTY_SCORES,
        state: target.state,
        currentQuarter: target.currentQuarter,
        timeRemainingInQuarter: target.timeRemainingInQuarter,
        espnEventId: target.espnEventId ?? null,
        espnEventUid: target.espnEventUid ?? null,
        detectedAt: new Date().toISOString()
      };
    }

    return buildEspnUpdateFromCompetition(gameId, target, matchedCompetition.competition, {
      eventId: matchedCompetition.eventId,
      eventUid: matchedCompetition.eventUid
    });
  } finally {
    client.release();
  }
};

export const getGameIngestionUpdate = async (
  gameId: number,
  source: IngestionSource,
  payloadScores?: QuarterScoresInput
): Promise<GameIngestionUpdate> => {
  if (source === 'payload') {
    if (!payloadScores) {
      throw new Error('Payload source requires scores in request body');
    }

    return {
      gameId,
      source,
      scores: payloadScores,
      state: inferGameStateFromScores(payloadScores),
      currentQuarter: inferCurrentQuarter(payloadScores),
      timeRemainingInQuarter: null,
      espnEventId: null,
      espnEventUid: null,
      detectedAt: new Date().toISOString()
    };
  }

  if (source === 'espn') {
    return getScoresFromEspn(gameId);
  }

  const client = await db.connect();

  try {
    const target = await loadGameTargetWithClient(client, gameId);
    const scores = buildDeterministicMockScores(gameId, target?.leagueCode);

    return {
      gameId,
      source,
      scores,
      state: inferGameStateFromScores(scores, target?.leagueCode),
      currentQuarter: inferCurrentQuarter(scores, null, target?.leagueCode),
      timeRemainingInQuarter: null,
      espnEventId: null,
      espnEventUid: null,
      detectedAt: new Date().toISOString()
    };
  } finally {
    client.release();
  };
};

export const getScoresForGame = async (
  gameId: number,
  source: IngestionSource,
  payloadScores?: QuarterScoresInput
): Promise<QuarterScoresInput> => {
  const update = await getGameIngestionUpdate(gameId, source, payloadScores);
  return update.scores;
};

const applyGameIngestionUpdateWithClient = async (
  client: PoolClient,
  update: GameIngestionUpdate,
  options?: { forceProcess?: boolean }
): Promise<IngestGameScoresResult> => {
  const existingResult = await client.query<{
    scores_by_quarter: unknown;
    final_score_home: number | null;
    final_score_away: number | null;
    state: string | null;
    current_quarter: number | null;
    time_remaining_in_quarter: string | null;
    espn_event_id: string | null;
    espn_event_uid: string | null;
    league_code: string | null;
  }>(
    `SELECT g.scores_by_quarter,
            g.final_score_home,
            g.final_score_away,
            g.state,
            g.current_quarter,
            g.time_remaining_in_quarter,
            g.espn_event_id,
            g.espn_event_uid,
            COALESCE(primary_team.league_code, 'NFL') AS league_code
     FROM football_pool.game g
     LEFT JOIN football_pool.sport_team primary_team ON primary_team.id = g.home_team_id
     WHERE g.id = $1
     LIMIT 1`,
    [update.gameId]
  );

  if (existingResult.rows.length === 0) {
    throw new Error('Game not found');
  }

  const existing = existingResult.rows[0];
  const activeSegments = getActiveScoreSegmentNumbers(existing.league_code);
  const finalSegment = activeSegments[activeSegments.length - 1] ?? 4;
  const finalScores = getQuarterScoresFromInput(update.scores, finalSegment);
  const existingScores = extractScoresFromDbValue(existing.scores_by_quarter, existing.final_score_home, existing.final_score_away);
  const nextState = normalizeGameState(update.state || inferGameStateFromScores(update.scores, existing.league_code));
  const nextQuarter = nextState === 'scheduled' ? null : inferCurrentQuarter(update.scores, update.currentQuarter, existing.league_code);
  const nextClock = nextState === 'completed' ? '0:00' : nextState === 'scheduled' ? null : update.timeRemainingInQuarter ?? null;
  const hasActiveScores = activeSegments.some((quarter) => {
    const quarterScores = getQuarterScoresFromInput(update.scores, quarter);
    return quarterScores.primaryScore != null || quarterScores.opponentScore != null;
  });
  const shouldClearExistingWinnings = nextState === 'scheduled' && !hasActiveScores;

  const changed =
    !scoresEqual(existingScores, update.scores) ||
    normalizeGameState(existing.state) !== nextState ||
    Number(existing.current_quarter ?? 0) !== Number(nextQuarter ?? 0) ||
    String(existing.time_remaining_in_quarter ?? '') !== String(nextClock ?? '') ||
    String(existing.espn_event_id ?? '') !== String(update.espnEventId ?? existing.espn_event_id ?? '') ||
    String(existing.espn_event_uid ?? '') !== String(update.espnEventUid ?? existing.espn_event_uid ?? '');

  if (changed) {
    await client.query(
      `UPDATE football_pool.game
       SET scores_by_quarter = $1::jsonb,
           final_score_home = $2,
           final_score_away = $3,
           state = $4,
           current_quarter = $5,
           time_remaining_in_quarter = $6,
           espn_event_id = COALESCE($7, espn_event_id),
           espn_event_uid = COALESCE($8, espn_event_uid),
           updated_at = NOW()
       WHERE id = $9`,
      [
        JSON.stringify(buildScoresByQuarterJson(update.scores)),
        finalScores.primaryScore,
        finalScores.opponentScore,
        nextState,
        nextQuarter,
        nextClock,
        update.espnEventId ?? null,
        update.espnEventUid ?? null,
        update.gameId
      ]
    );
  }

  if (shouldClearExistingWinnings) {
    await client.query(
      `DELETE FROM football_pool.winnings_ledger
       WHERE game_id = $1`,
      [update.gameId]
    );
  }

  const shouldProcess = !shouldClearExistingWinnings && (changed || Boolean(options?.forceProcess));
  const results = shouldProcess
    ? await processGameScoresWithClient(client, update.gameId, update.scores)
    : [];

  return {
    gameId: update.gameId,
    source: update.source,
    scores: update.scores,
    updated: changed,
    processed: shouldProcess,
    state: nextState,
    currentQuarter: nextQuarter,
    timeRemainingInQuarter: nextClock,
    results
  };
};

export const ingestGameScores = async (
  gameId: number,
  source: IngestionSource,
  payloadScores?: QuarterScoresInput,
  options?: { forceProcess?: boolean }
): Promise<IngestGameScoresResult> => {
  const update = await getGameIngestionUpdate(gameId, source, payloadScores);
  const client = await db.connect();

  try {
    await client.query('BEGIN');
    const result = await applyGameIngestionUpdateWithClient(client, update, options);
    await client.query('COMMIT');

    publishScoreIngestionEvent({
      type: 'game-updated',
      timestamp: new Date().toISOString(),
      payload: {
        gameId,
        source,
        updated: result.updated,
        processed: result.processed,
        state: result.state,
        currentQuarter: result.currentQuarter,
        timeRemainingInQuarter: result.timeRemainingInQuarter,
        winnersWritten: result.results.reduce((sum, entry) => sum + Number(entry.winnersWritten ?? 0), 0)
      }
    });

    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const listEligibleGamesForIngestion = async (at: Date = new Date()): Promise<number[]> => {
  const targets = await listTodayGameTargetsForIngestion(at);

  return targets
    .filter((target) => normalizeGameState(target.state) !== 'completed')
    .map((target) => target.gameId);
};

