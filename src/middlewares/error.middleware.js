'use strict';

/**
 * @file Middleware central de manejo de errores. Traduce ApiError, errores
 * de Mongoose y errores genéricos a respuestas JSON consistentes en español.
 * Formato: { success: false, message, details }.
 */

const mongoose = require('mongoose');
const ApiError = require('../utils/ApiError');
const { config } = require('../config/env');

/**
 * Normaliza un error de validación de Mongoose a ApiError 422.
 *
 * @param {mongoose.Error.ValidationError} err - Error de validación.
 * @returns {ApiError} Error 422 con detalle por campo.
 */
function fromValidationError(err) {
  const details = Object.values(err.errors).map((e) => ({
    field: e.path,
    message: e.message,
  }));
  return ApiError.unprocessable('Error de validación de datos', details);
}

/**
 * Normaliza un error de cast de Mongoose a ApiError 400.
 *
 * @param {mongoose.Error.CastError} err - Error de cast.
 * @returns {ApiError} Error 400.
 */
function fromCastError(err) {
  return ApiError.badRequest(`Valor inválido para el campo "${err.path}"`);
}

/**
 * Normaliza un error de clave duplicada (E11000) a ApiError 409.
 *
 * @param {Object} err - Error nativo de Mongo con keyValue.
 * @returns {ApiError} Error 409.
 */
function fromDuplicateKey(err) {
  const fields = err.keyValue ? Object.keys(err.keyValue) : [];
  const field = fields[0] || 'campo';
  return ApiError.conflict(`Ya existe un registro con ese ${field}`, {
    fields,
  });
}

/**
 * Convierte cualquier error a ApiError.
 *
 * @param {Error} err - Error original.
 * @returns {ApiError} Error normalizado.
 */
function normalize(err) {
  if (err instanceof ApiError) return err;
  if (err instanceof mongoose.Error.ValidationError) {
    return fromValidationError(err);
  }
  if (err instanceof mongoose.Error.CastError) return fromCastError(err);
  if (err && err.code === 11000) return fromDuplicateKey(err);
  if (err && (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError')) {
    return ApiError.unauthorized('Token inválido o expirado');
  }
  return ApiError.internal();
}

/**
 * Middleware de errores de Express (firma de 4 argumentos).
 *
 * @param {Error} err - Error capturado.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @param {import('express').NextFunction} next - Next (requerido por Express).
 * @returns {import('express').Response} Respuesta de error.
 */
// eslint-disable-next-line no-unused-vars
function errorMiddleware(err, req, res, next) {
  const apiError = normalize(err);

  // Loguear errores no operacionales (bugs) con stack completo.
  if (!apiError.isOperational || apiError.statusCode >= 500) {
    // eslint-disable-next-line no-console
    console.error('✗ [error]', err.stack || err.message || err);
  }

  const body = {
    success: false,
    message: apiError.message,
  };

  if (apiError.details) body.details = apiError.details;
  if (!config.isProduction) body.stack = err.stack;

  return res.status(apiError.statusCode).json(body);
}

module.exports = errorMiddleware;
