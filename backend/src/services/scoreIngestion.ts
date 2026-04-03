import { db } from '../config/db';
import { env } from '../config/env';
import type { QuarterScoresInput } from './scoreProcessing';

export type IngestionSource = 'mock' | 'payload' | 'espn';

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

export const getScoresForGame = async (
  gameId: number,
  source: IngestionSource,
  payloadScores?: QuarterScoresInput
): Promise<QuarterScoresInput> => {
  if (source === 'payload') {
    if (!payloadScores) {
      throw new Error('Payload source requires scores in request body');
    }
    return payloadScores;
  }

  if (source === 'espn') {
    return getScoresFromEspn(gameId);
  }

  return buildDeterministicMockScores(gameId);
};

const normalize = (value: string): string => value.trim().toLowerCase();

const toYyyyMmDd = (date: Date): string => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
};

const getScoresFromEspn = async (gameId: number): Promise<QuarterScoresInput> => {
  const client = await db.connect();

  try {
    const gameResult = await client.query(
      `SELECT g.id, g.opponent, g.game_dt, p.primary_team
       FROM football_pool.game g
       JOIN football_pool.pool p ON p.id = g.pool_id
       WHERE g.id = $1`,
      [gameId]
    );

    if (gameResult.rows.length === 0) {
      throw new Error('Game not found for ESPN ingestion');
    }

    const game = gameResult.rows[0] as {
      id: number;
      opponent: string;
      game_dt: string;
      primary_team: string;
    };

    const dateParam = toYyyyMmDd(new Date(game.game_dt));
    const response = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${dateParam}`
    );

    if (!response.ok) {
      throw new Error(`ESPN request failed with status ${response.status}`);
    }

    const data = (await response.json()) as {
      events?: Array<{
        competitions?: Array<{
          competitors?: Array<{ team?: { displayName?: string; shortDisplayName?: string }; score?: string }>;
          situation?: {
            lastPlay?: {
              homeScore?: number;
              awayScore?: number;
            };
          };
        }>;
      }>;
    };

    const primaryHint = normalize(env.SCORE_INGEST_PRIMARY_TEAM || game.primary_team || '');
    const opponentHint = normalize(game.opponent || '');

    for (const event of data.events ?? []) {
      const competition = event.competitions?.[0];
      if (!competition || !competition.competitors || competition.competitors.length < 2) {
        continue;
      }

      const names = competition.competitors.map((c) =>
        normalize(c.team?.displayName || c.team?.shortDisplayName || '')
      );

      const matchesOpponent = names.some((n) => n.includes(opponentHint));
      const matchesPrimary = primaryHint
        ? names.some((n) => n.includes(primaryHint))
        : true;

      if (!matchesOpponent || !matchesPrimary) {
        continue;
      }

      const home = competition.competitors[0];
      const away = competition.competitors[1];

      const homeName = normalize(home.team?.displayName || home.team?.shortDisplayName || '');
      const awayName = normalize(away.team?.displayName || away.team?.shortDisplayName || '');

      const primaryIsHome = primaryHint ? homeName.includes(primaryHint) : !homeName.includes(opponentHint);

      const primaryFinal = Number(primaryIsHome ? home.score : away.score) || 0;
      const opponentFinal = Number(primaryIsHome ? away.score : home.score) || 0;

      // ESPN free scoreboard endpoint does not reliably expose per-quarter values without additional endpoints.
      // We maintain deterministic quarter splits from final to keep ingestion idempotent.
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
    }

    throw new Error('No matching ESPN game found for configured primary/opponent teams');
  } finally {
    client.release();
  }
};

export const listEligibleGamesForIngestion = async (): Promise<number[]> => {
  const client = await db.connect();
  try {
    const result = await client.query(
      `SELECT id
       FROM football_pool.game
       WHERE game_dt <= CURRENT_DATE
       ORDER BY game_dt DESC
       LIMIT 25`
    );

    return result.rows.map((row) => row.id as number);
  } finally {
    client.release();
  }
};
