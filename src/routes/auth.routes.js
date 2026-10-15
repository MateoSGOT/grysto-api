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
  codeSendLimiter,
  codeVerifyLimiter,
} = require('../middlewares/rateLimit.middleware');
const {
  registerSchema,
  loginSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  refreshTokenSchema,
  deleteAccountSchema,
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
  codeVerifyLimiter,
  validate(verifyEmailSchema),
  authController.verifyEmail
);

router.post(
  '/resend-verification',
  codeSendLimiter,
  validate(resendVerificationSchema),
  authController.resendVerification
);

router.post(
  '/refresh',
  validate(refreshTokenSchema),
  authController.refresh
);

router.post('/logout', authenticate, authController.logout);

router.post(
  '/forgot-password',
  codeSendLimiter,
  validate(forgotPasswordSchema),
  authController.forgotPassword
);

router.post(
  '/reset-password',
  codeVerifyLimiter,
  validate(resetPasswordSchema),
  authController.resetPassword
);

router.get('/me', authenticate, authController.me);

router.delete(
  '/account',
  authenticate,
  validate(deleteAccountSchema),
  authController.deleteAccount
);

module.exports = router;
