import type { PoolClient } from 'pg';
import { db } from '../config/db';
import { buildMatchupDisplayLabel, isGenericMatchupName, normalizeMatchupName, parseMatchupLabel } from '../utils/matchupLabels';
import { emitScoreNotifications, type QuarterNotificationResult, type LiveLeaderState } from './notifications';
import { resolvePoolGameBoardNumbers } from './poolBoardNumbers';
import { loadPoolPayoutConfig, resolvePoolPayoutsForRound } from './poolPayouts';

export interface QuarterScoresInput {
  q1PrimaryScore: number | null;
  q1OpponentScore: number | null;
  q2PrimaryScore: number | null;
  q2OpponentScore: number | null;
  q3PrimaryScore: number | null;
  q3OpponentScore: number | null;
  q4PrimaryScore: number | null;
  q4OpponentScore: number | null;
}

interface QuarterSpec {
  num: number;
  payout: number;
  squareNum: number | null;
}

type GameScoreSnapshot = {
  id: number;
  pool_id: number;
  row_numbers: unknown;
  col_numbers: unknown;
  q1_primary_score: number | null;
  q1_opponent_score: number | null;
  q2_primary_score: number | null;
  q2_opponent_score: number | null;
  q3_primary_score: number | null;
  q3_opponent_score: number | null;
  q4_primary_score: number | null;
  q4_opponent_score: number | null;
};

type BracketProgressionGame = {
  pool_game_id: number;
  pool_id: number;
  game_id: number;
  row_numbers: unknown;
  column_numbers: unknown;
  round_label: string | null;
  round_sequence: number | null;
  bracket_region: string | null;
  matchup_order: number | null;
  championship_flg: boolean;
  home_team_id: number | null;
  away_team_id: number | null;
  home_team_name: string | null;
  away_team_name: string | null;
  sport_code: string | null;
  league_code: string | null;
  q1_primary_score: number | null;
  q1_opponent_score: number | null;
  q2_primary_score: number | null;
  q2_opponent_score: number | null;
  q3_primary_score: number | null;
  q3_opponent_score: number | null;
  q4_primary_score: number | null;
  q4_opponent_score: number | null;
};

export interface ScoreProcessingResult {
  game: {
    id: number;
    pool_id: number;
    q1_primary_score: number | null;
    q1_opponent_score: number | null;
    q2_primary_score: number | null;
    q2_opponent_score: number | null;
    q3_primary_score: number | null;
    q3_opponent_score: number | null;
    q4_primary_score: number | null;
    q4_opponent_score: number | null;
  };
  winnersCalculated: boolean;
  winnersWritten: number;
  unresolvedWinners: number;
}

const defaultDigitOrder = Array.from({ length: 10 }, (_, index) => index);

const toDigitOrder = (value: unknown): number[] => {
  if (typeof value === 'string') {
    try {
      return toDigitOrder(JSON.parse(value));
    } catch {
      return defaultDigitOrder;
    }
  }

  if (Array.isArray(value)) {
    const normalized = value.map((entry) => Number(entry));
    if (normalized.length === 10 && normalized.every((entry) => Number.isFinite(entry))) {
      return normalized;
    }
  }

  return defaultDigitOrder;
};

export const resolveWinningSquareNumber = (
  rowNumbers: unknown,
  colNumbers: unknown,
  opponentScore: number | null | undefined,
  primaryScore: number | null | undefined,
  winnerLoserMode = false
): number | null => {
  if (opponentScore == null || primaryScore == null) {
    return null;
  }

  const rowDigits = toDigitOrder(rowNumbers);
  const colDigits = toDigitOrder(colNumbers);
  const resolvedTopScore = winnerLoserMode ? Math.max(Number(primaryScore), Number(opponentScore)) : Number(primaryScore);
  const resolvedSideScore = winnerLoserMode ? Math.min(Number(primaryScore), Number(opponentScore)) : Number(opponentScore);
  const opponentDigit = resolvedSideScore % 10;
  const primaryDigit = resolvedTopScore % 10;
  const rowIndex = rowDigits.findIndex((digit) => digit === opponentDigit);
  const colIndex = colDigits.findIndex((digit) => digit === primaryDigit);

  if (rowIndex === -1 || colIndex === -1) {
    return null;
  }

  return (rowIndex * 10) + colIndex + 1;
};

