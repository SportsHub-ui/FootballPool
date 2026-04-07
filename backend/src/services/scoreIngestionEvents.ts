import { EventEmitter } from 'events';

export type ScoreIngestionEvent = {
  type: 'scheduler-status' | 'game-updated';
  timestamp: string;
  payload: Record<string, unknown>;
};

const emitter = new EventEmitter();
emitter.setMaxListeners(100);

export const publishScoreIngestionEvent = (event: ScoreIngestionEvent): void => {
  emitter.emit('score-ingestion', event);
};

export const subscribeScoreIngestionEvents = (
  listener: (event: ScoreIngestionEvent) => void
): (() => void) => {
  emitter.on('score-ingestion', listener);

  return () => {
    emitter.off('score-ingestion', listener);
  };
};
