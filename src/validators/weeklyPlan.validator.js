'use strict';

/**
 * @file Schemas Zod para WeeklyPlans. Enums desde constants/enums.js.
 * `createdBy` NUNCA viene del body — se toma de req.user.
 */

const { z } = require('zod');
const { POSITIONS, LEVELS, GOALS, valuesOf } = require('../constants/enums');

const URL_REGEX = /^https?:\/\/\S+$/i;
const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;
const WEEK_DAYS = 7;

/**
 * Array (mín. 1) de strings restringidos a un enum (más 'all' como comodín).
 *
 * @param {string[]} values - Valores permitidos.
 * @param {string} label - Nombre legible.
 * @returns {import('zod').ZodTypeAny} Schema del array.
 */
function enumArray(values, label) {
  const allowed = [...values, 'all'];
  return z
    .array(
      z.string().refine((v) => allowed.includes(v), {
        message: `${label} inválido. Permitidos: ${allowed.join(', ')}`,
      }),
      { message: `${label} debe ser una lista` }
    )
    .min(1, `${label} requiere al menos un valor`);
}

const objectId = z
  .string()
  .regex(OBJECT_ID_REGEX, 'routineId no es un ObjectId válido');

/** Un día del plan. */
const daySchema = z.object({
  dayNumber: z.coerce
    .number()
    .int()
    .min(1, 'dayNumber debe estar entre 1 y 7')
    .max(7, 'dayNumber debe estar entre 1 y 7'),
  category: z.string({ message: 'category es obligatorio' }).trim().min(1),
  title: z.string({ message: 'title es obligatorio' }).trim().min(1),
  isRestDay: z.boolean().default(false),
  routines: z.array(objectId).default([]),
});

/**
 * Valida la coherencia de los 7 días: dayNumbers 1..7 únicos y que los días
 * de descanso no tengan rutinas.
 *
 * @param {Array<Object>} days - Días del plan.
 * @param {import('zod').RefinementCtx} ctx - Contexto de Zod.
 * @returns {void}
 */
function validateDays(days, ctx) {
  const numbers = days.map((d) => d.dayNumber);
  const unique = new Set(numbers);
  const expected = [1, 2, 3, 4, 5, 6, 7];
  const valid =
    unique.size === WEEK_DAYS && expected.every((n) => unique.has(n));
  if (!valid) {
    ctx.addIssue({
      code: 'custom',
      path: ['days'],
      message: 'Los 7 días deben tener dayNumber 1..7 sin repetir',
    });
  }
  days.forEach((d, i) => {
    if (d.isRestDay && d.routines.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['days', i, 'routines'],
        message: 'Un día de descanso no puede tener rutinas',
      });
    }
  });
}

/** Schema de creación de plan semanal. */
const createWeeklyPlanSchema = z
  .object({
    name: z
      .string({ message: 'El nombre es obligatorio' })
      .trim()
      .min(3, 'El nombre debe tener al menos 3 caracteres')
      .max(100, 'El nombre no puede superar 100 caracteres'),
    description: z
      .string({ message: 'La descripción es obligatoria' })
      .trim()
      .min(10, 'La descripción debe tener al menos 10 caracteres')
      .max(500, 'La descripción no puede superar 500 caracteres'),
    targetPosition: enumArray(valuesOf(POSITIONS), 'targetPosition'),
    targetLevel: enumArray(valuesOf(LEVELS), 'targetLevel'),
    targetGoal: enumArray(valuesOf(GOALS), 'targetGoal'),
    isPremium: z.boolean().default(false),
    days: z
      .array(daySchema, { message: 'days debe ser una lista' })
      .length(WEEK_DAYS, 'El plan debe tener exactamente 7 días'),
    coverImage: z
      .string()
      .trim()
      .regex(URL_REGEX, 'Debe ser una URL válida (http/https)')
      .nullable()
      .optional(),
  })
  .superRefine((val, ctx) => validateDays(val.days, ctx));

/** Schema de actualización: campos opcionales (sin re-superRefine de días). */
const updateWeeklyPlanSchema = z
  .object({
    name: z.string().trim().min(3).max(100).optional(),
    description: z.string().trim().min(10).max(500).optional(),
    targetPosition: enumArray(valuesOf(POSITIONS), 'targetPosition').optional(),
    targetLevel: enumArray(valuesOf(LEVELS), 'targetLevel').optional(),
    targetGoal: enumArray(valuesOf(GOALS), 'targetGoal').optional(),
    isPremium: z.boolean().optional(),
    isActive: z.boolean().optional(),
    days: z.array(daySchema).length(WEEK_DAYS).optional(),
    coverImage: z
      .string()
      .trim()
      .regex(URL_REGEX, 'Debe ser una URL válida (http/https)')
      .nullable()
      .optional(),
  })
  .superRefine((val, ctx) => {
    if (val.days) validateDays(val.days, ctx);
  });

/** Schema de query para listado. */
const listWeeklyPlansQuerySchema = z.object({
  targetPosition: z.string().trim().optional(),
  targetLevel: z.string().trim().optional(),
  targetGoal: z.string().trim().optional(),
  isPremium: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  isActive: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

module.exports = {
  createWeeklyPlanSchema,
  updateWeeklyPlanSchema,
  listWeeklyPlansQuerySchema,
};
