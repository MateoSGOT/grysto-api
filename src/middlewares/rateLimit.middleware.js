'use strict';

/**
 * @file Rate limiters para endpoints sensibles (express-rate-limit).
 * En entorno de test se omiten para no interferir con el flujo de pruebas;
 * el comportamiento 429 se valida con el factory directamente.
 */

const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
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
 * @param {(req: import('express').Request) => string} [opts.keyGenerator] - Clave del limiter (default: IP).
 * @returns {import('express').RequestHandler} Middleware limiter.
 */
function createRateLimiter({ windowMs, limit, message, skip, keyGenerator }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip,
    ...(keyGenerator ? { keyGenerator } : {}),
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

/**
 * 20 mensajes al Coach IA por USUARIO cada 15 minutos: protege la cuota
 * gratuita de Gemini y controla costos cuando sea de pago. Se monta después
 * de `authenticate`, por lo que `req.user` ya existe.
 */
const coachLimiter = createRateLimiter({
  windowMs: 15 * MINUTE,
  limit: 20,
  message: 'Has enviado muchos mensajes al Coach IA. Intenta de nuevo en unos minutos.',
  skip: skipInTest,
  // Limita por usuario autenticado. Solo cae a la IP cuando no hay usuario, y
  // ahí usa el helper ipKeyGenerator para normalizar IPv6 (evita ERR_ERL_KEY_GEN_IPV6).
  keyGenerator: (req) => (req.user?.id ? String(req.user.id) : ipKeyGenerator(req.ip)),
});

module.exports = {
  createRateLimiter,
  loginLimiter,
  registerLimiter,
  forgotPasswordLimiter,
  coachLimiter,
};
