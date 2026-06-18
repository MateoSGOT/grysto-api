'use strict';

/**
 * @file Middleware de autenticación: valida el access token (Bearer),
 * carga el usuario real desde la DB y lo inyecta en req.user.
 */

const { verifyAccessToken } = require('../utils/jwt.util');
const { User } = require('../models');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

/**
 * Extrae el token Bearer del header Authorization.
 *
 * @param {import('express').Request} req - Request.
 * @returns {string|null} Token o null si no está presente.
 */
function extractBearer(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token || null;
}

/**
 * Requiere un access token válido. Inyecta el documento completo del
 * usuario en req.user.
 *
 * @type {import('express').RequestHandler}
 * @throws {ApiError} 401 si no hay token, es inválido o el usuario no existe/está inactivo.
 */
const authenticate = asyncHandler(async (req, _res, next) => {
  const token = extractBearer(req);
  if (!token) {
    throw ApiError.unauthorized('No se proporcionó token de acceso');
  }

  const payload = verifyAccessToken(token); // lanza ApiError 401 si falla

  const user = await User.findById(payload.sub);
  if (!user) {
    throw ApiError.unauthorized('La cuenta asociada al token no existe');
  }
  if (!user.isActive) {
    throw ApiError.unauthorized('Cuenta desactivada');
  }

  req.user = user;
  return next();
});

module.exports = { authenticate };
