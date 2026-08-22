'use strict';

/**
 * @file Lógica de negocio de UserPlans: asignación, reglas de cambio de plan
 * (free/premium), ciclos recurrentes y sobrecarga progresiva.
 */

const mongoose = require('mongoose');
const {
  User,
  UserPlan,
  WeeklyPlan,
  Routine,
  Exercise,
} = require('../models');
const ApiError = require('../utils/ApiError');
const { PLAN_SOURCE, PLAN_STATUS } = require('../constants/enums');
const {
  getProgressionRule,
  validateMetricValue,
} = require('../constants/progression');
const { freshDaysProgress } = require('../models/UserPlan');

/**
 * Construye las cargas iniciales de un plan: una por cada ejercicio único
 * referenciado en las rutinas del plan, con su métrica/unidad según la
 * categoría. Las cargas nacen SIN CALIBRAR (`suggestedValue: null`,
 * `calibrated: false`): el sistema no puede adivinar cuánto peso/salto/tiro
 * hace el usuario, así que NO se deriva ningún valor de reps/sets. La base se
 * fija cuando el usuario registra su marca real (confirm-load).
 *
 * @param {import('mongoose').Document} weeklyPlan - Plan semanal.
 * @returns {Promise<Array<Object>>} Cargas iniciales sin calibrar.
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
      suggestedValue: null, // sin calibrar: se fija con la marca real del usuario
      actualValue: null,
      metric: rule.metric,
      unit: rule.unit,
      confirmed: false,
      calibrated: false,
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

  // Localiza la carga para validar el valor real contra el rango de su métrica
  // ANTES de mutar (si el ejercicio no está, es 404, no un valor inválido).
  const cycle = plan.getCurrentCycle();
  const target = cycle?.loads.find(
    (l) => String(l.exerciseId) === String(exerciseId)
  );
  if (!target) {
    throw ApiError.notFound('Ejercicio no encontrado en el ciclo actual');
  }

  const check = validateMetricValue(target.metric, actualValue);
  if (!check.ok) throw ApiError.badRequest(check.message);

  const load = plan.confirmLoad(exerciseId, actualValue);
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

  const check = validateMetricValue(load.metric, newValue);
  if (!check.ok) throw ApiError.badRequest(check.message);

  // Fijar manualmente la carga sugerida también calibra: el usuario está
  // declarando su base. Mantiene el invariante suggestedValue!=null ⇔ calibrated.
  load.suggestedValue = newValue;
  load.calibrated = true;
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
    // Sin calibrar → no hay base real: no inventamos progresión.
    if (!l.calibrated) {
      return {
        exerciseId: l.exerciseId,
        category: l.category,
        metric: l.metric,
        unit: l.unit,
        calibrated: false,
        currentValue: null,
        nextSuggestedValue: null,
        increment: rule.defaultIncrement,
        description:
          'Pendiente de calibrar: registra tu marca real para empezar a progresar.',
      };
    }
    const base = l.actualValue != null ? l.actualValue : l.suggestedValue;
    return {
      exerciseId: l.exerciseId,
      category: l.category,
      metric: l.metric,
      unit: l.unit,
      calibrated: true,
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

/**
 * Devuelve los exerciseId EFECTIVOS del plan (los del catálogo con las
 * sustituciones ya aplicadas), como strings.
 *
 * @param {import('mongoose').Document} plan - UserPlan activo.
 * @returns {Promise<Set<string>>} Ids efectivos.
 */
async function effectiveExerciseIds(plan) {
  const weeklyPlan = await WeeklyPlan.findById(plan.weeklyPlanId).lean();
  if (!weeklyPlan) return new Set();
  const routineIds = (weeklyPlan.days || []).flatMap((d) => d.routines || []);
  const routines = await Routine.find({ _id: { $in: routineIds } })
    .select('exercises.exerciseId')
    .lean();

  const subByOriginal = new Map(
    plan.substitutions.map((s) => [String(s.originalExerciseId), String(s.newExerciseId)])
  );
  const effective = new Set();
  for (const r of routines) {
    for (const e of r.exercises || []) {
      const cid = String(e.exerciseId);
      effective.add(subByOriginal.get(cid) || cid);
    }
  }
  return effective;
}

