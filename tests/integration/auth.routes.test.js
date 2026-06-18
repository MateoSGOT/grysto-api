'use strict';

/**
 * @file Tests de integración de los endpoints de Auth (Supertest).
 */

const request = require('supertest');
const express = require('express');
const app = require('../../src/app');
const { EmailVerificationToken } = require('../../src/models');
const { createRateLimiter } = require('../../src/middlewares/rateLimit.middleware');
const { validRegisterPayload } = require('../fixtures');

const BASE = '/api/v1/auth';

/**
 * Obtiene el último token de verificación emitido (modo desarrollo/tests).
 *
 * @returns {Promise<string>} Token de verificación en plano.
 */
async function lastVerifyToken() {
  const record = await EmailVerificationToken.findOne({}).sort({ createdAt: -1 });
  return record.token;
}

describe('Flujo completo de autenticación', () => {
  it('register → verify → login → me → refresh → reuso(401) → logout', async () => {
    const payload = validRegisterPayload();

    // 1. Register → 201, sin tokens.
    const registerRes = await request(app).post(`${BASE}/register`).send(payload);
    expect(registerRes.status).toBe(201);
    expect(registerRes.body.success).toBe(true);
    expect(registerRes.body.data.user.email).toBe(payload.email);
    expect(registerRes.body.data.accessToken).toBeUndefined();

    // 2. Login antes de verificar → 403.
    const earlyLogin = await request(app)
      .post(`${BASE}/login`)
      .send({ email: payload.email, password: payload.password });
    expect(earlyLogin.status).toBe(403);

    // 3. Verify email → 200.
    const token = await lastVerifyToken();
    const verifyRes = await request(app)
      .post(`${BASE}/verify-email`)
      .send({ token });
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.data.user.isEmailVerified).toBe(true);

    // 4. Login → 200 con tokens + cookie.
    const loginRes = await request(app)
      .post(`${BASE}/login`)
      .send({ email: payload.email, password: payload.password });
    expect(loginRes.status).toBe(200);
    const { accessToken, refreshToken } = loginRes.body.data;
    expect(accessToken).toEqual(expect.any(String));
    expect(refreshToken).toEqual(expect.any(String));
    expect(loginRes.headers['set-cookie'].join(';')).toContain('refreshToken');

    // 5. GET /me con access token → 200.
    const meRes = await request(app)
      .get(`${BASE}/me`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.data.user.email).toBe(payload.email);

    // 6. Refresh → 200 nuevo par.
    const refreshRes = await request(app)
      .post(`${BASE}/refresh`)
      .send({ refreshToken });
    expect(refreshRes.status).toBe(200);
    const newRefresh = refreshRes.body.data.refreshToken;
    expect(newRefresh).not.toBe(refreshToken);

    // 7. Reusar el refresh viejo → 401 'Sesión comprometida'.
    const reuseRes = await request(app)
      .post(`${BASE}/refresh`)
      .send({ refreshToken });
    expect(reuseRes.status).toBe(401);
    expect(reuseRes.body.message).toBe('Sesión comprometida');

    // 8. Logout (con access token) → 200.
    const logoutRes = await request(app)
      .post(`${BASE}/logout`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ refreshToken: newRefresh });
    expect(logoutRes.status).toBe(200);
  });
});

describe('Casos de error', () => {
  it('422 cuando el body de registro es inválido', async () => {
    const res = await request(app)
      .post(`${BASE}/register`)
      .send({ email: 'no-es-email', password: '123' });
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(Array.isArray(res.body.details)).toBe(true);
    expect(res.body.details.length).toBeGreaterThan(0);
  });

  it('401 con credenciales inválidas', async () => {
    const payload = validRegisterPayload();
    await request(app).post(`${BASE}/register`).send(payload);
    const token = await lastVerifyToken();
    await request(app).post(`${BASE}/verify-email`).send({ token });

    const res = await request(app)
      .post(`${BASE}/login`)
      .send({ email: payload.email, password: 'WrongPass123' });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Credenciales inválidas');
  });

  it('401 al acceder a /me sin token', async () => {
    const res = await request(app).get(`${BASE}/me`);
    expect(res.status).toBe(401);
  });

  it('403 al iniciar sesión sin verificar el email', async () => {
    const payload = validRegisterPayload();
    await request(app).post(`${BASE}/register`).send(payload);
    const res = await request(app)
      .post(`${BASE}/login`)
      .send({ email: payload.email, password: payload.password });
    expect(res.status).toBe(403);
  });
});

describe('Rate limiting (429)', () => {
  it('responde 429 al superar el límite', async () => {
    const limited = express();
    const limiter = createRateLimiter({
      windowMs: 60 * 1000,
      limit: 2,
      message: 'Demasiadas solicitudes',
    });
    limited.get('/probe', limiter, (_req, res) => res.json({ ok: true }));

    await request(limited).get('/probe').expect(200);
    await request(limited).get('/probe').expect(200);
    const blocked = await request(limited).get('/probe');
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({
      success: false,
      message: 'Demasiadas solicitudes',
    });
  });
});
