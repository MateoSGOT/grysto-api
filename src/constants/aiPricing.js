'use strict';

/**
 * @file Tabla de precios de IA por millón de tokens (USD), preparada para
 * billing futuro. En free tier el costo es 0, pero la estructura ya soporta
 * el tier pago: basta poner los precios reales.
 */

const { AI_PROVIDERS } = require('./enums');

const PER_MILLION = 1_000_000;

/**
 * Precios por modelo: { input, output } en USD por 1M de tokens.
 * Las cifras del tier pago quedan como referencia comentada.
 */
const AI_PRICING = Object.freeze({
  [AI_PROVIDERS.GEMINI]: Object.freeze({
    // Free tier: sin costo. (Tier pago referencia gemini-2.5-flash:
    //   input ≈ 0.30 USD/1M, output ≈ 2.50 USD/1M — verificar al activar.)
    'gemini-2.5-flash': Object.freeze({ input: 0, output: 0 }),
  }),

  [AI_PROVIDERS.ANTHROPIC]: Object.freeze({
    // Referencia para el futuro (verificar precios vigentes al comprar la API).
    'claude-haiku-4-5': Object.freeze({ input: 1, output: 5 }),
    'claude-sonnet-4-6': Object.freeze({ input: 3, output: 15 }),
    'claude-opus-4-8': Object.freeze({ input: 15, output: 75 }),
  }),
});

/**
 * Estima el costo en USD de una llamada. Devuelve 0 si el modelo no está en la
 * tabla (p. ej. free tier) — nunca lanza.
 *
 * @param {string} provider - Proveedor (enum AI_PROVIDERS).
 * @param {string} model - Modelo usado.
 * @param {number} tokensInput - Tokens de entrada.
 * @param {number} tokensOutput - Tokens de salida.
 * @returns {number} Costo estimado en USD.
 */
function estimateCost(provider, model, tokensInput = 0, tokensOutput = 0) {
  const price = AI_PRICING[provider]?.[model];
  if (!price) return 0;
  const cost =
    (tokensInput / PER_MILLION) * price.input +
    (tokensOutput / PER_MILLION) * price.output;
  return cost;
}

module.exports = Object.freeze({ AI_PRICING, estimateCost });
