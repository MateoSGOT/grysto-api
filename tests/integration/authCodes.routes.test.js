'use strict';

/**
 * @file Tests de integración de los códigos de 6 dígitos: verificación de
 * cuenta, reenvío, login no verificado, olvidé mi contraseña y reset.
 * Los códigos en claro se capturan interceptando el email (en la base solo
 * vive su HMAC).
 */

const request = require('supertest');
const app = require('../../src/app');
const {
  AuthCode,
  User,
  UserPlan,
  RefreshToken,
} = require('../../src/models');
const weeklyPlanService = require('../../src/services/weeklyPlan.service');
const { AUTH_CODE_POLICY } = require('../../src/constants/authCodes');
const {
  validRegisterPayload,
  captureEmailCodes,
  ageAuthCodes,
  uniqueEmail,
  createAdmin,
  authHeader,
  validExercisePayload,
  validRoutinePayload,
  validWeeklyPlanPayload,
} = require('../fixtures');

const BASE = '/api/v1/auth';
const COOLDOWN_MS = AUTH_CODE_POLICY.resendCooldownMs;

let mail;
beforeEach(() => {
  mail = captureEmailCodes();
});
afterEach(() => jest.restoreAllMocks());

/** Registra un usuario nuevo (sin verificar) y devuelve su payload. */
async function register(overrides = {}) {
  const payload = validRegisterPayload({ email: uniqueEmail('codes'), ...overrides });
  const res = await request(app).post(`${BASE}/register`).send(payload);
  expect(res.status).toBe(201);
  return payload;
}

/** POST /verify-email. */
const verify = (email, code) =>
  request(app).post(`${BASE}/verify-email`).send({ email, code });

/** POST /reset-password. */
const reset = (email, code, newPassword = 'NuevaClave123') =>
  request(app).post(`${BASE}/reset-password`).send({ email, code, newPassword });

/** Un código de 6 dígitos distinto del dado. */
const wrongCodeFor = (code) => (code === '000000' ? '111111' : '000000');

/** Registra y verifica; devuelve payload + tokens del verify. */
async function registerVerified() {
  const payload = await register();
  const res = await verify(payload.email, mail.last(payload.email, 'verify'));
  expect(res.status).toBe(200);
  return { payload, ...res.body.data };
}

/** Siembra ejercicio + rutina + plan semanal activo (catálogo mínimo). */
async function seedCatalog() {
  const admin = await createAdmin();
  const ex = await request(app)
    .post('/api/v1/exercises')
    .set(authHeader(admin))
    .send(validExercisePayload());
  const routine = await request(app)
    .post('/api/v1/routines')
    .set(authHeader(admin))
    .send(validRoutinePayload(ex.body.data.exercise._id));
  const plan = await request(app)
    .post('/api/v1/weekly-plans')
    .set(authHeader(admin))
    .send(validWeeklyPlanPayload(routine.body.data.routine._id));
  return plan.body.data.weeklyPlan._id;
}

// ───────────────────────────── Generación y almacenamiento ─────────────────

describe('Código de verificación — emisión', () => {
  it('el registro envía un código de 6 dígitos y lo guarda HASHEADO', async () => {
    const payload = await register();
    const code = mail.last(payload.email, 'verify');
    expect(code).toMatch(/^\d{6}$/);

    const docs = await AuthCode.find({}).lean();
    expect(docs).toHaveLength(1);
    const [doc] = docs;
    expect(doc.purpose).toBe('email_verification');
    expect(doc.codeHash).toMatch(/^[0-9a-f]{64}$/);
    // El código en claro no aparece en ningún campo del documento.
    expect(JSON.stringify(doc)).not.toContain(code);
    // Vence en ~10 min y se purga mucho después.
    const ttl = doc.expiresAt.getTime() - doc.createdAt.getTime();
    expect(ttl).toBeGreaterThan(AUTH_CODE_POLICY.ttlMs - 5000);
    expect(ttl).toBeLessThanOrEqual(AUTH_CODE_POLICY.ttlMs + 1000);
    expect(doc.purgeAt.getTime()).toBeGreaterThan(doc.expiresAt.getTime());
  });
});

