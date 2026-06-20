'use strict';

/**
 * @file Lógica de negocio de WeeklyPlans (sin req/res).
 */

const { WeeklyPlan, Routine } = require('../models');
const ApiError = require('../utils/ApiError');

/**
 * Verifica que todos los routineId referenciados en los días existan.
 *
 * @param {Array<{ routines: string[] }>} days - Días del plan.
 * @returns {Promise<void>}
 * @throws {ApiError} 422 con el primer routineId inexistente.
 */
async function assertRoutinesExist(days) {
  const ids = [
    ...new Set(days.flatMap((d) => (d.routines || []).map(String))),
  ];
  if (ids.length === 0) return;
  const found = await Routine.find({ _id: { $in: ids } }).select('_id').lean();
  const foundSet = new Set(found.map((r) => String(r._id)));
  const missing = ids.find((id) => !foundSet.has(id));
  if (missing) {
    throw ApiError.unprocessable(`Rutina no encontrada: ${missing}`);
  }
}

/**
 * Crea un plan semanal, validando que sus rutinas existan.
 *
 * @param {Object} data - Datos validados (sin createdBy).
 * @param {string} adminId - Id del admin creador.
 * @returns {Promise<import('mongoose').Document>} Plan creado.
 * @throws {ApiError} 422 si alguna rutina no existe.
 */
async function create(data, adminId) {
  await assertRoutinesExist(data.days);
  return WeeklyPlan.create({ ...data, createdBy: adminId });
}

/**
 * Obtiene un plan por id con sus rutinas pobladas.
 *
 * @param {string} id - ObjectId.
 * @returns {Promise<import('mongoose').Document>} Plan.
 * @throws {ApiError} 404 si no existe.
 */
async function getById(id) {
  const plan = await WeeklyPlan.findById(id).populate('days.routines');
  if (!plan) throw ApiError.notFound('Plan semanal no encontrado');
  return plan;
}

/**
 * Lista planes con filtros opcionales y paginación.
 *
 * @param {Object} filters - Filtros.
 * @param {Object} pagination - { page, limit }.
 * @returns {Promise<{ weeklyPlans: object[], total: number, page: number, totalPages: number }>}
 */
async function list(filters, pagination) {
  const { page, limit } = pagination;
  const query = {};
  if (filters.targetPosition) query.targetPosition = { $in: [filters.targetPosition] };
  if (filters.targetLevel) query.targetLevel = { $in: [filters.targetLevel] };
  if (filters.targetGoal) query.targetGoal = { $in: [filters.targetGoal] };
  if (typeof filters.isPremium === 'boolean') query.isPremium = filters.isPremium;
  if (typeof filters.isActive === 'boolean') query.isActive = filters.isActive;

  const [weeklyPlans, total] = await Promise.all([
    WeeklyPlan.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    WeeklyPlan.countDocuments(query),
  ]);

  return {
    weeklyPlans,
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

/**
 * Actualiza un plan; si trae días, revalida sus rutinas.
 *
 * @param {string} id - ObjectId.
 * @param {Object} data - Campos parciales.
 * @returns {Promise<import('mongoose').Document>} Plan actualizado.
 * @throws {ApiError} 404 si no existe; 422 si alguna rutina no existe.
 */
async function update(id, data) {
  if (data.days) await assertRoutinesExist(data.days);
  const plan = await WeeklyPlan.findByIdAndUpdate(id, data, {
    new: true,
    runValidators: true,
  });
  if (!plan) throw ApiError.notFound('Plan semanal no encontrado');
  return plan;
}

/**
 * Soft delete: marca isActive=false (nunca hard delete, puede haber UserPlans
 * que referencian el plan).
 *
 * @param {string} id - ObjectId.
 * @returns {Promise<{ message: string }>} Confirmación.
 * @throws {ApiError} 404 si no existe.
 */
async function remove(id) {
  const plan = await WeeklyPlan.findByIdAndUpdate(
    id,
    { isActive: false },
    { new: true }
  );
  if (!plan) throw ApiError.notFound('Plan semanal no encontrado');
  return { message: 'Plan semanal desactivado correctamente' };
}

/**
 * Elige el WeeklyPlan activo con mayor match-score para un perfil.
 *
 * @param {import('mongoose').Document} playerProfile - Perfil con getMatchScore.
 * @returns {Promise<import('mongoose').Document|null>} Mejor plan o null.
 */
async function getRecommendedForProfile(playerProfile) {
  if (!playerProfile) return null;
  const plans = await WeeklyPlan.find({ isActive: true });
  if (plans.length === 0) return null;

  let best = null;
  let bestScore = -1;
  for (const plan of plans) {
    const score = playerProfile.getMatchScore(plan);
    if (score > bestScore) {
      bestScore = score;
      best = plan;
    }
  }
  return best;
}

module.exports = {
  create,
  getById,
  list,
  update,
  remove,
  getRecommendedForProfile,
};
