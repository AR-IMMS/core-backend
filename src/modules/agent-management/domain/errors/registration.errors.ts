export class AgentNodeNotFoundError extends Error {}
export class AgentNodeNotEligibleError extends Error {}

export class BootstrapTokenInvalidError extends Error {}
export class BootstrapTokenExpiredError extends Error {}
export class BootstrapTokenConsumedError extends Error {}

export class NodeAlreadyBoundError extends Error {}
export class InstallationAlreadyBoundError extends Error {}
export class EnrollmentAttemptConflictError extends Error {}
export class EnrollmentRecoveryExpiredError extends Error {}
export class EnrollmentRecoveryRevokedError extends Error {}