const getLatestScoredQuarter = (game: GameScoreSnapshot): number | null => {
  if (game.q4_primary_score != null && game.q4_opponent_score != null) return 4;
  if (game.q3_primary_score != null && game.q3_opponent_score != null) return 3;
  if (game.q2_primary_score != null && game.q2_opponent_score != null) return 2;
  if (game.q1_primary_score != null && game.q1_opponent_score != null) return 1;
  return null;
};

const getQuarterScoresFromGame = (game: GameScoreSnapshot, quarter: number): { primaryScore: number | null; opponentScore: number | null } => {
  if (quarter === 1) return { primaryScore: game.q1_primary_score, opponentScore: game.q1_opponent_score };
  if (quarter === 2) return { primaryScore: game.q2_primary_score, opponentScore: game.q2_opponent_score };
  if (quarter === 3) return { primaryScore: game.q3_primary_score, opponentScore: game.q3_opponent_score };
  return { primaryScore: game.q4_primary_score, opponentScore: game.q4_opponent_score };
};

const getQuarterScoresFromInput = (scores: QuarterScoresInput, quarter: number): { primaryScore: number | null; opponentScore: number | null } => {
  if (quarter === 1) return { primaryScore: scores.q1PrimaryScore, opponentScore: scores.q1OpponentScore };
  if (quarter === 2) return { primaryScore: scores.q2PrimaryScore, opponentScore: scores.q2OpponentScore };
  if (quarter === 3) return { primaryScore: scores.q3PrimaryScore, opponentScore: scores.q3OpponentScore };
  return { primaryScore: scores.q4PrimaryScore, opponentScore: scores.q4OpponentScore };
};

const buildLiveLeaderState = (game: GameScoreSnapshot): LiveLeaderState | null => {
  if (game.q4_primary_score != null && game.q4_opponent_score != null) {
    return null;
  }

  const latestQuarter = getLatestScoredQuarter(game);
  if (latestQuarter == null) {
    return null;
  }

  const quarterScores = getQuarterScoresFromGame(game, latestQuarter);
  const squareNum = resolveWinningSquareNumber(game.row_numbers, game.col_numbers, quarterScores.opponentScore, quarterScores.primaryScore);

  if (squareNum == null) {
    return null;
  }

  return {
    quarter: latestQuarter,
    squareNum,
    primaryScore: quarterScores.primaryScore,
    opponentScore: quarterScores.opponentScore
  };
};

const parseBracketFeedLabel = (
  value: string | null | undefined
): { region: string | null; roundLabel: string; sourceNumbers: [number, number] } | null => {
  const normalized = normalizeMatchupName(value);
  if (!normalized) {
    return null;
  }

  const match = normalized.match(/^(?:(.+?)\s+)?Winner of (.+?) Game (\d+)\s+vs\s+Winner of (.+?) Game (\d+)$/i);
  if (!match) {
    return null;
  }

  const region = normalizeMatchupName(match[1]);
  const firstRoundLabel = normalizeMatchupName(match[2]);
  const secondRoundLabel = normalizeMatchupName(match[4]);

  if (!firstRoundLabel || firstRoundLabel.toLowerCase() !== secondRoundLabel.toLowerCase()) {
    return null;
  }

  return {
    region: region || null,
    roundLabel: firstRoundLabel,
    sourceNumbers: [Number(match[3]), Number(match[5])]
  };
};

const isCompletedBracketGame = (game: BracketProgressionGame): boolean =>
  game.q4_primary_score != null && game.q4_opponent_score != null;

