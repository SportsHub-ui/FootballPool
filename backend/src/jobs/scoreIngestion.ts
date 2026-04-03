import { env } from '../config/env';
import { listEligibleGamesForIngestion, getScoresForGame } from '../services/scoreIngestion';
import { processGameScores } from '../services/scoreProcessing';

let timer: NodeJS.Timeout | null = null;

export const startScoreIngestionScheduler = (): void => {
  if (!env.SCORE_INGEST_ENABLED) {
    return;
  }

  if (timer) {
    return;
  }

  const intervalMs = env.SCORE_INGEST_INTERVAL_MINUTES * 60 * 1000;

  const run = async () => {
    try {
      const gameIds = await listEligibleGamesForIngestion();

      for (const gameId of gameIds) {
        try {
          const scores = await getScoresForGame(gameId, env.SCORE_INGEST_SOURCE);
          await processGameScores(gameId, scores);
          console.log(`[score-ingest] processed game=${gameId} source=${env.SCORE_INGEST_SOURCE}`);
        } catch (error) {
          console.error(
            `[score-ingest] failed game=${gameId} reason=${error instanceof Error ? error.message : 'unknown'}`
          );
        }
      }
    } catch (error) {
      console.error(
        `[score-ingest] run failed reason=${error instanceof Error ? error.message : 'unknown'}`
      );
    }
  };

  timer = setInterval(() => {
    void run();
  }, intervalMs);

  console.log(
    `[score-ingest] scheduler enabled interval=${env.SCORE_INGEST_INTERVAL_MINUTES}m source=${env.SCORE_INGEST_SOURCE}`
  );

  // Kick once at startup.
  void run();
};

export const stopScoreIngestionScheduler = (): void => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
};
