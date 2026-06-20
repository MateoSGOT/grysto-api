'use strict';

/**
 * @file Rutas de WeeklyPlans, montadas bajo /api/v1/weekly-plans.
 * Lectura: cualquier autenticado. Escritura: solo admin.
 */

const express = require('express');
const weeklyPlanController = require('../controllers/weeklyPlan.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/role.middleware');
const { validate } = require('../middlewares/validate.middleware');
const { ROLES } = require('../constants/enums');
const {
  createWeeklyPlanSchema,
  updateWeeklyPlanSchema,
  listWeeklyPlansQuerySchema,
} = require('../validators/weeklyPlan.validator');

const router = express.Router();

router.get(
  '/',
  authenticate,
  validate(listWeeklyPlansQuerySchema, 'query'),
  weeklyPlanController.list
);

router.get('/:id', authenticate, weeklyPlanController.getById);

router.post(
  '/',
  authenticate,
  requireRole(ROLES.ADMIN),
  validate(createWeeklyPlanSchema),
  weeklyPlanController.create
);

router.put(
  '/:id',
  authenticate,
  requireRole(ROLES.ADMIN),
  validate(updateWeeklyPlanSchema),
  weeklyPlanController.update
);

router.delete(
  '/:id',
  authenticate,
  requireRole(ROLES.ADMIN),
  weeklyPlanController.remove
);

module.exports = router;
