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

router.use('/auth', require('./auth.routes'));
router.use('/exercises', require('./exercise.routes'));
router.use('/routines', require('./routine.routes'));
router.use('/weekly-plans', require('./weeklyPlan.routes'));
router.use('/my-plan', require('./userPlan.routes'));
router.use('/coach', require('./coach.routes'));

module.exports = router;