// ───────────────────────────── Verificación ────────────────────────────────

describe('POST /auth/verify-email', () => {
  it('código correcto → 200, verifica e INICIA SESIÓN (tokens + cookie)', async () => {
    const payload = await register();
    const res = await verify(payload.email, mail.last(payload.email, 'verify'));

    expect(res.status).toBe(200);
    expect(res.body.data.user.isEmailVerified).toBe(true);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.refreshToken).toEqual(expect.any(String));
    expect(res.body.data.recommendedPlan).toBeNull(); // catálogo vacío
    expect(res.headers['set-cookie'].join(';')).toContain('refreshToken');

    const me = await request(app)
      .get(`${BASE}/me`)
      .set('Authorization', `Bearer ${res.body.data.accessToken}`);
    expect(me.status).toBe(200);
  });

  it('con catálogo, recomienda y crea el plan activo', async () => {
    const planId = await seedCatalog();
    const payload = await register();
    const res = await verify(payload.email, mail.last(payload.email, 'verify'));

    expect(res.status).toBe(200);
    expect(String(res.body.data.recommendedPlan.weeklyPlanId)).toBe(planId);
    expect(await UserPlan.countDocuments({ status: 'active' })).toBe(1);
  });

  it('si recommendPlan falla, la verificación NO se rompe (recommendedPlan null)', async () => {
    await seedCatalog();
    jest
      .spyOn(weeklyPlanService, 'getRecommendedForProfile')
      .mockRejectedValueOnce(new Error('fallo simulado'));
    const payload = await register();
    const res = await verify(payload.email, mail.last(payload.email, 'verify'));

    expect(res.status).toBe(200);
    expect(res.body.data.user.isEmailVerified).toBe(true);
    expect(res.body.data.recommendedPlan).toBeNull();
  });

  it('código incorrecto → 400 CODE_INVALID con intentos restantes', async () => {
    const payload = await register();
    const code = mail.last(payload.email, 'verify');
    const res = await verify(payload.email, wrongCodeFor(code));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CODE_INVALID');
    expect(res.body.details).toEqual({
      attemptsRemaining: AUTH_CODE_POLICY.maxAttempts - 1,
    });
    expect((await User.findOne({ email: payload.email })).isEmailVerified).toBe(false);
  });

  it('código expirado → 400 CODE_EXPIRED', async () => {
    const payload = await register();
    const code = mail.last(payload.email, 'verify');
    await AuthCode.updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });

    const res = await verify(payload.email, code);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CODE_EXPIRED');
  });

  it('código ya usado → 409 ALREADY_VERIFIED (la cuenta ya quedó verificada)', async () => {
    const payload = await register();
    const code = mail.last(payload.email, 'verify');
    expect((await verify(payload.email, code)).status).toBe(200);

    const again = await verify(payload.email, code);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('ALREADY_VERIFIED');
  });

  it(`al llegar a ${AUTH_CODE_POLICY.maxAttempts} fallos el código se invalida (ni el correcto sirve)`, async () => {
    const payload = await register();
    const code = mail.last(payload.email, 'verify');
    const wrong = wrongCodeFor(code);

    for (let i = 1; i < AUTH_CODE_POLICY.maxAttempts; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const r = await verify(payload.email, wrong);
      expect(r.body.code).toBe('CODE_INVALID');
      expect(r.body.details.attemptsRemaining).toBe(AUTH_CODE_POLICY.maxAttempts - i);
    }
    const last = await verify(payload.email, wrong);
    expect(last.status).toBe(400);
    expect(last.body.code).toBe('CODE_TOO_MANY_ATTEMPTS');

    const correct = await verify(payload.email, code);
    expect(correct.status).toBe(400);
    expect(correct.body.code).toBe('CODE_TOO_MANY_ATTEMPTS');

    // Con un código nuevo vuelve a funcionar.
    await ageAuthCodes(COOLDOWN_MS);
    await request(app).post(`${BASE}/resend-verification`).send({ email: payload.email });
    const fresh = await verify(payload.email, mail.last(payload.email, 'verify'));
    expect(fresh.status).toBe(200);
  });

  it('email inexistente → 400 CODE_INVALID (sin revelar nada)', async () => {
    const res = await verify(uniqueEmail('nadie'), '123456');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CODE_INVALID');
    expect(res.body.details).toBeUndefined();
  });

  it('formato inválido (no 6 dígitos) → 422', async () => {
    const payload = await register();
    expect((await verify(payload.email, '12345')).status).toBe(422);
    expect((await verify(payload.email, 'abcdef')).status).toBe(422);
  });

  it('dos verificaciones simultáneas: solo una crea sesión y plan', async () => {
    await seedCatalog();
    const payload = await register();
    const code = mail.last(payload.email, 'verify');

    const [a, b] = await Promise.all([
      verify(payload.email, code),
      verify(payload.email, code),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses[0]).toBe(200);
    expect(statuses[1]).toBeGreaterThanOrEqual(400);
    expect(await UserPlan.countDocuments({ status: 'active' })).toBe(1);
  });
});

