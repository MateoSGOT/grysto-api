'use strict';

/**
 * @file Model PasswordResetToken — token de un solo uso para reset de
 * contraseña. Expira a los 30 minutos (TTL index).
 */

const mongoose = require('mongoose');
const crypto = require('crypto');

const RESET_TTL_MS = 30 * 60 * 1000; // 30 minutos

const passwordResetTokenSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    token: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    used: { type: Boolean, default: false },
    usedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

passwordResetTokenSchema.index({ token: 1 }, { unique: true });
passwordResetTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/**
 * Genera y persiste un token de reset (válido 30 min).
 *
 * @param {mongoose.Types.ObjectId|string} userId - ID del usuario.
 * @returns {Promise<mongoose.Document>} El token creado.
 */
passwordResetTokenSchema.statics.generateToken = function generateToken(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  return this.create({
    userId,
    token,
    expiresAt: new Date(Date.now() + RESET_TTL_MS),
  });
};

module.exports = mongoose.model(
  'PasswordResetToken',
  passwordResetTokenSchema,
  'passwordResetTokens'
);
