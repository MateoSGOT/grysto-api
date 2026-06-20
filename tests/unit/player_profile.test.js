'use strict';

/**
 * @file Tests unitarios de PlayerProfile.getMatchScore con goals múltiples.
 * El score de objetivo (25 pts) es PROPORCIONAL a cuántos goals del jugador
 * cubre el plan.
 */

const mongoose = require('mongoose');
const { PlayerProfile } = require('../../src/models');

/**
 * Construye un PlayerProfile en memoria (sin guardar) con los goals dados.
 *
 * @param {string[]} goals - Objetivos del jugador.
 * @returns {import('mongoose').Document} Perfil.
 */
function profileWith(goals) {
  return new PlayerProfile({
    userId: new mongoose.Types.ObjectId(),
    position: 'base',
    level: 'intermedio',
    goals,
    trainingDaysPerWeek: '3-4',
    sessionDuration: '45-60min',
    height: 180,
    weight: 75,
    age: 22,
    weaknesses: ['tiro'],
    gymAccess: 'gym_completo',
  });
}

describe('PlayerProfile.getMatchScore — goals múltiples (proporcional)', () => {
  it('score de objetivo proporcional a los goals cubiertos (2 de 3 → 25·2/3)', () => {
    const profile = profileWith(['salto_vertical', 'resistencia', 'fuerza_masa']);
    const plan = {
      targetPosition: ['zzz'],
      targetLevel: ['zzz'],
      targetGoal: ['salto_vertical', 'resistencia'],
    };
    expect(profile.getMatchScore(plan)).toBeCloseTo((25 * 2) / 3, 5);
  });

  it('25 pts completos si el plan cubre todos los goals del jugador', () => {
    const profile = profileWith(['salto_vertical', 'resistencia']);
    const plan = {
      targetPosition: ['zzz'],
      targetLevel: ['zzz'],
      targetGoal: ['salto_vertical', 'resistencia', 'fuerza_masa'],
    };
    expect(profile.getMatchScore(plan)).toBe(25);
  });

  it('0 en el componente de objetivo si no cubre ninguno', () => {
    const profile = profileWith(['salto_vertical']);
    const plan = {
      targetPosition: ['zzz'],
      targetLevel: ['zzz'],
      targetGoal: ['resistencia'],
    };
    expect(profile.getMatchScore(plan)).toBe(0);
  });

  it('match total = 100 (posición + nivel + todos los goals)', () => {
    const profile = profileWith(['salto_vertical']);
    const plan = {
      targetPosition: ['base'],
      targetLevel: ['intermedio'],
      targetGoal: ['salto_vertical'],
    };
    expect(profile.getMatchScore(plan)).toBe(100);
  });
});
