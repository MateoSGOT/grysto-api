'use strict';

/**
 * @file Lógica de negocio de UserPlans: asignación, reglas de cambio de plan
 * (free/premium), ciclos recurrentes y sobrecarga progresiva.
 */

const {
  User,
  UserPlan,
  WeeklyPlan,
  Routine,
  Exercise,
} = require('../models');
const ApiError = require('../utils/ApiError');
const { PLAN_SOURCE, PLAN_STATUS } = require('../constants/enums');
const { getProgressionRule } = require('../constants/progression');
const { freshDaysProgress } = require('../models/UserPlan');

/**
 * Deriva el valor base de una carga desde la prescripción de un ejercicio en
 * una rutina (segundos > reps > sets > 1).
 *
 * @param {Object} entry - Sub-ejercicio de la rutina.
 * @returns {number} Valor base numérico.
 */
function baseValueFromEntry(entry) {
  if (entry.seconds != null) return entry.seconds;
  if (entry.reps != null) {
    const n = Number.parseInt(entry.reps, 10);
    if (!Number.isNaN(n)) return n;
  }
  if (entry.sets != null) return entry.sets;
  return 1;
}

/**
 * Construye las cargas iniciales de un plan: una por cada ejercicio único
 * referenciado en las rutinas del plan, con su métrica/unidad según la
 * categoría y un valor sugerido base.
 *
 * @param {import('mongoose').Document} weeklyPlan - Plan semanal.
 * @returns {Promise<Array<Object>>} Cargas iniciales.
 */
async function buildInitialLoads(weeklyPlan) {
  const routineIds = weeklyPlan.days.flatMap((d) => d.routines || []);
  if (routineIds.length === 0) return [];

  const routines = await Routine.find({ _id: { $in: routineIds } }).lean();

  // Primera aparición de cada ejercicio (dedupe por exerciseId).
  const entryByExercise = new Map();
  for (const routine of routines) {
    for (const ex of routine.exercises || []) {
      const key = String(ex.exerciseId);
      if (!entryByExercise.has(key)) entryByExercise.set(key, ex);
    }
  }
  if (entryByExercise.size === 0) return [];

  const exercises = await Exercise.find({
    _id: { $in: [...entryByExercise.keys()] },
  })
    .select('_id category')
    .lean();
  const categoryById = new Map(exercises.map((e) => [String(e._id), e.category]));

  const loads = [];
  for (const [key, entry] of entryByExercise) {
    const category = categoryById.get(key);
    if (!category) continue; // ejercicio inexistente, se omite
    const rule = getProgressionRule(category);
    loads.push({
      exerciseId: entry.exerciseId,
      category,
      suggestedValue: baseValueFromEntry(entry),
      actualValue: null,
      metric: rule.metric,
      unit: rule.unit,
      confirmed: false,
    });
  }
  return loads;
}

/**
 * Crea un UserPlan activo con su primer ciclo (cargas + 7 días en blanco).
 * Reutilizable por la activación manual y por la recomendación automática.
 *
 * @param {Object} params - Parámetros.
 * @param {mongoose.Types.ObjectId|string} params.userId - Usuario.
 * @param {import('mongoose').Document} params.weeklyPlan - Plan semanal.
 * @param {string} params.source - Origen (enum PLAN_SOURCE).
 * @returns {Promise<import('mongoose').Document>} UserPlan creado.
 */
async function createUserPlanForUser({ userId, weeklyPlan, source }) {
  const loads = await buildInitialLoads(weeklyPlan);
  const now = new Date();
  return UserPlan.create({
    userId,
    weeklyPlanId: weeklyPlan._id,
    source,
    status: PLAN_STATUS.ACTIVE,
    startedAt: now,
    currentCycle: 1,
    cycles: [
      {
        cycleNumber: 1,
        startedAt: now,
        completedAt: null,
        loads,
        daysProgress: freshDaysProgress(),
      },
    ],
  });
}

/**
 * Busca el UserPlan activo del usuario.
 *
 * @param {string} userId - Usuario.
 * @returns {Promise<import('mongoose').Document|null>} Plan activo o null.
 */
function findActivePlan(userId) {
  return UserPlan.findOne({ userId, status: PLAN_STATUS.ACTIVE });
}

