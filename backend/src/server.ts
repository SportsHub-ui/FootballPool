import { fundraiserApp } from './fundraiser-app';
import { env } from './config/env';
import { startScoreIngestionScheduler } from './jobs/scoreIngestion';

fundraiserApp.listen(env.PORT, () => {
  console.log(`Server listening on port ${env.PORT}`);
  startScoreIngestionScheduler();
});
