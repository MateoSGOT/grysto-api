'use strict';

/**
 * @file Controller de WeeklyPlans: orquesta req/res, sin lógica de negocio.
 */

const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const weeklyPlanService = require('../services/weeklyPlan.service');
const userPlanService = require('../services/userPlan.service');

/** GET /weekly-plans — lista paginada con filtros + `isCurrentPlan` por item. */
const list = asyncHandler(async (req, res) => {
  const {
    targetPosition,
    targetLevel,
    targetGoal,
    position,
    level,
    goal,
    isPremium,
    isActive,
    page,
    limit,
  } = req.query;
  const result = await weeklyPlanService.list(
    { targetPosition, targetLevel, targetGoal, position, level, goal, isPremium, isActive },
    { page, limit },
    req.user.id
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

/** GET /weekly-plans/:id/change-preview — matches de carga con el plan destino. */
const changePreview = asyncHandler(async (req, res) => {
  const preview = await userPlanService.changePreview(
    req.user.id,
    req.params.id
  );
  return ApiResponse.success(res, preview, 'Preview de cambio de plan');
});

/** POST /weekly-plans/:id/change — confirma el cambio (premium, transacción). */
const changePlan = asyncHandler(async (req, res) => {
  const plan = await userPlanService.changePlan(
    req.user.id,
    req.params.id,
    req.body.decisions
  );
  return ApiResponse.success(res, { plan }, 'Plan cambiado correctamente', 201);
});

module.exports = { list, getById, create, update, remove, changePreview, changePlan };
