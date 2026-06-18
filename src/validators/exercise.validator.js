'use strict';

/**
 * @file Schemas Zod para Exercises. Enums desde constants/enums.js,
 * mensajes en español por campo.
 */

const { z } = require('zod');
const {
  EXERCISE_CATEGORIES,
  LEVELS,
  VIDEO_TYPES,
  valuesOf,
} = require('../constants/enums');

/** Dificultad: niveles sin "competitivo". */
const DIFFICULTY_LEVELS = valuesOf(LEVELS).filter(
  (lvl) => lvl !== LEVELS.COMPETITIVO
);

const URL_REGEX = /^https?:\/\/\S+$/i;

/**
 * Campo string restringido a un set de valores, con mensaje en español.
 *
 * @param {string[]} values - Valores permitidos.
 * @param {string} label - Nombre legible del campo.
 * @returns {import('zod').ZodTypeAny} Schema del campo.
 */
function enumField(values, label) {
  return z
    .string({ message: `${label} es obligatorio` })
    .refine((v) => values.includes(v), {
      message: `${label} inválido. Valores permitidos: ${values.join(', ')}`,
    });
}

/** Campo de URL (http/https) opcional y anulable. */
const optionalUrl = z
  .string()
  .trim()
  .regex(URL_REGEX, 'Debe ser una URL válida (http/https)')
  .nullable()
  .optional();

/** Array de strings no vacíos, opcional. */
const stringArray = z.array(z.string().trim().min(1, 'Valor inválido')).optional();

/**
 * demoVideo: el tipo determina qué URL es obligatoria.
 */
const demoVideoSchema = z
  .object({
    type: enumField(valuesOf(VIDEO_TYPES), 'El tipo de video'),
    cloudinaryUrl: optionalUrl,
    youtubeUrl: optionalUrl,
  })
  .superRefine((val, ctx) => {
    if (val.type === VIDEO_TYPES.CLOUDINARY && !val.cloudinaryUrl) {
      ctx.addIssue({
        code: 'custom',
        path: ['cloudinaryUrl'],
        message: 'cloudinaryUrl es requerido cuando type es "cloudinary"',
      });
    }
    if (val.type === VIDEO_TYPES.YOUTUBE && !val.youtubeUrl) {
      ctx.addIssue({
        code: 'custom',
        path: ['youtubeUrl'],
        message: 'youtubeUrl es requerido cuando type es "youtube"',
      });
    }
  });

/** Schema de creación de ejercicio. */
const createExerciseSchema = z.object({
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
  category: enumField(valuesOf(EXERCISE_CATEGORIES), 'La categoría'),
  targetMuscles: stringArray,
  difficulty: enumField(DIFFICULTY_LEVELS, 'La dificultad'),
  equipment: stringArray,
  demoVideo: demoVideoSchema,
  tags: stringArray,
});

/** Schema de actualización: todos los campos opcionales. */
const updateExerciseSchema = createExerciseSchema.partial();

/** Schema de query para listado: filtros + paginación. */
const listExercisesQuerySchema = z.object({
  category: enumField(valuesOf(EXERCISE_CATEGORIES), 'La categoría').optional(),
  difficulty: enumField(DIFFICULTY_LEVELS, 'La dificultad').optional(),
  tags: z
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
  createExerciseSchema,
  updateExerciseSchema,
  listExercisesQuerySchema,
};
