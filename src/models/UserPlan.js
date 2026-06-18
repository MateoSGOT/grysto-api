'use strict';

/**
 * @file Model UserPlan — instancia de un plan asignado a un usuario,
 * con seguimiento de progreso día a día.
 */

const mongoose = require('mongoose');
const {
  PLAN_SOURCE,
  PLAN_STATUS,
  valuesOf,
} = require('../constants/enums');

const MS_PER_DAY = 1000 * 60 * 60 * 24;

const progressSchema = new mongoose.Schema(
  {
    dayNumber: {
      type: Number,
      required: true,
      min: [1, 'El día debe estar entre 1 y 7'],
      max: [7, 'El día debe estar entre 1 y 7'],
    },
    completed: { type: Boolean, default: false },
    completedAt: { type: Date, default: null },
    skipped: { type: Boolean, default: false },
  },
  { _id: false }
);

const userPlanSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    weeklyPlanId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WeeklyPlan',
      default: null,
    },
    isAIGenerated: { type: Boolean, default: false },
    aiGeneratedContent: { type: mongoose.Schema.Types.Mixed, default: null },
    source: { type: String, enum: valuesOf(PLAN_SOURCE), required: true },
    status: {
      type: String,
      enum: valuesOf(PLAN_STATUS),
      default: PLAN_STATUS.ACTIVE,
    },
    startedAt: { type: Date, required: true },
    endsAt: { type: Date, default: null },
    progress: { type: [progressSchema], default: [] },
    completionPercentage: {
      type: Number,
      default: 0,
      min: [0, 'El porcentaje mínimo es 0'],
      max: [100, 'El porcentaje máximo es 100'],
    },
  },
  { timestamps: true, versionKey: false }
);

userPlanSchema.index({ userId: 1, status: 1 });

/** Indica si el plan ya expiró respecto a `endsAt`. */
userPlanSchema.virtual('isExpired').get(function isExpired() {
  if (!this.endsAt) return false;
  return this.endsAt.getTime() < Date.now();
});

/** Días restantes hasta `endsAt` (0 si ya expiró o no hay fecha). */
userPlanSchema.virtual('daysRemaining').get(function daysRemaining() {
  if (!this.endsAt) return 0;
  const diff = this.endsAt.getTime() - Date.now();
  if (diff <= 0) return 0;
  return Math.ceil(diff / MS_PER_DAY);
});

/**
 * Recalcula el porcentaje de avance desde `progress` y persiste el cambio.
 *
 * @returns {Promise<mongoose.Document>} El documento guardado.
 */
userPlanSchema.methods.recalculateCompletion =
  async function recalculateCompletion() {
    const total = this.progress.length;
    if (total === 0) {
      this.completionPercentage = 0;
    } else {
      const done = this.progress.filter((p) => p.completed).length;
      this.completionPercentage = Math.round((done / total) * 100);
    }
    return this.save();
  };

module.exports = mongoose.model('UserPlan', userPlanSchema);
