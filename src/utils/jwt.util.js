'use strict';

/**
 * @file Utilidades de JWT para access tokens (HS256 explícito).
 * Los refresh tokens se manejarán en la capa de Auth (siguiente fase).
 */

const jwt = require('jsonwebtoken');
const { config } = require('../config/env');
const ApiError = require('./ApiError');

const ALGORITHM = 'HS256';

/**
 * @typedef {Object} AccessPayload
 * @property {string} sub - ID del usuario (ObjectId como string).
 * @property {string} role - Rol del usuario (enum ROLES).
 * @property {string} plan - Plan del usuario (enum PLANS).
 */

/**
 * Firma un access token con HS256.
 *
 * @param {AccessPayload} payload - Datos del usuario a embeber.
 * @returns {string} JWT firmado.
 */
function signAccessToken(payload) {
  return jwt.sign(payload, config.jwt.accessSecret, {
    algorithm: ALGORITHM,
    expiresIn: config.jwt.accessExpires,
  });
}

/**
 * Verifica y decodifica un access token.
 *
 * @param {string} token - JWT a verificar.
 * @returns {AccessPayload & { iat: number, exp: number }} Payload decodificado.
 * @throws {ApiError} 401 si el token es inválido o expiró.
 */
function verifyAccessToken(token) {
  try {
    return jwt.verify(token, config.jwt.accessSecret, {
      algorithms: [ALGORITHM],
    });
  } catch (err) {
    const message =
      err.name === 'TokenExpiredError'
        ? 'El token de acceso expiró'
        : 'Token de acceso inválido';
    throw ApiError.unauthorized(message);
  }
}

module.exports = { signAccessToken, verifyAccessToken };
