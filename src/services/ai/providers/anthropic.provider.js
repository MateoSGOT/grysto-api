'use strict';

/**
 * @file Proveedor Anthropic — STUB listo para el futuro. Cuando se compre la
 * API, se completa `generate()` y se cambia AI_DEFAULT_PROVIDER=anthropic; el
 * resto del código de negocio NO cambia (formato normalizado).
 */

const { AIProvider } = require('./base.provider');
const { config } = require('../../../config/env');
const ApiError = require('../../../utils/ApiError');
const { AI_PROVIDERS, MSG_ROLES } = require('../../../constants/enums');

class AnthropicProvider extends AIProvider {
  constructor() {
    super(AI_PROVIDERS.ANTHROPIC);
    this.apiKey = config.ai.anthropic.apiKey;
    this.model = config.ai.anthropic.model;
  }

  /**
   * Traduce los mensajes normalizados al formato de Anthropic Messages API.
   * Referencia para cuando se implemente (Anthropic separa `system` del array
   * de `messages`, que solo admite roles 'user' y 'assistant'):
   *
   *   const system = messages.filter(m => m.role === 'system')
   *                          .map(m => m.content).join('\n\n');
   *   const msgs = messages
   *     .filter(m => m.role !== 'system')
   *     .map(m => ({ role: m.role, content: m.content })); // user|assistant
   *
   *   POST https://api.anthropic.com/v1/messages
   *   headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
   *   body: { model, max_tokens, system, messages: msgs }
   *
   *   // respuesta: data.content[0].text, data.usage.input_tokens / output_tokens
   *
   * @param {import('./base.provider').AIMessage[]} messages - Conversación.
   * @returns {{ system: string, messages: Array<{role: string, content: string}> }}
   */
  static buildRequestPayload(messages) {
    const system = messages
      .filter((m) => m.role === MSG_ROLES.SYSTEM)
      .map((m) => m.content)
      .join('\n\n');
    const msgs = messages
      .filter((m) => m.role !== MSG_ROLES.SYSTEM)
      .map((m) => ({ role: m.role, content: m.content }));
    return { system, messages: msgs };
  }

  /**
   * Aún no implementado. Lanza un error operacional claro.
   *
   * @param {import('./base.provider').AIMessage[]} _messages - Conversación.
   * @param {Object} [_options] - Opciones.
   * @returns {Promise<import('./base.provider').AIResult>} Nunca retorna.
   * @throws {ApiError} 503 — proveedor no configurado/implementado.
   */
  // eslint-disable-next-line no-unused-vars, class-methods-use-this
  async generate(_messages, _options = {}) {
    if (!this.apiKey) {
      throw new ApiError(503, 'Proveedor Anthropic aún no configurado');
    }
    throw new ApiError(503, 'Proveedor Anthropic aún no implementado');
  }
}

module.exports = { AnthropicProvider };
