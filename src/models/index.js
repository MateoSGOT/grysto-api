'use strict';

/**
 * @file Punto único de acceso a los 13 models de Mongoose.
 */

const User = require('./User');
const PlayerProfile = require('./PlayerProfile');
const Exercise = require('./Exercise');
const Routine = require('./Routine');
const WeeklyPlan = require('./WeeklyPlan');
const UserPlan = require('./UserPlan');
const WorkoutHistory = require('./WorkoutHistory');
const CoachConversation = require('./CoachConversation');
const Subscription = require('./Subscription');
const PasswordResetToken = require('./PasswordResetToken');
const EmailVerificationToken = require('./EmailVerificationToken');
const GymInfo = require('./GymInfo');

module.exports = {
  User,
  PlayerProfile,
  Exercise,
  Routine,
  WeeklyPlan,
  UserPlan,
  WorkoutHistory,
  CoachConversation,
  Subscription,
  PasswordResetToken,
  EmailVerificationToken,
  GymInfo,
};
