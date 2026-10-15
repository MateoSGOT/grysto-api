'use strict';

/**
 * @file Lógica de negocio de autenticación (sin req/res). Orquesta models,
 * tokens y emails. Toda la capa HTTP vive en el controller.
 */

const mongoose = require('mongoose');
const {
  User,
  PlayerProfile,
  UserPlan,
  CoachConversation,
  Subscription,
  GymInfo,
  WorkoutHistory,
  AuthCode,
  RefreshToken,
} = require('../models');
const crypto = require('crypto');
const { signAccessToken } = require('../utils/jwt.util');
const ApiError = require('../utils/ApiError');
const { PLAN_SOURCE, AUTH_CODE_PURPOSES } = require('../constants/enums');
const { AUTH_CODE_POLICY } = require('../constants/authCodes');
const emailService = require('./email.service');
const authCodeService = require('./authCode.service');
const weeklyPlanService = require('./weeklyPlan.service');
const userPlanService = require('./userPlan.service');

/** Códigos de negocio propios de auth (campo `code` top-level). */
const AUTH_ERRORS = Object.freeze({
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  ALREADY_VERIFIED: 'ALREADY_VERIFIED',
});

/** Segundos de cooldown que se informan tras un envío exitoso. */
const RESEND_COOLDOWN_SECONDS = Math.ceil(AUTH_CODE_POLICY.resendCooldownMs / 1000);

/**
 * Firma un access token a partir de un usuario.
 *
 * @param {mongoose.Document} user - Documento de usuario.
 * @returns {string} Access token JWT.
 */
function issueAccessToken(user) {
  return signAccessToken({
    sub: user._id.toString(),
    role: user.role,
    plan: user.plan,
  });
}

/**
 * Emite el par access + refresh para un usuario y registra el login.
 *
 * @param {mongoose.Document} user - Usuario (verificado y activo).
 * @param {string|null} ip - IP de origen.
 * @returns {Promise<{ accessToken: string, refreshToken: string }>}
 */
async function issueSession(user, ip) {
  user.lastLoginAt = new Date();
  await user.save();
  const accessToken = issueAccessToken(user);
  const { plainToken: refreshToken } = await RefreshToken.generateToken(
    user._id,
    ip
  );
  return { accessToken, refreshToken };
}

/**
 * Emite y envía un código de verificación de cuenta.
 *
 * @param {mongoose.Document} user - Usuario.
 * @returns {Promise<number>} Segundos hasta poder reenviar.
 * @throws {ApiError} 429 RESEND_COOLDOWN / RESEND_LIMIT.
 */
async function sendVerificationCode(user) {
  const { code, resendAvailableInSeconds } = await authCodeService.issueCode(
    user._id,
    AUTH_CODE_PURPOSES.EMAIL_VERIFICATION
  );
  await emailService.sendVerificationCode(user.email, user.nombre, code);
  return resendAvailableInSeconds;
}

/**
 * Registra un usuario nuevo junto a su perfil, de forma atómica
 * (transacción), y le envía el código de verificación. NO emite tokens:
 * primero debe verificar el email.
 *
 * @param {Object} data - Datos validados (credenciales + cuestionario).
 * @param {string|null} [ip=null] - IP de origen.
 * @returns {Promise<Object>} Perfil público del usuario creado.
 * @throws {ApiError} 409 si el email ya está registrado.
 */
async function register(data, ip = null) {
  const existing = await User.findOne({ email: data.email });
  if (existing) {
    throw ApiError.conflict('Ya existe una cuenta con este email');
  }

  const session = await mongoose.startSession();
  let createdUser;

  try {
    await session.withTransaction(async () => {
      const [user] = await User.create(
        [
          {
            nombre: data.nombre,
            email: data.email,
            password: data.password,
            isEmailVerified: false,
          },
        ],
        { session }
      );

      await PlayerProfile.create(
        [
          {
            userId: user._id,
            position: data.position,
            level: data.level,
            goals: data.goals,
            trainingDaysPerWeek: data.trainingDaysPerWeek,
            sessionDuration: data.sessionDuration,
            height: data.height,
            weight: data.weight,
            age: data.age,
            weaknesses: data.weaknesses,
            gymAccess: data.gymAccess,
          },
        ],
        { session }
      );

      createdUser = user;
    });
  } finally {
    await session.endSession();
  }

  // Fuera de la transacción: el código y su envío no deben romper el registro
  // (si fallan, el usuario puede pedir otro con resend-verification).
  try {
    await sendVerificationCode(createdUser);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`✗ [auth] No se pudo emitir el código de verificación: ${err.message}`);
  }

  return createdUser.getPublicProfile();
}

/**
 * Autentica un usuario y emite el par de tokens.
 *
 * @param {string} email - Email.
 * @param {string} password - Contraseña en claro.
 * @param {string|null} [ip=null] - IP de origen.
 * @returns {Promise<{ user: Object, accessToken: string, refreshToken: string }>}
 * @throws {ApiError} 401 credenciales inválidas; 403 EMAIL_NOT_VERIFIED (con
 *   `details.resendAvailableInSeconds`) o cuenta inactiva.
 */
