import { describe, expect, it } from 'vitest'

import { resolveActiveDisplayQuarter } from './gameStatus'

describe('resolveActiveDisplayQuarter', () => {
  it('keeps the final inning card active for live extra-inning baseball games', () => {
    const activeQuarter = resolveActiveDisplayQuarter({
      state: 'in_progress',
      current_quarter: 10,
      q1_primary_score: 1,
      q1_opponent_score: 0,
      q2_primary_score: 1,
      q2_opponent_score: 1,
      q3_primary_score: 2,
      q3_opponent_score: 1,
      q4_primary_score: 2,
      q4_opponent_score: 2,
      q5_primary_score: 3,
      q5_opponent_score: 2,
      q6_primary_score: 3,
      q6_opponent_score: 3,
      q7_primary_score: 3,
      q7_opponent_score: 4,
      q8_primary_score: 4,
      q8_opponent_score: 4,
      q9_primary_score: 5,
      q9_opponent_score: 5
    })

    expect(activeQuarter).toBe(9)
  })
})