/**
 * Sustituye un ejercicio del plan del usuario por otro EQUIVALENTE (misma
 * categoría). Permanente: registra un override en el UserPlan (el catálogo,
 * compartido, no se toca). El load del sustituto nace SIN CALIBRAR. Ciclos
 * pasados y días completados no se tocan.
 *
 * @param {string} userId - Usuario.
 * @param {string} originalExerciseId - Ejercicio EFECTIVO actual (el que ve el usuario).
 * @param {string} newExerciseId - Sustituto elegido.
 * @returns {Promise<Object>} Plan activo con `currentCycleData`.
 * @throws {ApiError} 404/422 según las reglas.
 */
async function substituteExercise(userId, originalExerciseId, newExerciseId) {
  const plan = await findActivePlan(userId);
  if (!plan) throw ApiError.notFound('No tienes un plan activo');

  if (String(originalExerciseId) === String(newExerciseId)) {
    throw ApiError.unprocessable('Ese ya es tu ejercicio actual');
  }

  const [outgoing, newEx] = await Promise.all([
    Exercise.findById(originalExerciseId).lean(),
    Exercise.findById(newExerciseId).lean(),
  ]);
  if (!newEx) throw ApiError.notFound('El ejercicio sustituto no existe');
  if (!outgoing) throw ApiError.notFound('El ejercicio a sustituir no existe');

  // El ejercicio saliente debe estar en el plan del usuario (efectivo).
  const effective = await effectiveExerciseIds(plan);
  if (!effective.has(String(originalExerciseId))) {
    throw ApiError.unprocessable('Ese ejercicio no está en tu plan');
  }

  // Misma categoría (si no, rompería métrica/progresión).
  if (newEx.category !== outgoing.category) {
    throw ApiError.unprocessable(
      'Solo puedes sustituir por un ejercicio de la misma categoría'
    );
  }

  // Ancla = el ejercicio del catálogo. Si el saliente ya era un sustituto,
  // el ancla es su `originalExerciseId` (re-sustituir ACTUALIZA, no acumula).
  const existing = plan.substitutions.find(
    (s) => String(s.newExerciseId) === String(originalExerciseId)
  );
  const anchorId = existing
    ? String(existing.originalExerciseId)
    : String(originalExerciseId);

  // Actualiza el override: quita el del ancla y, si no es un "revert" al
  // propio ancla, agrega el nuevo.
  plan.substitutions = plan.substitutions.filter(
    (s) => String(s.originalExerciseId) !== anchorId
  );
  if (String(newExerciseId) !== anchorId) {
    plan.substitutions.push({
      originalExerciseId: anchorId,
      newExerciseId,
      category: newEx.category,
      substitutedAt: new Date(),
    });
  }

  // Ajusta los loads del CICLO ACTUAL: fuera el del saliente (y cualquiera del
  // nuevo, para no duplicar); entra el del nuevo SIN CALIBRAR.
  const cycle = plan.getCurrentCycle();
  if (cycle) {
    for (let i = cycle.loads.length - 1; i >= 0; i -= 1) {
      const id = String(cycle.loads[i].exerciseId);
      if (id === String(originalExerciseId) || id === String(newExerciseId)) {
        cycle.loads.splice(i, 1);
      }
    }
    const rule = getProgressionRule(newEx.category);
    cycle.loads.push({
      exerciseId: newExerciseId,
      category: newEx.category,
      suggestedValue: null,
      actualValue: null,
      metric: rule.metric,
      unit: rule.unit,
      confirmed: false,
      calibrated: false,
    });
  }

  await plan.save();
  return { ...plan.toObject(), currentCycleData: plan.getCurrentCycle() };
}

// ───────────────────── Cambio de plan (carry-load, premium) ─────────────────

/**
 * Carga el plan destino con sus ejercicios poblados (nombre + categoría) y los
 * agrupa por categoría. Dedup por exerciseId dentro de cada categoría.
 *
 * @param {string} targetPlanId - WeeklyPlan destino.
 * @returns {Promise<{ plan: import('mongoose').Document,
 *   byCategory: Map<string, Array<{ exerciseId: string, name: string }>> }>}
 * @throws {ApiError} 404 si el plan no existe o está inactivo.
 */
