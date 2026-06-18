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
};
