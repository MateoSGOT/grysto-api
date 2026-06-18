'use strict';

/**
 * @file Controller de Routines: orquesta req/res, sin lógica de negocio.
 */

const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const routineService = require('../services/routine.service');

/** GET /routines — lista paginada con preview según plan. */
const list = asyncHandler(async (req, res) => {
  const { level, category, isPremium, targetPositions, page, limit } = req.query;
  const result = await routineService.list(
    { level, category, isPremium, targetPositions },
    { page, limit },
    req.user
  );
  return ApiResponse.success(res, result, 'Rutinas obtenidas');
});

/** GET /routines/:id — detalle con control de acceso. */
const getById = asyncHandler(async (req, res) => {
  const routine = await routineService.getById(req.params.id, req.user);
  return ApiResponse.success(res, { routine }, 'Rutina obtenida');
});

/** POST /routines — crea (admin); createdBy = req.user.id. */
const create = asyncHandler(async (req, res) => {
  const routine = await routineService.create(req.body, req.user.id);
  return ApiResponse.success(res, { routine }, 'Rutina creada', 201);
});

/** PUT /routines/:id — actualiza (admin). */
const update = asyncHandler(async (req, res) => {
  const routine = await routineService.update(req.params.id, req.body);
  return ApiResponse.success(res, { routine }, 'Rutina actualizada');
});

/** DELETE /routines/:id — elimina (admin). */
const remove = asyncHandler(async (req, res) => {
  const result = await routineService.remove(req.params.id);
  return ApiResponse.success(res, null, result.message);
});

module.exports = { list, getById, create, update, remove };
