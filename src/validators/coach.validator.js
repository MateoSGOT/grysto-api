'use strict';

/**
 * @file Schemas Zod para el Coach IA.
 */

const { z } = require('zod');

const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;

/** Mensaje de chat: 1-2000 caracteres. */
const chatSchema = z.object({
  message: z
    .string({ message: 'El mensaje es obligatorio' })
    .trim()
    .min(1, 'El mensaje no puede estar vacío')
    .max(2000, 'El mensaje no puede superar 2000 caracteres'),
});

/** Param :id como ObjectId. */
const conversationIdParamSchema = z.object({
  id: z
    .string({ message: 'id es obligatorio' })
    .regex(OBJECT_ID_REGEX, 'id no es un ObjectId válido'),
});

module.exports = { chatSchema, conversationIdParamSchema };