/**
 * Activa un plan del catálogo para el usuario, aplicando las reglas de
 * cambio de plan (free/premium).
 *
 * @param {string} userId - Usuario.
 * @param {string} weeklyPlanId - Plan a activar.
 * @returns {Promise<import('mongoose').Document>} UserPlan activo.
 * @throws {ApiError} 404/403/409 según las reglas de negocio.
 */
async function activatePlan(userId, weeklyPlanId) {
  const [user, weeklyPlan] = await Promise.all([
    User.findById(userId),
    WeeklyPlan.findById(weeklyPlanId),
  ]);

  if (!weeklyPlan || !weeklyPlan.isActive) {
    throw ApiError.notFound('Plan semanal no encontrado o inactivo');
  }

  const isPremiumActive = Boolean(user.fullPlan.isPremiumActive);

  // Regla premium: planes premium solo para usuarios premium activos.
  if (weeklyPlan.isPremium && !isPremiumActive) {
    throw ApiError.forbidden('Este plan es solo para usuarios premium');
  }

  const active = await findActivePlan(userId);

  // Sin plan activo → alta normal.
  if (!active) {
    return createUserPlanForUser({
      userId,
      weeklyPlan,
      source: PLAN_SOURCE.SELECTED,
    });
  }

  // Premium con plan activo → debe abandonar explícitamente primero.
  if (isPremiumActive) {
    throw ApiError.conflict(
      'Debes abandonar tu plan actual antes de activar uno nuevo'
    );
  }

  // Free con plan activo: solo puede cambiar si el actual fue recomendado.
  if (active.source === PLAN_SOURCE.RECOMMENDED) {
    active.status = PLAN_STATUS.ABANDONED;
    await active.save();
    return createUserPlanForUser({
      userId,
      weeklyPlan,
      source: PLAN_SOURCE.SELECTED,
    });
  }

  throw ApiError.forbidden(
    'Los usuarios free no pueden cambiar de plan. Hazte premium para cambiar tu entrenamiento.'
  );
}

/**
 * Abandona un plan (solo usuarios premium). Si no se indica userPlanId, se
 * abandona el plan activo del usuario.
 *
 * @param {string} userId - Usuario.
 * @param {string|null} [userPlanId=null] - Plan a abandonar.
 * @returns {Promise<import('mongoose').Document>} Plan abandonado.
 * @throws {ApiError} 403/404/409 según el caso.
 */
async function abandonPlan(userId, userPlanId = null) {
  const user = await User.findById(userId);
  if (!user.fullPlan.isPremiumActive) {
    throw ApiError.forbidden('Solo los usuarios premium pueden abandonar su plan');
  }

  const plan = userPlanId
    ? await UserPlan.findById(userPlanId)
    : await findActivePlan(userId);

  if (!plan || String(plan.userId) !== String(userId)) {
    throw ApiError.notFound('Plan no encontrado');
  }
  if (plan.status !== PLAN_STATUS.ACTIVE) {
    throw ApiError.conflict('El plan no está activo');
  }

  plan.status = PLAN_STATUS.ABANDONED;
  await plan.save();
  return plan;
}

/**
 * Devuelve el plan activo del usuario con el plan semanal poblado y el ciclo
 * actual resuelto.
 *
 * @param {string} userId - Usuario.
 * @returns {Promise<Object|null>} Plan activo + currentCycleData, o null.
 */
async function getActivePlan(userId) {
  const plan = await UserPlan.findOne({
    userId,
    status: PLAN_STATUS.ACTIVE,
  }).populate('weeklyPlanId');
  if (!plan) return null;

  return { ...plan.toObject(), currentCycleData: plan.getCurrentCycle() };
}

/**
 * Marca un día como completado en el ciclo actual. Si se completan los 7,
 * inicia el siguiente ciclo con cargas progresadas (el plan NO termina).
 *
 * @param {string} userId - Usuario.
 * @param {number} dayNumber - Día (1-7).
 * @returns {Promise<{ cycleCompleted: boolean, currentCycle: number, message: string, plan: Object }>}
 * @throws {ApiError} 404 si no hay plan activo o el día no existe.
 */
