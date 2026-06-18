'use strict';

/**
 * @file Helper para respuestas exitosas con formato uniforme en toda la API.
 * Formato: { success: true, message, data }.
 */

const ApiResponse = {
  /**
   * Envía una respuesta exitosa estandarizada.
   *
   * @param {import('express').Response} res - Response de Express.
   * @param {*} [data=null] - Payload de datos.
   * @param {string} [message='OK'] - Mensaje legible.
   * @param {number} [statusCode=200] - Código HTTP.
   * @returns {import('express').Response} Response enviada.
   */
  success(res, data = null, message = 'OK', statusCode = 200) {
    return res.status(statusCode).json({
      success: true,
      message,
      data,
    });
  },
};

module.exports = ApiResponse;
