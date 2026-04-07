import { env } from '../config/env';
import {
  ingestGameScores,
  listTodayGameTargetsForIngestion,
  type IngestionGameTarget
} from '../services/scoreIngestion';
import { publishScoreIngestionEvent } from '../services/scoreIngestionEvents';

type SchedulerReason =
  | 'before_daily_window'
  | 'no_games_today'
  | 'scheduled_today'
  | 'live_window'
  | 'all_games_complete'
  | 'after_error';

export interface SchedulerPlan {
  mode: 'sleep' | 'poll';
  reason: SchedulerReason;
  delayMs: number;
  targetGameIds: number[];
}

let timer: NodeJS.Timeout | null = null;
let runInProgress = false;

const getCentralNow = (now: Date = new Date()): Date => new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));

const getDelayUntilNextDailyWake = (now: Date, dailyStartHourCt: number): number => {
  const centralNow = getCentralNow(now);
  const nextWake = new Date(centralNow);
  nextWake.setHours(dailyStartHourCt, 0, 0, 0);

  if (nextWake <= centralNow) {
    nextWake.setDate(nextWake.getDate() + 1);
  }

  return Math.max(60_000, nextWake.getTime() - centralNow.getTime());
};

const isLiveWindowGame = (
  game: Pick<IngestionGameTarget, 'state' | 'kickoffAt'>,
  now: Date
): boolean => {
  if (game.state === 'in_progress') {
    return true;
  }

  if (!game.kickoffAt || game.state === 'completed') {
    return false;
  }

  const kickoffMs = new Date(game.kickoffAt).getTime();
  if (!Number.isFinite(kickoffMs)) {
    return false;
  }

  const diffMs = kickoffMs - now.getTime();
  return diffMs <= 90 * 60 * 1000;
};

export const buildSchedulerPlan = ({
  now = new Date(),
  todayGames,
  dailyStartHourCt = env.SCORE_INGEST_DAILY_START_HOUR_CT,
  pregameIntervalMs = env.SCORE_INGEST_INTERVAL_MINUTES * 60 * 1000,
  liveIntervalMs = env.SCORE_INGEST_ACTIVE_INTERVAL_SECONDS * 1000
}: {
  now?: Date;
  todayGames: Array<Pick<IngestionGameTarget, 'gameId' | 'kickoffAt' | 'state'>>;
  dailyStartHourCt?: number;
  pregameIntervalMs?: number;
  liveIntervalMs?: number;
}): SchedulerPlan => {
  const centralNow = getCentralNow(now);
  const pendingGames = todayGames.filter((game) => game.state !== 'completed');

  if (centralNow.getHours() < dailyStartHourCt) {
    return {
      mode: 'sleep',
      reason: 'before_daily_window',
      delayMs: getDelayUntilNextDailyWake(now, dailyStartHourCt),
      targetGameIds: []
    };
  }

  if (todayGames.length === 0) {
    return {
      mode: 'sleep',
      reason: 'no_games_today',
      delayMs: getDelayUntilNextDailyWake(now, dailyStartHourCt),
      targetGameIds: []
    };
  }

  if (pendingGames.length === 0) {
    return {
      mode: 'sleep',
      reason: 'all_games_complete',
      delayMs: getDelayUntilNextDailyWake(now, dailyStartHourCt),
      targetGameIds: todayGames.map((game) => Number(game.gameId))
    };
  }

  const liveWindow = pendingGames.some((game) => isLiveWindowGame(game, now));

  return {
    mode: 'poll',
    reason: liveWindow ? 'live_window' : 'scheduled_today',
    delayMs: Math.max(60_000, liveWindow ? liveIntervalMs : pregameIntervalMs),
    targetGameIds: pendingGames.map((game) => Number(game.gameId))
  };
};

const emitSchedulerStatus = (plan: SchedulerPlan, extras?: Record<string, unknown>): void => {
  publishScoreIngestionEvent({
    type: 'scheduler-status',
    timestamp: new Date().toISOString(),
    payload: {
      mode: plan.mode,
      reason: plan.reason,
      delayMs: plan.delayMs,
      nextRunAt: new Date(Date.now() + plan.delayMs).toISOString(),
      targetGameIds: plan.targetGameIds,
      ...extras
    }
  });
};

const scheduleNextRun = (delayMs: number): void => {
  if (timer) {
    clearTimeout(timer);
  }

  timer = setTimeout(() => {
    void runSchedulerCycle();
  }, Math.max(1_000, delayMs));

  timer.unref?.();
};

const runSchedulerCycle = async (): Promise<void> => {
  if (runInProgress) {
    scheduleNextRun(env.SCORE_INGEST_ACTIVE_INTERVAL_SECONDS * 1000);
    return;
  }

  runInProgress = true;

  try {
    const todayGames = await listTodayGameTargetsForIngestion(new Date());
    const initialPlan = buildSchedulerPlan({
      now: new Date(),
      todayGames
    });

    if (initialPlan.mode === 'sleep') {
      emitSchedulerStatus(initialPlan);
      scheduleNextRun(initialPlan.delayMs);
      return;
    }

    const runResults: Array<Record<string, unknown>> = [];

    for (const game of todayGames.filter((entry) => entry.state !== 'completed')) {
      try {
        const result = await ingestGameScores(game.gameId, env.SCORE_INGEST_SOURCE, undefined, {
          forceProcess: false
        });

        runResults.push({
          gameId: game.gameId,
          updated: result.updated,
          processed: result.processed,
          state: result.state,
          currentQuarter: result.currentQuarter
        });

        console.log(
          `[score-ingest] game=${game.gameId} updated=${result.updated} processed=${result.processed} state=${result.state}`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown';
        console.error(`[score-ingest] failed game=${game.gameId} reason=${message}`);
        runResults.push({ gameId: game.gameId, error: message });
      }
    }

    const refreshedGames = await listTodayGameTargetsForIngestion(new Date());
    const nextPlan = buildSchedulerPlan({
      now: new Date(),
      todayGames: refreshedGames
    });

    emitSchedulerStatus(nextPlan, {
      runResults,
      activeGames: refreshedGames
        .filter((game) => game.state !== 'completed')
        .map((game) => ({ gameId: game.gameId, state: game.state }))
    });

    scheduleNextRun(nextPlan.delayMs);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    const fallbackDelayMs = Math.max(60_000, Math.min(5 * 60 * 1000, env.SCORE_INGEST_INTERVAL_MINUTES * 60 * 1000));

    console.error(`[score-ingest] scheduler run failed reason=${message}`);

    emitSchedulerStatus(
      {
        mode: 'poll',
        reason: 'after_error',
        delayMs: fallbackDelayMs,
        targetGameIds: []
      },
      { error: message }
    );

    scheduleNextRun(fallbackDelayMs);
  } finally {
    runInProgress = false;
  }
};

export const startScoreIngestionScheduler = (): void => {
  if (!env.SCORE_INGEST_ENABLED || timer) {
    return;
  }

  console.log(
    `[score-ingest] scheduler enabled start=${env.SCORE_INGEST_DAILY_START_HOUR_CT}:00 CT pregame=${env.SCORE_INGEST_INTERVAL_MINUTES}m live=${env.SCORE_INGEST_ACTIVE_INTERVAL_SECONDS}s source=${env.SCORE_INGEST_SOURCE}`
  );

  void runSchedulerCycle();
};

export const stopScoreIngestionScheduler = (): void => {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
};
