'use strict';

/**
 * @file `loadConfig`: validación estricta en producción (sin defaults
 * inseguros, todos los errores juntos) y comportamiento de desarrollo intacto.
 */

const { loadConfig, ConfigError } = require('../../src/config/env');

const secret = (c) => c.repeat(40);

/** Entorno de producción completo y válido. */
const PROD_ENV = Object.freeze({
  NODE_ENV: 'production',
  PORT: '10000',
  MONGODB_URI: 'mongodb+srv://prod.example/',
  DB_NAME: 'grysto_prod',
  JWT_ACCESS_SECRET: secret('a'),
  JWT_REFRESH_SECRET: secret('b'),
  AUTH_CODE_SECRET: secret('c'),
  RESEND_API_KEY: 're_test',
  EMAIL_FROM: 'Grysto <no-reply@grysto.app>',
  GEMINI_API_KEY: 'gemini-key',
});

/** Problemas reportados por loadConfig (o [] si no lanza). */
function problemsOf(env) {
  try {
    loadConfig(env);
    return [];
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError);
    return err.problems;
  }
}

describe('loadConfig — producción', () => {
  it('acepta un entorno completo y usa PORT', () => {
    const config = loadConfig(PROD_ENV);
    expect(config.isProduction).toBe(true);
    expect(config.port).toBe(10000);
    expect(config.db.name).toBe('grysto_prod');
    expect(config.trustProxy).toBe(1); // 1 salto: el proxy de Render
  });

  it.each([
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'AUTH_CODE_SECRET',
    'RESEND_API_KEY',
    'EMAIL_FROM',
    'MONGODB_URI',
    'DB_NAME',
    'GEMINI_API_KEY',
  ])('no arranca sin %s y dice cuál falta', (key) => {
    const env = { ...PROD_ENV, [key]: '' };
    expect(problemsOf(env)).toEqual([`Falta la variable de entorno requerida: ${key}`]);
  });

  it('informa TODAS las variables faltantes juntas', () => {
    const problems = problemsOf({ NODE_ENV: 'production' });
    expect(problems).toHaveLength(8);
    expect(problems.join('\n')).toContain('AUTH_CODE_SECRET');
    expect(problems.join('\n')).toContain('GEMINI_API_KEY');
  });

  it('el mensaje nunca incluye valores de secretos', () => {
    const env = { ...PROD_ENV, JWT_ACCESS_SECRET: 'corta-123' };
    try {
      loadConfig(env);
      throw new Error('debía fallar');
    } catch (err) {
      expect(err.message).toContain('JWT_ACCESS_SECRET es demasiado corta');
      expect(err.message).not.toContain('corta-123');
    }
  });

  it('rechaza secretos repetidos', () => {
    const env = { ...PROD_ENV, AUTH_CODE_SECRET: PROD_ENV.JWT_REFRESH_SECRET };
    expect(problemsOf(env)).toEqual([
      'JWT_REFRESH_SECRET y AUTH_CODE_SECRET no pueden ser iguales',
    ]);
  });

  it('rechaza TRUST_PROXY=true (permitiría falsear la IP) y PORT inválido', () => {
    expect(problemsOf({ ...PROD_ENV, TRUST_PROXY: 'true' })).toHaveLength(1);
    expect(problemsOf({ ...PROD_ENV, PORT: 'abc' })).toEqual([
      'PORT debe ser un entero positivo (máx. 65535)',
    ]);
  });

  it('TRUST_PROXY acepta un número de saltos o false', () => {
    expect(loadConfig({ ...PROD_ENV, TRUST_PROXY: '2' }).trustProxy).toBe(2);
    expect(loadConfig({ ...PROD_ENV, TRUST_PROXY: 'false' }).trustProxy).toBe(false);
  });
});

describe('loadConfig — desarrollo', () => {
  const DEV_ENV = {
    MONGODB_URI: 'mongodb://localhost/x',
    JWT_ACCESS_SECRET: 'a',
    JWT_REFRESH_SECRET: 'b',
  };

  it('mantiene los defaults de desarrollo', () => {
    const config = loadConfig(DEV_ENV);
    expect(config.isProduction).toBe(false);
    expect(config.port).toBe(4000);
    expect(config.db.name).toBe('grysto_db');
    expect(config.trustProxy).toBe(false);
    expect(config.authCodes.secret).toBe(''); // se deriva del refresh secret
    expect(config.ai.timeoutMs).toBe(20000);
  });

  it('sigue exigiendo MONGODB_URI y los secretos JWT', () => {
    expect(problemsOf({})).toHaveLength(3);
  });
});
