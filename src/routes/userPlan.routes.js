'use strict';

/**
 * @file Rutas de UserPlans, montadas bajo /api/v1/my-plan.
 * Todas requieren autenticación; operan sobre el plan del usuario en sesión.
 */

const express = require('express');
const userPlanController = require('../controllers/userPlan.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { validate } = require('../middlewares/validate.middleware');
const {
  activatePlanSchema,
  confirmDaySchema,
  confirmLoadSchema,
  adjustLoadSchema,
} = require('../validators/userPlan.validator');

const router = express.Router();

router.use(authenticate);

router.get('/', userPlanController.getActivePlan);

router.post('/activate', validate(activatePlanSchema), userPlanController.activatePlan);

router.post('/abandon', userPlanController.abandonPlan);

router.post('/confirm-day', validate(confirmDaySchema), userPlanController.confirmDay);

router.post('/confirm-load', validate(confirmLoadSchema), userPlanController.confirmLoad);

router.post('/adjust-load', validate(adjustLoadSchema), userPlanController.adjustLoad);

router.get('/progression-preview', userPlanController.progressionPreview);

module.exports = router;
