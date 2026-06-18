'use strict';

/**
 * @file Error operacional de la API. Cualquier error esperado/controlado
 * debe lanzarse con esta clase para que el error middleware lo traduzca
 * a una respuesta HTTP limpia y consistente.
 */

class ApiError extends Error {
  /**
   * @param {number} statusCode - Código HTTP de la respuesta.
   * @param {string} message - Mensaje legible (en español).
   * @param {*} [details=null] - Detalle adicional (errores de campo, etc.).
   */
  constructor(statusCode, message, details = null) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.details = details;
    /** Marca un error esperado, no un bug. */
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * @param {string} [message='Solicitud inválida'] - Mensaje.
   * @param {*} [details=null] - Detalle.
   * @returns {ApiError} 400 Bad Request.
   */
  static badRequest(message = 'Solicitud inválida', details = null) {
    return new ApiError(400, message, details);
  }

  /**
   * @param {string} [message='No autenticado'] - Mensaje.
   * @param {*} [details=null] - Detalle.
   * @returns {ApiError} 401 Unauthorized.
   */
  static unauthorized(message = 'No autenticado', details = null) {
    return new ApiError(401, message, details);
  }

  /**
   * @param {string} [message='No autorizado'] - Mensaje.
   * @param {*} [details=null] - Detalle.
   * @returns {ApiError} 403 Forbidden.
   */
  static forbidden(message = 'No autorizado', details = null) {
    return new ApiError(403, message, details);
  }

  /**
   * @param {string} [message='Recurso no encontrado'] - Mensaje.
   * @param {*} [details=null] - Detalle.
   * @returns {ApiError} 404 Not Found.
   */
  static notFound(message = 'Recurso no encontrado', details = null) {
    return new ApiError(404, message, details);
  }

  /**
   * @param {string} [message='Conflicto con el estado actual'] - Mensaje.
   * @param {*} [details=null] - Detalle.
   * @returns {ApiError} 409 Conflict.
   */
  static conflict(message = 'Conflicto con el estado actual', details = null) {
    return new ApiError(409, message, details);
  }

  /**
   * @param {string} [message='Entidad no procesable'] - Mensaje.
   * @param {*} [details=null] - Detalle.
   * @returns {ApiError} 422 Unprocessable Entity.
   */
  static unprocessable(message = 'Entidad no procesable', details = null) {
    return new ApiError(422, message, details);
  }

  /**
   * @param {string} [message='Demasiadas solicitudes'] - Mensaje.
   * @param {*} [details=null] - Detalle.
   * @returns {ApiError} 429 Too Many Requests.
   */
  static tooMany(message = 'Demasiadas solicitudes', details = null) {
    return new ApiError(429, message, details);
  }

  /**
   * @param {string} [message='Error interno del servidor'] - Mensaje.
   * @param {*} [details=null] - Detalle.
   * @returns {ApiError} 500 Internal Server Error.
   */
  static internal(message = 'Error interno del servidor', details = null) {
    return new ApiError(500, message, details);
  }
}

module.exports = ApiError;
