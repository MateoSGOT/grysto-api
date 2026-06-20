'use strict';

/**
 * @file Schemas Zod reutilizables y transversales.
 */

const { z } = require('zod');

const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;

/** Param `:id` de ruta validado como ObjectId de Mongo (24 hex). */
const idParamSchema = z.object({
  id: z
    .string({ message: 'ID inválido' })
    .regex(OBJECT_ID_REGEX, 'ID inválido'),
});

module.exports = { idParamSchema };
