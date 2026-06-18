'use strict';

/**
 * @file Model Exercise — ejercicio individual del catálogo.
 */

const mongoose = require('mongoose');
const {
  EXERCISE_CATEGORIES,
  LEVELS,
  VIDEO_TYPES,
  valuesOf,
} = require('../constants/enums');

/** Dificultad: niveles sin "competitivo". */
const DIFFICULTY_LEVELS = valuesOf(LEVELS).filter(
  (lvl) => lvl !== LEVELS.COMPETITIVO
);

const exerciseSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: [3, 'El nombre debe tener al menos 3 caracteres'],
      maxlength: [100, 'El nombre no puede superar 100 caracteres'],
    },
    description: {
      type: String,
      required: true,
      minlength: [10, 'La descripción debe tener al menos 10 caracteres'],
      maxlength: [500, 'La descripción no puede superar 500 caracteres'],
    },
    category: {
      type: String,
      enum: valuesOf(EXERCISE_CATEGORIES),
      required: true,
    },
    targetMuscles: { type: [String], default: [] },
    difficulty: { type: String, enum: DIFFICULTY_LEVELS, required: true },
    equipment: { type: [String], default: [] },
    demoVideo: {
      type: {
        type: String,
        enum: valuesOf(VIDEO_TYPES),
        required: true,
      },
      cloudinaryUrl: { type: String, default: null },
      youtubeUrl: { type: String, default: null },
    },
    tags: { type: [String], default: [] },
  },
  { timestamps: true, versionKey: false }
);

exerciseSchema.index({ category: 1 });
exerciseSchema.index({ tags: 1 });

module.exports = mongoose.model('Exercise', exerciseSchema);
