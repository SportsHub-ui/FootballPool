import { describe, expect, it } from 'vitest';
import { buildSchedulerPlan } from './scoreIngestion';

describe('buildSchedulerPlan', () => {
  it('sleeps until the daily wake time before 6:00am CT', () => {
    const now = new Date('2026-10-11T10:00:00.000Z'); // 5:00am CT
    const plan = buildSchedulerPlan({
      now,
      todayGames: []
    });

    expect(plan.mode).toBe('sleep');
    expect(plan.reason).toBe('before_daily_window');
    expect(plan.delayMs).toBeGreaterThan(0);
  });

  it('polls slowly when games are scheduled later today', () => {
    const now = new Date('2026-10-11T16:00:00.000Z'); // 11:00am CT
    const plan = buildSchedulerPlan({
      now,
      todayGames: [
        {
          gameId: 101,
          kickoffAt: '2026-10-11T20:25:00.000Z',
          state: 'scheduled'
        }
      ]
    });

    expect(plan.mode).toBe('poll');
    expect(plan.reason).toBe('scheduled_today');
    expect(plan.delayMs).toBeGreaterThanOrEqual(60_000);
  });

  it('polls aggressively when a game is in progress', () => {
    const now = new Date('2026-10-11T18:30:00.000Z');
    const plan = buildSchedulerPlan({
      now,
      todayGames: [
        {
          gameId: 102,
          kickoffAt: '2026-10-11T18:00:00.000Z',
          state: 'in_progress'
        }
      ]
    });

    expect(plan.mode).toBe('poll');
    expect(plan.reason).toBe('live_window');
    expect(plan.delayMs).toBeLessThanOrEqual(60_000);
  });

  it('returns to sleep after the last game completes', () => {
    const now = new Date('2026-10-12T04:30:00.000Z'); // 11:30pm CT on 10/11
    const plan = buildSchedulerPlan({
      now,
      todayGames: [
        {
          gameId: 103,
          kickoffAt: '2026-10-11T18:00:00.000Z',
          state: 'completed'
        }
      ]
    });

    expect(plan.mode).toBe('sleep');
    expect(plan.reason).toBe('all_games_complete');
    expect(plan.delayMs).toBeGreaterThan(0);
  });
});
