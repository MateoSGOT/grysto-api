'use strict';

/**
 * @file Rutas de autenticación, montadas bajo /api/v1/auth.
 */

const express = require('express');
const authController = require('../controllers/auth.controller');
const { validate } = require('../middlewares/validate.middleware');
const { authenticate } = require('../middlewares/auth.middleware');
const {
  loginLimiter,
  registerLimiter,
  forgotPasswordLimiter,
} = require('../middlewares/rateLimit.middleware');
const {
  registerSchema,
  loginSchema,
  verifyEmailSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  refreshTokenSchema,
} = require('../validators/auth.validator');

const router = express.Router();

router.post(
  '/register',
  registerLimiter,
  validate(registerSchema),
  authController.register
);

router.post('/login', loginLimiter, validate(loginSchema), authController.login);

router.post(
  '/verify-email',
  validate(verifyEmailSchema),
  authController.verifyEmail
);

router.post(
  '/refresh',
  validate(refreshTokenSchema),
  authController.refresh
);

router.post('/logout', authenticate, authController.logout);

router.post(
  '/forgot-password',
  forgotPasswordLimiter,
  validate(forgotPasswordSchema),
  authController.forgotPassword
);

router.post(
  '/reset-password',
  validate(resetPasswordSchema),
  authController.resetPassword
);

router.get('/me', authenticate, authController.me);

module.exports = router;
