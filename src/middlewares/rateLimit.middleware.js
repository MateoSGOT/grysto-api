'use strict';

/**
 * @file Rate limiters para endpoints sensibles (express-rate-limit).
 * En entorno de test se omiten para no interferir con el flujo de pruebas;
 * el comportamiento 429 se valida con el factory directamente.
 */

const rateLimit = require('express-rate-limit');
const { config } = require('../config/env');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/** Omite el limiter cuando corremos los tests. */
const skipInTest = () => config.isTest;

/**
 * Crea un rate limiter con respuesta 429 en formato uniforme.
 *
 * @param {Object} opts - Opciones.
 * @param {number} opts.windowMs - Ventana de tiempo en ms.
 * @param {number} opts.limit - Máximo de requests por ventana.
 * @param {string} opts.message - Mensaje 429 en español.
 * @param {() => boolean} [opts.skip] - Predicado para omitir el limiter.
 * @returns {import('express').RequestHandler} Middleware limiter.
 */
function createRateLimiter({ windowMs, limit, message, skip }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip,
    handler: (_req, res) =>
      res.status(429).json({ success: false, message }),
  });
}

/** 5 intentos de login por IP cada 15 minutos. */
const loginLimiter = createRateLimiter({
  windowMs: 15 * MINUTE,
  limit: 5,
  message: 'Demasiados intentos de inicio de sesión. Intenta de nuevo en 15 minutos.',
  skip: skipInTest,
});

/** 3 registros por IP cada hora. */
const registerLimiter = createRateLimiter({
  windowMs: HOUR,
  limit: 3,
  message: 'Demasiados registros desde esta IP. Intenta de nuevo en una hora.',
  skip: skipInTest,
});

/** 3 solicitudes de recuperación de contraseña por IP cada hora. */
const forgotPasswordLimiter = createRateLimiter({
  windowMs: HOUR,
  limit: 3,
  message: 'Demasiadas solicitudes. Intenta de nuevo en una hora.',
  skip: skipInTest,
});

module.exports = {
  createRateLimiter,
  loginLimiter,
  registerLimiter,
  forgotPasswordLimiter,
};
