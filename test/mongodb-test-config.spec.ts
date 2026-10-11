import { resolveMongoTestConfig } from './mongodb-test-config';

describe('resolveMongoTestConfig', () => {
  test('accepts a replica-set URI with an isolated test database', () => {
    expect(
      resolveMongoTestConfig(
        'mongodb://localhost:27017/ar_imms_core_test?replicaSet=rs0',
      ),
    ).toEqual({
      uri: 'mongodb://localhost:27017/ar_imms_core_test?replicaSet=rs0',
      dbName: 'ar_imms_core_test',
    });
  });

  test.each([
    undefined,
    'mongodb://localhost:27017/ar_imms_core?replicaSet=rs0',
    'mongodb://localhost:27017/ar_imms_core_test',
  ])('rejects unsafe test URI %s', (uri) => {
    expect(() => resolveMongoTestConfig(uri)).toThrow();
  });
});
