'use strict';

/**
 * @file Model PlayerProfile — perfil deportivo del jugador (cuestionario).
 */

const mongoose = require('mongoose');
const {
  POSITIONS,
  LEVELS,
  GOALS,
  TRAINING_DAYS,
  SESSION_DURATION,
  GYM_ACCESS,
  valuesOf,
} = require('../constants/enums');

/** Pesos del match-score (suman 100). */
const SCORE_POSITION = 40;
const SCORE_LEVEL = 35;
const SCORE_GOAL = 25;

const playerProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    position: { type: String, enum: valuesOf(POSITIONS), required: true },
    level: { type: String, enum: valuesOf(LEVELS), required: true },
    primaryGoal: { type: String, enum: valuesOf(GOALS), required: true },
    trainingDaysPerWeek: {
      type: String,
      enum: valuesOf(TRAINING_DAYS),
      required: true,
    },
    sessionDuration: {
      type: String,
      enum: valuesOf(SESSION_DURATION),
      required: true,
    },
    height: {
      type: Number,
      required: true,
      min: [140, 'La estatura mínima es 140 cm'],
      max: [230, 'La estatura máxima es 230 cm'],
    },
    weight: {
      type: Number,
      required: true,
      min: [40, 'El peso mínimo es 40 kg'],
      max: [180, 'El peso máximo es 180 kg'],
    },
    age: {
      type: Number,
      required: true,
      min: [12, 'La edad mínima es 12 años'],
      max: [60, 'La edad máxima es 60 años'],
    },
    weaknesses: {
      type: [String],
      required: true,
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length >= 1,
        message: 'Debe indicar al menos una debilidad',
      },
    },
    gymAccess: { type: String, enum: valuesOf(GYM_ACCESS), required: true },
  },
  { timestamps: true }
);

playerProfileSchema.index({ userId: 1 }, { unique: true });

/**
 * Calcula la afinidad (0-100) entre este perfil y un WeeklyPlan.
 *
 * @param {Object} weeklyPlan - Plan semanal a evaluar.
 * @param {string[]} [weeklyPlan.targetPosition] - Posiciones objetivo.
 * @param {string[]} [weeklyPlan.targetLevel] - Niveles objetivo.
 * @param {string[]} [weeklyPlan.targetGoal] - Objetivos cubiertos.
 * @returns {number} Score entre 0 y 100.
 */
playerProfileSchema.methods.getMatchScore = function getMatchScore(weeklyPlan) {
  if (!weeklyPlan) return 0;
  let score = 0;

  const positions = weeklyPlan.targetPosition || [];
  if (positions.includes('all') || positions.includes(this.position)) {
    score += SCORE_POSITION;
  }

  const levels = weeklyPlan.targetLevel || [];
  if (levels.includes(this.level)) score += SCORE_LEVEL;

  const goals = weeklyPlan.targetGoal || [];
  if (goals.includes(this.primaryGoal)) score += SCORE_GOAL;

  return score;
};

module.exports = mongoose.model('PlayerProfile', playerProfileSchema);
