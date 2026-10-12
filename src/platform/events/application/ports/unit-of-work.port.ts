declare const unitOfWorkContextBrand: unique symbol;

/** Opaque transaction context passed to participating application ports. */
export interface UnitOfWorkContext {
  readonly [unitOfWorkContextBrand]: never;
}

/**
 * Runs one bounded producer operation in a transaction and resolves only after
 * the transaction commits. Infrastructure owns the transaction lifecycle.
 * @example `constructor(@Inject(UNIT_OF_WORK_PORT) private readonly unitOfWork: UnitOfWorkPort) {}`
 */
export interface UnitOfWorkPort {
  /**
   * Runs producer writes and outbox append in one transaction.
   * @param operation Bounded operation receiving an opaque transaction context.
   * @returns The operation result after commit; rejects and rolls back on failure.
   * @example `await unitOfWork.run(async (context) => { await repository.save(entity, context); await outbox.append(fact, context); })`
   */
  run<TResult>(
    operation: (context: UnitOfWorkContext) => Promise<TResult>,
  ): Promise<TResult>;
}
