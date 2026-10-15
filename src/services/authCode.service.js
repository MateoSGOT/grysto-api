'use strict';

/**
 * @file Códigos de un solo uso (6 dígitos) para verificación de cuenta y
 * recuperación de contraseña. Sin req/res: lo orquesta auth.service.
 *
 * Seguridad:
 * - Generado con `crypto.randomInt` (CSPRNG), nunca Math.random.
 * - Guardado como HMAC-SHA256 de `purpose:userId:code` con una clave del
 *   servidor. Un SHA-256 plano de 6 dígitos se rompe offline en milisegundos;
 *   el HMAC exige además la clave. Incluir `purpose` y `userId` impide usar un
 *   código para otro propósito u otro usuario.
 * - Vence a los 10 min, es de un solo uso y se invalida tras N intentos.
 * - Emitir uno nuevo invalida el anterior del mismo propósito.
 * - Reenvío con cooldown y límite por hora.
 */

const crypto = require('crypto');
const { AuthCode } = require('../models');
const ApiError = require('../utils/ApiError');
const { config } = require('../config/env');
const { AUTH_CODE_POLICY: POLICY } = require('../constants/authCodes');

/** Códigos de error de negocio (campo `code` top-level de la respuesta). */
const AUTH_CODE_ERRORS = Object.freeze({
  INVALID: 'CODE_INVALID',
  EXPIRED: 'CODE_EXPIRED',
  TOO_MANY_ATTEMPTS: 'CODE_TOO_MANY_ATTEMPTS',
  RESEND_COOLDOWN: 'RESEND_COOLDOWN',
  RESEND_LIMIT: 'RESEND_LIMIT',
});

/**
 * Clave HMAC. Prioriza AUTH_CODE_SECRET; si no está, la deriva de
 * JWT_REFRESH_SECRET con una etiqueta propia (no reutiliza la clave tal cual).
 *
 * @returns {Buffer} Clave HMAC.
 */
function hmacKey() {
  if (config.authCodes.secret) return Buffer.from(config.authCodes.secret, 'utf8');
  return crypto
    .createHmac('sha256', config.jwt.refreshSecret)
    .update('grysto:auth-codes:v1')
    .digest();
}

/**
 * Hash del código ligado a su propósito y usuario.
 *
 * @param {string} purpose - Propósito (enum AUTH_CODE_PURPOSES).
 * @param {string} userId - Usuario.
 * @param {string} code - Código en claro.
 * @returns {string} HMAC en hex.
 */
function hashCode(purpose, userId, code) {
  return crypto
    .createHmac('sha256', hmacKey())
    .update(`${purpose}:${String(userId)}:${code}`)
    .digest('hex');
}

/**
 * Genera un código numérico de `POLICY.length` dígitos (con ceros a la izquierda).
 *
 * @returns {string} Código en claro.
 */
function generateCode() {
  const max = 10 ** POLICY.length;
  return String(crypto.randomInt(0, max)).padStart(POLICY.length, '0');
}

/**
 * Segundos (redondeados hacia arriba) entre ahora y una fecha futura.
 *
 * @param {number} targetMs - Instante objetivo (epoch ms).
 * @returns {number} Segundos restantes (mínimo 1).
 */
function secondsUntil(targetMs) {
  return Math.max(1, Math.ceil((targetMs - Date.now()) / 1000));
}

/**
 * Verifica que el usuario pueda recibir un código nuevo de ese propósito.
 *
 * @param {string} userId - Usuario.
 * @param {string} purpose - Propósito.
 * @returns {Promise<void>}
 * @throws {ApiError} 429 RESEND_COOLDOWN / RESEND_LIMIT con `details.retryAfterSeconds`.
 */
async function assertCanSend(userId, purpose) {
  const now = Date.now();
  const windowStart = new Date(now - POLICY.sendWindowMs);
  const recent = await AuthCode.find({
    userId,
    purpose,
    createdAt: { $gt: windowStart },
  })
    .sort({ createdAt: -1 })
    .select('createdAt')
    .lean();

  const last = recent[0];
  if (last && now - last.createdAt.getTime() < POLICY.resendCooldownMs) {
    const retryAfterSeconds = secondsUntil(
      last.createdAt.getTime() + POLICY.resendCooldownMs
    );
    throw ApiError.tooMany(
      `Espera ${retryAfterSeconds} s para pedir otro código.`,
      { retryAfterSeconds }
    ).withCode(AUTH_CODE_ERRORS.RESEND_COOLDOWN);
  }

  if (recent.length >= POLICY.maxSendsPerHour) {
    // Se libera un envío cuando el más viejo de la ventana sale de ella.
    const oldest = recent[recent.length - 1];
    const retryAfterSeconds = secondsUntil(
      oldest.createdAt.getTime() + POLICY.sendWindowMs
    );
    throw ApiError.tooMany(
      'Pediste demasiados códigos. Intenta de nuevo más tarde.',
      { retryAfterSeconds }
    ).withCode(AUTH_CODE_ERRORS.RESEND_LIMIT);
  }
}

