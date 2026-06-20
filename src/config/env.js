'use strict';

/**
 * @file Carga y validación fail-fast de variables de entorno.
 * Si falta una variable requerida, el proceso aborta ANTES de levantar
 * el server. Exporta un objeto `config` ya validado e inmutable.
 */

const dotenv = require('dotenv');

dotenv.config();

/**
 * Lee una variable requerida. Aborta el proceso si no existe.
 *
 * @param {string} key - Nombre de la variable de entorno.
 * @returns {string} Valor de la variable.
 */
function required(key) {
  const value = process.env[key];
  if (value === undefined || value === null || String(value).trim() === '') {
    // eslint-disable-next-line no-console
    console.error(`✗ [env] Falta la variable de entorno requerida: ${key}`);
    process.exit(1);
  }
  return value;
}

/**
 * Lee una variable opcional con valor por defecto.
 *
 * @param {string} key - Nombre de la variable de entorno.
 * @param {string} fallback - Valor por defecto si no está definida.
 * @returns {string} Valor de la variable o el default.
 */
function optional(key, fallback) {
  const value = process.env[key];
  return value === undefined || value === null || String(value).trim() === ''
    ? fallback
    : value;
}

const nodeEnv = optional('NODE_ENV', 'development');

const config = Object.freeze({
  nodeEnv,
  isProduction: nodeEnv === 'production',
  isTest: nodeEnv === 'test',
  port: Number.parseInt(optional('PORT', '4000'), 10),

  db: Object.freeze({
    uri: required('MONGODB_URI'),
    name: optional('DB_NAME', 'grysto_db'),
  }),

  jwt: Object.freeze({
    accessSecret: required('JWT_ACCESS_SECRET'),
    refreshSecret: required('JWT_REFRESH_SECRET'),
    accessExpires: optional('JWT_ACCESS_EXPIRES', '15m'),
    refreshExpires: optional('JWT_REFRESH_EXPIRES', '7d'),
  }),

  email: Object.freeze({
    resendApiKey: optional('RESEND_API_KEY', ''),
    from: optional('EMAIL_FROM', 'GRYSTO <no-reply@grysto.com>'),
  }),

  client: Object.freeze({
    frontendUrl: optional('FRONTEND_URL', 'http://localhost:5173'),
    verifyUrl: optional('CLIENT_VERIFY_URL', 'http://localhost:5173/verify-email'),
    resetUrl: optional('CLIENT_RESET_URL', 'http://localhost:5173/reset-password'),
  }),

  ai: Object.freeze({
    defaultProvider: optional('AI_DEFAULT_PROVIDER', 'gemini'),
    gemini: Object.freeze({
      apiKey: optional('GEMINI_API_KEY', ''),
      model: optional('GEMINI_MODEL', 'gemini-2.5-flash'),
    }),
    anthropic: Object.freeze({
      apiKey: optional('ANTHROPIC_API_KEY', ''),
      model: optional('ANTHROPIC_MODEL', 'claude-sonnet-4-6'),
    }),
  }),
});

module.exports = { config };