async function loadTargetGroupedByCategory(targetPlanId) {
  const plan = await WeeklyPlan.findById(targetPlanId).populate({
    path: 'days.routines',
    populate: { path: 'exercises.exerciseId', select: 'name category' },
  });
  if (!plan || !plan.isActive) {
    throw ApiError.notFound('Plan destino no encontrado');
  }

  const byCategory = new Map();
  for (const day of plan.days) {
    for (const routine of day.routines || []) {
      for (const ex of routine.exercises || []) {
        const info = ex.exerciseId; // { _id, name, category } poblado
        if (!info || !info.category) continue;
        if (!byCategory.has(info.category)) byCategory.set(info.category, new Map());
        byCategory.get(info.category).set(String(info._id), info.name);
      }
    }
  }

  // Map → array de { exerciseId, name } por categoría.
  const grouped = new Map();
  for (const [cat, exMap] of byCategory) {
    grouped.set(
      cat,
      [...exMap].map(([exerciseId, name]) => ({ exerciseId, name }))
    );
  }
  return { plan, byCategory: grouped };
}

/**
 * Valida las precondiciones del cambio de plan y devuelve el contexto común.
 * Cambio-con-carry-load es EXCLUSIVO de premium.
 *
 * @param {string} userId - Usuario.
 * @param {string} targetPlanId - WeeklyPlan destino.
 * @returns {Promise<{ active: import('mongoose').Document }>} Plan activo.
 * @throws {ApiError} 403 no premium; 404 sin plan activo; 400 mismo plan.
 */
async function assertChangeAllowed(userId, targetPlanId) {
  const user = await User.findById(userId);
  if (!user || !user.isPremiumActive()) {
    throw ApiError.forbidden(
      'Cambiar de plan conservando tus cargas es exclusivo de premium'
    );
  }
  const active = await findActivePlan(userId);
  if (!active) throw ApiError.notFound('No tienes un plan activo');
  if (String(active.weeklyPlanId) === String(targetPlanId)) {
    throw ApiError.badRequest('Ese ya es tu plan actual');
  }
  return { active };
}

/**
 * Preview del cambio: cruza las cargas CALIBRADAS del ciclo actual con los
 * ejercicios del plan destino, por `category`. El sistema nunca decide el
 * número: solo expone el dato real para que el usuario elija (carry/recalibrar).
 *
 * @param {string} userId - Usuario premium.
 * @param {string} targetPlanId - WeeklyPlan destino.
 * @returns {Promise<{ matches: object[], onlyInCurrentPlan: object[], newInTargetPlan: object[] }>}
 * @throws {ApiError} 403/404/400 según precondiciones.
 */
async function changePreview(userId, targetPlanId) {
  const { active } = await assertChangeAllowed(userId, targetPlanId);
  const { byCategory: targetByCategory } =
    await loadTargetGroupedByCategory(targetPlanId);

  const cycle = active.getCurrentCycle();
  const calibrated = (cycle?.loads || []).filter((l) => l.calibrated);

  // Nombres de los ejercicios calibrados actuales.
  const currentNames = new Map(
    (
      await Exercise.find({ _id: { $in: calibrated.map((l) => l.exerciseId) } })
        .select('name')
        .lean()
    ).map((e) => [String(e._id), e.name])
  );

  const matches = [];
  const onlyInCurrentPlan = [];
  const calibratedCategories = new Set();

  for (const load of calibrated) {
    calibratedCategories.add(load.category);
    const targets = targetByCategory.get(load.category);
    const currentExercise = {
      exerciseId: String(load.exerciseId),
      name: currentNames.get(String(load.exerciseId)) || 'Ejercicio',
      actualValue: load.actualValue,
      metric: load.metric,
      unit: load.unit,
    };
    if (targets && targets.length > 0) {
      matches.push({ category: load.category, currentExercise, targetExercises: targets });
    } else {
      onlyInCurrentPlan.push({
        category: load.category,
        exerciseName: currentExercise.name,
      });
    }
  }

  // Categorías del destino sin carga calibrada previa (informativo).
  const newInTargetPlan = [];
  for (const [cat, exs] of targetByCategory) {
    if (!calibratedCategories.has(cat)) {
      newInTargetPlan.push({ category: cat, exerciseName: exs[0]?.name || 'Ejercicio' });
    }
  }

  return { matches, onlyInCurrentPlan, newInTargetPlan };
}

