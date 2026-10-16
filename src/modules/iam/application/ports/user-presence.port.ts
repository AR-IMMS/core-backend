import type { UserPresenceStatus } from '../../domain/user-presence';

/** Effective presence exposed to IAM consumers without persistence details. */
export interface UserPresenceView {
  readonly userId: string;
  readonly status: UserPresenceStatus;
}

/** Public candidate-ID-only presence query owned by IAM. */
export interface UserPresencePort {
  getPresence(
    candidateUserIds: readonly string[],
  ): Promise<readonly UserPresenceView[]>;
}
