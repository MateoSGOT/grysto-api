'use strict';

/**
 * @file Access log mínimo: una línea por request con método, ruta (SIN query
 * string), status y duración. No registra headers, body, query, IP ni
 * usuario: nada de contraseñas, tokens, códigos ni datos personales.
 */

/**
 * Ruta sin query string (ahí podrían viajar datos que no deben loguearse).
 *
 * @param {import('express').Request} req - Request.
 * @returns {string} Ruta.
 */
function pathOf(req) {
  return (req.originalUrl || req.url || '').split('?')[0];
}

/**
 * Crea el middleware de access log.
 *
 * @param {Object} [opts] - Opciones.
 * @param {(line: string) => void} [opts.log] - Destino de la línea (default: console.log).
 * @returns {import('express').RequestHandler} Middleware.
 */
function accessLog({ log = console.log } = {}) {
  return (req, res, next) => {
    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
      log(`→ ${req.method} ${pathOf(req)} ${res.statusCode} ${ms.toFixed(0)}ms`);
    });
    next();
  };
}

module.exports = { accessLog };
