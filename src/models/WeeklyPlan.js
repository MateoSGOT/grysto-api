'use strict';

/**
 * @file Model WeeklyPlan — plantilla de plan semanal (7 días) reusable.
 */

const mongoose = require('mongoose');

const WEEK_LENGTH = 7;

const weeklyPlanDaySchema = new mongoose.Schema(
  {
    dayNumber: {
      type: Number,
      required: true,
      min: [1, 'El día debe estar entre 1 y 7'],
      max: [7, 'El día debe estar entre 1 y 7'],
    },
    category: { type: String, required: true },
    title: { type: String, required: true },
    isRestDay: { type: Boolean, default: false },
    routines: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Routine' }],
      default: [],
    },
  },
  { _id: false }
);

const weeklyPlanSchema = new mongoose.Schema(
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
    targetPosition: { type: [String], required: true },
    targetLevel: { type: [String], required: true },
    targetGoal: { type: [String], required: true },
    isPremium: { type: Boolean, default: false },
    days: {
      type: [weeklyPlanDaySchema],
      required: true,
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length === WEEK_LENGTH,
        message: 'El plan semanal debe tener exactamente 7 días',
      },
    },
    coverImage: { type: String, default: null },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, versionKey: false }
);

weeklyPlanSchema.index({ targetPosition: 1, targetLevel: 1, targetGoal: 1 });
weeklyPlanSchema.index({ isActive: 1 });

module.exports = mongoose.model('WeeklyPlan', weeklyPlanSchema, 'weeklyPlans');
