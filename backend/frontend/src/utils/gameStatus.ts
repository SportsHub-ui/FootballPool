export type GameStatusSource = {
  state?: string | null
  current_quarter?: number | null
  q1_primary_score: number | null
  q1_opponent_score: number | null
  q2_primary_score: number | null
  q2_opponent_score: number | null
  q3_primary_score: number | null
  q3_opponent_score: number | null
  q4_primary_score: number | null
  q4_opponent_score: number | null
  q5_primary_score?: number | null
  q5_opponent_score?: number | null
  q6_primary_score?: number | null
  q6_opponent_score?: number | null
  q7_primary_score?: number | null
  q7_opponent_score?: number | null
  q8_primary_score?: number | null
  q8_opponent_score?: number | null
  q9_primary_score?: number | null
  q9_opponent_score?: number | null
}

export const isCompletedGame = (game: GameStatusSource | null): boolean => {
  if (!game) return false

  const normalizedState = String(game.state ?? '').trim().toLowerCase()
  if (['completed', 'complete', 'closed', 'finished', 'final', 'post'].includes(normalizedState)) {
    return true
  }

  if (normalizedState) {
    return false
  }

  return game.q9_primary_score !== null && game.q9_opponent_score !== null
}

export const isLiveGame = (game: GameStatusSource | null): boolean => {
  if (!game) return false

  const normalizedState = String(game.state ?? '').trim().toLowerCase()
  if (
    [
      'in_progress',
      'in progress',
      'live',
      'active',
      'ongoing',
      'underway',
      'midgame',
      'halftime',
      'delayed',
      'delay',
      'rain_delay',
      'rain delay',
      'suspended'
    ].includes(normalizedState)
  ) {
    return true
  }

  return !isCompletedGame(game) && getLatestScoredQuarter(game) !== null
}

export const getLatestScoredQuarter = (game: GameStatusSource | null): number | null => {
  if (!game) return null
  if (game.q9_primary_score !== null || game.q9_opponent_score !== null) return 9
  if (game.q8_primary_score !== null || game.q8_opponent_score !== null) return 8
  if (game.q7_primary_score !== null || game.q7_opponent_score !== null) return 7
  if (game.q6_primary_score !== null || game.q6_opponent_score !== null) return 6
  if (game.q5_primary_score !== null || game.q5_opponent_score !== null) return 5
  if (game.q4_primary_score !== null || game.q4_opponent_score !== null) return 4
  if (game.q3_primary_score !== null || game.q3_opponent_score !== null) return 3
  if (game.q2_primary_score !== null || game.q2_opponent_score !== null) return 2
  if (game.q1_primary_score !== null || game.q1_opponent_score !== null) return 1
  return null
}

export const resolveActiveDisplayQuarter = (
  game: GameStatusSource | null,
  preferredQuarter?: number | null
): number | null => {
  if (!game) {
    return null
  }

  const normalizedPreferredQuarter = Number(preferredQuarter ?? game.current_quarter ?? 0) || null

  if (normalizedPreferredQuarter != null) {
    return Math.min(Math.max(normalizedPreferredQuarter, 1), 9)
  }

  return getLatestScoredQuarter(game)
}
