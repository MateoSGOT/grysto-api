'use strict';

/**
 * @file Proveedor Gemini (Google Generative Language API), vía REST con fetch
 * nativo (sin SDK). Traduce el formato normalizado al de Gemini y normaliza
 * la respuesta de vuelta.
 */

const { AIProvider } = require('./base.provider');
const { config } = require('../../../config/env');
const ApiError = require('../../../utils/ApiError');
const { AI_PROVIDERS, MSG_ROLES } = require('../../../constants/enums');

const API_BASE =
  'https://generativelanguage.googleapis.com/v1beta/models';

class GeminiProvider extends AIProvider {
  constructor() {
    super(AI_PROVIDERS.GEMINI);
    this.apiKey = config.ai.gemini.apiKey;
    this.model = config.ai.gemini.model;
  }

  /**
   * Traduce los mensajes normalizados al cuerpo de la API de Gemini.
   * - Los mensajes 'system' se agregan a `systemInstruction` (Gemini no tiene
   *   rol system en `contents`).
   * - 'assistant' → 'model'; 'user' → 'user'.
   *
   * @param {import('./base.provider').AIMessage[]} messages - Conversación.
   * @returns {Object} Cuerpo de la petición para Gemini.
   */
  static buildRequestBody(messages) {
    const systemTexts = [];
    const contents = [];

    for (const msg of messages) {
      if (msg.role === MSG_ROLES.SYSTEM) {
        systemTexts.push(msg.content);
        continue;
      }
      const role = msg.role === MSG_ROLES.ASSISTANT ? 'model' : 'user';
      contents.push({ role, parts: [{ text: msg.content }] });
    }

    const body = { contents };
    if (systemTexts.length > 0) {
      body.systemInstruction = { parts: [{ text: systemTexts.join('\n\n') }] };
    }
    return body;
  }

  /**
   * Llama a Gemini y normaliza la respuesta.
   *
   * @param {import('./base.provider').AIMessage[]} messages - Conversación.
   * @param {Object} [options] - Opciones (no usadas por ahora).
   * @returns {Promise<import('./base.provider').AIResult>} Resultado normalizado.
   * @throws {ApiError} 500 si falta la API key; 429 si Gemini limita; 502 ante error del proveedor.
   */
  // eslint-disable-next-line no-unused-vars
  async generate(messages, options = {}) {
    if (!this.apiKey) {
      throw ApiError.internal('GEMINI_API_KEY no está configurada');
    }

    const url = `${API_BASE}/${this.model}:generateContent`;
    const body = GeminiProvider.buildRequestBody(messages);

    const startedAt = Date.now();
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new ApiError(502, 'No se pudo contactar al Coach IA (Gemini)', {
        cause: err.message,
      });
    }
    const responseTimeMs = Date.now() - startedAt;

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      if (response.status === 429) {
        throw ApiError.tooMany(
          'El Coach IA alcanzó el límite de solicitudes de Gemini. Intenta en un momento.'
        );
      }
      throw new ApiError(502, 'Error del proveedor de IA (Gemini)', {
        status: response.status,
        detail: detail.slice(0, 500),
      });
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts
      ?.map((p) => p.text || '')
      .join('')
      .trim();

    if (!text) {
      throw new ApiError(502, 'El Coach IA no pudo generar una respuesta', {
        finishReason: candidate?.finishReason ?? null,
      });
    }

    const usage = data.usageMetadata || {};
    return {
      content: text,
      provider: this.name,
      model: this.model,
      tokensInput: usage.promptTokenCount ?? 0,
      tokensOutput: usage.candidatesTokenCount ?? 0,
      responseTimeMs,
      metadata: {
        finishReason: candidate?.finishReason ?? null,
        totalTokenCount: usage.totalTokenCount ?? null,
      },
    };
  }
}

module.exports = { GeminiProvider };
