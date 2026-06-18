'use strict';

/**
 * @file Model CoachConversation — historial de chat con el Coach IA,
 * incluyendo métricas de uso (tokens, costo, latencia).
 */

const mongoose = require('mongoose');
const { AI_PROVIDERS, MSG_ROLES, valuesOf } = require('../constants/enums');

/** Prompt de sistema base del Coach IA de GRYSTO. */
const GRYSTO_SYSTEM_PROMPT =
  'Eres el Coach IA de Grysto, una app de entrenamiento de baloncesto. ' +
  'Respondes en español, con tono cercano y motivador. Tu único objetivo es ' +
  'ayudar al jugador a mejorar su rendimiento en la cancha y en el gym. ' +
  'Perfil del jugador: ';

const messageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: valuesOf(MSG_ROLES), required: true },
    content: {
      type: String,
      required: true,
      maxlength: [10000, 'El mensaje no puede superar 10000 caracteres'],
    },
    timestamp: { type: Date, default: Date.now },
    provider: { type: String, enum: valuesOf(AI_PROVIDERS), default: null },
    model: { type: String, default: null },
    tokensInput: { type: Number, default: 0 },
    tokensOutput: { type: Number, default: 0 },
    responseTimeMs: { type: Number, default: null },
    estimatedCostUSD: { type: Number, default: 0 },
    metadata: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: true }
);

const coachConversationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    title: {
      type: String,
      default: null,
      maxlength: [80, 'El título no puede superar 80 caracteres'],
    },
    messages: { type: [messageSchema], default: [] },
    totalTokensUsed: { type: Number, default: 0 },
    totalCostUSD: { type: Number, default: 0 },
    contextSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    isArchived: { type: Boolean, default: false },
    lastMessageAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

coachConversationSchema.index({ userId: 1, lastMessageAt: -1 });

/**
 * Construye el contexto para enviar al proveedor de IA: prompt de sistema
 * con el perfil del jugador seguido del historial de mensajes.
 *
 * @param {Object} playerProfile - Perfil del jugador (se serializa a JSON).
 * @returns {Array<{ role: string, content: string }>} Mensajes para la IA.
 */
coachConversationSchema.methods.buildContext = function buildContext(
  playerProfile
) {
  const systemMessage = {
    role: MSG_ROLES.SYSTEM,
    content: GRYSTO_SYSTEM_PROMPT + JSON.stringify(playerProfile ?? {}),
  };
  const history = this.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  return [systemMessage, ...history];
};

/**
 * Agrega un mensaje, actualiza `lastMessageAt`, recalcula totales de
 * tokens/costo y persiste el documento.
 *
 * @param {string} role - Rol del mensaje (enum MSG_ROLES).
 * @param {string} content - Contenido del mensaje.
 * @param {Object} [metadata={}] - Métricas opcionales (tokens, costo, etc.).
 * @returns {Promise<mongoose.Document>} El documento guardado.
 */
coachConversationSchema.methods.addMessage = async function addMessage(
  role,
  content,
  metadata = {}
) {
  const message = {
    role,
    content,
    timestamp: new Date(),
    provider: metadata.provider ?? null,
    model: metadata.model ?? null,
    tokensInput: metadata.tokensInput ?? 0,
    tokensOutput: metadata.tokensOutput ?? 0,
    responseTimeMs: metadata.responseTimeMs ?? null,
    estimatedCostUSD: metadata.estimatedCostUSD ?? 0,
    metadata: metadata.metadata ?? null,
  };

  this.messages.push(message);
  this.lastMessageAt = message.timestamp;
  this.totalTokensUsed += message.tokensInput + message.tokensOutput;
  this.totalCostUSD += message.estimatedCostUSD;

  return this.save();
};

module.exports = mongoose.model('CoachConversation', coachConversationSchema);
module.exports.GRYSTO_SYSTEM_PROMPT = GRYSTO_SYSTEM_PROMPT;
