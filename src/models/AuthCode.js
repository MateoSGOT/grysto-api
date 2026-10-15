'use strict';

/**
 * @file Model AuthCode — código de 6 dígitos de un solo uso enviado por email
 * (verificación de cuenta o recuperación de contraseña).
 *
 * El código NUNCA se guarda en claro: solo su HMAC (`codeHash`), que además
 * liga el código a su `purpose` y a su `userId` (un código de verificación no
 * valida para reset ni para otro usuario). `expiresAt` marca la vigencia;
 * `purgeAt` (TTL) borra el documento mucho después, para que el límite de
 * envíos por hora siga contando códigos ya expirados.
 */

const mongoose = require('mongoose');
const { AUTH_CODE_PURPOSES, valuesOf } = require('../constants/enums');

const authCodeSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    purpose: {
      type: String,
      enum: valuesOf(AUTH_CODE_PURPOSES),
      required: true,
    },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0, min: 0 },
    // Consumido con éxito (un solo uso).
    usedAt: { type: Date, default: null },
    // Anulado: por superar los intentos o por emitirse un código más nuevo.
    invalidatedAt: { type: Date, default: null },
    purgeAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

// Búsqueda del código vigente y conteo de envíos por usuario + propósito.
authCodeSchema.index({ userId: 1, purpose: 1, createdAt: -1 });
// Purga automática (TTL).
authCodeSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('AuthCode', authCodeSchema, 'authCodes');
