export interface NodeEligibilityPort {
  getEligibility(nodeId: string): Promise<{
    readonly exists: boolean;
    readonly active: boolean;
    readonly hasActivePlacement: boolean;
  }>;
}

export const NODE_ELIGIBILITY_PORT = Symbol('NODE_ELIGIBILITY_PORT');
