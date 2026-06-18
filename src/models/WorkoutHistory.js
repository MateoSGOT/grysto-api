'use strict';

/**
 * @file Model WorkoutHistory — registro histórico de sesiones completadas.
 * Datos denormalizados (routineTitle) para reportes rápidos.
 */

const mongoose = require('mongoose');

const workoutHistorySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    routineId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Routine',
      required: true,
    },
    routineTitle: { type: String, required: true },
    userPlanId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'UserPlan',
      default: null,
    },
    dayNumber: {
      type: Number,
      default: null,
      min: [1, 'El día debe estar entre 1 y 7'],
      max: [7, 'El día debe estar entre 1 y 7'],
    },
    completedAt: { type: Date, required: true },
    realDuration_min: { type: Number, default: null },
    exercisesCompleted: {
      type: Number,
      required: true,
      min: [0, 'No puede ser negativo'],
    },
    totalExercises: {
      type: Number,
      required: true,
      min: [0, 'No puede ser negativo'],
    },
    completed: { type: Boolean, required: true },
    notes: {
      type: String,
      default: null,
      maxlength: [500, 'Las notas no pueden superar 500 caracteres'],
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

workoutHistorySchema.index({ userId: 1, completedAt: -1 });

/** Porcentaje de ejercicios completados (1 decimal, 0 si no hay total). */
workoutHistorySchema.virtual('completionRate').get(function completionRate() {
  if (!this.totalExercises || this.totalExercises === 0) return 0;
  return Math.round((this.exercisesCompleted / this.totalExercises) * 1000) / 10;
});

/**
 * Estadísticas agregadas de entrenamiento de un usuario.
 *
 * @param {mongoose.Types.ObjectId|string} userId - ID del usuario.
 * @returns {Promise<{
 *   totalSessions: number,
 *   completedSessions: number,
 *   totalMinutes: number,
 *   completionRate: number,
 *   lastSessionAt: Date|null
 * }>} Estadísticas.
 */
workoutHistorySchema.statics.getStats = async function getStats(userId) {
  const id = new mongoose.Types.ObjectId(String(userId));
  const [stats] = await this.aggregate([
    { $match: { userId: id } },
    {
      $group: {
        _id: null,
        totalSessions: { $sum: 1 },
        completedSessions: {
          $sum: { $cond: ['$completed', 1, 0] },
        },
        totalMinutes: { $sum: { $ifNull: ['$realDuration_min', 0] } },
        lastSessionAt: { $max: '$completedAt' },
      },
    },
  ]);

  if (!stats) {
    return {
      totalSessions: 0,
      completedSessions: 0,
      totalMinutes: 0,
      completionRate: 0,
      lastSessionAt: null,
    };
  }

  const completionRate =
    stats.totalSessions === 0
      ? 0
      : Math.round((stats.completedSessions / stats.totalSessions) * 1000) / 10;

  return {
    totalSessions: stats.totalSessions,
    completedSessions: stats.completedSessions,
    totalMinutes: stats.totalMinutes,
    completionRate,
    lastSessionAt: stats.lastSessionAt || null,
  };
};

module.exports = mongoose.model('WorkoutHistory', workoutHistorySchema);
