'use strict';

/**
 * @file Model User — cuenta de usuario, credenciales y plan freemium.
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { ROLES, PLANS, valuesOf } = require('../constants/enums');

const BCRYPT_ROUNDS = 12;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const userSchema = new mongoose.Schema(
  {
    nombre: {
      type: String,
      required: [true, 'El nombre es obligatorio'],
      trim: true,
      minlength: [2, 'El nombre debe tener al menos 2 caracteres'],
      maxlength: [50, 'El nombre no puede superar 50 caracteres'],
    },
    email: {
      type: String,
      required: [true, 'El email es obligatorio'],
      lowercase: true,
      trim: true,
      match: [EMAIL_REGEX, 'El email no tiene un formato válido'],
    },
    password: {
      type: String,
      required: [true, 'La contraseña es obligatoria'],
      minlength: [60, 'Hash de contraseña inválido'],
      select: false,
    },
    role: {
      type: String,
      enum: valuesOf(ROLES),
      default: ROLES.USER,
    },
    plan: {
      type: String,
      enum: valuesOf(PLANS),
      default: PLANS.FREE,
    },
    planExpiresAt: { type: Date, default: null },
    isEmailVerified: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      /**
       * Limpia la representación JSON: sin password ni __v.
       * @param {mongoose.Document} _doc - Documento original.
       * @param {Object} ret - Objeto plano a transformar.
       * @returns {Object} Objeto saneado.
       */
      transform(_doc, ret) {
        delete ret.password;
        delete ret.__v;
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ role: 1 });

/**
 * Hashea la contraseña (si cambió) antes de validar, para que el hash de 60
 * caracteres satisfaga el `minlength`. Corre en `pre('validate')` porque la
 * validación de Mongoose se ejecuta antes que `pre('save')`.
 */
userSchema.pre('validate', async function hashPassword() {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, BCRYPT_ROUNDS);
});

/**
 * Indica si el plan premium está activo en este momento.
 *
 * @returns {boolean} `true` si plan premium y no expirado.
 */
userSchema.methods.isPremiumActive = function isPremiumActive() {
  if (this.plan !== PLANS.PREMIUM) return false;
  if (!this.planExpiresAt) return true;
  return this.planExpiresAt.getTime() > Date.now();
};

/**
 * Compara una contraseña en claro contra el hash almacenado.
 *
 * @param {string} candidate - Contraseña en texto plano.
 * @returns {Promise<boolean>} `true` si coincide.
 */
userSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

/**
 * Devuelve el perfil público (sin password) con flag premium.
 *
 * @returns {Object} Perfil seguro para exponer al cliente.
 */
userSchema.methods.getPublicProfile = function getPublicProfile() {
  const obj = this.toObject();
  delete obj.password;
  delete obj.__v;
  obj.isPremiumActive = this.isPremiumActive();
  return obj;
};

/**
 * Busca un usuario por email incluyendo el campo password.
 *
 * @param {string} email - Email a buscar.
 * @returns {Promise<mongoose.Document|null>} Usuario con password o null.
 */
userSchema.statics.findByEmail = function findByEmail(email) {
  return this.findOne({ email: String(email).toLowerCase().trim() }).select(
    '+password'
  );
};

/** Resumen del plan del usuario. */
userSchema.virtual('fullPlan').get(function fullPlan() {
  return {
    plan: this.plan,
    planExpiresAt: this.planExpiresAt,
    isPremiumActive: this.isPremiumActive(),
  };
});

module.exports = mongoose.model('User', userSchema);
