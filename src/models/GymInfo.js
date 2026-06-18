'use strict';

/**
 * @file Model GymInfo — información del Grysto Gym (singleton).
 * Sin timestamps automáticos: solo `updatedAt` gestionado manualmente.
 */

const mongoose = require('mongoose');

const gymInfoSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, default: 'Grysto Gym' },
    description: { type: String, default: null },
    address: { type: String, default: null },
    city: { type: String, required: true, default: 'Medellín' },
    country: { type: String, required: true, default: 'Colombia' },
    openingDate: { type: Date, default: null },
    socialLinks: {
      instagram: { type: String, default: null },
      tiktok: { type: String, default: null },
      youtube: { type: String, default: null },
      whatsapp: { type: String, default: null },
    },
    features: { type: [String], default: [] },
    isComingSoon: { type: Boolean, default: true },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: false, versionKey: false }
);

/** Mantiene `updatedAt` al guardar. */
gymInfoSchema.pre('save', function bumpUpdatedAt(next) {
  this.updatedAt = new Date();
  next();
});

/**
 * Devuelve el único documento de GymInfo, creándolo con defaults si no existe.
 *
 * @returns {Promise<mongoose.Document>} La instancia singleton.
 */
gymInfoSchema.statics.getInstance = async function getInstance() {
  const existing = await this.findOne();
  if (existing) return existing;
  return this.create({});
};

module.exports = mongoose.model('GymInfo', gymInfoSchema);