// ───────────────────────────── Reenvío ─────────────────────────────────────

describe('POST /auth/resend-verification', () => {
  it('dentro del cooldown → 429 RESEND_COOLDOWN con retryAfterSeconds', async () => {
    const payload = await register();
    const res = await request(app)
      .post(`${BASE}/resend-verification`)
      .send({ email: payload.email });

    expect(res.status).toBe(429);
    expect(res.body.code).toBe('RESEND_COOLDOWN');
    expect(res.body.details.retryAfterSeconds).toBeGreaterThan(0);
    expect(res.body.details.retryAfterSeconds).toBeLessThanOrEqual(60);
    expect(mail.count(payload.email, 'verify')).toBe(1);
  });

  it('pasado el cooldown → 200, envía uno nuevo e invalida el anterior', async () => {
    const payload = await register();
    const oldCode = mail.last(payload.email, 'verify');
    await ageAuthCodes(COOLDOWN_MS);

    const res = await request(app)
      .post(`${BASE}/resend-verification`)
      .send({ email: payload.email });
    expect(res.status).toBe(200);
    expect(res.body.data.resendAvailableInSeconds).toBe(60);
    expect(mail.count(payload.email, 'verify')).toBe(2);

    const newCode = mail.last(payload.email, 'verify');
    if (newCode !== oldCode) {
      const old = await verify(payload.email, oldCode);
      expect(old.status).toBe(400);
    }
    expect((await verify(payload.email, newCode)).status).toBe(200);
  });

  it(`más de ${AUTH_CODE_POLICY.maxSendsPerHour} envíos en una hora → 429 RESEND_LIMIT`, async () => {
    const payload = await register(); // envío 1
    for (let i = 2; i <= AUTH_CODE_POLICY.maxSendsPerHour; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await ageAuthCodes(COOLDOWN_MS);
      // eslint-disable-next-line no-await-in-loop
      const r = await request(app)
        .post(`${BASE}/resend-verification`)
        .send({ email: payload.email });
      expect(r.status).toBe(200);
    }
    await ageAuthCodes(COOLDOWN_MS);
    const res = await request(app)
      .post(`${BASE}/resend-verification`)
      .send({ email: payload.email });

    expect(res.status).toBe(429);
    expect(res.body.code).toBe('RESEND_LIMIT');
    expect(res.body.details.retryAfterSeconds).toBeGreaterThan(0);
    expect(mail.count(payload.email, 'verify')).toBe(AUTH_CODE_POLICY.maxSendsPerHour);
  });

  it('email inexistente → 200 con la misma forma, sin enviar nada', async () => {
    const res = await request(app)
      .post(`${BASE}/resend-verification`)
      .send({ email: uniqueEmail('nadie') });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ resendAvailableInSeconds: 60 });
    expect(mail.sent).toHaveLength(0);
    expect(await AuthCode.countDocuments()).toBe(0);
  });

  it('cuenta ya verificada → 409 ALREADY_VERIFIED', async () => {
    const { payload } = await registerVerified();
    const res = await request(app)
      .post(`${BASE}/resend-verification`)
      .send({ email: payload.email });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_VERIFIED');
  });
});

