'use strict';

/**
 * @file Controller de WeeklyPlans: orquesta req/res, sin lógica de negocio.
 */

const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const weeklyPlanService = require('../services/weeklyPlan.service');

/** GET /weekly-plans — lista paginada con filtros. */
const list = asyncHandler(async (req, res) => {
  const { targetPosition, targetLevel, targetGoal, isPremium, isActive, page, limit } =
    req.query;
  const result = await weeklyPlanService.list(
    { targetPosition, targetLevel, targetGoal, isPremium, isActive },
    { page, limit }
  );
  return ApiResponse.success(res, result, 'Planes semanales obtenidos');
});

/** GET /weekly-plans/:id — detalle con rutinas pobladas. */
const getById = asyncHandler(async (req, res) => {
  const weeklyPlan = await weeklyPlanService.getById(req.params.id);
  return ApiResponse.success(res, { weeklyPlan }, 'Plan semanal obtenido');
});

/** POST /weekly-plans — crea (admin). */
const create = asyncHandler(async (req, res) => {
  const weeklyPlan = await weeklyPlanService.create(req.body, req.user.id);
  return ApiResponse.success(res, { weeklyPlan }, 'Plan semanal creado', 201);
});

/** PUT /weekly-plans/:id — actualiza (admin). */
const update = asyncHandler(async (req, res) => {
  const weeklyPlan = await weeklyPlanService.update(req.params.id, req.body);
  return ApiResponse.success(res, { weeklyPlan }, 'Plan semanal actualizado');
});

/** DELETE /weekly-plans/:id — soft delete (admin). */
const remove = asyncHandler(async (req, res) => {
  const result = await weeklyPlanService.remove(req.params.id);
  return ApiResponse.success(res, null, result.message);
});

module.exports = { list, getById, create, update, remove };
