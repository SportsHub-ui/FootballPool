import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { getPoolSimulationStatus } from '../services/poolSimulation';
import { resolveWinningSquareNumber } from '../services/scoreProcessing';

export const participantRouter = Router();

const getLatestScoredQuarter = (game: {
  q1_primary_score: number | null;
  q1_opponent_score: number | null;
  q2_primary_score: number | null;
  q2_opponent_score: number | null;
  q3_primary_score: number | null;
  q3_opponent_score: number | null;
  q4_primary_score: number | null;
  q4_opponent_score: number | null;
}): number | null => {
  if (game.q4_primary_score != null && game.q4_opponent_score != null) return 4;
  if (game.q3_primary_score != null && game.q3_opponent_score != null) return 3;
  if (game.q2_primary_score != null && game.q2_opponent_score != null) return 2;
  if (game.q1_primary_score != null && game.q1_opponent_score != null) return 1;
  return null;
};

const getQuarterScores = (
  game: {
    q1_primary_score: number | null;
    q1_opponent_score: number | null;
    q2_primary_score: number | null;
    q2_opponent_score: number | null;
    q3_primary_score: number | null;
    q3_opponent_score: number | null;
    q4_primary_score: number | null;
    q4_opponent_score: number | null;
  },
  quarter: number
): { primaryScore: number | null; opponentScore: number | null } => {
  if (quarter === 1) return { primaryScore: game.q1_primary_score, opponentScore: game.q1_opponent_score };
  if (quarter === 2) return { primaryScore: game.q2_primary_score, opponentScore: game.q2_opponent_score };
  if (quarter === 3) return { primaryScore: game.q3_primary_score, opponentScore: game.q3_opponent_score };
  return { primaryScore: game.q4_primary_score, opponentScore: game.q4_opponent_score };
};

type QuarterKey = '1' | '2' | '3' | '4';
type QuarterScoreMap = Partial<Record<QuarterKey, { home?: number | null; away?: number | null }>>;