// ───────────────────────────── Login no verificado ─────────────────────────

describe('POST /auth/login — usuario no verificado', () => {
  it('contraseña correcta → 403 EMAIL_NOT_VERIFIED (respeta el cooldown, no reenvía)', async () => {
    const payload = await register();
    const res = await request(app)
      .post(`${BASE}/login`)
      .send({ email: payload.email, password: payload.password });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
    expect(res.body.details.resendAvailableInSeconds).toBeGreaterThan(0);
    expect(res.body.details.resendAvailableInSeconds).toBeLessThanOrEqual(60);
    expect(res.body.data).toBeUndefined();
    expect(mail.count(payload.email, 'verify')).toBe(1); // solo el del registro
  });

  it('pasado el cooldown → envía un código nuevo, que verifica la cuenta', async () => {
    const payload = await register();
    await ageAuthCodes(COOLDOWN_MS);

    const res = await request(app)
      .post(`${BASE}/login`)
      .send({ email: payload.email, password: payload.password });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
    expect(res.body.details.resendAvailableInSeconds).toBe(60);
    expect(mail.count(payload.email, 'verify')).toBe(2);

    const ok = await verify(payload.email, mail.last(payload.email, 'verify'));
    expect(ok.status).toBe(200);
  });

  it('contraseña incorrecta → 401 y NO envía código', async () => {
    const payload = await register();
    await ageAuthCodes(COOLDOWN_MS);
    const res = await request(app)
      .post(`${BASE}/login`)
      .send({ email: payload.email, password: 'OtraClave999' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBeUndefined();
    expect(mail.count(payload.email, 'verify')).toBe(1);
  });
});

// ───────────────────────────── Olvidé mi contraseña ────────────────────────

describe('POST /auth/forgot-password', () => {
  it('email existente → 200 y envía un código de reset', async () => {
    const { payload } = await registerVerified();
    const res = await request(app)
      .post(`${BASE}/forgot-password`)
      .send({ email: payload.email });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ resendAvailableInSeconds: 60 });
    expect(mail.last(payload.email, 'reset')).toMatch(/^\d{6}$/);
  });

  it('email inexistente → MISMA respuesta (status, mensaje y data), sin enviar nada', async () => {
    const { payload } = await registerVerified();
    const existing = await request(app)
      .post(`${BASE}/forgot-password`)
      .send({ email: payload.email });
    const missing = await request(app)
      .post(`${BASE}/forgot-password`)
      .send({ email: uniqueEmail('nadie') });

    expect(missing.status).toBe(existing.status);
    expect(missing.body).toEqual(existing.body);
    expect(mail.sent.filter((m) => m.kind === 'reset')).toHaveLength(1);
  });

  it('dentro del cooldown → 200 igual (silencioso), sin segundo email', async () => {
    const { payload } = await registerVerified();
    await request(app).post(`${BASE}/forgot-password`).send({ email: payload.email });
    const res = await request(app)
      .post(`${BASE}/forgot-password`)
      .send({ email: payload.email });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ resendAvailableInSeconds: 60 });
    expect(mail.count(payload.email, 'reset')).toBe(1);
  });
});

// ───────────────────────────── Reset ───────────────────────────────────────

