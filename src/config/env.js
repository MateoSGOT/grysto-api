'use strict';

/**
 * @file Carga y validación fail-fast de variables de entorno.
 * Si falta una variable requerida, el proceso aborta ANTES de levantar
 * el server. Exporta un objeto `config` ya validado e inmutable.
 *
 * En `NODE_ENV=production` la validación es estricta: todas las variables
 * críticas son obligatorias (sin defaults inseguros), los secretos deben ser
 * largos y distintos entre sí, y se informan TODOS los errores juntos.
 */

const dotenv = require('dotenv');

dotenv.config({ quiet: true });

/** Variables sin las que el server no arranca en ningún entorno. */
const ALWAYS_REQUIRED = ['MONGODB_URI', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];

/** Variables críticas adicionales en producción. */
const PRODUCTION_REQUIRED = [
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'AUTH_CODE_SECRET',
  'RESEND_API_KEY',
  'EMAIL_FROM',
  'MONGODB_URI',
  'DB_NAME',
  'GEMINI_API_KEY',
];

/** Secretos que en producción deben ser largos y distintos entre sí. */
const PRODUCTION_SECRETS = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'AUTH_CODE_SECRET'];
const MIN_SECRET_LENGTH = 32;

/** Error de configuración: lista todos los problemas encontrados. */
class ConfigError extends Error {
  constructor(problems) {
    super(`Configuración inválida:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

const isBlank = (value) =>
  value === undefined || value === null || String(value).trim() === '';

/**
 * `trust proxy` de Express. Por defecto: 1 salto en producción (el proxy de
 * Render), desactivado en desarrollo. Acepta un número de saltos, `false` o
 * las palabras/CIDR que entiende Express. `true` se rechaza en producción:
 * confiaría en cualquier `X-Forwarded-For` y un cliente podría falsear su IP
 * para esquivar los rate limits.
 *
 * @param {string|undefined} raw - Valor de TRUST_PROXY.
 * @param {boolean} isProduction - Si es producción.
 * @param {string[]} problems - Acumulador de errores.
 * @returns {number|boolean|string} Valor para `app.set('trust proxy', ...)`.
 */
function parseTrustProxy(raw, isProduction, problems) {
  if (isBlank(raw)) return isProduction ? 1 : false;
  const value = String(raw).trim();
  if (value === 'false') return false;
  if (value === 'true') {
    if (isProduction) {
      problems.push('TRUST_PROXY=true no está permitido en producción (usa el número de proxies, p. ej. 1)');
    }
    return true;
  }
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

/**
 * Entero positivo con valor por defecto.
 *
 * @returns {number} Valor parseado (o el default si es inválido; se reporta).
 */
function parsePositiveInt(env, key, fallback, problems, { max } = {}) {
  if (isBlank(env[key])) return fallback;
  const n = Number(env[key]);
  if (!Number.isInteger(n) || n <= 0 || (max !== undefined && n > max)) {
    problems.push(`${key} debe ser un entero positivo${max ? ` (máx. ${max})` : ''}`);
    return fallback;
  }
  return n;
}

/**
 * Construye y valida la configuración a partir de un objeto de entorno.
 * Función pura (no lee `process.env` ni corta el proceso): testeable.
 *
 * @param {Record<string, string|undefined>} env - Variables de entorno.
 * @returns {Readonly<Object>} Configuración inmutable.
 * @throws {ConfigError} Con TODOS los problemas encontrados.
 */
function loadConfig(env) {
  const opt = (key, fallback) => (isBlank(env[key]) ? fallback : env[key]);
  const nodeEnv = opt('NODE_ENV', 'development');
  const isProduction = nodeEnv === 'production';
  const problems = [];

  const required = isProduction ? PRODUCTION_REQUIRED : ALWAYS_REQUIRED;
  for (const key of required) {
    if (isBlank(env[key])) problems.push(`Falta la variable de entorno requerida: ${key}`);
  }

  if (isProduction) {
    const present = PRODUCTION_SECRETS.filter((key) => !isBlank(env[key]));
    for (const key of present) {
      if (String(env[key]).length < MIN_SECRET_LENGTH) {
        problems.push(`${key} es demasiado corta (mínimo ${MIN_SECRET_LENGTH} caracteres)`);
      }
    }
    for (let i = 0; i < present.length; i++) {
      for (let j = i + 1; j < present.length; j++) {
        if (env[present[i]] === env[present[j]]) {
          problems.push(`${present[i]} y ${present[j]} no pueden ser iguales`);
        }
      }
    }
  }

  const port = parsePositiveInt(env, 'PORT', 4000, problems, { max: 65535 });
  const trustProxy = parseTrustProxy(env.TRUST_PROXY, isProduction, problems);
  const aiTimeoutMs = parsePositiveInt(env, 'AI_TIMEOUT_MS', 20000, problems);

  if (problems.length) throw new ConfigError(problems);

  return Object.freeze({
    nodeEnv,
    isProduction,
    isTest: nodeEnv === 'test',
    port,
    trustProxy,

    db: Object.freeze({
      uri: env.MONGODB_URI,
      name: opt('DB_NAME', 'grysto_db'),
    }),

    jwt: Object.freeze({
      accessSecret: env.JWT_ACCESS_SECRET,
      refreshSecret: env.JWT_REFRESH_SECRET,
      accessExpires: opt('JWT_ACCESS_EXPIRES', '15m'),
      refreshExpires: opt('JWT_REFRESH_EXPIRES', '7d'),
    }),

    authCodes: Object.freeze({
      // Clave HMAC de los códigos de 6 dígitos (verificación / reset). En
      // producción es OBLIGATORIA y propia; fuera de producción, si falta, se
      // deriva de JWT_REFRESH_SECRET (ver services/authCode.service.js).
      secret: opt('AUTH_CODE_SECRET', ''),
    }),

    email: Object.freeze({
      resendApiKey: opt('RESEND_API_KEY', ''),
      // El default solo aplica fuera de producción (allí EMAIL_FROM es obligatoria).
      from: opt('EMAIL_FROM', 'GRYSTO <no-reply@grysto.com>'),
    }),

    client: Object.freeze({
      // Solo para CORS (origen permitido; p. ej. un futuro panel admin web). NO se
      // usa para construir links: verificación y reset van por código de 6 dígitos.
      frontendUrl: opt('FRONTEND_URL', 'http://localhost:5173'),
    }),

    ai: Object.freeze({
      defaultProvider: opt('AI_DEFAULT_PROVIDER', 'gemini'),
      // Temperatura de generación: baja para respuestas consistentes y concisas.
      temperature: Number(opt('AI_TEMPERATURE', '0.6')),
      // Tiempo máximo de espera por respuesta del proveedor de IA.
      timeoutMs: aiTimeoutMs,
      gemini: Object.freeze({
        apiKey: opt('GEMINI_API_KEY', ''),
        model: opt('GEMINI_MODEL', 'gemini-2.5-flash'),
      }),
      anthropic: Object.freeze({
        apiKey: opt('ANTHROPIC_API_KEY', ''),
        model: opt('ANTHROPIC_MODEL', 'claude-sonnet-4-6'),
      }),
    }),
  });
}

let config;
try {
  config = loadConfig(process.env);
} catch (err) {
  if (!(err instanceof ConfigError)) throw err;
  // Solo nombres de variables y reglas: nunca valores.
  // eslint-disable-next-line no-console
  console.error(`✗ [env] ${err.message}`);
  process.exit(1);
}

module.exports = { config, loadConfig, ConfigError };
