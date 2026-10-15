'use strict';

/**
 * @file Política de los códigos de un solo uso enviados por email
 * (verificación de cuenta y recuperación de contraseña). Centralizada aquí
 * para que service, model y tests compartan los mismos números.
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

const AUTH_CODE_POLICY = Object.freeze({
  /** Cantidad de dígitos del código. */
  length: 6,
  /** Vigencia de un código desde que se emite. */
  ttlMs: 10 * MINUTE,
  /** Intentos fallidos permitidos antes de invalidar el código. */
  maxAttempts: 5,
  /** Espera mínima entre dos envíos del mismo propósito. */
  resendCooldownMs: 60 * SECOND,
  /** Envíos máximos por usuario y propósito en una ventana de 1 hora. */
  maxSendsPerHour: 5,
  /** Ventana del límite de envíos. */
  sendWindowMs: HOUR,
  /**
   * Cuándo se purga el documento (TTL). Mayor que la ventana de envíos para
   * que el conteo por hora sobreviva a la expiración del código.
   */
  purgeAfterMs: 24 * HOUR,
});

module.exports = { AUTH_CODE_POLICY };