describe('POST /auth/reset-password', () => {
  /** Usuario verificado con sesión iniciada y un código de reset emitido. */
  async function withResetCode() {
    const verified = await registerVerified();
    await request(app)
      .post(`${BASE}/forgot-password`)
      .send({ email: verified.payload.email });
    return { ...verified, code: mail.last(verified.payload.email, 'reset') };
  }

  it('código correcto → 200, cambia la contraseña y REVOCA todas las sesiones', async () => {
    const { payload, refreshToken, code } = await withResetCode();
    // Una segunda sesión (otro dispositivo).
    const login2 = await request(app)
      .post(`${BASE}/login`)
      .send({ email: payload.email, password: payload.password });
    const refresh2 = login2.body.data.refreshToken;

    const res = await reset(payload.email, code, 'NuevaClave123');
    expect(res.status).toBe(200);

    // Ningún refresh token del usuario sigue vivo.
    const user = await User.findOne({ email: payload.email });
    expect(await RefreshToken.countDocuments({ userId: user._id, isRevoked: false })).toBe(0);
    for (const rt of [refreshToken, refresh2]) {
      // eslint-disable-next-line no-await-in-loop
      const r = await request(app).post(`${BASE}/refresh`).send({ refreshToken: rt });
      expect(r.status).toBe(401);
    }

    // La vieja no entra; la nueva sí.
    const oldLogin = await request(app)
      .post(`${BASE}/login`)
      .send({ email: payload.email, password: payload.password });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(app)
      .post(`${BASE}/login`)
      .send({ email: payload.email, password: 'NuevaClave123' });
    expect(newLogin.status).toBe(200);
  });

  it('código incorrecto → 400 CODE_INVALID con intentos restantes', async () => {
    const { payload, code } = await withResetCode();
    const res = await reset(payload.email, wrongCodeFor(code));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CODE_INVALID');
    expect(res.body.details.attemptsRemaining).toBe(AUTH_CODE_POLICY.maxAttempts - 1);
  });

  it('código expirado → 400 CODE_EXPIRED', async () => {
    const { payload, code } = await withResetCode();
    await AuthCode.updateMany(
      { purpose: 'password_reset' },
      { $set: { expiresAt: new Date(Date.now() - 1000) } }
    );
    const res = await reset(payload.email, code);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CODE_EXPIRED');
  });

  it('código reusado → 400 CODE_EXPIRED (un solo uso)', async () => {
    const { payload, code } = await withResetCode();
    expect((await reset(payload.email, code, 'NuevaClave123')).status).toBe(200);
    const again = await reset(payload.email, code, 'OtraClave456');
    expect(again.status).toBe(400);
    expect(again.body.code).toBe('CODE_EXPIRED');
  });

  it(`al llegar a ${AUTH_CODE_POLICY.maxAttempts} fallos el código se invalida`, async () => {
    const { payload, code } = await withResetCode();
    const wrong = wrongCodeFor(code);
    for (let i = 1; i < AUTH_CODE_POLICY.maxAttempts; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await reset(payload.email, wrong);
    }
    const last = await reset(payload.email, wrong);
    expect(last.body.code).toBe('CODE_TOO_MANY_ATTEMPTS');
    const correct = await reset(payload.email, code);
    expect(correct.status).toBe(400);
    expect(correct.body.code).toBe('CODE_TOO_MANY_ATTEMPTS');
  });

  it('email inexistente → 400 CODE_INVALID idéntico a un código incorrecto sin detalle', async () => {
    const res = await reset(uniqueEmail('nadie'), '123456');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CODE_INVALID');
    expect(res.body.details).toBeUndefined();
  });

  it('contraseña nueva débil → 422 (misma regla que el registro)', async () => {
    const { payload, code } = await withResetCode();
    const res = await reset(payload.email, code, 'debil');
    expect(res.status).toBe(422);
  });
});

// ───────────────────────────── Propósito cruzado ───────────────────────────

describe('Separación de propósito', () => {
  it('un código de VERIFICACIÓN no sirve para restablecer la contraseña', async () => {
    const payload = await register();
    const verifyCode = mail.last(payload.email, 'verify');

    const res = await reset(payload.email, verifyCode);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CODE_INVALID');
    // El código de verificación sigue intacto y sirve para lo suyo.
    expect((await verify(payload.email, verifyCode)).status).toBe(200);
  });

  it('un código de RESET no sirve para verificar la cuenta', async () => {
    const payload = await register(); // sin verificar
    await request(app).post(`${BASE}/forgot-password`).send({ email: payload.email });
    const resetCode = mail.last(payload.email, 'reset');
    const verifyCode = mail.last(payload.email, 'verify');

    const res = await verify(payload.email, resetCode);
    if (resetCode !== verifyCode) {
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('CODE_INVALID');
    }
    expect((await User.findOne({ email: payload.email })).isEmailVerified).toBe(
      resetCode === verifyCode
    );
  });
});
