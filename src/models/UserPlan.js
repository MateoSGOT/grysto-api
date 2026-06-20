'use strict';

/**
 * @file Model UserPlan — asignación de UN plan semanal a un usuario, con
 * CICLOS recurrentes y SOBRECARGA PROGRESIVA. El plan no "termina": al
 * completar los 7 días inicia un nuevo ciclo con cargas progresadas.
 */

const mongoose = require('mongoose');
const { PLAN_SOURCE, PLAN_STATUS, valuesOf } = require('../constants/enums');
const { getProgressionRule } = require('../constants/progression');

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const WEEK_DAYS = 7;

/** Progreso de un día dentro de un ciclo. */
const dayProgressSchema = new mongoose.Schema(
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

/** Carga de un ejercicio en un ciclo (sobrecarga progresiva). */
const loadSchema = new mongoose.Schema(
  {
    exerciseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Exercise',
      required: true,
    },
    category: { type: String, required: true },
    suggestedValue: { type: Number, required: true },
    actualValue: { type: Number, default: null },
    metric: { type: String, required: true },
    unit: { type: String, required: true },
    confirmed: { type: Boolean, default: false },
  },
  { _id: false }
);

/** Un ciclo semanal: cargas + progreso de los 7 días. */
const cycleSchema = new mongoose.Schema(
  {
    cycleNumber: { type: Number, required: true, min: 1 },
    startedAt: { type: Date, required: true },
    completedAt: { type: Date, default: null },
    loads: { type: [loadSchema], default: [] },
    daysProgress: { type: [dayProgressSchema], default: [] },
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
    // Campos legacy mantenidos por compatibilidad con el validator de Atlas.
    progress: { type: [dayProgressSchema], default: [] },
    completionPercentage: {
      type: Number,
      default: 0,
      min: [0, 'El porcentaje mínimo es 0'],
      max: [100, 'El porcentaje máximo es 100'],
    },
    // Ciclos recurrentes con sobrecarga progresiva.
    currentCycle: { type: Number, default: 1, min: 1 },
    cycles: { type: [cycleSchema], default: [] },
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
 * Crea el array de progreso de 7 días en blanco.
 *
 * @returns {Array<Object>} Días 1..7 sin completar.
 */
function freshDaysProgress() {
  return Array.from({ length: WEEK_DAYS }, (_, i) => ({
    dayNumber: i + 1,
    completed: false,
    completedAt: null,
    skipped: false,
  }));
}

/**
 * Devuelve el ciclo activo (el de `currentCycle`).
 *
 * @returns {mongoose.Document|null} Subdocumento del ciclo actual o null.
 */
userPlanSchema.methods.getCurrentCycle = function getCurrentCycle() {
  return (
    this.cycles.find((c) => c.cycleNumber === this.currentCycle) ||
    this.cycles[this.cycles.length - 1] ||
    null
  );
};

/**
 * Registra el valor real que hizo el usuario para un ejercicio en el ciclo
 * actual. Muta en memoria; el caller debe persistir con `save()`.
 *
 * @param {mongoose.Types.ObjectId|string} exerciseId - Ejercicio.
 * @param {number} actualValue - Valor real realizado.
 * @returns {Object|null} La carga actualizada, o null si no existe.
 */
userPlanSchema.methods.confirmLoad = function confirmLoad(exerciseId, actualValue) {
  const cycle = this.getCurrentCycle();
  if (!cycle) return null;
  const load = cycle.loads.find(
    (l) => String(l.exerciseId) === String(exerciseId)
  );
  if (!load) return null;
  load.actualValue = actualValue;
  load.confirmed = true;
  return load;
};

/**
 * Cierra el ciclo actual e inicia el siguiente con cargas SUGERIDAS,
 * calculadas desde el valor confirmado (o el sugerido si no se confirmó) más
 * el incremento de PROGRESSION_RULES según la categoría de cada ejercicio.
 * Muta en memoria; el caller debe persistir con `save()`.
 *
 * @returns {mongoose.Document} El UserPlan (this) con el nuevo ciclo.
 */
userPlanSchema.methods.startNewCycle = function startNewCycle() {
  const current = this.getCurrentCycle();
  if (current) current.completedAt = new Date();

  const prevLoads = current ? current.loads : [];
  const nextLoads = prevLoads.map((l) => {
    const rule = getProgressionRule(l.category);
    const base =
      l.confirmed && l.actualValue != null ? l.actualValue : l.suggestedValue;
    return {
      exerciseId: l.exerciseId,
      category: l.category,
      suggestedValue: base + rule.defaultIncrement,
      actualValue: null,
      metric: l.metric,
      unit: l.unit,
      confirmed: false,
    };
  });

  this.currentCycle += 1;
  this.cycles.push({
    cycleNumber: this.currentCycle,
    startedAt: new Date(),
    completedAt: null,
    loads: nextLoads,
    daysProgress: freshDaysProgress(),
  });

  return this;
};

module.exports = mongoose.model('UserPlan', userPlanSchema, 'userPlans');
module.exports.freshDaysProgress = freshDaysProgress;
