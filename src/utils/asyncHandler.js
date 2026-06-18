'use strict';

/**
 * @file Wrapper para controladores async. Captura cualquier rechazo de
 * promesa y lo delega a `next()` para que lo procese el error middleware,
 * evitando try/catch repetidos en cada controlador.
 */

/**
 * Envuelve un handler async de Express.
 *
 * @param {(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => Promise<*>} fn
 *   Controlador async a envolver.
 * @returns {import('express').RequestHandler} Handler con captura de errores.
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;
