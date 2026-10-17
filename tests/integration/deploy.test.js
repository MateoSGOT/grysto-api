'use strict';

/**
 * @file Preparación para producción (Render): trust proxy + rate limit por IP
 * real, health check, access log y logs sin datos sensibles.
 */

const express = require('express');
const request = require('supertest');

const app = require('../../src/app');
const { config, loadConfig } = require('../../src/config/env');
const { createRateLimiter } = require('../../src/middlewares/rateLimit.middleware');
const { accessLog } = require('../../src/middlewares/accessLog.middleware');
const { createHealthHandler } = require('../../src/controllers/health.controller');
const { RefreshToken } = require('../../src/models');
const { captureEmailCodes, validRegisterPayload, uniqueEmail } = require('../fixtures');

/** trust proxy que usaría producción con la config por defecto. */
const PROD_TRUST_PROXY = loadConfig({
  NODE_ENV: 'production',
  MONGODB_URI: 'x',
  DB_NAME: 'grysto_prod',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  JWT_REFRESH_SECRET: 'b'.repeat(40),
  AUTH_CODE_SECRET: 'c'.repeat(40),
  RESEND_API_KEY: 'k',
  EMAIL_FROM: 'x@y.z',
  GEMINI_API_KEY: 'g',
}).trustProxy;

/** App mínima con un limiter de 2 requests y el trust proxy indicado. */
function limitedApp(trustProxy) {
  const mini = express();
  mini.set('trust proxy', trustProxy);
  mini.use(
    createRateLimiter({ windowMs: 60_000, limit: 2, message: 'Demasiadas solicitudes' })
  );
  mini.get('/ip', (req, res) => res.json({ ip: req.ip }));
  return mini;
}

/** Simula al proxy de Render: agrega la IP real del cliente al final de XFF. */
const viaProxy = (agent, clientIp, spoofed) =>
  agent.set('X-Forwarded-For', spoofed ? `${spoofed}, ${clientIp}` : clientIp);

describe('trust proxy (Render)', () => {
  it('la app toma trust proxy de la config', () => {
    expect(app.get('trust proxy')).toBe(config.trustProxy);
  });

  it('con la config de producción, cada cliente tiene su propio contador', async () => {
    const mini = limitedApp(PROD_TRUST_PROXY);
    const a = () => viaProxy(request(mini).get('/ip'), '203.0.113.1');
    const b = () => viaProxy(request(mini).get('/ip'), '203.0.113.2');

    expect((await a()).body.ip).toBe('203.0.113.1');
    await a();
    expect((await a()).status).toBe(429);
    // Otro cliente no comparte el límite del primero.
    expect((await b()).status).toBe(200);
  });

  it('un X-Forwarded-For falsificado por el cliente no cambia su clave', async () => {
    const mini = limitedApp(PROD_TRUST_PROXY);
    const spoof = (fake) => viaProxy(request(mini).get('/ip'), '203.0.113.9', fake);

    const res = await spoof('1.1.1.1');
    expect(res.body.ip).toBe('203.0.113.9');
    await spoof('2.2.2.2');
    expect((await spoof('3.3.3.3')).status).toBe(429);
  });

  it('sin trust proxy (desarrollo) se ignora X-Forwarded-For', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {}); // aviso de express-rate-limit
    const mini = limitedApp(false);
    const a = () => viaProxy(request(mini).get('/ip'), '203.0.113.1');
    const b = () => viaProxy(request(mini).get('/ip'), '203.0.113.2');
    await a();
    await b();
    // Ambos son la IP del socket: comparten el contador.
    expect((await a()).status).toBe(429);
  });
});

describe('GET /health', () => {
  afterEach(() => jest.restoreAllMocks());

  it('200 con Mongo conectado, sin auth', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'ok', db: 'connected' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('503 si Mongo no está conectado', async () => {
    const mini = express();
    mini.get('/health', createHealthHandler(() => 0)); // readyState 0 = disconnected
    const res = await request(mini).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.data).toMatchObject({ status: 'degraded', db: 'disconnected' });
  });

  it('/api/v1/health es alias', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.data.db).toBe('connected');
  });
});

describe('access log', () => {
  it('registra método, ruta sin query, status y ms; nunca body ni query', async () => {
    const lines = [];
    const mini = express();
    mini.use(express.json());
    mini.use(accessLog({ log: (l) => lines.push(l) }));
    mini.post('/auth/login', (_req, res) => res.status(401).json({}));

    await request(mini)
      .post('/auth/login?token=secreto-en-query')
      .send({ email: 'a@b.c', password: 'MiClave123' });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^→ POST \/auth\/login 401 \d+ms$/);
  });
});

describe('logs sin datos sensibles', () => {
  afterEach(() => jest.restoreAllMocks());

  it('registro → verificación → login → refresh → reset no loguean contraseñas, tokens ni códigos', async () => {
    const logged = [];
    const capture = (...args) => logged.push(args.map(String).join(' '));
    for (const level of ['log', 'info', 'warn', 'error']) {
      jest.spyOn(console, level).mockImplementation(capture);
    }
    // La app real detrás del access log (en test viene desactivado).
    const wrapped = express();
    wrapped.use(accessLog({ log: capture }));
    wrapped.use(app);

    const mail = captureEmailCodes();
    const email = uniqueEmail('logs');
    const password = 'Secreta123';
    const newPassword = 'OtraSecreta456';
    const api = request(wrapped);

    await api.post('/api/v1/auth/register').send(validRegisterPayload({ email, password }));
    const verifyCode = mail.last(email, 'verify');
    const verified = await api.post('/api/v1/auth/verify-email').send({ email, code: verifyCode });
    const login = await api.post('/api/v1/auth/login').send({ email, password });
    const { accessToken, refreshToken } = login.body.data;
    const refreshed = await api.post('/api/v1/auth/refresh').send({ refreshToken });
    await api.post('/api/v1/auth/forgot-password').send({ email });
    const resetCode = mail.last(email, 'reset');
    await api.post('/api/v1/auth/reset-password').send({ email, code: resetCode, newPassword });

    expect(verified.status).toBe(200);
    expect(refreshed.status).toBe(200);

    const secrets = [
      password,
      newPassword,
      verifyCode,
      resetCode,
      accessToken,
      refreshToken,
      refreshed.body.data.refreshToken,
      verified.body.data.refreshToken,
    ];
    const output = logged.join('\n');
    expect(output).toContain('→ POST /api/v1/auth/login 200'); // el log existe
    for (const value of secrets) {
      expect(value).toBeTruthy();
      expect(output).not.toContain(value);
    }

    // En la base solo hay hashes, nunca el refresh token en plano.
    const stored = await RefreshToken.find({}).lean();
    expect(stored.length).toBeGreaterThan(0);
    for (const doc of stored) {
      expect(doc.token).toMatch(/^[0-9a-f]{64}$/);
      expect([refreshToken, refreshed.body.data.refreshToken]).not.toContain(doc.token);
    }
  });
});