/**
 * Confirma el cambio de plan (transacción). Cierra el ciclo actual, pasa el
 * userplan a `switched` y crea uno nuevo `active`, aplicando las decisiones de
 * carga: `carry_load` (con match válido) → lleva el valor real ya confirmado;
 * el resto → sin calibrar. Atómico: nunca deja dos planes `active`.
 *
 * @param {string} userId - Usuario premium.
 * @param {string} targetPlanId - WeeklyPlan destino.
 * @param {Array<{ category: string, decision: string, targetExerciseId?: string }>} decisions
 * @returns {Promise<{ _id: string, status: string, weeklyPlanId: string }>} Nuevo plan.
 * @throws {ApiError} 403/404/400/422 según el caso.
 */
async function changePlan(userId, targetPlanId, decisions = []) {
  const { active } = await assertChangeAllowed(userId, targetPlanId);
  const { plan: targetPlan, byCategory: targetByCategory } =
    await loadTargetGroupedByCategory(targetPlanId);

  // Cargas calibradas actuales, indexadas por categoría.
  const cycle = active.getCurrentCycle();
  const calibratedByCategory = new Map(
    (cycle?.loads || [])
      .filter((l) => l.calibrated)
      .map((l) => [l.category, l])
  );

  // Cargas base del plan destino (todas sin calibrar).
  const newLoads = await buildInitialLoads(targetPlan);
  const loadByExerciseId = new Map(newLoads.map((l) => [String(l.exerciseId), l]));

  // Aplica las decisiones de carry_load.
  for (const dec of decisions) {
    if (dec.decision !== 'carry_load') continue;
    const current = calibratedByCategory.get(dec.category);
    if (!current) continue; // no hay carga calibrada en esa categoría: se ignora

    // Ejercicio destino que recibe la carga. Si hay más de uno, exige elegir.
    const targets = targetByCategory.get(dec.category) || [];
    let targetExerciseId = dec.targetExerciseId;
    if (!targetExerciseId) {
      if (targets.length === 1) targetExerciseId = targets[0].exerciseId;
      else if (targets.length > 1) {
        throw ApiError.unprocessable(
          `Elige a qué ejercicio llevar la carga de "${dec.category}" (targetExerciseId)`
        );
      } else {
        continue; // la categoría no existe en el destino
      }
    }

    const target = loadByExerciseId.get(String(targetExerciseId));
    if (!target) continue;

    // metric/unit se derivan de la categoría → siempre coinciden dentro de una
    // misma categoría. Guard defensivo por si eso cambiara (nunca inventar).
    if (target.metric !== current.metric || target.unit !== current.unit) continue;

    const value = current.actualValue != null ? current.actualValue : current.suggestedValue;
    if (value == null) continue;
    target.actualValue = value;
    target.suggestedValue = value; // base para la progresión futura
    target.calibrated = true;
    target.confirmed = true;
  }

  // Transacción: cierra el actual y crea el nuevo, de forma atómica.
  const now = new Date();
  const session = await mongoose.startSession();
  let created;
  try {
    await session.withTransaction(async () => {
      const current = active.getCurrentCycle();
      if (current) current.completedAt = now;
      active.status = PLAN_STATUS.SWITCHED;
      await active.save({ session });

      const [doc] = await UserPlan.create(
        [
          {
            userId,
            weeklyPlanId: targetPlan._id,
            source: PLAN_SOURCE.SELECTED,
            status: PLAN_STATUS.ACTIVE,
            startedAt: now,
            currentCycle: 1,
            cycles: [
              {
                cycleNumber: 1,
                startedAt: now,
                completedAt: null,
                loads: newLoads,
                daysProgress: freshDaysProgress(),
              },
            ],
          },
        ],
        { session }
      );
      created = doc;
    });
  } finally {
    await session.endSession();
  }

  return {
    _id: created._id,
    status: created.status,
    weeklyPlanId: created.weeklyPlanId,
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
  substituteExercise,
  changePreview,
  changePlan,
};