async function login(email, password, ip = null) {
  const user = await User.findByEmail(email);

  // Mismo mensaje exista o no el email (anti-enumeración).
  if (!user || !(await user.comparePassword(password))) {
    throw ApiError.unauthorized('Credenciales inválidas');
  }
  if (!user.isActive) {
    throw ApiError.forbidden('Cuenta desactivada');
  }
  if (!user.isEmailVerified) {
    // Contraseña correcta pero sin verificar: se envía un código (si el
    // cooldown lo permite) y el código de error lleva a la pantalla de código.
    let resendAvailableInSeconds;
    try {
      await sendVerificationCode(user);
      resendAvailableInSeconds = RESEND_COOLDOWN_SECONDS;
    } catch (err) {
      if (!(err instanceof ApiError) || err.statusCode !== 429) throw err;
      resendAvailableInSeconds = err.details?.retryAfterSeconds ?? RESEND_COOLDOWN_SECONDS;
    }
    throw ApiError.forbidden('Verifica tu email: te enviamos un código.', {
      resendAvailableInSeconds,
    }).withCode(AUTH_ERRORS.EMAIL_NOT_VERIFIED);
  }

  const tokens = await issueSession(user, ip);
  return { user: user.getPublicProfile(), ...tokens };
}

/**
 * Genera el plan recomendado tras la verificación: elige el WeeklyPlan activo
 * con mayor match-score (vía weeklyPlanService) y crea el UserPlan inicial con
 * source 'recommended_after_questionnaire'. Tolera catálogo vacío (retorna null).
 *
 * @param {mongoose.Types.ObjectId} userId - Usuario.
 * @returns {Promise<mongoose.Document|null>} UserPlan creado o null.
 */
async function recommendPlan(userId) {
  const profile = await PlayerProfile.findOne({ userId });
  if (!profile) return null;

  const best = await weeklyPlanService.getRecommendedForProfile(profile);
  if (!best) return null;

  return userPlanService.createUserPlanForUser({
    userId,
    weeklyPlan: best,
    source: PLAN_SOURCE.RECOMMENDED,
  });
}

/**
 * Verifica el email con el código de 6 dígitos, recomienda un plan e INICIA
 * SESIÓN (registro → código → Home).
 *
 * La recomendación es best-effort: si falla, la verificación NO se rompe
 * (`recommendedPlan: null`) y el usuario elige un plan desde el catálogo.
 *
 * @param {string} email - Email de la cuenta.
 * @param {string} code - Código de 6 dígitos.
 * @param {string|null} [ip=null] - IP de origen.
 * @returns {Promise<{ user: Object, accessToken: string, refreshToken: string, recommendedPlan: Object|null }>}
 * @throws {ApiError} 400 CODE_*; 409 ALREADY_VERIFIED; 403 cuenta desactivada.
 */
async function verifyEmail(email, code, ip = null) {
  const user = await User.findOne({ email });
  if (!user) throw authCodeService.unknownUserError();
  if (user.isEmailVerified) throw alreadyVerified();

  await authCodeService.consumeCode(
    user._id,
    AUTH_CODE_PURPOSES.EMAIL_VERIFICATION,
    code
  );

  // Update condicional: si dos requests llegan a la vez, solo una verifica
  // (y solo una dispara la recomendación de plan).
  const { modifiedCount } = await User.updateOne(
    { _id: user._id, isEmailVerified: false },
    { $set: { isEmailVerified: true } }
  );
  if (modifiedCount === 0) throw alreadyVerified();
  user.isEmailVerified = true;

  let recommendedPlan = null;
  try {
    recommendedPlan = await recommendPlan(user._id);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`✗ [auth] recommendPlan falló para ${user._id}: ${err.message}`);
  }

  if (!user.isActive) throw ApiError.forbidden('Cuenta desactivada');

  const tokens = await issueSession(user, ip);
  return { user: user.getPublicProfile(), ...tokens, recommendedPlan };
}

/** @returns {ApiError} 409 ALREADY_VERIFIED. */
function alreadyVerified() {
  return ApiError.conflict('Tu email ya está verificado. Inicia sesión.').withCode(
    AUTH_ERRORS.ALREADY_VERIFIED
  );
}

/**
 * Reenvía el código de verificación. Si el email no existe responde igual
 * que un envío exitoso, sin enviar nada.
 *
 * @param {string} email - Email de la cuenta.
 * @returns {Promise<{ resendAvailableInSeconds: number }>}
 * @throws {ApiError} 409 ALREADY_VERIFIED; 429 RESEND_COOLDOWN / RESEND_LIMIT.
 */
async function resendVerification(email) {
  const user = await User.findOne({ email });
  if (!user) return { resendAvailableInSeconds: RESEND_COOLDOWN_SECONDS };
  if (user.isEmailVerified) throw alreadyVerified();
  const resendAvailableInSeconds = await sendVerificationCode(user);
  return { resendAvailableInSeconds };
}