async function confirmDay(userId, dayNumber) {
  const plan = await findActivePlan(userId);
  if (!plan) throw ApiError.notFound('No tienes un plan activo');

  const cycle = plan.getCurrentCycle();
  if (!cycle) throw ApiError.conflict('El plan no tiene un ciclo activo');

  const day = cycle.daysProgress.find((d) => d.dayNumber === dayNumber);
  if (!day) throw ApiError.notFound('Día no encontrado en el ciclo actual');

  day.completed = true;
  day.completedAt = new Date();
  day.skipped = false;

  const allDone =
    cycle.daysProgress.length === 7 &&
    cycle.daysProgress.every((d) => d.completed);

  if (allDone) {
    plan.startNewCycle();
    await plan.save();
    return {
      cycleCompleted: true,
      currentCycle: plan.currentCycle,
      message: `¡Semana completada! 🏀 Iniciaste el ciclo ${plan.currentCycle} con cargas progresadas. ¡A seguir mejorando!`,
      plan,
    };
  }

  await plan.save();
  return {
    cycleCompleted: false,
    currentCycle: plan.currentCycle,
    message: 'Día confirmado',
    plan,
  };
}

/**
 * Registra la carga real realizada por el usuario en un ejercicio.
 *
 * @param {string} userId - Usuario.
 * @param {string} exerciseId - Ejercicio.
 * @param {number} actualValue - Valor real.
 * @returns {Promise<Object>} La carga confirmada.
 * @throws {ApiError} 404 si no hay plan activo o el ejercicio no está en el plan.
 */
async function confirmLoad(userId, exerciseId, actualValue) {
  const plan = await findActivePlan(userId);
  if (!plan) throw ApiError.notFound('No tienes un plan activo');

  const load = plan.confirmLoad(exerciseId, actualValue);
  if (!load) {
    throw ApiError.notFound('Ejercicio no encontrado en el ciclo actual');
  }
  await plan.save();
  return load;
}

/**
 * Ajusta la carga SUGERIDA de un ejercicio antes de realizarla.
 *
 * @param {string} userId - Usuario.
 * @param {string} exerciseId - Ejercicio.
 * @param {number} newValue - Nuevo valor sugerido.
 * @returns {Promise<Object>} La carga ajustada.
 * @throws {ApiError} 404 si no hay plan activo o el ejercicio no está en el plan.
 */
async function adjustSuggestedLoad(userId, exerciseId, newValue) {
  const plan = await findActivePlan(userId);
  if (!plan) throw ApiError.notFound('No tienes un plan activo');

  const cycle = plan.getCurrentCycle();
  const load = cycle?.loads.find(
    (l) => String(l.exerciseId) === String(exerciseId)
  );
  if (!load) {
    throw ApiError.notFound('Ejercicio no encontrado en el ciclo actual');
  }
  load.suggestedValue = newValue;
  await plan.save();
  return load;
}

/**
 * Calcula la sobrecarga sugerida para el PRÓXIMO ciclo sin iniciarlo.
 *
 * @param {string} userId - Usuario.
 * @returns {Promise<{ currentCycle: number, nextCycle: number, preview: object[] }>}
 * @throws {ApiError} 404 si no hay plan activo.
 */
async function getProgressionPreview(userId) {
  const plan = await findActivePlan(userId);
  if (!plan) throw ApiError.notFound('No tienes un plan activo');

  const cycle = plan.getCurrentCycle();
  const preview = (cycle?.loads || []).map((l) => {
    const rule = getProgressionRule(l.category);
    const base =
      l.confirmed && l.actualValue != null ? l.actualValue : l.suggestedValue;
    return {
      exerciseId: l.exerciseId,
      category: l.category,
      metric: l.metric,
      unit: l.unit,
      currentValue: base,
      nextSuggestedValue: base + rule.defaultIncrement,
      increment: rule.defaultIncrement,
      description: rule.description,
    };
  });

  return {
    currentCycle: plan.currentCycle,
    nextCycle: plan.currentCycle + 1,
    preview,
  };
}

module.exports = {
  createUserPlanForUser,
  activatePlan,
  abandonPlan,
  getActivePlan,
  confirmDay,
  confirmLoad,
  adjustSuggestedLoad,
  getProgressionPreview,
};
