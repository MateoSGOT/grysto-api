'use strict';

/**
 * @file Tests unitarios del auth.service contra MongoDB en memoria.
 */

const authService = require('../../src/services/auth.service');
const {
  User,
  PlayerProfile,
  EmailVerificationToken,
  PasswordResetToken,
  RefreshToken,
} = require('../../src/models');
const { validRegisterPayload } = require('../fixtures');

/**
 * Registra un usuario y devuelve su token de verificación en plano.
 *
 * @param {Object} [overrides={}] - Overrides del payload.
 * @returns {Promise<{ payload: Object, verifyToken: string }>}
 */
async function registerUser(overrides = {}) {
  const payload = validRegisterPayload(overrides);
  await authService.register(payload, '127.0.0.1');
  const record = await EmailVerificationToken.findOne({}).sort({ createdAt: -1 });
  return { payload, verifyToken: record.token };
}

describe('authService.register', () => {
  it('registra usuario, perfil y token de verificación (sin emitir tokens)', async () => {
    const payload = validRegisterPayload();
    const result = await authService.register(payload, '127.0.0.1');

    expect(result.email).toBe(payload.email);
    expect(result.password).toBeUndefined();
    expect(result.isEmailVerified).toBe(false);

    expect(await User.countDocuments()).toBe(1);
    expect(await PlayerProfile.countDocuments()).toBe(1);
    expect(await EmailVerificationToken.countDocuments()).toBe(1);
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
    const { payload, verifyToken } = await registerUser();
    await authService.verifyEmail(verifyToken);

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
    const { payload, verifyToken } = await registerUser();
    await authService.verifyEmail(verifyToken);

    await expect(
      authService.login(payload.email, 'WrongPass123', '127.0.0.1')
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it('rechaza login si el email no está verificado con 403', async () => {
    const { payload } = await registerUser();
    await expect(
      authService.login(payload.email, payload.password, '127.0.0.1')
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('authService refresh token (rotación y reuso)', () => {
  /**
   * @returns {Promise<{ refreshToken: string }>} Refresh token válido inicial.
   */
  async function loggedInUser() {
    const { payload, verifyToken } = await registerUser();
    await authService.verifyEmail(verifyToken);
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
  it('cambia la contraseña, invalida el token y revoca sesiones', async () => {
    const { payload, verifyToken } = await registerUser();
    await authService.verifyEmail(verifyToken);
    await authService.login(payload.email, payload.password, '127.0.0.1');

    const user = await User.findByEmail(payload.email);
    const resetRecord = await PasswordResetToken.generateToken(user._id);

    await authService.resetPassword(resetRecord.token, 'NewPassword456');

    // La nueva contraseña funciona; la vieja no.
    await expect(
      authService.login(payload.email, 'NewPassword456', '127.0.0.1')
    ).resolves.toMatchObject({ accessToken: expect.any(String) });
    await expect(
      authService.login(payload.email, payload.password, '127.0.0.1')
    ).rejects.toMatchObject({ statusCode: 401 });

    // El token de reset quedó usado.
    const used = await PasswordResetToken.findOne({ token: resetRecord.token });
    expect(used.used).toBe(true);
  });
});
