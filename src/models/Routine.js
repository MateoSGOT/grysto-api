'use strict';

/**
 * @file Model Routine — rutina compuesta por una secuencia de ejercicios.
 */

const mongoose = require('mongoose');
const {
  LEVELS,
  ROUTINE_CATEGORIES,
  valuesOf,
} = require('../constants/enums');

/** Nivel sin "competitivo". */
const ROUTINE_LEVELS = valuesOf(LEVELS).filter(
  (lvl) => lvl !== LEVELS.COMPETITIVO
);

const routineExerciseSchema = new mongoose.Schema(
  {
    exerciseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Exercise',
      required: true,
    },
    sets: { type: Number, default: null },
    reps: { type: String, default: null },
    seconds: { type: Number, default: null },
    restSeconds: { type: Number, default: null },
    order: { type: Number, required: true },
    notes: { type: String, default: null },
  },
  { _id: false }
);

const routineSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      minlength: [3, 'El título debe tener al menos 3 caracteres'],
      maxlength: [100, 'El título no puede superar 100 caracteres'],
    },
    description: {
      type: String,
      required: true,
      minlength: [10, 'La descripción debe tener al menos 10 caracteres'],
      maxlength: [500, 'La descripción no puede superar 500 caracteres'],
    },
    level: { type: String, enum: ROUTINE_LEVELS, required: true },
    category: {
      type: String,
      enum: valuesOf(ROUTINE_CATEGORIES),
      required: true,
    },
    targetPositions: { type: [String], default: ['all'] },
    duration_min: {
      type: Number,
      required: true,
      min: [5, 'La duración mínima es 5 minutos'],
      max: [180, 'La duración máxima es 180 minutos'],
    },
    isPremium: { type: Boolean, default: false },
    exercises: { type: [routineExerciseSchema], default: [] },
    coverImage: { type: String, default: null },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true, versionKey: false }
);

routineSchema.index({ level: 1, category: 1 });

module.exports = mongoose.model('Routine', routineSchema);
