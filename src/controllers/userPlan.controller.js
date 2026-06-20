'use strict';

/**
 * @file Controller de UserPlans (mi plan): orquesta req/res, sin lógica.
 */

const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const userPlanService = require('../services/userPlan.service');

/** GET /my-plan — plan activo del usuario (o null). */
const getActivePlan = asyncHandler(async (req, res) => {
  const plan = await userPlanService.getActivePlan(req.user.id);
  return ApiResponse.success(
    res,
    { plan },
    plan ? 'Plan activo obtenido' : 'No tienes un plan activo'
  );
});

/** POST /my-plan/activate — activa un plan del catálogo. */
const activatePlan = asyncHandler(async (req, res) => {
  const plan = await userPlanService.activatePlan(req.user.id, req.body.weeklyPlanId);
  return ApiResponse.success(res, { plan }, 'Plan activado', 201);
});

/** POST /my-plan/abandon — abandona el plan (premium). */
const abandonPlan = asyncHandler(async (req, res) => {
  const plan = await userPlanService.abandonPlan(req.user.id, req.body?.userPlanId);
  return ApiResponse.success(res, { plan }, 'Plan abandonado');
});

/** POST /my-plan/confirm-day — confirma un día del ciclo actual. */
const confirmDay = asyncHandler(async (req, res) => {
  const result = await userPlanService.confirmDay(req.user.id, req.body.dayNumber);
  return ApiResponse.success(
    res,
    {
      cycleCompleted: result.cycleCompleted,
      currentCycle: result.currentCycle,
      plan: result.plan,
    },
    result.message
  );
});

/** POST /my-plan/confirm-load — registra la carga real realizada. */
const confirmLoad = asyncHandler(async (req, res) => {
  const load = await userPlanService.confirmLoad(
    req.user.id,
    req.body.exerciseId,
    req.body.actualValue
  );
  return ApiResponse.success(res, { load }, 'Carga confirmada');
});

/** POST /my-plan/adjust-load — ajusta la carga sugerida. */
const adjustLoad = asyncHandler(async (req, res) => {
  const load = await userPlanService.adjustSuggestedLoad(
    req.user.id,
    req.body.exerciseId,
    req.body.newValue
  );
  return ApiResponse.success(res, { load }, 'Carga ajustada');
});

/** GET /my-plan/progression-preview — preview de la sobrecarga del próximo ciclo. */
const progressionPreview = asyncHandler(async (req, res) => {
  const preview = await userPlanService.getProgressionPreview(req.user.id);
  return ApiResponse.success(res, preview, 'Preview de progresión');
});

module.exports = {
  getActivePlan,
  activatePlan,
  abandonPlan,
  confirmDay,
  confirmLoad,
  adjustLoad,
  progressionPreview,
};
