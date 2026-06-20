'use strict';

/**
 * @file Configuración de Jest. Los tests corren contra MongoDB en memoria
 * (replica set), nunca contra Atlas.
 */

module.exports = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/tests/env.setup.js'],
  setupFilesAfterEnv: ['<rootDir>/tests/db.setup.js'],
  testTimeout: 60000,
  testMatch: ['**/tests/**/*.test.js'],
  verbose: true,
  forceExit: true,
  // Serializa los suites: cada uno levanta su propio MongoMemoryReplSet y en
  // Windows varios mongod arrancando en paralelo se pisan (timeout de arranque).
  maxWorkers: 1,
};
