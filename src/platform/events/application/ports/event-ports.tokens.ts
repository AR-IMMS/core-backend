/** Nest DI token for the transactional producer outbox append port.
 * @example `@Inject(OUTBOX_WRITER_PORT) private readonly outbox: OutboxWriterPort`
 */
export const OUTBOX_WRITER_PORT = Symbol('OUTBOX_WRITER_PORT');
/** Nest DI token for outbox delivery claims and acknowledgements.
 * @example `@Inject(OUTBOX_DELIVERY_PORT) private readonly delivery: OutboxDeliveryPort`
 */
export const OUTBOX_DELIVERY_PORT = Symbol('OUTBOX_DELIVERY_PORT');
/** Nest DI token for the producer transaction boundary.
 * @example `@Inject(UNIT_OF_WORK_PORT) private readonly unitOfWork: UnitOfWorkPort`
 */
export const UNIT_OF_WORK_PORT = Symbol('UNIT_OF_WORK_PORT');
/** Internal composition token containing the explicitly registered consumers. */
export const EVENT_CONSUMER_PORTS = Symbol('EVENT_CONSUMER_PORTS');
/** Nest DI token for registered consumer lookup and dispatch. */
export const EVENT_CONSUMER_DISPATCH_PORT = Symbol(
  'EVENT_CONSUMER_DISPATCH_PORT',
);