const resolveActualWinnerName = (game: BracketProgressionGame): string | null => {
  if (!isCompletedBracketGame(game)) {
    return null;
  }

  const homeName = normalizeMatchupName(game.home_team_name);
  const awayName = normalizeMatchupName(game.away_team_name);

  if (!homeName || !awayName) {
    return null;
  }

  if (
    isGenericMatchupName(homeName) ||
    isGenericMatchupName(awayName) ||
    /winner of/i.test(homeName) ||
    /winner of/i.test(awayName) ||
    parseMatchupLabel(homeName) ||
    parseMatchupLabel(awayName)
  ) {
    return null;
  }

  if (Number(game.q4_primary_score) === Number(game.q4_opponent_score)) {
    return null;
  }

  return Number(game.q4_primary_score) > Number(game.q4_opponent_score) ? homeName : awayName;
};

const resolveAdvancingTeamLabel = (game: BracketProgressionGame): string => {
  const actualWinnerName = resolveActualWinnerName(game);
  if (actualWinnerName) {
    return actualWinnerName;
  }

  const matchupLabel = buildMatchupDisplayLabel(game.home_team_name, game.away_team_name, {
    roundLabel: game.round_label,
    fallback: game.away_team_name ?? 'TBD'
  });
  const normalizedMatchup = normalizeMatchupName(matchupLabel);

  if (!normalizedMatchup) {
    return `Winner of ${game.round_label ?? 'previous round'} Game ${game.matchup_order ?? game.game_id}`;
  }

  return /^winner of /i.test(normalizedMatchup) ? normalizedMatchup : `Winner of ${normalizedMatchup}`;
};

const loadPoolBracketGames = async (client: PoolClient, poolId: number): Promise<BracketProgressionGame[]> => {
  const result = await client.query(
    `SELECT pg.id AS pool_game_id,
            pg.pool_id,
            pg.row_numbers,
            pg.column_numbers,
            pg.round_label,
            pg.round_sequence,
            pg.bracket_region,
            pg.matchup_order,
            COALESCE(pg.championship_flg, FALSE) AS championship_flg,
            g.id AS game_id,
            g.home_team_id,
            g.away_team_id,
            home.name AS home_team_name,
            away.name AS away_team_name,
            COALESCE(p.sport_code, 'FOOTBALL') AS sport_code,
            COALESCE(p.league_code, 'NFL') AS league_code,
            g.scores_by_quarter
     FROM football_pool.pool_game pg
     JOIN football_pool.game g ON g.id = pg.game_id
     JOIN football_pool.pool p ON p.id = pg.pool_id
     LEFT JOIN football_pool.sport_team home ON home.id = g.home_team_id
     LEFT JOIN football_pool.sport_team away ON away.id = g.away_team_id
     WHERE pg.pool_id = $1
     ORDER BY COALESCE(pg.round_sequence, g.week_number, 9999),
              COALESCE(pg.matchup_order, 9999),
              g.id`,
    [poolId]
  );

  return result.rows.map((row) => {
    const scores = typeof row.scores_by_quarter === 'string' ? JSON.parse(row.scores_by_quarter) : row.scores_by_quarter ?? {};
    const scoreMap = (scores as Record<string, { home?: number | null; away?: number | null }>) ?? {};

    return {
      pool_game_id: Number(row.pool_game_id),
      pool_id: Number(row.pool_id),
      game_id: Number(row.game_id),
      row_numbers: row.row_numbers,
      column_numbers: row.column_numbers,
      round_label: typeof row.round_label === 'string' ? row.round_label : null,
      round_sequence: row.round_sequence != null ? Number(row.round_sequence) : null,
      bracket_region: typeof row.bracket_region === 'string' ? row.bracket_region : null,
      matchup_order: row.matchup_order != null ? Number(row.matchup_order) : null,
      championship_flg: Boolean(row.championship_flg),
      home_team_id: row.home_team_id != null ? Number(row.home_team_id) : null,
      away_team_id: row.away_team_id != null ? Number(row.away_team_id) : null,
      home_team_name: typeof row.home_team_name === 'string' ? row.home_team_name : null,
      away_team_name: typeof row.away_team_name === 'string' ? row.away_team_name : null,
      sport_code: typeof row.sport_code === 'string' ? row.sport_code : null,
      league_code: typeof row.league_code === 'string' ? row.league_code : null,
      q1_primary_score: scoreMap['1']?.home ?? null,
      q1_opponent_score: scoreMap['1']?.away ?? null,
      q2_primary_score: scoreMap['2']?.home ?? null,
      q2_opponent_score: scoreMap['2']?.away ?? null,
      q3_primary_score: scoreMap['3']?.home ?? null,
      q3_opponent_score: scoreMap['3']?.away ?? null,
      q4_primary_score: scoreMap['4']?.home ?? null,
      q4_opponent_score: scoreMap['4']?.away ?? null
    };
  });
};

