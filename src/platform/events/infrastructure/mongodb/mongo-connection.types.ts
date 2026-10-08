/** Minimal MongoDB session surface used by the event infrastructure adapters. */
export interface MongoSession {
  withTransaction<TResult>(operation: () => Promise<TResult>): Promise<TResult>;
  endSession(): Promise<void>;
}

/** Minimal connection surface required to start an event Unit of Work. */
export interface MongoConnection {
  startSession(): Promise<MongoSession>;
}
