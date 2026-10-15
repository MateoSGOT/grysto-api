'use strict';

/**
 * @file Catálogo semilla de Grysto: ejercicios, rutinas y planes semanales.
 *
 * Origen: el antiguo `scripts/seed-test-plan.ps1` (único seed en el historial
 * de git): 5 ejercicios, 5 rutinas y 1 plan semanal. NO hay en el repo ni en
 * el historial URLs reales de video.
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ PARA COMPLETAR A MANO:                                               │
 * │ 1. `videoUrl` de cada ejercicio: pegar la URL del MP4 desde la Media │
 * │    Library de Cloudinary (https://res.cloudinary.com/duwnri2bf/...). │
 * │    Mientras sea null, el ejercicio se crea SIN video (la app muestra │
 * │    el placeholder) y el seed lo avisa.                               │
 * │ 2. Planes nuevos: agregarlos a WEEKLY_PLANS con el formato de PLAN_1.│
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * Claves naturales (idempotencia): ejercicio → `name`, rutina → `title`,
 * plan → `name`. Correr el seed dos veces actualiza, no duplica.
 */

/** @type {Array<{ name: string, category: string, description: string, difficulty: string, videoUrl: string|null }>} */
const EXERCISES = [
  {
    name: 'Sentadilla con barra',
    category: 'fuerza',
    description: 'Sentadilla profunda para tren inferior y potencia de salto.',
    difficulty: 'intermedio',
    videoUrl: null, // ← PEGAR URL de Cloudinary (MP4)
  },
  {
    name: 'Crossover entre conos',
    category: 'dribbling',
    description: 'Cambio de mano explosivo entre conos para manejo de balón.',
    difficulty: 'intermedio',
    videoUrl: null, // ← PEGAR URL de Cloudinary (MP4)
  },
  {
    name: 'Salto al cajón',
    category: 'salto',
    description: 'Salto pliométrico al cajón para desarrollar el salto vertical.',
    difficulty: 'intermedio',
    videoUrl: null, // ← PEGAR URL de Cloudinary (MP4)
  },
  {
    name: 'Tiro libre con arco',
    category: 'tiro',
    description: 'Repeticiones de tiro libre cuidando la mecánica y el arco.',
    difficulty: 'intermedio',
    videoUrl: null, // ← PEGAR URL de Cloudinary (MP4)
  },
  {
    name: 'Sprint de cancha',
    category: 'resistencia',
    description: 'Sprints de extremo a extremo para acondicionamiento físico.',
    difficulty: 'intermedio',
    videoUrl: null, // ← PEGAR URL de Cloudinary (MP4)
  },
];

/**
 * Rutinas. Cada ejercicio va POR REPS (`reps`) o POR TIEMPO (`seconds`),
 * nunca ambos.
 */
const ROUTINES = [
  {
    title: 'Fuerza tren inferior',
    category: 'gym',
    duration_min: 45,
    exercises: [{ exercise: 'Sentadilla con barra', sets: 4, reps: '8', restSeconds: 60 }],
  },
  {
    title: 'Manejo de balón',
    category: 'cancha',
    duration_min: 30,
    exercises: [{ exercise: 'Crossover entre conos', sets: 3, reps: '10', restSeconds: 60 }],
  },
  {
    title: 'Pliometría y salto',
    category: 'fisico',
    duration_min: 40,
    exercises: [{ exercise: 'Salto al cajón', sets: 4, reps: '6', restSeconds: 60 }],
  },
  {
    title: 'Mecánica de tiro',
    category: 'cancha',
    duration_min: 35,
    exercises: [{ exercise: 'Tiro libre con arco', sets: 5, reps: '10', restSeconds: 60 }],
  },
  {
    title: 'Acondicionamiento',
    category: 'fisico',
    duration_min: 25,
    exercises: [{ exercise: 'Sprint de cancha', sets: 4, seconds: 30, restSeconds: 30 }],
  },
];

/** Plan 1 (del seed original). Los días referencian rutinas por `title`. */
const PLAN_1 = {
  name: 'Plan de prueba GRYSTO',
  description: 'Plan semanal de prueba con días variados para ver el home.',
  targetPosition: ['all'],
  targetLevel: ['intermedio'],
  targetGoal: ['salto_vertical'],
  isPremium: false,
  days: [
    { dayNumber: 1, category: 'fuerza', title: 'Fuerza explosiva', isRestDay: false, routines: ['Fuerza tren inferior'] },
    { dayNumber: 2, category: 'dribbling', title: 'Control de balón', isRestDay: false, routines: ['Manejo de balón'] },
    { dayNumber: 3, category: 'salto', title: 'Salto vertical', isRestDay: false, routines: ['Pliometría y salto'] },
    { dayNumber: 4, category: 'descanso', title: 'Descanso activo', isRestDay: true, routines: [] },
    { dayNumber: 5, category: 'tiro', title: 'Tiro y mecánica', isRestDay: false, routines: ['Mecánica de tiro'] },
    { dayNumber: 6, category: 'resistencia', title: 'Acondicionamiento', isRestDay: false, routines: ['Acondicionamiento'] },
    { dayNumber: 7, category: 'descanso', title: 'Descanso total', isRestDay: true, routines: [] },
  ],
};

/** Planes semanales del catálogo (el primero se activa al usuario demo). */
const WEEKLY_PLANS = [PLAN_1];

module.exports = { EXERCISES, ROUTINES, WEEKLY_PLANS };
