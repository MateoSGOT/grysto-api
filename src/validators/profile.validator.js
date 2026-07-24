'use strict';

/**
 * @file Schema Zod del PlayerProfile. Solo se permite ACTUALIZAR los datos
 * físicos que cambian con el tiempo (peso, altura, edad). El resto del perfil
 * (posición, nivel, objetivos, etc.) define el plan y NO es editable: `.strict()`
 * rechaza con 422 cualquier intento de cambiar otro campo.
 */

const { z } = require('zod');

const heightField = z.coerce
  .number({ message: 'La estatura debe ser un número' })
  .min(140, 'La estatura mínima es 140 cm')
  .max(230, 'La estatura máxima es 230 cm');

const weightField = z.coerce
  .number({ message: 'El peso debe ser un número' })
  .min(40, 'El peso mínimo es 40 kg')
  .max(180, 'El peso máximo es 180 kg');

// `age` es bsonType:int en el validator de Atlas → forzamos entero.
const ageField = z.coerce
  .number({ message: 'La edad debe ser un número' })
  .int('La edad debe ser un número entero')
  .min(12, 'La edad mínima es 12 años')
  .max(60, 'La edad máxima es 60 años');

/** PATCH /profile — SOLO height/weight/age; cualquier otra clave → 422. */
const updateProfileSchema = z
  .object({
    height: heightField.optional(),
    weight: weightField.optional(),
    age: ageField.optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.height !== undefined || v.weight !== undefined || v.age !== undefined,
    { message: 'Envía al menos un campo: height, weight o age' }
  );

module.exports = { updateProfileSchema };
