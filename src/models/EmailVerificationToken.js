'use strict';

/**
 * @file Model EmailVerificationToken — token de verificación de email.
 * Expira a las 24 horas (TTL index).
 */

const mongoose = require('mongoose');
const crypto = require('crypto');

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas

const emailVerificationTokenSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    token: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    verified: { type: Boolean, default: false },
    verifiedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

emailVerificationTokenSchema.index({ token: 1 }, { unique: true });
emailVerificationTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/**
 * Genera y persiste un token de verificación (válido 24 h).
 *
 * @param {mongoose.Types.ObjectId|string} userId - ID del usuario.
 * @returns {Promise<mongoose.Document>} El token creado.
 */
emailVerificationTokenSchema.statics.generateToken = function generateToken(
  userId
) {
  const token = crypto.randomBytes(32).toString('hex');
  return this.create({
    userId,
    token,
    expiresAt: new Date(Date.now() + VERIFY_TTL_MS),
  });
};

module.exports = mongoose.model(
  'EmailVerificationToken',
  emailVerificationTokenSchema,
  'emailVerificationTokens'
);
