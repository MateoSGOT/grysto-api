'use strict';

/**
 * @file Lógica de negocio de autenticación (sin req/res). Orquesta models,
 * tokens y emails. Toda la capa HTTP vive en el controller.
 */

const mongoose = require('mongoose');
const {
  User,
  PlayerProfile,
  EmailVerificationToken,
  PasswordResetToken,
  RefreshToken,
  WeeklyPlan,
  UserPlan,
} = require('../models');
const { signAccessToken } = require('../utils/jwt.util');
const ApiError = require('../utils/ApiError');
const { PLAN_SOURCE, PLAN_STATUS } = require('../constants/enums');
const emailService = require('./email.service');

const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // 24 h
const PLAN_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 días
const WEEK_DAYS = 7;

const crypto = require('crypto');

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
 * Registra un usuario nuevo junto a su perfil y token de verificación,
 * de forma atómica (transacción). NO emite tokens: primero debe verificar
 * el email.
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
  let verifyTokenPlain;

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
            primaryGoal: data.primaryGoal,
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

      verifyTokenPlain = crypto.randomBytes(32).toString('hex');
      await EmailVerificationToken.create(
        [
          {
            userId: user._id,
            token: verifyTokenPlain,
            expiresAt: new Date(Date.now() + EMAIL_VERIFY_TTL_MS),
          },
        ],
        { session }
      );

      createdUser = user;
    });
  } finally {
    await session.endSession();
  }

  // Fuera de la transacción: el envío de email no debe romper el registro.
  await emailService.sendVerificationEmail(
    createdUser.email,
    createdUser.nombre,
    verifyTokenPlain
  );

  return createdUser.getPublicProfile();
}

/**
 * Autentica un usuario y emite el par de tokens.
 *
 * @param {string} email - Email.
 * @param {string} password - Contraseña en claro.
 * @param {string|null} [ip=null] - IP de origen.
 * @returns {Promise<{ user: Object, accessToken: string, refreshToken: string }>}
 * @throws {ApiError} 401 credenciales inválidas; 403 email no verificado o cuenta inactiva.
 */
async function login(email, password, ip = null) {
  const user = await User.findByEmail(email);

  // Mismo mensaje exista o no el email (anti-enumeración).
  if (!user || !(await user.comparePassword(password))) {
    throw ApiError.unauthorized('Credenciales inválidas');
  }
  if (!user.isEmailVerified) {
    throw ApiError.forbidden('Verifica tu email primero');
  }
  if (!user.isActive) {
    throw ApiError.forbidden('Cuenta desactivada');
  }

  user.lastLoginAt = new Date();
  await user.save();

  const accessToken = issueAccessToken(user);
  const { plainToken: refreshToken } = await RefreshToken.generateToken(
    user._id,
    ip
  );

  return { user: user.getPublicProfile(), accessToken, refreshToken };
}

/**
 * Genera el plan recomendado tras la verificación: elige el WeeklyPlan activo
 * con mayor match-score y crea el UserPlan correspondiente. Tolera catálogo vacío.
 *
 * @param {mongoose.Types.ObjectId} userId - Usuario.
 * @returns {Promise<mongoose.Document|null>} UserPlan creado o null.
 */
async function recommendPlan(userId) {
  const [profile, plans] = await Promise.all([
    PlayerProfile.findOne({ userId }),
    WeeklyPlan.find({ isActive: true }),
  ]);

  if (!profile || plans.length === 0) return null;

  let best = null;
  let bestScore = -1;
  for (const plan of plans) {
    const score = profile.getMatchScore(plan);
    if (score > bestScore) {
      bestScore = score;
      best = plan;
    }
  }
  if (!best) return null;

  const now = new Date();
  const progress = Array.from({ length: WEEK_DAYS }, (_, i) => ({
    dayNumber: i + 1,
    completed: false,
    completedAt: null,
    skipped: false,
  }));

  return UserPlan.create({
    userId,
    weeklyPlanId: best._id,
    source: PLAN_SOURCE.RECOMMENDED,
    status: PLAN_STATUS.ACTIVE,
    startedAt: now,
    endsAt: new Date(now.getTime() + PLAN_DURATION_MS),
    progress,
  });
}

/**
 * Verifica el email mediante token y dispara la recomendación de plan.
 *
 * @param {string} token - Token de verificación.
 * @returns {Promise<{ user: Object, recommendedPlan: Object|null }>}
 * @throws {ApiError} 400 si el token es inválido, usado o expirado.
 */
async function verifyEmail(token) {
  const record = await EmailVerificationToken.findOne({ token });
  if (
    !record ||
    record.verified ||
    record.expiresAt.getTime() < Date.now()
  ) {
    throw ApiError.badRequest('Token de verificación inválido o expirado');
  }

  const user = await User.findById(record.userId);
  if (!user) {
    throw ApiError.badRequest('Token de verificación inválido o expirado');
  }

  user.isEmailVerified = true;
  await user.save();

  record.verified = true;
  record.verifiedAt = new Date();
  await record.save();

  const recommendedPlan = await recommendPlan(user._id);

  return { user: user.getPublicProfile(), recommendedPlan };
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
 * Inicia la recuperación de contraseña. Respuesta idéntica exista o no el
 * email (anti-enumeración).
 *
 * @param {string} email - Email.
 * @returns {Promise<void>}
 */
async function forgotPassword(email) {
  const user = await User.findOne({ email });
  if (user) {
    const record = await PasswordResetToken.generateToken(user._id);
    await emailService.sendPasswordResetEmail(
      user.email,
      user.nombre,
      record.token
    );
  }
}

/**
 * Restablece la contraseña con un token válido y revoca todas las sesiones.
 *
 * @param {string} token - Token de reset.
 * @param {string} newPassword - Nueva contraseña (se hashea en pre-save).
 * @returns {Promise<{ message: string }>} Confirmación.
 * @throws {ApiError} 400 si el token es inválido, usado o expirado.
 */
async function resetPassword(token, newPassword) {
  const record = await PasswordResetToken.findOne({ token });
  if (!record || record.used || record.expiresAt.getTime() < Date.now()) {
    throw ApiError.badRequest('Token de recuperación inválido o expirado');
  }

  const user = await User.findById(record.userId);
  if (!user) {
    throw ApiError.badRequest('Token de recuperación inválido o expirado');
  }

  user.password = newPassword;
  await user.save();

  record.used = true;
  record.usedAt = new Date();
  await record.save();

  // Cierra sesión en todos los dispositivos.
  await RefreshToken.revokeAllForUser(user._id);

  return { message: 'Contraseña actualizada correctamente' };
}

module.exports = {
  register,
  login,
  verifyEmail,
  refreshToken,
  logout,
  forgotPassword,
  resetPassword,
};
