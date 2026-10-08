/** Nest-independent tokens for application-facing event ports. */
export const OUTBOX_WRITER_PORT = Symbol('OUTBOX_WRITER_PORT');
export const OUTBOX_DELIVERY_PORT = Symbol('OUTBOX_DELIVERY_PORT');
export const UNIT_OF_WORK_PORT = Symbol('UNIT_OF_WORK_PORT');
export const EVENT_CONSUMER_PORTS = Symbol('EVENT_CONSUMER_PORTS');
