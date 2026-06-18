'use strict';

/**
 * @file Schemas Zod para Routines. Enums desde constants/enums.js.
 * `createdBy` NUNCA viene del body — se toma de req.user.
 */

const { z } = require('zod');
const { LEVELS, ROUTINE_CATEGORIES, valuesOf } = require('../constants/enums');

/** Nivel sin "competitivo". */
const ROUTINE_LEVELS = valuesOf(LEVELS).filter(
  (lvl) => lvl !== LEVELS.COMPETITIVO
);

const URL_REGEX = /^https?:\/\/\S+$/i;
const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;

/**
 * Campo string restringido a un set de valores.
 *
 * @param {string[]} values - Valores permitidos.
 * @param {string} label - Nombre legible.
 * @returns {import('zod').ZodTypeAny} Schema.
 */
function enumField(values, label) {
  return z
    .string({ message: `${label} es obligatorio` })
    .refine((v) => values.includes(v), {
      message: `${label} inválido. Valores permitidos: ${values.join(', ')}`,
    });
}

/** Sub-ejercicio dentro de una rutina. */
const routineExerciseSchema = z.object({
  exerciseId: z
    .string({ message: 'exerciseId es obligatorio' })
    .regex(OBJECT_ID_REGEX, 'exerciseId no es un ObjectId válido'),
  sets: z.number().int().positive().nullable().optional(),
  reps: z.string().trim().min(1).nullable().optional(),
  seconds: z.number().int().positive().nullable().optional(),
  restSeconds: z.number().int().nonnegative().nullable().optional(),
  order: z.number({ message: 'order es obligatorio' }).int().min(1, 'order debe ser ≥ 1'),
  notes: z.string().trim().max(300).nullable().optional(),
});

/** Schema de creación de rutina. */
const createRoutineSchema = z.object({
  title: z
    .string({ message: 'El título es obligatorio' })
    .trim()
    .min(3, 'El título debe tener al menos 3 caracteres')
    .max(100, 'El título no puede superar 100 caracteres'),
  description: z
    .string({ message: 'La descripción es obligatoria' })
    .trim()
    .min(10, 'La descripción debe tener al menos 10 caracteres')
    .max(500, 'La descripción no puede superar 500 caracteres'),
  level: enumField(ROUTINE_LEVELS, 'El nivel'),
  category: enumField(valuesOf(ROUTINE_CATEGORIES), 'La categoría'),
  targetPositions: z.array(z.string().trim().min(1)).default(['all']),
  duration_min: z.coerce
    .number({ message: 'La duración debe ser un número' })
    .min(5, 'La duración mínima es 5 minutos')
    .max(180, 'La duración máxima es 180 minutos'),
  isPremium: z.boolean().default(false),
  exercises: z
    .array(routineExerciseSchema, { message: 'exercises debe ser una lista' })
    .min(1, 'La rutina debe tener al menos un ejercicio'),
  coverImage: z
    .string()
    .trim()
    .regex(URL_REGEX, 'Debe ser una URL válida (http/https)')
    .nullable()
    .optional(),
});

/** Schema de actualización: todos los campos opcionales. */
const updateRoutineSchema = createRoutineSchema.partial();

/** Schema de query para listado: filtros + paginación. */
const listRoutinesQuerySchema = z.object({
  level: enumField(ROUTINE_LEVELS, 'El nivel').optional(),
  category: enumField(valuesOf(ROUTINE_CATEGORIES), 'La categoría').optional(),
  isPremium: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  targetPositions: z
    .string()
    .trim()
    .optional()
    .transform((v) =>
      v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined
    ),
  page: z.coerce.number().int().min(1, 'page debe ser ≥ 1').default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1, 'limit debe ser ≥ 1')
    .max(100, 'limit no puede superar 100')
    .default(20),
});

module.exports = {
  createRoutineSchema,
  updateRoutineSchema,
  listRoutinesQuerySchema,
};
