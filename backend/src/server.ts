import { app } from './app';
import { env } from './config/env';
import { startScoreIngestionScheduler } from './jobs/scoreIngestion';

app.listen(env.PORT, () => {
  console.log(`Server listening on port ${env.PORT}`);
  startScoreIngestionScheduler();
});
