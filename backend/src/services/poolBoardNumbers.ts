import type { PoolClient } from 'pg';
import { ensurePoolStructureSupport } from './poolStructureSupport';

export const poolBoardNumberModeValues = ['per_game', 'same_for_tournament'] as const;
export type PoolBoardNumberMode = (typeof poolBoardNumberModeValues)[number];

export type PoolBoardNumbers = {
  mode: PoolBoardNumberMode;
  rowNumbers: number[];
  columnNumbers: number[];
};

const defaultDigitOrder = Array.from({ length: 10 }, (_, index) => index);

const randomInt = (maxExclusive: number): number => Math.floor(Math.random() * maxExclusive);

const shuffle = <T,>(values: T[]): T[] => {
  const next = [...values];

  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }

  return next;
};

export const buildRandomDigitOrder = (): number[] => shuffle([...defaultDigitOrder]);

export const getPoolBoardNumberMode = (value: unknown): PoolBoardNumberMode =>
  value === 'same_for_tournament' ? 'same_for_tournament' : 'per_game';

const toDigitOrderOrNull = (value: unknown): number[] | null => {
  if (typeof value === 'string') {
    try {
      return toDigitOrderOrNull(JSON.parse(value));
    } catch {
      return null;
    }
  }

  if (!Array.isArray(value)) {
    return null;
  }

  const normalized = value.map((entry) => Number(entry));
  if (normalized.length !== 10 || normalized.some((entry) => !Number.isFinite(entry))) {
    return null;
  }

  return normalized;
};

const loadPoolBoardConfig = async (
  client: PoolClient,
  poolId: number
): Promise<{
  mode: PoolBoardNumberMode;
  tournamentRowNumbers: number[] | null;
  tournamentColumnNumbers: number[] | null;
}> => {
  await ensurePoolStructureSupport(client);

  const result = await client.query<{
    board_number_mode: string | null;
    tournament_row_numbers: unknown;
    tournament_column_numbers: unknown;
  }>(
    `SELECT COALESCE(board_number_mode, 'per_game') AS board_number_mode,
            tournament_row_numbers,
            tournament_column_numbers
     FROM football_pool.pool
     WHERE id = $1
     LIMIT 1`,
    [poolId]
  );

  const row = result.rows[0];

  return {
    mode: getPoolBoardNumberMode(row?.board_number_mode),
    tournamentRowNumbers: toDigitOrderOrNull(row?.tournament_row_numbers),
    tournamentColumnNumbers: toDigitOrderOrNull(row?.tournament_column_numbers)
  };
};

const getOrCreateSharedTournamentBoardNumbers = async (client: PoolClient, poolId: number): Promise<PoolBoardNumbers> => {
  const config = await loadPoolBoardConfig(client, poolId);
  let rowNumbers = config.tournamentRowNumbers;
  let columnNumbers = config.tournamentColumnNumbers;

  if (!rowNumbers || !columnNumbers) {
    rowNumbers = buildRandomDigitOrder();
    columnNumbers = buildRandomDigitOrder();

    await client.query(
      `UPDATE football_pool.pool
       SET tournament_row_numbers = $2::jsonb,
           tournament_column_numbers = $3::jsonb
       WHERE id = $1`,
      [poolId, JSON.stringify(rowNumbers), JSON.stringify(columnNumbers)]
    );
  }

  return {
    mode: 'same_for_tournament',
    rowNumbers,
    columnNumbers
  };
};

export const resolvePoolGameBoardNumbers = async (client: PoolClient, poolId: number): Promise<PoolBoardNumbers> => {
  const config = await loadPoolBoardConfig(client, poolId);

  if (config.mode === 'same_for_tournament') {
    return getOrCreateSharedTournamentBoardNumbers(client, poolId);
  }

  return {
    mode: 'per_game',
    rowNumbers: buildRandomDigitOrder(),
    columnNumbers: buildRandomDigitOrder()
  };
};

export const syncPoolGameBoardNumbers = async (
  client: PoolClient,
  poolId: number,
  options?: {
    overwriteExisting?: boolean;
    onlyGameId?: number | null;
  }
): Promise<void> => {
  const overwriteExisting = Boolean(options?.overwriteExisting);
  const onlyGameId = options?.onlyGameId ?? null;
  const config = await loadPoolBoardConfig(client, poolId);

  if (config.mode !== 'same_for_tournament') {
    return;
  }

  const sharedBoardNumbers = await getOrCreateSharedTournamentBoardNumbers(client, poolId);
  const params: Array<number | string> = [poolId];
  let gameFilter = '';

  if (onlyGameId != null) {
    params.push(onlyGameId);
    gameFilter = ` AND game_id = $${params.length}`;
  }

  params.push(JSON.stringify(sharedBoardNumbers.rowNumbers), JSON.stringify(sharedBoardNumbers.columnNumbers));

  await client.query(
    `UPDATE football_pool.pool_game
     SET row_numbers = $${params.length - 1}::jsonb,
         column_numbers = $${params.length}::jsonb,
         updated_at = NOW()
     WHERE pool_id = $1${gameFilter}${
       overwriteExisting ? '' : '\n       AND (row_numbers IS NULL OR column_numbers IS NULL)'
     }`,
    params
  );
};
