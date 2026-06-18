'use strict';

/**
 * @file Middleware de validación con Zod. Valida una fuente del request
 * (body/query/params) y, si pasa, reemplaza esa fuente con los datos
 * parseados/saneados.
 */

const ApiError = require('../utils/ApiError');

/**
 * Mapea los issues de Zod a un formato de detalle uniforme en español.
 *
 * @param {import('zod').ZodError} error - Error de Zod.
 * @returns {Array<{ field: string, message: string }>} Detalle por campo.
 */
function formatIssues(error) {
  return error.issues.map((issue) => ({
    field: issue.path.length ? issue.path.join('.') : '(raíz)',
    message: issue.message,
  }));
}

/**
 * Factory de validación.
 *
 * @param {import('zod').ZodTypeAny} schema - Schema de Zod.
 * @param {'body'|'query'|'params'} [source='body'] - Fuente a validar.
 * @returns {import('express').RequestHandler} Middleware de validación.
 * @throws {ApiError} 422 con `details` si la validación falla.
 */
function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return next(
        ApiError.unprocessable('Error de validación', formatIssues(result.error))
      );
    }
    if (source === 'query') {
      // Express 5: req.query es un getter sin setter; no se puede reasignar.
      // Definimos una propiedad propia que sombrea el getter del prototipo.
      Object.defineProperty(req, 'query', {
        value: result.data,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    } else {
      req[source] = result.data;
    }
    return next();
  };
}

module.exports = { validate };