/**
 * Rota el refresh token (con detección de reuso) y emite un nuevo par.
 *
 * @param {string} oldRefreshToken - Refresh token en plano.
 * @param {string|null} [ip=null] - IP de origen.
 * @returns {Promise<{ accessToken: string, refreshToken: string }>}
 * @throws {ApiError} 401 si el token es inválido, expiró o fue reusado.
 */
async function refreshToken(oldRefreshToken, ip = null) {
  const { plainToken, document } = await RefreshToken.rotateToken(
    oldRefreshToken,
    ip
  );

  const user = await User.findById(document.userId);
  if (!user || !user.isActive) {
    throw ApiError.unauthorized('La cuenta asociada no está disponible');
  }

  return { accessToken: issueAccessToken(user), refreshToken: plainToken };
}

/**
 * Cierra la sesión revocando el refresh token presentado.
 *
 * @param {string} token - Refresh token en plano.
 * @returns {Promise<{ message: string }>} Confirmación.
 */
async function logout(token) {
  if (token) {
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    await RefreshToken.updateOne(
      { token: hash, isRevoked: false },
      { $set: { isRevoked: true, revokedAt: new Date() } }
    );
  }
  return { message: 'Sesión cerrada correctamente' };
}

/**
 * Inicia la recuperación de contraseña enviando un código. Respuesta SIEMPRE
 * idéntica exista o no el email (anti-enumeración): el cooldown y el límite
 * por hora se aplican en silencio, sin 429.
 *
 * @param {string} email - Email.
 * @returns {Promise<{ resendAvailableInSeconds: number }>}
 */
async function forgotPassword(email) {
  const user = await User.findOne({ email });
  if (user && user.isActive) {
    try {
      const { code } = await authCodeService.issueCode(
        user._id,
        AUTH_CODE_PURPOSES.PASSWORD_RESET
      );
      await emailService.sendPasswordResetCode(user.email, user.nombre, code);
    } catch (err) {
      // 429 (cooldown/límite) se silencia para no revelar que el email existe.
      if (!(err instanceof ApiError) || err.statusCode !== 429) throw err;
    }
  }
  return { resendAvailableInSeconds: RESEND_COOLDOWN_SECONDS };
}

/**
 * Restablece la contraseña con el código de reset y revoca TODAS las sesiones
 * (refresh tokens) del usuario. No inicia sesión: el usuario vuelve a login.
 *
 * @param {string} email - Email de la cuenta.
 * @param {string} code - Código de 6 dígitos (propósito password_reset).
 * @param {string} newPassword - Nueva contraseña (se hashea en pre-validate).
 * @returns {Promise<{ message: string }>} Confirmación.
 * @throws {ApiError} 400 CODE_* (email inexistente → CODE_INVALID, igual que un código incorrecto).
 */
async function resetPassword(email, code, newPassword) {
  const user = await User.findOne({ email });
  if (!user) throw authCodeService.unknownUserError();

  await authCodeService.consumeCode(
    user._id,
    AUTH_CODE_PURPOSES.PASSWORD_RESET,
    code
  );

  user.password = newPassword;
  await user.save();

  // Cierra sesión en todos los dispositivos.
  await RefreshToken.revokeAllForUser(user._id);

  return { message: 'Contraseña actualizada. Inicia sesión con la nueva.' };
}

/**
 * Elimina la cuenta del usuario y TODOS sus datos personales de forma atómica
 * (transacción). Exige re-autenticación con la contraseña actual. El catálogo
 * compartido (ejercicios/rutinas/planes) NO se toca. Irreversible.
 *
 * @param {string} userId - Usuario autenticado.
 * @param {string} password - Contraseña actual (re-autenticación).
 * @returns {Promise<{ message: string }>} Confirmación.
 * @throws {ApiError} 404 si el usuario no existe; 401 si la contraseña no coincide.
 */
async function deleteAccount(userId, password) {
  const user = await User.findById(userId).select('+password');
  if (!user) throw ApiError.notFound('Usuario no encontrado');

  const ok = await user.comparePassword(password);
  if (!ok) throw ApiError.unauthorized('Contraseña incorrecta');

  const uid = user._id;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      // Borra todo lo indexado por userId (NO el catálogo compartido). Las
      // operaciones de una transacción deben ser SECUENCIALES (no Promise.all:
      // Mongo no admite operaciones concurrentes en la misma sesión).
      await PlayerProfile.deleteMany({ userId: uid }, { session });
      await UserPlan.deleteMany({ userId: uid }, { session });
      await CoachConversation.deleteMany({ userId: uid }, { session });
      await Subscription.deleteMany({ userId: uid }, { session });
      await GymInfo.deleteMany({ userId: uid }, { session });
      await WorkoutHistory.deleteMany({ userId: uid }, { session });
      await RefreshToken.deleteMany({ userId: uid }, { session });
      await AuthCode.deleteMany({ userId: uid }, { session });
      await User.deleteOne({ _id: uid }, { session });
    });
  } finally {
    await session.endSession();
  }

  return { message: 'Cuenta eliminada correctamente' };
}

module.exports = {
  AUTH_ERRORS,
  register,
  login,
  verifyEmail,
  resendVerification,
  refreshToken,
  logout,
  forgotPassword,
  resetPassword,
  deleteAccount,
};
