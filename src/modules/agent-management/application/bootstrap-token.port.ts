import type { UnitOfWorkContext } from '@platform/events';

export interface BootstrapTokenStorePort {
  issue(
    input: {
      readonly tokenId: string;
      readonly nodeId: string;
      readonly tokenHash: string;
      readonly expiresAt: Date;
      readonly createdBy: string;
    },
    context: UnitOfWorkContext,
  ): Promise<void>;
  hasActiveBinding(nodeId: string): Promise<boolean>;
}

export const BOOTSTRAP_TOKEN_STORE = Symbol('BOOTSTRAP_TOKEN_STORE');

export interface NodeEligibilityPort {
  getEligibility(nodeId: string): Promise<{
    readonly exists: boolean;
    readonly active: boolean;
    readonly hasActivePlacement: boolean;
  }>;
  serializeEnrollmentEligibility(
    nodeId: string,
    context: UnitOfWorkContext,
  ): Promise<boolean>;
}

export const NODE_ELIGIBILITY_PORT = Symbol('NODE_ELIGIBILITY_PORT');
