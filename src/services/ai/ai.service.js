'use strict';

/**
 * @file Fachada del Coach IA: selecciona el proveedor según la config y
 * orquesta el flujo de chat (contexto, perfil, persistencia y métricas).
 */

const { CoachConversation, PlayerProfile } = require('../../models');
const { config } = require('../../config/env');
const ApiError = require('../../utils/ApiError');
const { AI_PROVIDERS, MSG_ROLES } = require('../../constants/enums');
const { estimateCost } = require('../../constants/aiPricing');
const { GeminiProvider } = require('./providers/gemini.provider');
const { AnthropicProvider } = require('./providers/anthropic.provider');

const TITLE_MAX = 80;

/** Registro de proveedores disponibles. */
const PROVIDERS = {
  [AI_PROVIDERS.GEMINI]: GeminiProvider,
  [AI_PROVIDERS.ANTHROPIC]: AnthropicProvider,
};

/**
 * Devuelve una instancia del proveedor solicitado (o el por defecto).
 *
 * @param {string} [providerName] - Nombre del proveedor (enum AI_PROVIDERS).
 * @returns {import('./providers/base.provider').AIProvider} Instancia.
 * @throws {ApiError} 500 si el proveedor no está soportado.
 */
function getProvider(providerName = config.ai.defaultProvider) {
  const Provider = PROVIDERS[providerName];
  if (!Provider) {
    throw ApiError.internal(`Proveedor de IA no soportado: ${providerName}`);
  }
  return new Provider();
}

/**
 * Obtiene la conversación activa (la más reciente no archivada) o crea una.
 *
 * @param {string} userId - Usuario.
 * @returns {Promise<import('mongoose').Document>} Conversación.
 */
async function getOrCreateActiveConversation(userId) {
  const existing = await CoachConversation.findOne({
    userId,
    isArchived: false,
  }).sort({ lastMessageAt: -1 });
  if (existing) return existing;
  return CoachConversation.create({ userId });
}

/**
 * Envía un mensaje al Coach IA y persiste el intercambio.
 *
 * @param {string} userId - Usuario autenticado.
 * @param {string} userMessage - Mensaje del usuario.
 * @returns {Promise<{
 *   conversationId: string, reply: string, provider: string, model: string,
 *   tokensInput: number, tokensOutput: number, responseTimeMs: number,
 *   estimatedCostUSD: number
 * }>} Respuesta normalizada.
 */
async function chat(userId, userMessage) {
  const [conversation, profile] = await Promise.all([
    getOrCreateActiveConversation(userId),
    PlayerProfile.findOne({ userId }),
  ]);

  // Contexto = system prompt + perfil + historial + el nuevo mensaje.
  const messages = [
    ...conversation.buildContext(profile),
    { role: MSG_ROLES.USER, content: userMessage },
  ];

  const provider = getProvider();
  const result = await provider.generate(messages);

  const estimatedCostUSD = estimateCost(
    result.provider,
    result.model,
    result.tokensInput,
    result.tokensOutput
  );

  // Título de la conversación a partir del primer mensaje.
  if (!conversation.title && conversation.messages.length === 0) {
    conversation.title = userMessage.slice(0, TITLE_MAX);
  }

  await conversation.addMessage(MSG_ROLES.USER, userMessage);
  await conversation.addMessage(MSG_ROLES.ASSISTANT, result.content, {
    provider: result.provider,
    model: result.model,
    tokensInput: result.tokensInput,
    tokensOutput: result.tokensOutput,
    responseTimeMs: result.responseTimeMs,
    estimatedCostUSD,
    metadata: result.metadata,
  });

  return {
    conversationId: conversation._id,
    reply: result.content,
    provider: result.provider,
    model: result.model,
    tokensInput: result.tokensInput,
    tokensOutput: result.tokensOutput,
    responseTimeMs: result.responseTimeMs,
    estimatedCostUSD,
  };
}

/**
 * Lista las conversaciones del usuario (más recientes primero).
 *
 * @param {string} userId - Usuario.
 * @returns {Promise<object[]>} Conversaciones.
 */
function getConversations(userId) {
  return CoachConversation.find({ userId })
    .sort({ lastMessageAt: -1 })
    .lean();
}

/**
 * Obtiene una conversación completa validando ownership.
 *
 * @param {string} userId - Usuario.
 * @param {string} conversationId - Conversación.
 * @returns {Promise<import('mongoose').Document>} Conversación.
 * @throws {ApiError} 404 si no existe; 403 si no es del usuario.
 */
async function getConversation(userId, conversationId) {
  const conversation = await CoachConversation.findById(conversationId);
  if (!conversation) throw ApiError.notFound('Conversación no encontrada');
  if (String(conversation.userId) !== String(userId)) {
    throw ApiError.forbidden('No tienes acceso a esta conversación');
  }
  return conversation;
}

/**
 * Crea una conversación vacía nueva.
 *
 * @param {string} userId - Usuario.
 * @returns {Promise<import('mongoose').Document>} Conversación creada.
 */
function newConversation(userId) {
  return CoachConversation.create({ userId });
}

/**
 * Archiva una conversación del usuario.
 *
 * @param {string} userId - Usuario.
 * @param {string} conversationId - Conversación.
 * @returns {Promise<import('mongoose').Document>} Conversación archivada.
 * @throws {ApiError} 404/403 según ownership.
 */
async function archiveConversation(userId, conversationId) {
  const conversation = await getConversation(userId, conversationId);
  conversation.isArchived = true;
  await conversation.save();
  return conversation;
}

module.exports = {
  getProvider,
  chat,
  getConversations,
  getConversation,
  newConversation,
  archiveConversation,
};
