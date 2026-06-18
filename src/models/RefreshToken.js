'use strict';

/**
 * @file Model RefreshToken — refresh tokens OPACOS con rotación y detección
 * de reuso. En DB se guarda SIEMPRE el hash SHA-256, nunca el token en plano.
 */

const mongoose = require('mongoose');
const crypto = require('crypto');
const ApiError = require('../utils/ApiError');

const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 días
const TOKEN_BYTES = 40;

/**
 * Hashea un token en plano con SHA-256.
 *
 * @param {string} plainToken - Token en texto plano.
 * @returns {string} Hash hexadecimal.
 */
function hashToken(plainToken) {
  return crypto.createHash('sha256').update(plainToken).digest('hex');
}

const refreshTokenSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    token: { type: String, required: true }, // hash SHA-256
    expiresAt: { type: Date, required: true },
    isRevoked: { type: Boolean, default: false },
    replacedByToken: { type: String, default: null }, // hash del sucesor
    createdByIp: { type: String, default: null },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

refreshTokenSchema.index({ token: 1 }, { unique: true });
refreshTokenSchema.index({ userId: 1 });
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/**
 * Genera un refresh token opaco, guarda su hash y devuelve el token en plano.
 *
 * @param {mongoose.Types.ObjectId|string} userId - Dueño del token.
 * @param {string|null} [ip=null] - IP de origen (auditoría).
 * @returns {Promise<{ plainToken: string, document: mongoose.Document }>}
 *   Token en plano (solo se devuelve aquí) y su documento persistido.
 */
refreshTokenSchema.statics.generateToken = async function generateToken(
  userId,
  ip = null
) {
  const plainToken = crypto.randomBytes(TOKEN_BYTES).toString('hex');
  const document = await this.create({
    userId,
    token: hashToken(plainToken),
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    createdByIp: ip,
  });
  return { plainToken, document };
};

/**
 * Revoca todos los refresh tokens activos de un usuario.
 *
 * @param {mongoose.Types.ObjectId|string} userId - Usuario.
 * @returns {Promise<import('mongoose').UpdateWriteOpResult>} Resultado.
 */
refreshTokenSchema.statics.revokeAllForUser = function revokeAllForUser(userId) {
  return this.updateMany(
    { userId, isRevoked: false },
    { $set: { isRevoked: true, revokedAt: new Date() } }
  );
};

/**
 * Rota un refresh token: valida el viejo, lo revoca y emite uno nuevo.
 * Detección de reuso: si el token presentado ya estaba revocado, se asume
 * robo de credenciales y se revoca TODA la cadena del usuario.
 *
 * @param {string} oldPlainToken - Refresh token en plano presentado por el cliente.
 * @param {string|null} [ip=null] - IP de origen.
 * @returns {Promise<{ plainToken: string, document: mongoose.Document }>}
 *   Nuevo token en plano y su documento.
 * @throws {ApiError} 401 si el token no existe, expiró o fue reusado.
 */
refreshTokenSchema.statics.rotateToken = async function rotateToken(
  oldPlainToken,
  ip = null
) {
  const oldHash = hashToken(oldPlainToken);
  const existing = await this.findOne({ token: oldHash });

  if (!existing || existing.expiresAt.getTime() < Date.now()) {
    throw ApiError.unauthorized('Refresh token inválido o expirado');
  }

  // Detección de reuso: token ya revocado presentado de nuevo.
  if (existing.isRevoked) {
    await this.revokeAllForUser(existing.userId);
    throw ApiError.unauthorized('Sesión comprometida');
  }

  // Emitir el sucesor.
  const { plainToken, document } = await this.generateToken(existing.userId, ip);

  // Revocar el viejo y enlazarlo con el nuevo (cadena de rotación).
  existing.isRevoked = true;
  existing.revokedAt = new Date();
  existing.replacedByToken = document.token;
  await existing.save();

  return { plainToken, document };
};

module.exports = mongoose.model('RefreshToken', refreshTokenSchema);
