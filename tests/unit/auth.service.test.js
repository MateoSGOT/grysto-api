'use strict';

/**
 * @file Tests unitarios del auth.service contra MongoDB en memoria.
 */

const authService = require('../../src/services/auth.service');
const {
  User,
  PlayerProfile,
  AuthCode,
  RefreshToken,
} = require('../../src/models');
const { validRegisterPayload, captureEmailCodes } = require('../fixtures');

let mail;
beforeEach(() => {
  mail = captureEmailCodes();
});
afterEach(() => jest.restoreAllMocks());

/**
 * Registra un usuario y devuelve su código de verificación en claro.
 *
 * @param {Object} [overrides={}] - Overrides del payload.
 * @returns {Promise<{ payload: Object, verifyCode: string }>}
 */
async function registerUser(overrides = {}) {
  const payload = validRegisterPayload(overrides);
  await authService.register(payload, '127.0.0.1');
  return { payload, verifyCode: mail.last(payload.email, 'verify') };
}

/** Registra y verifica (el verify ya inicia sesión). */
async function registerAndVerify(overrides = {}) {
  const { payload, verifyCode } = await registerUser(overrides);
  await authService.verifyEmail(payload.email, verifyCode, '127.0.0.1');
  return { payload };
}

describe('authService.register', () => {
  it('registra usuario, perfil y código de verificación (sin emitir tokens)', async () => {
    const payload = validRegisterPayload();
    const result = await authService.register(payload, '127.0.0.1');

    expect(result.email).toBe(payload.email);
    expect(result.password).toBeUndefined();
    expect(result.isEmailVerified).toBe(false);

    expect(await User.countDocuments()).toBe(1);
    expect(await PlayerProfile.countDocuments()).toBe(1);
    expect(await AuthCode.countDocuments()).toBe(1);
    expect(mail.last(payload.email, 'verify')).toMatch(/^\d{6}$/);
  });

  it('rechaza email duplicado con 409', async () => {
    await authService.register(validRegisterPayload(), '127.0.0.1');
    await expect(
      authService.register(validRegisterPayload(), '127.0.0.1')
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('authService.login', () => {
  it('inicia sesión y emite access + refresh tras verificar email', async () => {
    const { payload } = await registerAndVerify();
    await RefreshToken.deleteMany({}); // el verify ya emitió uno

    const result = await authService.login(
      payload.email,
      payload.password,
      '127.0.0.1'
    );

    expect(result.accessToken).toEqual(expect.any(String));
    expect(result.refreshToken).toEqual(expect.any(String));
    expect(result.user.email).toBe(payload.email);
    expect(await RefreshToken.countDocuments()).toBe(1);
  });

  it('rechaza password incorrecto con 401', async () => {
    const { payload } = await registerAndVerify();

    await expect(
      authService.login(payload.email, 'WrongPass123', '127.0.0.1')
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it('rechaza login si el email no está verificado con 403', async () => {
    const { payload } = await registerUser();
    await expect(
      authService.login(payload.email, payload.password, '127.0.0.1')
    ).rejects.toMatchObject({ statusCode: 403, code: 'EMAIL_NOT_VERIFIED' });
  });
});

describe('authService refresh token (rotación y reuso)', () => {
  /**
   * @returns {Promise<{ refreshToken: string }>} Refresh token válido inicial.
   */
  async function loggedInUser() {
    const { payload } = await registerAndVerify();
    const { refreshToken } = await authService.login(
      payload.email,
      payload.password,
      '127.0.0.1'
    );
    return { refreshToken };
  }

  it('rota el refresh: revoca el viejo y emite uno nuevo válido', async () => {
    const { refreshToken } = await loggedInUser();
    const rotated = await authService.refreshToken(refreshToken, '127.0.0.1');

    expect(rotated.refreshToken).not.toBe(refreshToken);
    expect(rotated.accessToken).toEqual(expect.any(String));

    // El nuevo refresh token funciona.
    const again = await authService.refreshToken(rotated.refreshToken, '127.0.0.1');
    expect(again.refreshToken).toEqual(expect.any(String));
  });

  it('detecta reuso: reusar un refresh revocado revoca toda la cadena', async () => {
    const { refreshToken } = await loggedInUser();
    await authService.refreshToken(refreshToken, '127.0.0.1'); // primera rotación

    // Reusar el viejo (ya revocado) → sesión comprometida.
    await expect(
      authService.refreshToken(refreshToken, '127.0.0.1')
    ).rejects.toMatchObject({ statusCode: 401, message: 'Sesión comprometida' });

    // Toda la cadena del usuario quedó revocada.
    const active = await RefreshToken.countDocuments({ isRevoked: false });
    expect(active).toBe(0);
  });

  it('rechaza un refresh token inexistente con 401', async () => {
    await expect(
      authService.refreshToken('token-que-no-existe', '127.0.0.1')
    ).rejects.toMatchObject({ statusCode: 401 });
  });
});

describe('authService.resetPassword', () => {
  it('cambia la contraseña, consume el código y revoca sesiones', async () => {
    const { payload } = await registerAndVerify();
    await authService.login(payload.email, payload.password, '127.0.0.1');

    await authService.forgotPassword(payload.email);
    const resetCode = mail.last(payload.email, 'reset');

    await authService.resetPassword(payload.email, resetCode, 'NewPassword456');
    expect(await RefreshToken.countDocuments({ isRevoked: false })).toBe(0);

    // La nueva contraseña funciona; la vieja no.
    await expect(
      authService.login(payload.email, 'NewPassword456', '127.0.0.1')
    ).resolves.toMatchObject({ accessToken: expect.any(String) });
    await expect(
      authService.login(payload.email, payload.password, '127.0.0.1')
    ).rejects.toMatchObject({ statusCode: 401 });

    // El código de reset quedó usado: no sirve una segunda vez.
    await expect(
      authService.resetPassword(payload.email, resetCode, 'OtraClave789')
    ).rejects.toMatchObject({ statusCode: 400, code: 'CODE_EXPIRED' });
  });
});
