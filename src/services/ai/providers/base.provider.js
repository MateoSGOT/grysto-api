'use strict';

/**
 * @file Interfaz base de proveedor de IA. Todos los proveedores devuelven la
 * MISMA forma normalizada, de modo que la lógica de negocio no dependa del
 * formato específico de cada API.
 */

/**
 * @typedef {Object} AIMessage
 * @property {('system'|'user'|'assistant')} role - Rol del mensaje.
 * @property {string} content - Contenido del mensaje.
 */

/**
 * @typedef {Object} AIResult
 * @property {string} content - Texto generado por el modelo.
 * @property {string} provider - Proveedor usado (enum AI_PROVIDERS).
 * @property {string} model - Modelo usado.
 * @property {number} tokensInput - Tokens de entrada (prompt).
 * @property {number} tokensOutput - Tokens de salida (respuesta).
 * @property {number} responseTimeMs - Latencia de la llamada en ms.
 * @property {Object} metadata - Metadata adicional específica del proveedor.
 */

class AIProvider {
  /**
   * @param {string} name - Nombre del proveedor (enum AI_PROVIDERS).
   */
  constructor(name) {
    this.name = name;
  }

  /**
   * Genera una respuesta a partir de los mensajes normalizados.
   *
   * @abstract
   * @param {AIMessage[]} _messages - Conversación (incluye el mensaje de sistema).
   * @param {Object} [_options] - Opciones del proveedor (temperatura, etc.).
   * @returns {Promise<AIResult>} Resultado normalizado.
   * @throws {Error} Si la subclase no lo implementa.
   */
  // eslint-disable-next-line no-unused-vars, class-methods-use-this
  async generate(_messages, _options = {}) {
    throw new Error('AIProvider.generate() debe ser implementado por la subclase');
  }
}

module.exports = { AIProvider };
