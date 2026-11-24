/** Minimal internal IAM identity projection for an already scoped Core ID. */
export interface HumanDirectoryPort {
  getIdentity(userId: string): Promise<{
    readonly userId: string;
    readonly username: string;
    readonly displayName: string | null;
    readonly role: import('../../domain/role-permissions').RoleCode;
    readonly status: import('../../domain/user').UserStatus;
  } | null>;
}

export const IAM_HUMAN_DIRECTORY_PORT = Symbol('IAM_HUMAN_DIRECTORY_PORT');
