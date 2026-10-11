import { resolveMongoTestConfig } from './mongodb-test-config';

const mongoTestConfig = resolveMongoTestConfig();
process.env.MONGODB_URI = mongoTestConfig.uri;
process.env.MONGODB_DB_NAME = mongoTestConfig.dbName;
