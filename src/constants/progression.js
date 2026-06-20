'use strict';

/**
 * @file Reglas de SOBRECARGA PROGRESIVA por categoría de ejercicio.
 * Tabla CONFIGURABLE: ajustar los incrementos aquí NO requiere tocar la
 * lógica del service. Cada regla define la métrica que progresa, su unidad
 * y el incremento por defecto al pasar de un ciclo semanal al siguiente.
 */

const { EXERCISE_CATEGORIES } = require('./enums');

/**
 * @typedef {Object} ProgressionRule
 * @property {('peso'|'altura'|'velocidad'|'repeticiones'|'precision')} metric - Qué progresa.
 * @property {('kg'|'cm'|'seg'|'reps'|'%')} unit - Unidad de la métrica.
 * @property {number} defaultIncrement - Incremento sugerido por ciclo.
 * @property {string} description - Explicación en español.
 */

/** Regla genérica para categorías sin progresión específica. */
const GENERIC_RULE = Object.freeze({
  metric: 'repeticiones',
  unit: 'reps',
  // +2 reps por semana: progresión conservadora y sostenible para volumen
  // de trabajo técnico/auxiliar donde no aplica carga externa.
  defaultIncrement: 2,
  description:
    'Incremento genérico de volumen: suma repeticiones de forma gradual.',
});

/**
 * Reglas por categoría. La lógica de cada incremento está documentada para
 * justificar el valor (no son números mágicos).
 */
const PROGRESSION_RULES = Object.freeze({
  // Fuerza: el motor del rendimiento. +2.5 kg/semana es el salto mínimo
  // estándar (microplacas) que mantiene la sobrecarga sin frenar la técnica.
  [EXERCISE_CATEGORIES.FUERZA]: Object.freeze({
    metric: 'peso',
    unit: 'kg',
    defaultIncrement: 2.5,
    description: 'Sube 2.5 kg por semana para sostener la sobrecarga de fuerza.',
  }),

  // Salto: la potencia se mide en altura. +2 cm/semana es un objetivo
  // realista de mejora pliométrica para un atleta en progresión.
  [EXERCISE_CATEGORIES.SALTO]: Object.freeze({
    metric: 'altura',
    unit: 'cm',
    defaultIncrement: 2,
    description: 'Apunta a 2 cm más de altura/intensidad de salto por semana.',
  }),

  // Agilidad: progresa exigiendo más en el mismo tiempo (intensidad). +0.5
  // representa el aumento de dificultad/velocidad del drill por semana.
  [EXERCISE_CATEGORIES.AGILIDAD]: Object.freeze({
    metric: 'velocidad',
    unit: 'seg',
    defaultIncrement: 0.5,
    description: 'Aumenta la intensidad/velocidad del drill medio segundo por semana.',
  }),

  // Dribbling: control bajo fatiga. +4 reps/semana añade volumen de
  // contactos con balón manteniendo la calidad del gesto.
  [EXERCISE_CATEGORIES.DRIBBLING]: Object.freeze({
    metric: 'repeticiones',
    unit: 'reps',
    defaultIncrement: 4,
    description: 'Suma 4 repeticiones de manejo de balón por semana.',
  }),

  // Tiro: la mejora es precisión y volumen. +5 % de efectividad objetivo
  // por semana empuja al jugador a más tiros buenos sostenidos.
  [EXERCISE_CATEGORIES.TIRO]: Object.freeze({
    metric: 'precision',
    unit: '%',
    defaultIncrement: 5,
    description: 'Sube 5 % la precisión/volumen objetivo de tiro por semana.',
  }),
});

/**
 * Devuelve la regla de progresión de una categoría, o la genérica si la
 * categoría no está mapeada.
 *
 * @param {string} exerciseCategory - Categoría del ejercicio (enum EXERCISE_CATEGORIES).
 * @returns {ProgressionRule} Regla de progresión.
 */
function getProgressionRule(exerciseCategory) {
  return PROGRESSION_RULES[exerciseCategory] || GENERIC_RULE;
}

module.exports = Object.freeze({
  PROGRESSION_RULES,
  GENERIC_RULE,
  getProgressionRule,
});
