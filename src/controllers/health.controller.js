'use strict';

/**
 * @file Health check para Render (y monitoreo). Liviano: sin auth, sin rate
 * limit y SIN consultas a la base — solo lee el estado de la conexión de
 * Mongoose. 200 si Mongo está conectado; 503 si no, para que Render no envíe
 * tráfico a una instancia sin base (durante un deploy o una caída).
 */

const mongoose = require('mongoose');

/** readyState de Mongoose → texto. */
const DB_STATES = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

/**
 * Crea el handler de GET /health.
 *
 * @param {() => number} [getReadyState] - Estado de la conexión (inyectable en tests).
 * @returns {import('express').RequestHandler} Handler.
 */
function createHealthHandler(getReadyState = () => mongoose.connection.readyState) {
  return (_req, res) => {
    const readyState = getReadyState();
    const db = DB_STATES[readyState] || 'unknown';
    const ok = readyState === 1;
    res.set('Cache-Control', 'no-store');
    return res.status(ok ? 200 : 503).json({
      success: ok,
      message: ok ? 'GRYSTO API operativa' : 'Base de datos no disponible',
      data: {
        status: ok ? 'ok' : 'degraded',
        db,
        uptimeSeconds: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
      },
    });
  };
}

/** GET /health — estado del servicio. */
const health = createHealthHandler();

module.exports = { health, createHealthHandler };
