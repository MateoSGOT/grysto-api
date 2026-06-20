'use strict';

/**
 * @file Controller del Coach IA: orquesta req/res, sin lógica de negocio.
 */

const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const aiService = require('../services/ai/ai.service');

/** POST /coach/chat — envía un mensaje y devuelve la respuesta del coach. */
const chat = asyncHandler(async (req, res) => {
  const result = await aiService.chat(req.user.id, req.body.message);
  return ApiResponse.success(res, result, 'Respuesta del Coach IA');
});

/** GET /coach/conversations — lista las conversaciones del usuario. */
const getConversations = asyncHandler(async (req, res) => {
  const conversations = await aiService.getConversations(req.user.id);
  return ApiResponse.success(res, { conversations }, 'Conversaciones obtenidas');
});

/** GET /coach/conversations/:id — una conversación con sus mensajes. */
const getConversation = asyncHandler(async (req, res) => {
  const conversation = await aiService.getConversation(
    req.user.id,
    req.params.id
  );
  return ApiResponse.success(res, { conversation }, 'Conversación obtenida');
});

/** POST /coach/conversations — crea una conversación vacía. */
const newConversation = asyncHandler(async (req, res) => {
  const conversation = await aiService.newConversation(req.user.id);
  return ApiResponse.success(res, { conversation }, 'Conversación creada', 201);
});

/** PATCH /coach/conversations/:id/archive — archiva una conversación. */
const archiveConversation = asyncHandler(async (req, res) => {
  const conversation = await aiService.archiveConversation(
    req.user.id,
    req.params.id
  );
  return ApiResponse.success(res, { conversation }, 'Conversación archivada');
});

module.exports = {
  chat,
  getConversations,
  getConversation,
  newConversation,
  archiveConversation,
};
