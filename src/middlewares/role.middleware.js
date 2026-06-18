'use strict';

/**
 * @file Middleware de autorización por rol. Debe usarse SIEMPRE después de
 * `authenticate`, que es quien puebla req.user.
 */

const ApiError = require('../utils/ApiError');

/**
 * Factory que restringe el acceso a los roles indicados.
 *
 * @param {...string} roles - Roles permitidos (enum ROLES).
 * @returns {import('express').RequestHandler} Middleware de autorización.
 * @throws {ApiError} 401 si no hay usuario; 403 si el rol no está permitido.
 */
function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(ApiError.unauthorized('No autenticado'));
    }
    if (!roles.includes(req.user.role)) {
      return next(ApiError.forbidden('No tienes permiso para esta acción'));
    }
    return next();
  };
}

module.exports = { requireRole };
