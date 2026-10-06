import type { Config } from 'jest';
import { createDefaultEsmPreset } from 'ts-jest';

const defaultPreset = createDefaultEsmPreset();

const config: Config = {
  ...defaultPreset,
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@modules/(.*)$': '<rootDir>/src/modules/$1',
    '^@platform/(.*)$': '<rootDir>/src/platform/$1',
    '^@shared/(.*)$': '<rootDir>/src/shared/$1',
  },
  collectCoverageFrom: ['src/**/*.(t|j)s'],
  coverageDirectory: 'coverage',
  testEnvironment: 'node',
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '\\.kilo/'],
  modulePathIgnorePatterns: ['<rootDir>/.kilo/'],
};

export default config;
