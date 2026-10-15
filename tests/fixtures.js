'use strict';

/**
 * @file Datos y helpers de prueba reutilizables.
 */

const { User } = require('../src/models');
const { signAccessToken } = require('../src/utils/jwt.util');
const { ROLES, PLANS } = require('../src/constants/enums');

let counter = 0;

/**
 * Genera un email único por test.
 *
 * @param {string} [prefix='user'] - Prefijo.
 * @returns {string} Email único.
 */
function uniqueEmail(prefix = 'user') {
  counter += 1;
  return `${prefix}_${Date.now()}_${counter}@example.com`;
}

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
    goals: ['salto_vertical', 'resistencia'],
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

/**
 * Crea un usuario directamente (verificado y activo por defecto).
 *
 * @param {Object} [overrides={}] - Campos a sobrescribir.
 * @returns {Promise<import('mongoose').Document>} Usuario creado.
 */
async function createUser(overrides = {}) {
  return User.create({
    nombre: 'Test User',
    email: uniqueEmail(),
    password: 'Password123',
    isEmailVerified: true,
    isActive: true,
    ...overrides,
  });
}

/** Crea un admin. @param {Object} [o={}] @returns {Promise<import('mongoose').Document>} */
async function createAdmin(o = {}) {
  return createUser({ role: ROLES.ADMIN, email: uniqueEmail('admin'), ...o });
}

/** Crea un usuario free. @param {Object} [o={}] @returns {Promise<import('mongoose').Document>} */
async function createFreeUser(o = {}) {
  return createUser({ plan: PLANS.FREE, email: uniqueEmail('free'), ...o });
}

/** Crea un usuario premium activo. @param {Object} [o={}] @returns {Promise<import('mongoose').Document>} */
async function createPremiumUser(o = {}) {
  return createUser({
    plan: PLANS.PREMIUM,
    planExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    email: uniqueEmail('premium'),
    ...o,
  });
}

/**
 * Firma un access token para un usuario.
 *
 * @param {import('mongoose').Document} user - Usuario.
 * @returns {string} Access token JWT.
 */
function tokenFor(user) {
  return signAccessToken({
    sub: user._id.toString(),
    role: user.role,
    plan: user.plan,
  });
}

/**
 * Header Authorization Bearer para un usuario.
 *
 * @param {import('mongoose').Document} user - Usuario.
 * @returns {{ Authorization: string }} Header.
 */
function authHeader(user) {
  return { Authorization: `Bearer ${tokenFor(user)}` };
}

/**
 * Payload válido de ejercicio.
 *
 * @param {Object} [overrides={}] - Overrides.
 * @returns {Object} Payload.
 */
function validExercisePayload(overrides = {}) {
  return {
    name: 'Salto al cajón',
    description: 'Ejercicio pliométrico para potencia de salto vertical.',
    category: 'salto',
    difficulty: 'intermedio',
    demoVideo: {
      type: 'youtube',
      youtubeUrl: 'https://youtube.com/watch?v=abc123',
    },
    targetMuscles: ['cuádriceps', 'glúteos'],
    equipment: ['cajón'],
    tags: ['pliometria', 'salto'],
    ...overrides,
  };
}

/**
 * Payload válido de rutina (sin createdBy).
 *
 * @param {string} exerciseId - Id de un ejercicio existente.
 * @param {Object} [overrides={}] - Overrides.
 * @returns {Object} Payload.
 */
function validRoutinePayload(exerciseId, overrides = {}) {
  return {
    title: 'Rutina de salto',
    description: 'Rutina enfocada en mejorar el salto vertical.',
    level: 'intermedio',
    category: 'fisico',
    duration_min: 45,
    isPremium: false,
    exercises: [{ exerciseId: String(exerciseId), order: 1, sets: 4, reps: '10' }],
    ...overrides,
  };
}

/**
 * Payload válido de plan semanal: día 1 con una rutina, días 2-7 de descanso.
 *
 * @param {string} routineId - Id de una rutina existente.
 * @param {Object} [overrides={}] - Overrides.
 * @returns {Object} Payload.
 */
function validWeeklyPlanPayload(routineId, overrides = {}) {
  const restDays = [2, 3, 4, 5, 6, 7].map((n) => ({
    dayNumber: n,
    category: 'descanso',
    title: `Descanso ${n}`,
    isRestDay: true,
    routines: [],
  }));
  return {
    name: 'Plan de fuerza y salto',
    description: 'Plan recurrente enfocado en fuerza y potencia de salto.',
    targetPosition: ['all'],
    targetLevel: ['intermedio'],
    targetGoal: ['salto_vertical'],
    isPremium: false,
    days: [
      {
        dayNumber: 1,
        category: 'fisico',
        title: 'Día de fuerza',
        isRestDay: false,
        routines: [String(routineId)],
      },
      ...restDays,
    ],
    coverImage: null,
    ...overrides,
  };
}

/**
 * Intercepta los envíos de email y guarda los códigos en claro (en la base
 * solo está el HMAC). Llamar en `beforeEach`; `jest.restoreAllMocks()` en
 * `afterEach` deshace los spies.
 *
 * @returns {{ sent: Array<{ kind: 'verify'|'reset', to: string, code: string }>,
 *   last: (to: string, kind: 'verify'|'reset') => string|undefined,
 *   count: (to: string, kind: 'verify'|'reset') => number }}
 */
function captureEmailCodes() {
  // Require diferido: fixtures no debe cargar services salvo que se use.
  // eslint-disable-next-line global-require
  const emailService = require('../src/services/email.service');
  const sent = [];
  jest
    .spyOn(emailService, 'sendVerificationCode')
    .mockImplementation(async (to, _nombre, code) => {
      sent.push({ kind: 'verify', to, code });
      return { sent: true };
    });
  jest
    .spyOn(emailService, 'sendPasswordResetCode')
    .mockImplementation(async (to, _nombre, code) => {
      sent.push({ kind: 'reset', to, code });
      return { sent: true };
    });
  const matching = (to, kind) => sent.filter((m) => m.to === to && m.kind === kind);
  return {
    sent,
    last: (to, kind) => matching(to, kind).at(-1)?.code,
    count: (to, kind) => matching(to, kind).length,
  };
}

/**
 * Corre el reloj de los códigos emitidos hacia atrás (createdAt), para salir
 * del cooldown de reenvío sin esperar. Usa el driver nativo: Mongoose trata
 * `createdAt` como inmutable.
 *
 * @param {number} ms - Milisegundos a retroceder.
 * @returns {Promise<void>}
 */
async function ageAuthCodes(ms) {
  // eslint-disable-next-line global-require
  const { AuthCode } = require('../src/models');
  const docs = await AuthCode.find({}).select('createdAt').lean();
  await Promise.all(
    docs.map((d) =>
      AuthCode.collection.updateOne(
        { _id: d._id },
        { $set: { createdAt: new Date(d.createdAt.getTime() - ms) } }
      )
    )
  );
}

module.exports = {
  captureEmailCodes,
  ageAuthCodes,
  uniqueEmail,
  validRegisterPayload,
  createUser,
  createAdmin,
  createFreeUser,
  createPremiumUser,
  tokenFor,
  authHeader,
  validExercisePayload,
  validRoutinePayload,
  validWeeklyPlanPayload,
};
