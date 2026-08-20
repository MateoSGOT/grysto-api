'use strict';

/**
 * @file Lógica de negocio del PlayerProfile (sin req/res).
 */

const { PlayerProfile } = require('../models');
const ApiError = require('../utils/ApiError');

/**
 * Devuelve el PlayerProfile del usuario.
 *
 * @param {string} userId - Usuario autenticado.
 * @returns {Promise<Object>} Perfil.
 * @throws {ApiError} 404 si no tiene perfil.
 */
async function getProfile(userId) {
  const profile = await PlayerProfile.findOne({ userId }).lean();
  if (!profile) throw ApiError.notFound('Perfil no encontrado');
  return profile;
}

/**
 * Actualiza SOLO los datos físicos (peso/altura/edad). El resto del perfil
 * define el plan y no se toca (el validator Zod ya rechaza otros campos).
 *
 * @param {string} userId - Usuario.
 * @param {{ height?: number, weight?: number, age?: number }} data - Cambios.
 * @returns {Promise<Object>} Perfil actualizado.
 * @throws {ApiError} 404 si no tiene perfil.
 */
async function updatePhysical(userId, data) {
  const profile = await PlayerProfile.findOneAndUpdate(
    { userId },
    { $set: data },
    { new: true, runValidators: true }
  ).lean();
  if (!profile) throw ApiError.notFound('Perfil no encontrado');
  return profile;
}

module.exports = { getProfile, updatePhysical };
