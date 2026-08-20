'use strict';

/**
 * @file Controller del PlayerProfile: orquesta req/res, sin lógica de negocio.
 */

const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const profileService = require('../services/profile.service');

/** GET /profile — perfil deportivo del usuario. */
const getProfile = asyncHandler(async (req, res) => {
  const profile = await profileService.getProfile(req.user.id);
  return ApiResponse.success(res, { profile }, 'Perfil obtenido');
});

/** PATCH /profile — actualiza solo peso/altura/edad. */
const updateProfile = asyncHandler(async (req, res) => {
  const profile = await profileService.updatePhysical(req.user.id, req.body);
  return ApiResponse.success(res, { profile }, 'Perfil actualizado');
});

module.exports = { getProfile, updateProfile };
