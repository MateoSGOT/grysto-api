'use strict';

/**
 * @file Lógica de negocio de Routines (sin req/res), incluyendo el control de
 * acceso premium/preview reutilizable.
 */

const { Routine, Exercise } = require('../models');
const ApiError = require('../utils/ApiError');

/**
 * Verifica que todos los exerciseId referenciados existan en la colección.
 *
 * @param {Array<{ exerciseId: string }>} exercises - Sub-ejercicios.
 * @returns {Promise<void>}
 * @throws {ApiError} 422 con el primer exerciseId inexistente.
 */
async function assertExercisesExist(exercises) {
  if (!exercises || exercises.length === 0) return;
  const ids = [...new Set(exercises.map((e) => String(e.exerciseId)))];
  const found = await Exercise.find({ _id: { $in: ids } }).select('_id').lean();
  const foundSet = new Set(found.map((d) => String(d._id)));
  const missing = ids.find((id) => !foundSet.has(id));
  if (missing) {
    throw ApiError.unprocessable(`Ejercicio no encontrado: ${missing}`);
  }
}

/**
 * Aplica el control de acceso premium/preview a una rutina (objeto plano).
 *
 * - Rutina no premium → completa.
 * - Premium + usuario con premium activo → completa.
 * - Premium + usuario free → preview (sin ejercicios, locked: true).
 *
 * @param {Object} routine - Rutina como objeto plano (lean/toObject).
 * @param {import('mongoose').Document} user - Usuario autenticado (req.user).
 * @returns {Object} Rutina completa o su versión preview.
 */
function applyAccessControl(routine, user) {
  if (!routine.isPremium) return { ...routine, locked: false };

  const premiumActive = Boolean(user?.fullPlan?.isPremiumActive);
  if (premiumActive) return { ...routine, locked: false };

  return {
    _id: routine._id,
    title: routine.title,
    description: routine.description,
    duration_min: routine.duration_min,
    isPremium: routine.isPremium,
    level: routine.level,
    category: routine.category,
    coverImage: routine.coverImage,
    locked: true,
    exercises: [],
  };
}

/**
 * Crea una rutina, validando que sus ejercicios existan.
 *
 * @param {Object} data - Datos validados de la rutina (sin createdBy).
 * @param {string} adminId - Id del admin creador (req.user.id).
 * @returns {Promise<import('mongoose').Document>} Rutina creada.
 * @throws {ApiError} 422 si algún exerciseId no existe.
 */
async function create(data, adminId) {
  await assertExercisesExist(data.exercises);
  return Routine.create({ ...data, createdBy: adminId });
}

/**
 * Obtiene una rutina por id con sus ejercicios poblados y control de acceso.
 *
 * @param {string} id - ObjectId.
 * @param {import('mongoose').Document} user - Usuario autenticado.
 * @returns {Promise<Object>} Rutina (completa o preview).
 * @throws {ApiError} 404 si no existe.
 */
async function getById(id, user) {
  const routine = await Routine.findById(id)
    .populate('exercises.exerciseId')
    .lean();
  if (!routine) throw ApiError.notFound('Rutina no encontrada');
  return applyAccessControl(routine, user);
}

/**
 * Lista rutinas con filtros, paginación y control de acceso por usuario.
 *
 * @param {Object} filters - Filtros (level, category, isPremium, targetPositions).
 * @param {Object} pagination - { page, limit }.
 * @param {import('mongoose').Document} user - Usuario autenticado.
 * @returns {Promise<{ routines: object[], total: number, page: number, totalPages: number }>}
 */
async function list(filters, pagination, user) {
  const { page, limit } = pagination;
  const query = {};
  if (filters.level) query.level = filters.level;
  if (filters.category) query.category = filters.category;
  if (typeof filters.isPremium === 'boolean') query.isPremium = filters.isPremium;
  if (filters.targetPositions && filters.targetPositions.length) {
    query.targetPositions = { $in: filters.targetPositions };
  }

  const [docs, total] = await Promise.all([
    Routine.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('exercises.exerciseId')
      .lean(),
    Routine.countDocuments(query),
  ]);

  return {
    routines: docs.map((r) => applyAccessControl(r, user)),
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

/**
 * Actualiza una rutina; si trae ejercicios, revalida que existan.
 *
 * @param {string} id - ObjectId.
 * @param {Object} data - Campos parciales.
 * @returns {Promise<import('mongoose').Document>} Rutina actualizada.
 * @throws {ApiError} 404 si no existe; 422 si algún exerciseId no existe.
 */
async function update(id, data) {
  if (data.exercises) await assertExercisesExist(data.exercises);
  const routine = await Routine.findByIdAndUpdate(id, data, {
    new: true,
    runValidators: true,
  });
  if (!routine) throw ApiError.notFound('Rutina no encontrada');
  return routine;
}

/**
 * Elimina una rutina.
 *
 * @param {string} id - ObjectId.
 * @returns {Promise<{ message: string }>} Confirmación.
 * @throws {ApiError} 404 si no existe.
 */
async function remove(id) {
  const routine = await Routine.findByIdAndDelete(id);
  if (!routine) throw ApiError.notFound('Rutina no encontrada');
  return { message: 'Rutina eliminada correctamente' };
}

module.exports = {
  applyAccessControl,
  create,
  getById,
  list,
  update,
  remove,
};
