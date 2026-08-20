'use strict';

/**
 * @file Rutas del PlayerProfile, montadas bajo /api/v1/profile.
 * Todas requieren autenticación; operan sobre el perfil del usuario en sesión.
 */

const express = require('express');
const profileController = require('../controllers/profile.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { validate } = require('../middlewares/validate.middleware');
const { updateProfileSchema } = require('../validators/profile.validator');

const router = express.Router();

router.use(authenticate);

router.get('/', profileController.getProfile);

router.patch('/', validate(updateProfileSchema), profileController.updateProfile);

module.exports = router;
