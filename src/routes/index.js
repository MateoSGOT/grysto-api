'use strict';

/**
 * @file Router central de la API (montado en /api/v1).
 * Preparado para montar /auth en la siguiente fase.
 */

const express = require('express');
const { health } = require('../controllers/health.controller');

const router = express.Router();

/**
 * GET /api/v1/health — alias del health check de la raíz (`/health`).
 */
router.get('/health', health);

router.use('/auth', require('./auth.routes'));
router.use('/profile', require('./profile.routes'));
router.use('/exercises', require('./exercise.routes'));
router.use('/routines', require('./routine.routes'));
router.use('/weekly-plans', require('./weeklyPlan.routes'));
router.use('/my-plan', require('./userPlan.routes'));
router.use('/coach', require('./coach.routes'));

module.exports = router;
