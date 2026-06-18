'use strict';

/**
 * @file Catálogo central de enums del dominio GRYSTO.
 * Toda la app debe importar desde aquí — nunca usar strings hardcodeados.
 * Cada enum es `Object.freeze` para garantizar inmutabilidad en runtime.
 */

/** Roles de usuario. */
const ROLES = Object.freeze({
  USER: 'user',
  ADMIN: 'admin',
});

/** Planes de suscripción (freemium). */
const PLANS = Object.freeze({
  FREE: 'free',
  PREMIUM: 'premium',
});

/** Niveles de habilidad del jugador. */
const LEVELS = Object.freeze({
  PRINCIPIANTE: 'principiante',
  INTERMEDIO: 'intermedio',
  AVANZADO: 'avanzado',
  COMPETITIVO: 'competitivo',
});

/** Posiciones en cancha. */
const POSITIONS = Object.freeze({
  BASE: 'base',
  ESCOLTA: 'escolta',
  ALERO: 'alero',
  ALA_PIVOT: 'ala-pivot',
  PIVOT: 'pivot',
});

/** Objetivos principales de entrenamiento. */
const GOALS = Object.freeze({
  VELOCIDAD: 'velocidad_agilidad',
  SALTO: 'salto_vertical',
  TECNICA: 'habilidades_tecnicas',
  FUERZA: 'fuerza_masa',
  RESISTENCIA: 'resistencia',
});

/** Días de entrenamiento por semana. */
const TRAINING_DAYS = Object.freeze({
  LOW: '1-2',
  MID: '3-4',
  HIGH: '5-6',
  ALL: 'todos',
});

/** Duración de cada sesión. */
const SESSION_DURATION = Object.freeze({
  EXPRESS: '30min',
  STANDARD: '45-60min',
  FULL: '90-120min',
  DOUBLE: '2h+',
});

/** Acceso a equipamiento / gimnasio. */
const GYM_ACCESS = Object.freeze({
  FULL: 'gym_completo',
  HOME: 'casa_mancuernas',
  COURT: 'solo_cancha',
  GRYSTO: 'grysto_gym',
});

/** Categorías de ejercicios. */
const EXERCISE_CATEGORIES = Object.freeze({
  SALTO: 'salto',
  DRIBBLING: 'dribbling',
  TIRO: 'tiro',
  DEFENSA: 'defensa',
  FUERZA: 'fuerza',
  AGILIDAD: 'agilidad',
  RESISTENCIA: 'resistencia',
  TECNICA: 'tecnica',
  CALENTAMIENTO: 'calentamiento',
  ESTIRAMIENTO: 'estiramiento',
});

/** Categorías de rutinas. */
const ROUTINE_CATEGORIES = Object.freeze({
  GYM: 'gym',
  CANCHA: 'cancha',
  FISICO: 'fisico',
  TECNICA: 'tecnica',
  CALENTAMIENTO: 'calentamiento',
});

/** Estado de un plan de usuario. */
const PLAN_STATUS = Object.freeze({
  ACTIVE: 'active',
  COMPLETED: 'completed',
  ABANDONED: 'abandoned',
  PAUSED: 'paused',
});

/** Origen de un plan de usuario. */
const PLAN_SOURCE = Object.freeze({
  RECOMMENDED: 'recommended_after_questionnaire',
  SELECTED: 'user_selected',
  AI: 'ai_generated',
});

/** Estado de la suscripción premium. */
const SUB_STATUS = Object.freeze({
  ACTIVE: 'active',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
  TRIAL: 'trial',
  PAST_DUE: 'past_due',
});

/** Proveedores de IA soportados por el Coach IA. */
const AI_PROVIDERS = Object.freeze({
  ANTHROPIC: 'anthropic',
  OPENAI: 'openai',
  GEMINI: 'gemini',
  LOCAL: 'local',
  OTHER: 'other',
});

/** Roles de mensaje en una conversación con el Coach IA. */
const MSG_ROLES = Object.freeze({
  USER: 'user',
  ASSISTANT: 'assistant',
  SYSTEM: 'system',
});

/** Tipos de video demostrativo de un ejercicio. */
const VIDEO_TYPES = Object.freeze({
  CLOUDINARY: 'cloudinary',
  YOUTUBE: 'youtube',
});

/**
 * Devuelve el array de valores de un enum, listo para `enum:` de Mongoose
 * o validaciones de Zod.
 *
 * @param {Object} enumObj - Uno de los objetos enum de este módulo.
 * @returns {string[]} Valores del enum.
 */
const valuesOf = (enumObj) => Object.values(enumObj);

module.exports = Object.freeze({
  ROLES,
  PLANS,
  LEVELS,
  POSITIONS,
  GOALS,
  TRAINING_DAYS,
  SESSION_DURATION,
  GYM_ACCESS,
  EXERCISE_CATEGORIES,
  ROUTINE_CATEGORIES,
  PLAN_STATUS,
  PLAN_SOURCE,
  SUB_STATUS,
  AI_PROVIDERS,
  MSG_ROLES,
  VIDEO_TYPES,
  valuesOf,
});
