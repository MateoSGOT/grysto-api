'use strict';

/**
 * @file Rutas de Routines, montadas bajo /api/v1/routines.
 * Lectura: cualquier usuario autenticado (con preview premium).
 * Escritura: solo admin.
 */

const express = require('express');
const routineController = require('../controllers/routine.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/role.middleware');
const { validate } = require('../middlewares/validate.middleware');
const { ROLES } = require('../constants/enums');
const {
  createRoutineSchema,
  updateRoutineSchema,
  listRoutinesQuerySchema,
} = require('../validators/routine.validator');
const { idParamSchema } = require('../validators/common.validator');

const router = express.Router();

router.get(
  '/',
  authenticate,
  validate(listRoutinesQuerySchema, 'query'),
  routineController.list
);

router.get(
  '/:id',
  authenticate,
  validate(idParamSchema, 'params'),
  routineController.getById
);

router.post(
  '/',
  authenticate,
  requireRole(ROLES.ADMIN),
  validate(createRoutineSchema),
  routineController.create
);

router.put(
  '/:id',
  authenticate,
  requireRole(ROLES.ADMIN),
  validate(idParamSchema, 'params'),
  validate(updateRoutineSchema),
  routineController.update
);

router.delete(
  '/:id',
  authenticate,
  requireRole(ROLES.ADMIN),
  validate(idParamSchema, 'params'),
  routineController.remove
);

module.exports = router;