/**
 * Emite un código nuevo: aplica cooldown y límite, invalida el código vigente
 * anterior del mismo propósito y guarda solo el hash.
 *
 * @param {string} userId - Usuario.
 * @param {string} purpose - Propósito (enum AUTH_CODE_PURPOSES).
 * @returns {Promise<{ code: string, resendAvailableInSeconds: number }>}
 *   Código en claro (solo para enviarlo por email) y segundos hasta poder reenviar.
 * @throws {ApiError} 429 si está en cooldown o superó el límite por hora.
 */
async function issueCode(userId, purpose) {
  await assertCanSend(userId, purpose);

  const now = new Date();
  await AuthCode.updateMany(
    { userId, purpose, usedAt: null, invalidatedAt: null },
    { $set: { invalidatedAt: now } }
  );

  const code = generateCode();
  await AuthCode.create({
    userId,
    purpose,
    codeHash: hashCode(purpose, userId, code),
    expiresAt: new Date(now.getTime() + POLICY.ttlMs),
    purgeAt: new Date(now.getTime() + POLICY.purgeAfterMs),
  });

  return {
    code,
    resendAvailableInSeconds: Math.ceil(POLICY.resendCooldownMs / 1000),
  };
}

/** @returns {ApiError} 400 CODE_INVALID (opcionalmente con intentos restantes). */
function invalidCode(attemptsRemaining) {
  return ApiError.badRequest(
    'El código es incorrecto.',
    attemptsRemaining == null ? null : { attemptsRemaining }
  ).withCode(AUTH_CODE_ERRORS.INVALID);
}

/** @returns {ApiError} 400 CODE_EXPIRED. */
function expiredCode() {
  return ApiError.badRequest(
    'El código venció o ya no es válido. Pide uno nuevo.'
  ).withCode(AUTH_CODE_ERRORS.EXPIRED);
}

/** @returns {ApiError} 400 CODE_TOO_MANY_ATTEMPTS. */
function tooManyAttempts() {
  return ApiError.badRequest(
    'Demasiados intentos fallidos. Pide un código nuevo.'
  ).withCode(AUTH_CODE_ERRORS.TOO_MANY_ATTEMPTS);
}

/**
 * Error genérico para cuando no hay usuario: idéntico a un código incorrecto,
 * para no revelar si el email existe (anti-enumeración en reset).
 *
 * @returns {ApiError} 400 CODE_INVALID sin detalle.
 */
function unknownUserError() {
  return invalidCode(null);
}

/**
 * Valida y CONSUME el código vigente del usuario para ese propósito.
 * Atómico: el consumo y el conteo de intentos usan updates condicionales, así
 * que dos requests simultáneas no pueden usar el mismo código.
 *
 * @param {string} userId - Usuario.
 * @param {string} purpose - Propósito esperado.
 * @param {string} code - Código ingresado.
 * @returns {Promise<void>}
 * @throws {ApiError} 400 CODE_INVALID / CODE_EXPIRED / CODE_TOO_MANY_ATTEMPTS.
 */
async function consumeCode(userId, purpose, code) {
  const latest = await AuthCode.findOne({ userId, purpose }).sort({ createdAt: -1 });
  if (!latest) throw invalidCode(null);

  if (latest.attempts >= POLICY.maxAttempts) throw tooManyAttempts();
  if (latest.usedAt || latest.invalidatedAt) throw expiredCode();
  if (latest.expiresAt.getTime() <= Date.now()) throw expiredCode();

  const expected = Buffer.from(latest.codeHash, 'hex');
  const given = Buffer.from(hashCode(purpose, userId, String(code)), 'hex');
  const matches =
    expected.length === given.length && crypto.timingSafeEqual(expected, given);

  if (!matches) {
    const updated = await AuthCode.findOneAndUpdate(
      { _id: latest._id, usedAt: null, invalidatedAt: null },
      { $inc: { attempts: 1 } },
      { returnDocument: 'after' }
    );
    if (!updated) throw expiredCode();
    if (updated.attempts >= POLICY.maxAttempts) {
      await AuthCode.updateOne(
        { _id: latest._id, invalidatedAt: null },
        { $set: { invalidatedAt: new Date() } }
      );
      throw tooManyAttempts();
    }
    throw invalidCode(POLICY.maxAttempts - updated.attempts);
  }

  const consumed = await AuthCode.findOneAndUpdate(
    {
      _id: latest._id,
      usedAt: null,
      invalidatedAt: null,
      attempts: { $lt: POLICY.maxAttempts },
    },
    { $set: { usedAt: new Date() } },
    { returnDocument: 'after' }
  );
  if (!consumed) throw expiredCode();
}

module.exports = {
  AUTH_CODE_ERRORS,
  issueCode,
  consumeCode,
  unknownUserError,
  // Expuestos para tests.
  hashCode,
  generateCode,
};
