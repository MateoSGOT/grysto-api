'use strict';

/**
 * @file Controller de Auth: solo orquesta req/res. La lógica vive en el
 * service. El refresh token se entrega como cookie httpOnly Y en el body
 * (para clientes mobile que no usan cookies).
 */

const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const { config } = require('../config/env');
const authService = require('../services/auth.service');

const REFRESH_COOKIE = 'refreshToken';
const REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 días

/**
 * Opciones de la cookie del refresh token.
 *
 * @returns {import('express').CookieOptions} Opciones seguras.
 */
function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'strict',
    maxAge: REFRESH_COOKIE_MAX_AGE,
    path: '/api/v1/auth',
  };
}

/**
 * Lee el refresh token desde el body o la cookie.
 *
 * @param {import('express').Request} req - Request.
 * @returns {string|undefined} Refresh token en plano.
 */
function readRefreshToken(req) {
  return req.body?.refreshToken || req.cookies?.[REFRESH_COOKIE];
}

/** POST /auth/register */
const register = asyncHandler(async (req, res) => {
  const user = await authService.register(req.body, req.ip);
  return ApiResponse.success(
    res,
    { user },
    'Cuenta creada. Revisa tu email para verificarla.',
    201
  );
});

/** POST /auth/login */
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const { user, accessToken, refreshToken } = await authService.login(
    email,
    password,
    req.ip
  );

  res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
  return ApiResponse.success(
    res,
    { user, accessToken, refreshToken },
    'Inicio de sesión exitoso'
  );
});

/** POST /auth/verify-email */
const verifyEmail = asyncHandler(async (req, res) => {
  const { user, recommendedPlan } = await authService.verifyEmail(
    req.body.token
  );
  return ApiResponse.success(
    res,
    { user, recommendedPlan },
    'Email verificado correctamente'
  );
});

/** POST /auth/refresh */
const refresh = asyncHandler(async (req, res) => {
  const presented = readRefreshToken(req);
  if (!presented) {
    throw ApiError.unauthorized('No se proporcionó refresh token');
  }

  const { accessToken, refreshToken } = await authService.refreshToken(
    presented,
    req.ip
  );

  res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
  return ApiResponse.success(
    res,
    { accessToken, refreshToken },
    'Token renovado'
  );
});

/** POST /auth/logout (requiere autenticación) */
const logout = asyncHandler(async (req, res) => {
  const presented = readRefreshToken(req);
  const result = await authService.logout(presented);

  res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
  return ApiResponse.success(res, null, result.message);
});

/** POST /auth/forgot-password */
const forgotPassword = asyncHandler(async (req, res) => {
  await authService.forgotPassword(req.body.email);
  // Respuesta idéntica exista o no el email (anti-enumeración).
  return ApiResponse.success(
    res,
    null,
    'Si el email está registrado, recibirás instrucciones para recuperar tu contraseña.'
  );
});

/** POST /auth/reset-password */
const resetPassword = asyncHandler(async (req, res) => {
  const result = await authService.resetPassword(
    req.body.token,
    req.body.newPassword
  );
  return ApiResponse.success(res, null, result.message);
});

/** GET /auth/me (requiere autenticación) */
const me = asyncHandler(async (req, res) =>
  ApiResponse.success(res, { user: req.user.getPublicProfile() }, 'OK')
);

module.exports = {
  register,
  login,
  verifyEmail,
  refresh,
  logout,
  forgotPassword,
  resetPassword,
  me,
};
