'use strict';

/**
 * @file Schemas Zod para UserPlans (acciones del usuario sobre su plan).
 */

const { z } = require('zod');

const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;

const objectId = (label) =>
  z
    .string({ message: `${label} es obligatorio` })
    .regex(OBJECT_ID_REGEX, `${label} no es un ObjectId válido`);

/** Activar un plan del catálogo. */
const activatePlanSchema = z.object({
  weeklyPlanId: objectId('weeklyPlanId'),
});

/** Confirmar un día del ciclo actual. */
const confirmDaySchema = z.object({
  dayNumber: z.coerce
    .number({ message: 'dayNumber debe ser un número' })
    .int()
    .min(1, 'dayNumber debe estar entre 1 y 7')
    .max(7, 'dayNumber debe estar entre 1 y 7'),
});

/** Confirmar la carga real realizada en un ejercicio. */
const confirmLoadSchema = z.object({
  exerciseId: objectId('exerciseId'),
  actualValue: z.coerce.number({ message: 'actualValue debe ser un número' }),
});

/** Ajustar la carga sugerida de un ejercicio antes de hacerla. */
const adjustLoadSchema = z.object({
  exerciseId: objectId('exerciseId'),
  newValue: z.coerce.number({ message: 'newValue debe ser un número' }),
});

module.exports = {
  activatePlanSchema,
  confirmDaySchema,
  confirmLoadSchema,
  adjustLoadSchema,
};
