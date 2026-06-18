'use strict';

/**
 * @file Ciclo de vida de la DB en memoria para los tests. Usa un replica set
 * (MongoMemoryReplSet) porque las transacciones de Mongoose lo requieren.
 * Limpia las colecciones entre tests para aislamiento total.
 */

const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

let replset;

beforeAll(async () => {
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replset.getUri(), { dbName: 'grysto_test' });
});

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
