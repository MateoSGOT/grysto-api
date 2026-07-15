'use strict';

/**
 * @file Rutas de Exercises, montadas bajo /api/v1/exercises.
 * Lectura: cualquier usuario autenticado. Escritura: solo admin.
 */

const express = require('express');
const exerciseController = require('../controllers/exercise.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/role.middleware');
const { validate } = require('../middlewares/validate.middleware');
const { ROLES } = require('../constants/enums');
const {
  createExerciseSchema,
  updateExerciseSchema,
  listExercisesQuerySchema,
} = require('../validators/exercise.validator');
const { idParamSchema } = require('../validators/common.validator');

const router = express.Router();

router.get(
  '/',
  authenticate,
  validate(listExercisesQuerySchema, 'query'),
  exerciseController.list
);

router.get(
  '/:id',
  authenticate,
  validate(idParamSchema, 'params'),
  exerciseController.getById
);

router.get(
  '/:id/alternatives',
  authenticate,
  validate(idParamSchema, 'params'),
  exerciseController.alternatives
);

router.post(
  '/',
  authenticate,
  requireRole(ROLES.ADMIN),
  validate(createExerciseSchema),
  exerciseController.create
);

router.put(
  '/:id',
  authenticate,
  requireRole(ROLES.ADMIN),
  validate(idParamSchema, 'params'),
  validate(updateExerciseSchema),
  exerciseController.update
);

router.delete(
  '/:id',
  authenticate,
  requireRole(ROLES.ADMIN),
  validate(idParamSchema, 'params'),
  exerciseController.remove
);

module.exports = router;
