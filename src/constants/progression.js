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

/**
 * Rangos razonables por MÉTRICA para validar el valor REAL que registra el
 * usuario al calibrar (confirm-load). Evita cargas absurdas (0, negativas o
 * imposibles) que contaminarían la sobrecarga de los ciclos siguientes.
 *
 * @type {Object<string, { min: number, max: number, exclusiveMin: boolean, label: string }>}
 */
const METRIC_BOUNDS = Object.freeze({
  peso: { min: 0, max: 500, exclusiveMin: true, label: 'peso (kg)' },
  altura: { min: 0, max: 300, exclusiveMin: true, label: 'altura (cm)' },
  velocidad: { min: 0, max: 600, exclusiveMin: true, label: 'tiempo (seg)' },
  precision: { min: 0, max: 100, exclusiveMin: false, label: 'precisión (%)' },
  repeticiones: { min: 0, max: 1000, exclusiveMin: true, label: 'repeticiones' },
});

/** Rango por defecto (métrica desconocida): trata como repeticiones. */
const DEFAULT_BOUNDS = METRIC_BOUNDS.repeticiones;

/**
 * Devuelve los límites de una métrica (o el default si no está mapeada).
 *
 * @param {string} metric - Métrica (peso|altura|velocidad|precision|repeticiones).
 * @returns {{ min: number, max: number, exclusiveMin: boolean, label: string }} Límites.
 */
function getMetricBounds(metric) {
  return METRIC_BOUNDS[metric] || DEFAULT_BOUNDS;
}

/**
 * Valida que un valor real esté dentro del rango razonable de su métrica.
 *
 * @param {string} metric - Métrica de la carga.
 * @param {number} value - Valor real a validar.
 * @returns {{ ok: boolean, message?: string }} Resultado; `message` si falla.
 */
function validateMetricValue(metric, value) {
  const b = getMetricBounds(metric);
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return { ok: false, message: `El valor de ${b.label} debe ser numérico` };
  }
  const aboveMin = b.exclusiveMin ? value > b.min : value >= b.min;
  if (!aboveMin || value > b.max) {
    const lower = b.exclusiveMin ? `mayor que ${b.min}` : `${b.min} o más`;
    return {
      ok: false,
      message: `El valor de ${b.label} debe ser ${lower} y como máximo ${b.max}`,
    };
  }
  return { ok: true };
}

module.exports = Object.freeze({
  PROGRESSION_RULES,
  GENERIC_RULE,
  getProgressionRule,
  METRIC_BOUNDS,
  getMetricBounds,
  validateMetricValue,
});
