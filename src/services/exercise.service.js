'use strict';

/**
 * @file Lógica de negocio de Exercises (sin req/res).
 */

const { Exercise, Routine } = require('../models');
const ApiError = require('../utils/ApiError');

/**
 * Crea un ejercicio.
 *
 * @param {Object} data - Datos validados del ejercicio.
 * @returns {Promise<import('mongoose').Document>} Ejercicio creado.
 */
async function create(data) {
  return Exercise.create(data);
}

/**
 * Obtiene un ejercicio por id.
 *
 * @param {string} id - ObjectId del ejercicio.
 * @returns {Promise<import('mongoose').Document>} Ejercicio.
 * @throws {ApiError} 404 si no existe.
 */
async function getById(id) {
  const exercise = await Exercise.findById(id);
  if (!exercise) throw ApiError.notFound('Ejercicio no encontrado');
  return exercise;
}

/**
 * Lista ejercicios con filtros opcionales y paginación.
 *
 * @param {Object} filters - Filtros.
 * @param {string} [filters.category] - Categoría.
 * @param {string} [filters.difficulty] - Dificultad.
 * @param {string[]} [filters.tags] - Tags (match por $in).
 * @param {Object} pagination - Paginación.
 * @param {number} pagination.page - Página (1-based).
 * @param {number} pagination.limit - Tamaño de página.
 * @returns {Promise<{ exercises: object[], total: number, page: number, totalPages: number }>}
 */
async function list(filters, pagination) {
  const { page, limit } = pagination;
  const query = {};
  if (filters.category) query.category = filters.category;
  if (filters.difficulty) query.difficulty = filters.difficulty;
  if (filters.tags && filters.tags.length) query.tags = { $in: filters.tags };

  const [exercises, total] = await Promise.all([
    Exercise.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Exercise.countDocuments(query),
  ]);

  return {
    exercises,
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

/**
 * Actualiza un ejercicio.
 *
 * @param {string} id - ObjectId.
 * @param {Object} data - Campos a actualizar (parciales).
 * @returns {Promise<import('mongoose').Document>} Ejercicio actualizado.
 * @throws {ApiError} 404 si no existe.
 */
async function update(id, data) {
  const exercise = await Exercise.findByIdAndUpdate(id, data, {
    new: true,
    runValidators: true,
  });
  if (!exercise) throw ApiError.notFound('Ejercicio no encontrado');
  return exercise;
}

/**
 * Elimina un ejercicio, salvo que esté referenciado por alguna rutina.
 *
 * @param {string} id - ObjectId.
 * @returns {Promise<{ message: string }>} Confirmación.
 * @throws {ApiError} 404 si no existe; 409 si está en uso por una rutina.
 */
async function remove(id) {
  const exercise = await Exercise.findById(id);
  if (!exercise) throw ApiError.notFound('Ejercicio no encontrado');

  const inUse = await Routine.exists({ 'exercises.exerciseId': id });
  if (inUse) {
    throw ApiError.conflict('Ejercicio en uso por una o más rutinas');
  }

  await exercise.deleteOne();
  return { message: 'Ejercicio eliminado correctamente' };
}

module.exports = { create, getById, list, update, remove };
