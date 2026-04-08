import type { PoolClient } from 'pg'

export const TOTAL_POOL_SQUARES = 100
const POOL_SQUARES_LOCK_NAMESPACE = 4_231

export const ensurePoolSquaresInitialized = async (
  client: PoolClient,
  poolId: number
): Promise<{ insertedCount: number; totalCount: number }> => {
  const poolExists = await client.query<{ id: number }>(
    `
      SELECT id
      FROM football_pool.pool
      WHERE id = $1
      LIMIT 1
    `,
    [poolId]
  )

  if ((poolExists.rowCount ?? 0) === 0) {
    throw new Error('Pool not found')
  }

  await client.query('SELECT pg_advisory_lock($1, $2)', [POOL_SQUARES_LOCK_NAMESPACE, poolId])

  try {
    const existingSquaresResult = await client.query<{ square_num: number }>(
      `
        SELECT square_num
        FROM football_pool.square
        WHERE pool_id = $1
        ORDER BY square_num
      `,
      [poolId]
    )

    const existingSquareNums = new Set(
      existingSquaresResult.rows.map((row) => Number(row.square_num)).filter((squareNum) => Number.isFinite(squareNum))
    )

    const missingSquareNums = Array.from({ length: TOTAL_POOL_SQUARES }, (_, index) => index + 1).filter(
      (squareNum) => !existingSquareNums.has(squareNum)
    )

    if (missingSquareNums.length === 0) {
      return {
        insertedCount: 0,
        totalCount: existingSquareNums.size
      }
    }

    const idBaseResult = await client.query<{ id_base: number }>(
      'SELECT COALESCE(MAX(id), 0) AS id_base FROM football_pool.square'
    )

    const idBase = Number(idBaseResult.rows[0]?.id_base ?? 0)

    await client.query(
      `
        INSERT INTO football_pool.square (id, pool_id, square_num, participant_id, player_id, paid_flg)
        SELECT
          $2 + src.seq,
          $1,
          src.square_num,
          NULL,
          NULL,
          FALSE
        FROM unnest($3::int[]) WITH ORDINALITY AS src(square_num, seq)
      `,
      [poolId, idBase, missingSquareNums]
    )

    return {
      insertedCount: missingSquareNums.length,
      totalCount: existingSquareNums.size + missingSquareNums.length
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1, $2)', [POOL_SQUARES_LOCK_NAMESPACE, poolId])
  }
}
