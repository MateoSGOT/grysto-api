'use strict';

/**
 * @file Rutas del Coach IA, montadas bajo /api/v1/coach. Todas requieren auth.
 */

const express = require('express');
const coachController = require('../controllers/coach.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { validate } = require('../middlewares/validate.middleware');
const { coachLimiter } = require('../middlewares/rateLimit.middleware');
const {
  chatSchema,
  conversationIdParamSchema,
} = require('../validators/coach.validator');

const router = express.Router();

router.use(authenticate);

router.post('/chat', coachLimiter, validate(chatSchema), coachController.chat);

router.get('/conversations', coachController.getConversations);

router.post('/conversations', coachController.newConversation);

router.get(
  '/conversations/:id',
  validate(conversationIdParamSchema, 'params'),
  coachController.getConversation
);

router.patch(
  '/conversations/:id/archive',
  validate(conversationIdParamSchema, 'params'),
  coachController.archiveConversation
);

module.exports = router;
