import type { PoolClient } from 'pg';
import { db } from '../config/db';
import { env } from '../config/env';
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
  homeTeam: string;
  awayTeam: string;
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
  home_team: string | null;
  away_team: string | null;
  state: string | null;
  current_quarter: number | null;
  time_remaining_in_quarter: string | null;
}

type QuarterKey = '1' | '2' | '3' | '4';
type QuarterScoreMap = Partial<Record<QuarterKey, { home?: number | null; away?: number | null }>>;

type EspnCompetitor = {
  homeAway?: string;
  score?: string;
  linescores?: Array<{ value?: number | string; displayValue?: string }>;
  team?: {
    displayName?: string;
    shortDisplayName?: string;
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
    competitions?: EspnCompetition[];
  }>;
};

const EMPTY_SCORES: QuarterScoresInput = {
  q1PrimaryScore: null,
  q1OpponentScore: null,
  q2PrimaryScore: null,
  q2OpponentScore: null,
  q3PrimaryScore: null,
  q3OpponentScore: null,
  q4PrimaryScore: null,
  q4OpponentScore: null
};

const scoreboardCache = new Map<string, { expiresAt: number; data: EspnScoreboardResponse }>();

const buildDeterministicMockScores = (gameId: number): QuarterScoresInput => {
  const base = (gameId * 7) % 10;

  return {
    q1PrimaryScore: (base + 3) % 10,
    q1OpponentScore: (base + 7) % 10,
    q2PrimaryScore: ((base + 1) % 10) + 10,
    q2OpponentScore: ((base + 5) % 10) + 10,
    q3PrimaryScore: ((base + 4) % 10) + 20,
    q3OpponentScore: ((base + 6) % 10) + 20,
    q4PrimaryScore: ((base + 2) % 10) + 30,
    q4OpponentScore: ((base + 8) % 10) + 30
  };
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

const toCumulativeQuarterScores = (lineScores: unknown): [number | null, number | null, number | null, number | null] => {
  if (!Array.isArray(lineScores) || lineScores.length === 0) {
    return [null, null, null, null];
  }

  let runningTotal = 0;
  let sequenceBroken = false;
  const cumulative = Array.from({ length: 4 }, (_, index) => {
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
  }) as [number | null, number | null, number | null, number | null];

  return cumulative;
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

const inferGameStateFromScores = (scores: QuarterScoresInput): string => {
  if (scores.q4PrimaryScore != null && scores.q4OpponentScore != null) {
    return 'completed';
  }

  if (
    scores.q1PrimaryScore != null ||
    scores.q1OpponentScore != null ||
    scores.q2PrimaryScore != null ||
    scores.q2OpponentScore != null ||
    scores.q3PrimaryScore != null ||
    scores.q3OpponentScore != null ||
    scores.q4PrimaryScore != null ||
    scores.q4OpponentScore != null
  ) {
    return 'in_progress';
  }

  return 'scheduled';
};

const normalizeGameState = (value: unknown): string => {
  const raw = normalize(String(value ?? 'scheduled'));

  if (['post', 'final', 'completed', 'complete', 'closed', 'finished'].some((keyword) => raw.includes(keyword))) {
    return 'completed';
  }

  if (['in', 'live', 'progress'].some((keyword) => raw.includes(keyword))) {
    return 'in_progress';
  }

  return 'scheduled';
};

const inferCurrentQuarter = (scores: QuarterScoresInput, preferredQuarter?: number | null): number | null => {
  if (preferredQuarter != null && Number.isFinite(Number(preferredQuarter))) {
    return Number(preferredQuarter);
  }

  if (scores.q4PrimaryScore != null || scores.q4OpponentScore != null) return 4;
  if (scores.q3PrimaryScore != null || scores.q3OpponentScore != null) return 3;
  if (scores.q2PrimaryScore != null || scores.q2OpponentScore != null) return 2;
  if (scores.q1PrimaryScore != null || scores.q1OpponentScore != null) return 1;
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
  left.q4OpponentScore === right.q4OpponentScore
);

const buildScoresByQuarterJson = (scores: QuarterScoresInput): QuarterScoreMap => ({
  '1': { home: scores.q1PrimaryScore, away: scores.q1OpponentScore },
  '2': { home: scores.q2PrimaryScore, away: scores.q2OpponentScore },
  '3': { home: scores.q3PrimaryScore, away: scores.q3OpponentScore },
  '4': { home: scores.q4PrimaryScore, away: scores.q4OpponentScore }
});

const extractScoresFromDbValue = (
  scoresByQuarter: unknown,
  finalScoreHome?: unknown,
  finalScoreAway?: unknown
): QuarterScoresInput => {
  const map = toQuarterScoreMap(scoresByQuarter);

  return {
    q1PrimaryScore: toNullableScore(map['1']?.home),
    q1OpponentScore: toNullableScore(map['1']?.away),
    q2PrimaryScore: toNullableScore(map['2']?.home),
    q2OpponentScore: toNullableScore(map['2']?.away),
    q3PrimaryScore: toNullableScore(map['3']?.home),
    q3OpponentScore: toNullableScore(map['3']?.away),
    q4PrimaryScore: toNullableScore(map['4']?.home) ?? toNullableScore(finalScoreHome),
    q4OpponentScore: toNullableScore(map['4']?.away) ?? toNullableScore(finalScoreAway)
  };
};

const mapLookupRow = (row: GameLookupRow): IngestionGameTarget => ({
  gameId: Number(row.game_id),
  gameDate: String(row.game_date),
  kickoffAt: row.kickoff_at ?? null,
  homeTeam: row.home_team ?? '',
  awayTeam: row.away_team ?? '',
  state: normalizeGameState(row.state),
  currentQuarter: row.current_quarter != null ? Number(row.current_quarter) : null,
  timeRemainingInQuarter: row.time_remaining_in_quarter ?? null
});

const loadGameTargetWithClient = async (client: PoolClient, gameId: number): Promise<IngestionGameTarget | null> => {
  const result = await client.query<GameLookupRow>(
    `SELECT g.id AS game_id,
            g.game_date::text AS game_date,
            COALESCE(g.kickoff_at::text, g.game_date::timestamp::text) AS kickoff_at,
            COALESCE(primary_team.name, '') AS home_team,
            COALESCE(opponent_team.name, '') AS away_team,
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
              COALESCE(primary_team.name, '') AS home_team,
              COALESCE(opponent_team.name, '') AS away_team,
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

const fetchScoreboardForDate = async (dateParam: string): Promise<EspnScoreboardResponse> => {
  const now = Date.now();
  const cached = scoreboardCache.get(dateParam);

  if (cached && cached.expiresAt > now) {
    return cached.data;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.SCORE_INGEST_REQUEST_TIMEOUT_MS);
  const startedAt = Date.now();
  let statusCode = 0;

  try {
    const response = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${dateParam}`,
      { signal: controller.signal }
    );

    statusCode = response.status;

    if (!response.ok) {
      throw new Error(`ESPN request failed with status ${response.status}`);
    }

    const data = (await response.json()) as EspnScoreboardResponse;
    scoreboardCache.set(dateParam, {
      expiresAt: now + getScoreboardCacheTtlMs(),
      data
    });

    return data;
  } finally {
    clearTimeout(timeout);
    recordApiUsage({
      metricType: 'external_api',
      provider: 'espn',
      routeKey: '/site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
      method: 'GET',
      statusCode,
      durationMs: Date.now() - startedAt,
      occurredAt: new Date()
    });
  }
};

const getDisplayNames = (competitor: EspnCompetitor | null | undefined): string[] => (
  [competitor?.team?.displayName, competitor?.team?.shortDisplayName].filter((value): value is string => Boolean(value))
);

const findMatchingCompetition = (
  target: IngestionGameTarget,
  scoreboard: EspnScoreboardResponse
): EspnCompetition | null => {
  for (const event of scoreboard.events ?? []) {
    const competition = event.competitions?.[0];
    if (!competition || !competition.competitors || competition.competitors.length < 2) {
      continue;
    }

    const firstNames = getDisplayNames(competition.competitors[0]);
    const secondNames = getDisplayNames(competition.competitors[1]);

    const expectedPrimary = target.homeTeam || env.SCORE_INGEST_PRIMARY_TEAM || '';
    const expectedOpponent = target.awayTeam;

    const directMatch =
      firstNames.some((name) => matchesTeamName(name, expectedPrimary)) &&
      secondNames.some((name) => matchesTeamName(name, expectedOpponent));
    const swappedMatch =
      firstNames.some((name) => matchesTeamName(name, expectedOpponent)) &&
      secondNames.some((name) => matchesTeamName(name, expectedPrimary));

    if (directMatch || swappedMatch) {
      return competition;
    }
  }

  return null;
};

const buildEspnUpdateFromCompetition = (
  gameId: number,
  target: IngestionGameTarget,
  competition: EspnCompetition
): GameIngestionUpdate => {
  const competitors = competition.competitors ?? [];
  const expectedPrimary = target.homeTeam || env.SCORE_INGEST_PRIMARY_TEAM || '';

  const primaryCompetitor =
    competitors.find((competitor) => getDisplayNames(competitor).some((name) => matchesTeamName(name, expectedPrimary))) ??
    competitors[0];
  const opponentCompetitor = competitors.find((competitor) => competitor !== primaryCompetitor) ?? competitors[1];

  const [q1Primary, q2Primary, q3Primary, q4Primary] = toCumulativeQuarterScores(primaryCompetitor?.linescores);
  const [q1Opponent, q2Opponent, q3Opponent, q4Opponent] = toCumulativeQuarterScores(opponentCompetitor?.linescores);

  const quarterBreakdownExists =
    [q1Primary, q2Primary, q3Primary, q4Primary].some((value) => value != null) &&
    [q1Opponent, q2Opponent, q3Opponent, q4Opponent].some((value) => value != null);

  const state = normalizeGameState(
    competition.status?.type?.completed
      ? 'completed'
      : competition.status?.type?.state ?? competition.status?.type?.description ?? target.state
  );

  const scores = quarterBreakdownExists
    ? {
        q1PrimaryScore: q1Primary,
        q1OpponentScore: q1Opponent,
        q2PrimaryScore: q2Primary,
        q2OpponentScore: q2Opponent,
        q3PrimaryScore: q3Primary,
        q3OpponentScore: q3Opponent,
        q4PrimaryScore: q4Primary,
        q4OpponentScore: q4Opponent
      }
    : (() => {
        const primaryFinal = toNullableScore(primaryCompetitor?.score);
        const opponentFinal = toNullableScore(opponentCompetitor?.score);

        if (primaryFinal != null && opponentFinal != null && state !== 'scheduled') {
          return buildFallbackQuarterScoresFromFinal(primaryFinal, opponentFinal);
        }

        return EMPTY_SCORES;
      })();

  return {
    gameId,
    source: 'espn',
    scores,
    state,
    currentQuarter: toNullableScore(competition.status?.period) ?? inferCurrentQuarter(scores, target.currentQuarter),
    timeRemainingInQuarter:
      competition.status?.displayClock ??
      competition.status?.type?.shortDetail ??
      competition.status?.type?.detail ??
      target.timeRemainingInQuarter ??
      null,
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
    const scoreboard = await fetchScoreboardForDate(toYyyyMmDd(dateValue));
    const competition = findMatchingCompetition(target, scoreboard);

    if (!competition) {
      return {
        gameId,
        source: 'espn',
        scores: EMPTY_SCORES,
        state: target.state,
        currentQuarter: target.currentQuarter,
        timeRemainingInQuarter: target.timeRemainingInQuarter,
        detectedAt: new Date().toISOString()
      };
    }

    return buildEspnUpdateFromCompetition(gameId, target, competition);
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
      detectedAt: new Date().toISOString()
    };
  }

  if (source === 'espn') {
    return getScoresFromEspn(gameId);
  }

  const scores = buildDeterministicMockScores(gameId);
  return {
    gameId,
    source,
    scores,
    state: inferGameStateFromScores(scores),
    currentQuarter: inferCurrentQuarter(scores),
    timeRemainingInQuarter: null,
    detectedAt: new Date().toISOString()
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
  }>(
    `SELECT scores_by_quarter,
            final_score_home,
            final_score_away,
            state,
            current_quarter,
            time_remaining_in_quarter
     FROM football_pool.game
     WHERE id = $1
     LIMIT 1`,
    [update.gameId]
  );

  if (existingResult.rows.length === 0) {
    throw new Error('Game not found');
  }

  const existing = existingResult.rows[0];
  const existingScores = extractScoresFromDbValue(existing.scores_by_quarter, existing.final_score_home, existing.final_score_away);
  const nextState = normalizeGameState(update.state || inferGameStateFromScores(update.scores));
  const nextQuarter = nextState === 'scheduled' ? null : inferCurrentQuarter(update.scores, update.currentQuarter);
  const nextClock = nextState === 'completed' ? '0:00' : update.timeRemainingInQuarter ?? null;

  const changed =
    !scoresEqual(existingScores, update.scores) ||
    normalizeGameState(existing.state) !== nextState ||
    Number(existing.current_quarter ?? 0) !== Number(nextQuarter ?? 0) ||
    String(existing.time_remaining_in_quarter ?? '') !== String(nextClock ?? '');

  if (changed) {
    await client.query(
      `UPDATE football_pool.game
       SET scores_by_quarter = $1::jsonb,
           final_score_home = $2,
           final_score_away = $3,
           state = $4,
           current_quarter = $5,
           time_remaining_in_quarter = $6,
           updated_at = NOW()
       WHERE id = $7`,
      [
        JSON.stringify(buildScoresByQuarterJson(update.scores)),
        update.scores.q4PrimaryScore,
        update.scores.q4OpponentScore,
        nextState,
        nextQuarter,
        nextClock,
        update.gameId
      ]
    );

  }

  const shouldProcess = changed || Boolean(options?.forceProcess);
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