const toQuarterScoreMap = (value: unknown): QuarterScoreMap => {
  if (!value) return {};
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

// Any authenticated user can access these endpoints
// They can only see pools they're participants in

// GET /api/participant/pools - Get all pools user is in
participantRouter.get('/pools', async (req, res) => {
  try {
    if (!req.auth) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const userId = Number(req.auth.userId);

    const client = await db.connect();
    try {
      // Get pools where user has assigned squares
      const result = await client.query(
        `SELECT DISTINCT p.id, p.pool_name, p.season, p.primary_team,
                p.square_cost, p.q1_payout, p.q2_payout, p.q3_payout, p.q4_payout,
                t.team_name, COUNT(DISTINCT s.id) as total_squares,
                COUNT(CASE WHEN s.participant_id = $1 THEN 1 END) as user_squares
         FROM football_pool.pool p
         LEFT JOIN football_pool.team t ON p.team_id = t.id
         LEFT JOIN football_pool.square s ON p.id = s.pool_id
         WHERE s.participant_id = $1
         GROUP BY p.id, t.team_name
         ORDER BY p.id DESC`,
        [userId]
      );

      res.json(result.rows);
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Participant pools error:', error);
    res.status(500).json({ error: 'Failed to fetch pools' });
  }
});

// GET /api/participant/pools/:poolId/squares - Get user's squares in a pool
participantRouter.get('/pools/:poolId/squares', async (req, res) => {
  try {
    if (!req.auth) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { poolId } = z.object({ poolId: z.coerce.number().int().positive() }).parse(req.params);
    const userId = Number(req.auth.userId);

    const client = await db.connect();
    try {
      const result = await client.query(
        `SELECT s.id, s.square_num, s.paid_flg, s.participant_id, s.player_id,
                u.first_name, u.last_name,
                p.first_name as player_first_name, p.last_name as player_last_name
         FROM football_pool.square s
         LEFT JOIN football_pool.users u ON s.participant_id = u.id
         LEFT JOIN football_pool.player_team pt ON s.player_id = pt.id
         LEFT JOIN football_pool.users p ON pt.user_id = p.id
         WHERE s.pool_id = $1 AND s.participant_id = $2
         ORDER BY s.square_num`,
        [poolId, userId]
      );

      res.json(result.rows);
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('User squares error:', error);
    res.status(500).json({ error: 'Failed to fetch squares' });
  }
});

// GET /api/participant/winnings - Get user's winnings across all pools
participantRouter.get('/winnings', async (req, res) => {
  try {
    if (!req.auth) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const userId = Number(req.auth.userId);

    const client = await db.connect();
    try {
      const result = await client.query(
        `SELECT wl.id,
                wl.game_id,
                wl.pool_id,
                wl.quarter,
                wl.amount_won,
                wl.payout_status,
                p.pool_name,
                away.name AS opponent,
                COALESCE(g.kickoff_at, g.game_date::timestamp) AS game_dt
         FROM football_pool.winnings_ledger wl
         LEFT JOIN football_pool.pool p ON wl.pool_id = p.id
         LEFT JOIN football_pool.game g ON wl.game_id = g.id
         LEFT JOIN football_pool.nfl_team away ON away.id = g.away_team_id
         WHERE wl.winner_user_id = $1
         ORDER BY COALESCE(g.kickoff_at, g.game_date::timestamp) DESC, wl.quarter ASC`,
        [userId]
      );

      const totalWon = result.rows.reduce((sum, row) => sum + (row.amount_won || 0), 0);
      const totalPending = result.rows
        .filter(row => row.payout_status === 'pending')
        .reduce((sum, row) => sum + (row.amount_won || 0), 0);

      res.json({
        userId,
        totalWon,
        totalPending,
        winnings: result.rows
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('User winnings error:', error);
    res.status(500).json({ error: 'Failed to fetch winnings' });
  }
});

// GET /api/participant/pools/:poolId/games - Get games for a pool with results
participantRouter.get('/pools/:poolId/games', async (req, res) => {
  try {
    const { poolId } = z.object({ poolId: z.coerce.number().int().positive() }).parse(req.params);

    const client = await db.connect();
    try {
      const result = await client.query(
        `SELECT pg.id AS pool_game_id,
                pg.pool_id,
                g.id AS game_id,
                g.season_year,
                g.week_number,
                g.game_date,
                g.home_team_id,
                g.away_team_id,
                g.state,
                g.scores_by_quarter,
                nth.name AS home_team_name,
                nta.name AS away_team_name
         FROM football_pool.pool_game pg
         JOIN football_pool.game g ON g.id = pg.game_id
         LEFT JOIN football_pool.nfl_team nth ON nth.id = g.home_team_id
         LEFT JOIN football_pool.nfl_team nta ON nta.id = g.away_team_id
         WHERE pg.pool_id = $1
         ORDER BY g.week_number ASC, COALESCE(g.kickoff_at, g.game_date::timestamp) ASC, g.id ASC`,
        [poolId]
      );

      // Map scores_by_quarter JSONB to flat quarter scores for compatibility
      type QuarterScoreMap = Partial<Record<'1' | '2' | '3' | '4', { home?: number | null; away?: number | null }>>;
      const toQuarterScoreMap = (value: unknown): QuarterScoreMap => {
        if (!value) return {};
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

      const games = result.rows.map((row) => {
        const scores = toQuarterScoreMap(row.scores_by_quarter);

        return {
          pool_game_id: row.pool_game_id,
          pool_id: row.pool_id,
          game_id: row.game_id,
          season_year: row.season_year,
          week_number: row.week_number,
          game_date: row.game_date,
          home_team_id: row.home_team_id,
          away_team_id: row.away_team_id,
          home_team_name: row.home_team_name,
          away_team_name: row.away_team_name,
          state: row.state,
          q1_primary_score: scores['1']?.home ?? null,
          q1_opponent_score: scores['1']?.away ?? null,
          q2_primary_score: scores['2']?.home ?? null,
          q2_opponent_score: scores['2']?.away ?? null,
          q3_primary_score: scores['3']?.home ?? null,
          q3_opponent_score: scores['3']?.away ?? null,
          q4_primary_score: scores['4']?.home ?? null,
          q4_opponent_score: scores['4']?.away ?? null
        };
      });

      res.json(games);
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Pool games error:', error);
    res.status(500).json({ error: 'Failed to fetch games' });
  }
});

// GET /api/participant/pools/:poolId/board - Full 10x10 board with season win coloring data
participantRouter.get('/pools/:poolId/board', async (req, res) => {
  try {
    if (!req.auth) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { poolId } = z.object({ poolId: z.coerce.number().int().positive() }).parse(req.params);
    const gameQuery = z.object({ gameId: z.coerce.number().int().positive().optional() }).safeParse(req.query);
    const gameId = gameQuery.success ? gameQuery.data.gameId : undefined;

    const client = await db.connect();
    try {
      const poolResult = await client.query(
        `SELECT p.id, p.pool_name, p.primary_team,
                t.team_name, t.primary_color, t.secondary_color, t.logo_file
         FROM football_pool.pool p
         LEFT JOIN football_pool.team t ON t.id = p.team_id
         WHERE p.id = $1`,
        [poolId]
      );

      if (poolResult.rows.length === 0) {
        return res.status(404).json({ error: 'Pool not found' });
      }

      let selectedGameRow = null;
      if (gameId) {
        const result = await client.query(
          `SELECT pg.id AS pool_game_id,
                  g.*,
                  nth.name AS home_team_name,
                  nta.name AS away_team_name,
                  pg.row_numbers,
                  pg.column_numbers AS col_numbers
           FROM football_pool.pool_game pg
           JOIN football_pool.game g ON g.id = pg.game_id
           LEFT JOIN football_pool.nfl_team nth ON nth.id = g.home_team_id
           LEFT JOIN football_pool.nfl_team nta ON nta.id = g.away_team_id
           WHERE pg.pool_id = $1 AND g.id = $2
           LIMIT 1`,
          [poolId, gameId]
        );
        selectedGameRow = result.rows[0] ?? null;
      } else {
        const result = await client.query(
          `SELECT pg.id AS pool_game_id,
                  g.*,
                  nth.name AS home_team_name,
                  nta.name AS away_team_name,
                  pg.row_numbers,
                  pg.column_numbers AS col_numbers
           FROM football_pool.pool_game pg
           JOIN football_pool.game g ON g.id = pg.game_id
           LEFT JOIN football_pool.nfl_team nth ON nth.id = g.home_team_id
           LEFT JOIN football_pool.nfl_team nta ON nta.id = g.away_team_id
           WHERE pg.pool_id = $1
           ORDER BY CASE WHEN g.game_date >= CURRENT_DATE THEN 0 ELSE 1 END,
                    g.week_number ASC,
                    COALESCE(g.kickoff_at, g.game_date::timestamp) ASC,
                    g.id ASC
           LIMIT 1`,
          [poolId]
        );
        selectedGameRow = result.rows[0] ?? null;
      }

      const gamesUpToSelectionResult = await client.query(
        `SELECT pg.id AS pool_game_id, g.*, pg.row_numbers, pg.column_numbers AS col_numbers
         FROM football_pool.pool_game pg
         JOIN football_pool.game g ON g.id = pg.game_id
         WHERE pg.pool_id = $1
           AND (
             $2::int IS NULL
             OR g.week_number < $2::int
             OR (g.week_number = $2::int AND ($3::date IS NULL OR g.game_date <= $3::date))
           )
         ORDER BY g.week_number ASC, COALESCE(g.kickoff_at, g.game_date::timestamp) ASC, g.id ASC`,
        [poolId, selectedGameRow?.week_number ?? null, selectedGameRow?.game_date ?? null]
      );

      const payoutsResult = await client.query(
        `SELECT q1_payout, q2_payout, q3_payout, q4_payout
         FROM football_pool.pool
         WHERE id = $1
         LIMIT 1`,
        [poolId]
      );

      const squaresResult = await client.query(
        `SELECT s.id,
                s.square_num,
                s.participant_id,
                s.player_id,
                s.paid_flg,
                u.first_name AS participant_first_name,
                u.last_name AS participant_last_name,
                pt.jersey_num AS player_jersey_num
         FROM football_pool.square s
         LEFT JOIN football_pool.users u ON u.id = s.participant_id
         LEFT JOIN football_pool.player_team pt ON pt.id = s.player_id
         WHERE s.pool_id = $1
         ORDER BY s.square_num`,
        [poolId]
      );

      const payouts = payoutsResult.rows[0] ?? {
        q1_payout: 0,
        q2_payout: 0,
        q3_payout: 0,
        q4_payout: 0
      };

      const simulationStatus = await getPoolSimulationStatus(client, poolId).catch(() => null);
      const currentGameTotals = new Map<number, number>();
      const seasonTotals = new Map<number, number>();
      const parseScores = (row: any): QuarterScoreMap => toQuarterScoreMap(row.scores_by_quarter);
      const getQuarterScore = (scores: QuarterScoreMap, quarter: QuarterKey, which: 'home' | 'away') =>
        scores[quarter]?.[which] ?? null;

      const selectedGame = selectedGameRow
        ? {
            ...selectedGameRow,
            q1_primary_score: getQuarterScore(parseScores(selectedGameRow), '1', 'home'),
            q1_opponent_score: getQuarterScore(parseScores(selectedGameRow), '1', 'away'),
            q2_primary_score: getQuarterScore(parseScores(selectedGameRow), '2', 'home'),
            q2_opponent_score: getQuarterScore(parseScores(selectedGameRow), '2', 'away'),
            q3_primary_score: getQuarterScore(parseScores(selectedGameRow), '3', 'home'),
            q3_opponent_score: getQuarterScore(parseScores(selectedGameRow), '3', 'away'),
            q4_primary_score: getQuarterScore(parseScores(selectedGameRow), '4', 'home'),
            q4_opponent_score: getQuarterScore(parseScores(selectedGameRow), '4', 'away')
          }
        : null;

      const selectedGameIsLiveSimulationQuarter =
        selectedGame &&
        simulationStatus?.mode === 'by_quarter' &&
        Number(simulationStatus.currentGameId ?? 0) === Number(selectedGame.id) &&
        simulationStatus.nextQuarter != null;
      const latestScoredQuarter = selectedGame ? getLatestScoredQuarter(selectedGame) : null;
      const currentLeaderSquare =
        selectedGame &&
        latestScoredQuarter != null &&
        (selectedGame.q4_primary_score == null || selectedGame.q4_opponent_score == null)
          ? resolveWinningSquareNumber(
              selectedGame.row_numbers,
              selectedGame.col_numbers,
              getQuarterScores(selectedGame, latestScoredQuarter).opponentScore,
              getQuarterScores(selectedGame, latestScoredQuarter).primaryScore
            )
          : null;

      for (const game of gamesUpToSelectionResult.rows) {
        const scores = parseScores(game);
        const liveQuarterToExclude =
          selectedGameIsLiveSimulationQuarter && selectedGame && Number(game.id) === Number(selectedGame.id)
            ? Number(simulationStatus?.nextQuarter ?? 0)
            : null;

        const entries = [
          {
            quarter: 1,
            squareNum: resolveWinningSquareNumber(game.row_numbers, game.col_numbers, getQuarterScore(scores, '1', 'away'), getQuarterScore(scores, '1', 'home')),
            amount: Number(payouts.q1_payout ?? 0)
          },
          {
            quarter: 2,
            squareNum: resolveWinningSquareNumber(game.row_numbers, game.col_numbers, getQuarterScore(scores, '2', 'away'), getQuarterScore(scores, '2', 'home')),
            amount: Number(payouts.q2_payout ?? 0)
          },
          {
            quarter: 3,
            squareNum: resolveWinningSquareNumber(game.row_numbers, game.col_numbers, getQuarterScore(scores, '3', 'away'), getQuarterScore(scores, '3', 'home')),
            amount: Number(payouts.q3_payout ?? 0)
          },
          {
            quarter: 4,
            squareNum: resolveWinningSquareNumber(game.row_numbers, game.col_numbers, getQuarterScore(scores, '4', 'away'), getQuarterScore(scores, '4', 'home')),
            amount: Number(payouts.q4_payout ?? 0)
          }
        ];

        for (const entry of entries) {
          if (entry.squareNum == null || entry.amount <= 0) {
            continue;
          }
          if (liveQuarterToExclude != null && entry.quarter >= liveQuarterToExclude) {
            continue;
          }
          seasonTotals.set(entry.squareNum, (seasonTotals.get(entry.squareNum) ?? 0) + entry.amount);
          if (selectedGame && Number(game.id) === Number(selectedGame.id)) {
            currentGameTotals.set(entry.squareNum, (currentGameTotals.get(entry.squareNum) ?? 0) + entry.amount);
          }
        }
      }

      const squares = squaresResult.rows.map((square) => ({
        ...square,
        current_game_won: Number(currentGameTotals.get(Number(square.square_num)) ?? 0),
        season_won_total: Number(seasonTotals.get(Number(square.square_num)) ?? 0),
        is_current_score_leader: currentLeaderSquare != null && Number(square.square_num) === Number(currentLeaderSquare)
      }));

      return res.json({
        board: {
          poolId,
          poolName: poolResult.rows[0].pool_name,
          primaryTeam: poolResult.rows[0].primary_team,
          opponent: selectedGame?.away_team_name ?? 'Opponent',
          gameId: selectedGame?.id ?? null,
          gameDate: selectedGame?.game_date ?? null,
          teamName: poolResult.rows[0].team_name,
          teamPrimaryColor: poolResult.rows[0].primary_color ?? '#fbbc04',
          teamSecondaryColor: poolResult.rows[0].secondary_color ?? '#111111',
          teamLogo: poolResult.rows[0].logo_file ?? null,
          rowNumbers: Array.isArray(selectedGame?.row_numbers) ? selectedGame.row_numbers : null,
          colNumbers: Array.isArray(selectedGame?.col_numbers) ? selectedGame.col_numbers : null,
          squares
        }
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Pool board error:', error);
    return res.status(500).json({ error: 'Failed to fetch pool board' });
  }
});
