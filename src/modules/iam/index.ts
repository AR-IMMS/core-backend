export * from './application/ports/permission-catalog.port';
export * from './application/ports/permission-catalog.token';
export * from './application/ports/human-access.port';
export { IAM_HUMAN_ACCESS_PORT } from './application/ports/human-access.token';
export {
  AuthenticatedOnly,
  RequirePermissions,
  CurrentHumanPrincipal,
  type AuthenticatedHumanContext,
} from './presentation/authorization.decorators';
export type { PermissionCode, RoleCode } from './domain/role-permissions';
export type { UserStatus } from './domain/user';
export { changeUserPresencePreference } from './domain/user';
export {
  resolveUserPresence,
  type ResolveUserPresenceInput,
  type UserPresencePreference,
  type UserPresenceStatus,
} from './domain/user-presence';
export type {
  UserPresencePort,
  UserPresenceView,
} from './application/ports/user-presence.port';
export { IAM_USER_PRESENCE_PORT } from './application/ports/user-presence.port.token';
export * from './permission-catalog.module';
