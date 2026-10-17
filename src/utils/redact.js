'use strict';

/**
 * @file Helpers para loguear sin exponer datos personales.
 */

/**
 * Enmascara un email para logs: `mateo@gmail.com` → `m***@gmail.com`.
 * Conserva el dominio (útil para diagnosticar rebotes de un proveedor).
 *
 * @param {string} email - Email.
 * @returns {string} Email enmascarado.
 */
function maskEmail(email) {
  const value = String(email ?? '');
  const at = value.lastIndexOf('@');
  if (at <= 0) return '***';
  return `${value[0]}***${value.slice(at)}`;
}

module.exports = { maskEmail };
