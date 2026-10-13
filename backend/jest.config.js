module.exports = {
  // A map from regular expressions to module names that allow to stub out resources with a single module
  moduleNameMapper: {
    '@/(.*)': '<rootDir>/src/$1',
    // TEST_MONGO=mongodb://localhost:27017 runs against a real server instead of downloading one
    ...(process.env.TEST_MONGO ? { '^mongodb-memory-server$': '<rootDir>/test/localMongoServer.js' } : {}),
  },
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.ts?(x)', '**/?(*.)+(spec|test).ts?(x)'],
  testPathIgnorePatterns: ['testUtils'],
}
