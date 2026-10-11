declare const unitOfWorkContextBrand: unique symbol;

/** Opaque transaction context passed to participating application ports. */
export interface UnitOfWorkContext {
  readonly [unitOfWorkContextBrand]: never;
}

/**
 * Runs one bounded producer operation in a transaction and resolves only after
 * the transaction commits. Infrastructure owns the transaction lifecycle.
 */
export interface UnitOfWorkPort {
  run<TResult>(
    operation: (context: UnitOfWorkContext) => Promise<TResult>,
  ): Promise<TResult>;
}
