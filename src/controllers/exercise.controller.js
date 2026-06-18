'use strict';

/**
 * @file Controller de Exercises: orquesta req/res, sin lógica de negocio.
 */

const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const exerciseService = require('../services/exercise.service');

/** GET /exercises — lista paginada con filtros. */
const list = asyncHandler(async (req, res) => {
  const { category, difficulty, tags, page, limit } = req.query;
  const result = await exerciseService.list(
    { category, difficulty, tags },
    { page, limit }
  );
  return ApiResponse.success(res, result, 'Ejercicios obtenidos');
});

/** GET /exercises/:id — detalle. */
const getById = asyncHandler(async (req, res) => {
  const exercise = await exerciseService.getById(req.params.id);
  return ApiResponse.success(res, { exercise }, 'Ejercicio obtenido');
});

/** POST /exercises — crea (admin). */
const create = asyncHandler(async (req, res) => {
  const exercise = await exerciseService.create(req.body);
  return ApiResponse.success(res, { exercise }, 'Ejercicio creado', 201);
});

/** PUT /exercises/:id — actualiza (admin). */
const update = asyncHandler(async (req, res) => {
  const exercise = await exerciseService.update(req.params.id, req.body);
  return ApiResponse.success(res, { exercise }, 'Ejercicio actualizado');
});

/** DELETE /exercises/:id — elimina (admin). */
const remove = asyncHandler(async (req, res) => {
  const result = await exerciseService.remove(req.params.id);
  return ApiResponse.success(res, null, result.message);
});

module.exports = { list, getById, create, update, remove };