const resolveOrCreateBracketTeamId = async (
  client: PoolClient,
  teamName: string,
  sportCode: string,
  leagueCode: string
): Promise<number | null> => {
  const normalizedName = normalizeMatchupName(teamName);
  if (!normalizedName) {
    return null;
  }

  const existingResult = await client.query<{ id: number }>(
    `SELECT id
     FROM football_pool.sport_team
     WHERE sport_code = $1
       AND league_code = $2
       AND LOWER(name) = LOWER($3)
     LIMIT 1`,
    [sportCode, leagueCode, normalizedName]
  );

  if (existingResult.rows[0]?.id != null) {
    return Number(existingResult.rows[0].id);
  }

  const createdResult = await client.query<{ id: number }>(
    `INSERT INTO football_pool.sport_team (name, sport_code, league_code)
     VALUES ($1, $2, $3)
     ON CONFLICT (sport_code, league_code, name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [normalizedName, sportCode, leagueCode]
  );

  return createdResult.rows[0]?.id != null ? Number(createdResult.rows[0].id) : null;
};

const selectTargetBracketGame = (
  currentGame: BracketProgressionGame,
  allGames: BracketProgressionGame[]
): BracketProgressionGame | null => {
  if (currentGame.round_sequence == null) {
    return null;
  }

  const nextRoundGames = allGames.filter((game) => Number(game.round_sequence ?? 0) === Number(currentGame.round_sequence) + 1);
  if (nextRoundGames.length === 0) {
    return null;
  }

  const currentRoundGames = allGames
    .filter((game) => Number(game.round_sequence ?? 0) === Number(currentGame.round_sequence))
    .slice()
    .sort((left, right) => Number(left.game_id) - Number(right.game_id));
  const currentIndex = currentRoundGames.findIndex((game) => Number(game.game_id) === Number(currentGame.game_id));
  const currentSourceNumber = currentGame.bracket_region != null
    ? Number(currentGame.matchup_order ?? 0)
    : currentIndex >= 0
      ? currentIndex + 1
      : 0;

  if (currentGame.round_label && currentSourceNumber > 0) {
    const matchingByLabel = nextRoundGames.find((game) => {
      const parsedFeed = parseBracketFeedLabel(game.away_team_name);
      if (!parsedFeed) {
        return false;
      }

      const matchesRound = parsedFeed.roundLabel.toLowerCase() === normalizeMatchupName(currentGame.round_label).toLowerCase();
      const matchesSource = parsedFeed.sourceNumbers.includes(currentSourceNumber);
      const matchesRegion =
        !currentGame.bracket_region ||
        !parsedFeed.region ||
        parsedFeed.region.toLowerCase() === normalizeMatchupName(currentGame.bracket_region).toLowerCase();

      return matchesRound && matchesSource && matchesRegion;
    });

    if (matchingByLabel) {
      return matchingByLabel;
    }
  }

  if (currentGame.bracket_region && currentGame.matchup_order != null) {
    const regionalTarget = nextRoundGames.find(
      (game) =>
        normalizeMatchupName(game.bracket_region).toLowerCase() === normalizeMatchupName(currentGame.bracket_region).toLowerCase() &&
        Number(game.matchup_order ?? 0) === Math.ceil(Number(currentGame.matchup_order) / 2)
    );

    if (regionalTarget) {
      return regionalTarget;
    }
  }

  if (currentIndex >= 0) {
    const targetOrder = Math.floor(currentIndex / 2) + 1;
    const bracketTarget = nextRoundGames.find(
      (game) => game.bracket_region == null && Number(game.matchup_order ?? 0) === targetOrder
    );

    if (bracketTarget) {
      return bracketTarget;
    }
  }

  return nextRoundGames[0] ?? null;
};

const resolveTargetFeeders = (
  targetGame: BracketProgressionGame,
  allGames: BracketProgressionGame[]
): BracketProgressionGame[] => {
  if (targetGame.round_sequence == null) {
    return [];
  }

  const previousRoundGames = allGames.filter(
    (game) => Number(game.round_sequence ?? 0) === Number(targetGame.round_sequence) - 1
  );
  if (previousRoundGames.length === 0) {
    return [];
  }

  const parsedFeed = parseBracketFeedLabel(targetGame.away_team_name);
  if (parsedFeed) {
    const matchingRoundGames = previousRoundGames.filter((game) => {
      const normalizedRound = normalizeMatchupName(game.round_label);
      return !parsedFeed.roundLabel || !normalizedRound || normalizedRound.toLowerCase() === parsedFeed.roundLabel.toLowerCase();
    });

    const orderedRoundGames = matchingRoundGames.slice().sort((left, right) => Number(left.game_id) - Number(right.game_id));
    const parsedFeeders = parsedFeed.sourceNumbers
      .map((sourceNumber) => {
        if (parsedFeed.region) {
          const regionalMatch = matchingRoundGames.find(
            (game) =>
              normalizeMatchupName(game.bracket_region).toLowerCase() === parsedFeed.region!.toLowerCase() &&
              Number(game.matchup_order ?? 0) === sourceNumber
          );
          if (regionalMatch) {
            return regionalMatch;
          }
        }

        return orderedRoundGames[sourceNumber - 1] ?? null;
      })
      .filter((game): game is BracketProgressionGame => game != null);

    if (parsedFeeders.length === 2) {
      return parsedFeeders;
    }
  }

  if (targetGame.bracket_region && targetGame.matchup_order != null) {
    const regionalFeeders = previousRoundGames
      .filter(
        (game) =>
          normalizeMatchupName(game.bracket_region).toLowerCase() === normalizeMatchupName(targetGame.bracket_region).toLowerCase() &&
          Number(game.matchup_order ?? 0) >= (Number(targetGame.matchup_order) * 2) - 1 &&
          Number(game.matchup_order ?? 0) <= Number(targetGame.matchup_order) * 2
      )
      .sort((left, right) => Number(left.matchup_order ?? 0) - Number(right.matchup_order ?? 0) || Number(left.game_id) - Number(right.game_id));

    if (regionalFeeders.length === 2) {
      return regionalFeeders;
    }
  }

  if (targetGame.matchup_order != null) {
    const orderedRoundGames = previousRoundGames.slice().sort((left, right) => Number(left.game_id) - Number(right.game_id));
    const startIndex = Math.max(0, (Number(targetGame.matchup_order) - 1) * 2);
    return orderedRoundGames.slice(startIndex, startIndex + 2);
  }

  return [];
};

const advanceTournamentBracketForPoolGame = async (
  client: PoolClient,
  poolId: number,
  completedGameId: number
): Promise<void> => {
  const allGames = await loadPoolBracketGames(client, poolId);
  const currentGame = allGames.find((game) => Number(game.game_id) === Number(completedGameId));

  if (!currentGame || currentGame.round_sequence == null || !isCompletedBracketGame(currentGame)) {
    return;
  }

  const targetGame = selectTargetBracketGame(currentGame, allGames);
  if (!targetGame) {
    return;
  }

  const feederGames = resolveTargetFeeders(targetGame, allGames);
  if (feederGames.length !== 2 || feederGames.some((game) => !isCompletedBracketGame(game))) {
    return;
  }

  const advancingLabels = feederGames.map((game) => resolveAdvancingTeamLabel(game));
  const sportCode = currentGame.sport_code ?? 'FOOTBALL';
  const leagueCode = currentGame.league_code ?? 'NFL';
  const homeTeamId = await resolveOrCreateBracketTeamId(client, advancingLabels[0], sportCode, leagueCode);
  const awayTeamId = await resolveOrCreateBracketTeamId(client, advancingLabels[1], sportCode, leagueCode);

  if (homeTeamId != null && awayTeamId != null) {
    await client.query(
      `UPDATE football_pool.game
       SET home_team_id = $2,
           away_team_id = $3,
           updated_at = NOW()
       WHERE id = $1`,
      [targetGame.game_id, homeTeamId, awayTeamId]
    );
  }

  if (targetGame.row_numbers == null || targetGame.column_numbers == null) {
    const boardNumbers = await resolvePoolGameBoardNumbers(client, poolId);

    await client.query(
      `UPDATE football_pool.pool_game
       SET row_numbers = COALESCE(row_numbers, $2::jsonb),
           column_numbers = COALESCE(column_numbers, $3::jsonb),
           updated_at = NOW()
       WHERE id = $1`,
      [
        targetGame.pool_game_id,
        JSON.stringify(boardNumbers.rowNumbers),
        JSON.stringify(boardNumbers.columnNumbers)
      ]
    );
  }
};

// Refactored for normalized schema: process scores for each pool_game
export const processGameScoresWithClient = async (
  client: PoolClient,
  gameId: number,
  scores: QuarterScoresInput
): Promise<ScoreProcessingResult[]> => {
  // Find all pool_game entries for this game
  const poolGames = await client.query(
    `SELECT pool_id,
            row_numbers,
            column_numbers,
            round_label,
            round_sequence
     FROM football_pool.pool_game
     WHERE game_id = $1`,
    [gameId]
  );
  const results: ScoreProcessingResult[] = [];
  for (const pg of poolGames.rows) {
    // Get previous winners for this pool/game
    const previousWinningsResult = await client.query<{
      quarter: number;
      winner_user_id: number | null;
      amount_won: number | null;
    }>(
      `SELECT quarter, winner_user_id, amount_won
       FROM football_pool.winnings_ledger
       WHERE game_id = $1 AND pool_id = $2`,
      [gameId, pg.pool_id]
    );
    const previousWinners = new Map<number, { winnerUserId: number | null; amountWon: number | null }>(
      previousWinningsResult.rows.map((row) => [
        Number(row.quarter),
        {
          winnerUserId: row.winner_user_id != null ? Number(row.winner_user_id) : null,
          amountWon: row.amount_won != null ? Number(row.amount_won) : null
        }
      ])
    );
    const payoutConfig = await loadPoolPayoutConfig(client, Number(pg.pool_id));
    const payouts = resolvePoolPayoutsForRound(
      payoutConfig,
      typeof pg.round_label === 'string' ? pg.round_label : null,
      pg.round_sequence != null ? Number(pg.round_sequence) : null
    );
    const quarters: QuarterSpec[] = [
      {
        num: 1,
        payout: payouts.q1Payout,
        squareNum: resolveWinningSquareNumber(
          pg.row_numbers,
          pg.column_numbers,
          scores.q1OpponentScore,
          scores.q1PrimaryScore,
          Boolean(payouts.winnerLoserMode)
        )
      },
      {
        num: 2,
        payout: payouts.q2Payout,
        squareNum: resolveWinningSquareNumber(
          pg.row_numbers,
          pg.column_numbers,
          scores.q2OpponentScore,
          scores.q2PrimaryScore,
          Boolean(payouts.winnerLoserMode)
        )
      },
      {
        num: 3,
        payout: payouts.q3Payout,
        squareNum: resolveWinningSquareNumber(
          pg.row_numbers,
          pg.column_numbers,
          scores.q3OpponentScore,
          scores.q3PrimaryScore,
          Boolean(payouts.winnerLoserMode)
        )
      },
      {
        num: 4,
        payout: payouts.q4Payout,
        squareNum: resolveWinningSquareNumber(
          pg.row_numbers,
          pg.column_numbers,
          scores.q4OpponentScore,
          scores.q4PrimaryScore,
          Boolean(payouts.winnerLoserMode)
        )
      }
    ];
    let winnersWritten = 0;
    let unresolvedWinners = 0;
    const quarterResults: QuarterNotificationResult[] = [];
    for (const quarter of quarters) {
      const result = await upsertWinningsForQuarter(client, gameId, pg.pool_id, quarter);
      const quarterScores = getQuarterScoresFromInput(scores, quarter.num);
      quarterResults.push({
        quarter: quarter.num,
        payout: Number(quarter.payout ?? 0),
        squareNum: quarter.squareNum,
        winnerUserId: result.winnerUserId,
        primaryScore: quarterScores.primaryScore,
        opponentScore: quarterScores.opponentScore
      });
      if (result.written) winnersWritten += 1;
      if (result.unresolved) unresolvedWinners += 1;
    }
    await emitScoreNotifications(client, {
      gameId,
      poolId: pg.pool_id,
      quarters: quarterResults,
      previousWinners,
      currentLeader: null, // Not implemented for normalized yet
      previousLeader: null, // Not implemented for normalized yet
      gameComplete: scores.q4PrimaryScore != null && scores.q4OpponentScore != null
    });

    if (scores.q4PrimaryScore != null && scores.q4OpponentScore != null) {
      await advanceTournamentBracketForPoolGame(client, Number(pg.pool_id), gameId);
    }

    results.push({
      game: { id: gameId, pool_id: pg.pool_id, q1_primary_score: scores.q1PrimaryScore, q1_opponent_score: scores.q1OpponentScore, q2_primary_score: scores.q2PrimaryScore, q2_opponent_score: scores.q2OpponentScore, q3_primary_score: scores.q3PrimaryScore, q3_opponent_score: scores.q3OpponentScore, q4_primary_score: scores.q4PrimaryScore, q4_opponent_score: scores.q4OpponentScore },
      winnersCalculated: true,
      winnersWritten,
      unresolvedWinners
    });
  }
  return results;
};

const upsertWinningsForQuarter = async (
  client: PoolClient,
  gameId: number,
  poolId: number,
  quarter: QuarterSpec
): Promise<{ written: boolean; unresolved: boolean; winnerUserId: number | null }> => {
  const squareNum = quarter.squareNum;

  if (squareNum == null) {
    return { written: false, unresolved: true, winnerUserId: null };
  }

  const winnerSquareResult = await client.query(
    `SELECT id, participant_id
     FROM football_pool.square
     WHERE pool_id = $1
       AND square_num = $2
     LIMIT 1`,
    [poolId, squareNum]
  );

  if (winnerSquareResult.rows.length === 0 || winnerSquareResult.rows[0].participant_id == null) {
    return { written: false, unresolved: true, winnerUserId: null };
  }

  const winnerUserId = winnerSquareResult.rows[0].participant_id as number;

  const existing = await client.query(
    `SELECT id
     FROM football_pool.winnings_ledger
     WHERE game_id = $1
       AND pool_id = $2
       AND quarter = $3`,
    [gameId, poolId, quarter.num]
  );

  if (existing.rows.length > 0) {
    await client.query(
      `UPDATE football_pool.winnings_ledger
       SET winner_user_id = $1,
           amount_won = $2
       WHERE id = $3`,
      [winnerUserId, quarter.payout, existing.rows[0].id]
    );
    return { written: true, unresolved: false, winnerUserId };
  }

  const winningIdResult = await client.query(
    'SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM football_pool.winnings_ledger'
  );

  await client.query(
    `INSERT INTO football_pool.winnings_ledger
       (id, game_id, pool_id, quarter, winner_user_id, amount_won, payout_status)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
    [winningIdResult.rows[0].next_id, gameId, poolId, quarter.num, winnerUserId, quarter.payout]
  );

  return { written: true, unresolved: false, winnerUserId };
};


export const processGameScores = async (
  gameId: number,
  scores: QuarterScoresInput
): Promise<ScoreProcessingResult[]> => {
  const client = await db.connect();

  try {
    await client.query('BEGIN');
    const result = await processGameScoresWithClient(client, gameId, scores);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
