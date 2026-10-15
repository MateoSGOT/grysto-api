'use strict';

/**
 * @file Punto único de acceso a los 12 models de Mongoose.
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
const AuthCode = require('./AuthCode');
const RefreshToken = require('./RefreshToken');
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
  AuthCode,
  RefreshToken,
  GymInfo,
};
