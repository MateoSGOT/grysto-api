'use strict';

/**
 * @file Datos de prueba reutilizables para los tests de Auth.
 */

/**
 * Construye un payload válido de registro (credenciales + cuestionario).
 *
 * @param {Object} [overrides={}] - Campos a sobrescribir.
 * @returns {Object} Payload de registro.
 */
function validRegisterPayload(overrides = {}) {
  return {
    nombre: 'Mateo Pérez',
    email: 'mateo@example.com',
    password: 'Password123',
    position: 'base',
    level: 'intermedio',
    primaryGoal: 'salto_vertical',
    trainingDaysPerWeek: '3-4',
    sessionDuration: '45-60min',
    height: 178,
    weight: 72,
    age: 22,
    weaknesses: ['tiro de media distancia'],
    gymAccess: 'gym_completo',
    ...overrides,
  };
}

module.exports = { validRegisterPayload };
