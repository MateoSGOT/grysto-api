'use strict';

/**
 * @file Router central de la API (montado en /api/v1).
 * Preparado para montar /auth en la siguiente fase.
 */

const express = require('express');
const ApiResponse = require('../utils/ApiResponse');

const router = express.Router();

/**
 * GET /api/v1/health — healthcheck del servicio.
 */
router.get('/health', (req, res) =>
  ApiResponse.success(
    res,
    { status: 'ok', timestamp: new Date().toISOString() },
    'GRYSTO API operativa'
  )
);

// Próxima fase:
// router.use('/auth', require('./auth.routes'));

module.exports = router;
