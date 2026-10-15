'use strict';

/**
 * @file Ciclo de vida de la DB en memoria para los tests. Usa un replica set
 * (MongoMemoryReplSet) porque las transacciones de Mongoose lo requieren.
 * Limpia las colecciones entre tests para aislamiento total.
 */

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

let replset;

beforeAll(async () => {
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replset.getUri(), { dbName: 'grysto_test' });
  await applyAtlasValidators();
});

/**
 * Crea cada colección con SU validador de `db/validators/` (strict + error),
 * igual que en Atlas. Así toda la suite falla si un write viola el validador
 * ("Document failed validation") antes de llegar a producción.
 *
 * @returns {Promise<void>}
 */
async function applyAtlasValidators() {
  // Mongoose crea las colecciones solo al conectar (autoCreate): esperar a que
  // termine evita la carrera "namespace already exists".
  // eslint-disable-next-line global-require
  const models = require('../src/models');
  await Promise.all(Object.values(models).map((m) => m.init()));

  const dir = path.join(__dirname, '..', 'db', 'validators');
  const { db } = mongoose.connection;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const validator = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    // eslint-disable-next-line no-await-in-loop
    await db.command({
      collMod: path.basename(file, '.json'),
      validator,
      validationLevel: 'strict',
      validationAction: 'error',
    });
  }
}

afterEach(async () => {
  const { collections } = mongoose.connection;
  await Promise.all(
    Object.values(collections).map((collection) => collection.deleteMany({}))
  );
});

afterAll(async () => {
  await mongoose.disconnect();
  if (replset) await replset.stop();
});
