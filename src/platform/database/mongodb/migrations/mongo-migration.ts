import type { Connection } from 'mongoose';

export interface MongoMigration {
  /**
   * ID has the format of YYYYMMDDTHHmmssZ_migration_name. The timestamp is in UTC.
   * The migration name should be a short description of the migration.
   *
   * Example:
   * 20261017T033000Z_iam_user_indexes
   *
   * Do not change the ID of a migration after it has been applied to a database. If you need to change a migration, create a new migration with a new ID.
   */
  readonly id: string;
  readonly module: string;
  readonly description: string;

  /**
   * The up method is called when the migration is applied to the database. It should contain the logic to perform the migration.
   */
  up(connection: Connection): Promise<void>;
}
