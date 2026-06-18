'use strict';

/**
 * @file Schemas Zod para los endpoints de Auth. Los valores de enum se
 * importan SIEMPRE desde constants/enums.js. Mensajes en español por campo.
 */

const { z } = require('zod');
const {
  POSITIONS,
  LEVELS,
  GOALS,
  TRAINING_DAYS,
  SESSION_DURATION,
  GYM_ACCESS,
  valuesOf,
} = require('../constants/enums');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Campo string restringido a los valores de un enum, con mensaje en español.
 *
 * @param {Object} enumObj - Enum de constants/enums.js.
 * @param {string} label - Nombre legible del campo para el mensaje.
 * @returns {import('zod').ZodTypeAny} Schema del campo.
 */
function enumField(enumObj, label) {
  const values = valuesOf(enumObj);
  return z
    .string({ message: `El campo ${label} es obligatorio` })
    .refine((v) => values.includes(v), {
      message: `${label} inválido. Valores permitidos: ${values.join(', ')}`,
    });
}

/** Email normalizado (trim + lowercase) y validado. */
const emailField = z
  .string({ message: 'El email es obligatorio' })
  .trim()
  .toLowerCase()
  .regex(EMAIL_REGEX, 'El email no tiene un formato válido');

/** Contraseña fuerte: min 8, ≥1 mayúscula, ≥1 minúscula, ≥1 número. */
const passwordField = z
  .string({ message: 'La contraseña es obligatoria' })
  .min(8, 'La contraseña debe tener al menos 8 caracteres')
  .regex(/[A-Z]/, 'La contraseña debe incluir al menos una mayúscula')
  .regex(/[a-z]/, 'La contraseña debe incluir al menos una minúscula')
  .regex(/[0-9]/, 'La contraseña debe incluir al menos un número');

/** Token opaco / de verificación (hex no vacío). */
const tokenField = z
  .string({ message: 'El token es obligatorio' })
  .trim()
  .min(1, 'El token es obligatorio');

/** Schema de registro: credenciales + cuestionario del jugador. */
const registerSchema = z.object({
  nombre: z
    .string({ message: 'El nombre es obligatorio' })
    .trim()
    .min(2, 'El nombre debe tener al menos 2 caracteres')
    .max(50, 'El nombre no puede superar 50 caracteres'),
  email: emailField,
  password: passwordField,

  // Cuestionario (11 campos del PlayerProfile).
  position: enumField(POSITIONS, 'la posición'),
  level: enumField(LEVELS, 'el nivel'),
  primaryGoal: enumField(GOALS, 'el objetivo principal'),
  trainingDaysPerWeek: enumField(TRAINING_DAYS, 'los días de entrenamiento'),
  sessionDuration: enumField(SESSION_DURATION, 'la duración de sesión'),
  height: z.coerce
    .number({ message: 'La estatura debe ser un número' })
    .min(140, 'La estatura mínima es 140 cm')
    .max(230, 'La estatura máxima es 230 cm'),
  weight: z.coerce
    .number({ message: 'El peso debe ser un número' })
    .min(40, 'El peso mínimo es 40 kg')
    .max(180, 'El peso máximo es 180 kg'),
  age: z.coerce
    .number({ message: 'La edad debe ser un número' })
    .int('La edad debe ser un número entero')
    .min(12, 'La edad mínima es 12 años')
    .max(60, 'La edad máxima es 60 años'),
  weaknesses: z
    .array(z.string().trim().min(1, 'Debilidad inválida'), {
      message: 'Las debilidades deben ser una lista',
    })
    .min(1, 'Debes indicar al menos una debilidad'),
  gymAccess: enumField(GYM_ACCESS, 'el acceso a gimnasio'),
});

/** Schema de login. */
const loginSchema = z.object({
  email: emailField,
  password: z.string({ message: 'La contraseña es obligatoria' }).min(1, 'La contraseña es obligatoria'),
});

/** Schema de verificación de email. */
const verifyEmailSchema = z.object({
  token: tokenField,
});

/** Schema de solicitud de recuperación de contraseña. */
const forgotPasswordSchema = z.object({
  email: emailField,
});

/** Schema de reset de contraseña. */
const resetPasswordSchema = z.object({
  token: tokenField,
  newPassword: passwordField,
});

/** Schema de refresh (token opcional en body; puede venir por cookie). */
const refreshTokenSchema = z.object({
  refreshToken: z.string().trim().min(1).optional(),
});

module.exports = {
  registerSchema,
  loginSchema,
  verifyEmailSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  refreshTokenSchema,
};
