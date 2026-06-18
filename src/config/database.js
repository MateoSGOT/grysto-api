'use strict';

/**
 * @file Conexión a MongoDB Atlas vía Mongoose, con reconexión por
 * backoff exponencial y logging de eventos del ciclo de vida.
 */

const mongoose = require('mongoose');
const { config } = require('./env');

/** Backoff: arranca en 1s y se duplica hasta un máximo de 30s. */
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

let reconnectDelay = RECONNECT_BASE_MS;
let reconnectTimer = null;
let manualClose = false;

/**
 * Programa un intento de reconexión con backoff exponencial.
 * Cada intento duplica el delay hasta `RECONNECT_MAX_MS`.
 *
 * @returns {void}
 */
function scheduleReconnect() {
  if (manualClose || reconnectTimer) return;

  // eslint-disable-next-line no-console
  console.warn(`… [db] Reintentando conexión en ${reconnectDelay / 1000}s`);

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    try {
      await mongoose.connect(config.db.uri, buildOptions());
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`✗ [db] Reconexión fallida: ${err.message}`);
      reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
      scheduleReconnect();
    }
  }, reconnectDelay);
}

/**
 * Opciones de conexión de Mongoose.
 *
 * @returns {import('mongoose').ConnectOptions} Opciones de conexión.
 */
function buildOptions() {
  return {
    dbName: config.db.name,
    serverSelectionTimeoutMS: 5000,
  };
}

/**
 * Registra los listeners del ciclo de vida de la conexión.
 * Se invoca una sola vez.
 *
 * @returns {void}
 */
function registerConnectionEvents() {
  const { connection } = mongoose;

  connection.on('connected', () => {
    reconnectDelay = RECONNECT_BASE_MS; // reset del backoff
    // eslint-disable-next-line no-console
    console.log(`✓ [db] Conectado a MongoDB — DB: ${connection.name}`);
  });

  connection.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error(`✗ [db] Error de conexión: ${err.message}`);
  });

  connection.on('disconnected', () => {
    // eslint-disable-next-line no-console
    console.warn('… [db] Desconectado de MongoDB');
    scheduleReconnect();
  });
}

let eventsRegistered = false;

/**
 * Conecta a MongoDB Atlas. Idempotente respecto a los listeners.
 *
 * @returns {Promise<import('mongoose').Connection>} Conexión activa.
 * @throws {Error} Si la conexión inicial falla.
 */
async function connectDB() {
  manualClose = false;

  if (!eventsRegistered) {
    registerConnectionEvents();
    eventsRegistered = true;
  }

  await mongoose.connect(config.db.uri, buildOptions());
  return mongoose.connection;
}

/**
 * Cierra la conexión de forma ordenada y cancela cualquier reintento.
 *
 * @returns {Promise<void>}
 */
async function disconnectDB() {
  manualClose = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  await mongoose.connection.close();
}

module.exports = { connectDB, disconnectDB };
