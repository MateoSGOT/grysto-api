'use strict';

/**
 * @file Contexto del PLAN para el Coach IA. Resuelve el día de hoy del usuario
 * (categoría, ejercicios con su prescripción y sus cargas) y lo formatea como
 * un bloque de texto legible que se inyecta en el system prompt. Así el coach
 * puede aconsejar sobre los ejercicios CONCRETOS de hoy y distingue las cargas
 * calibradas (valor real del jugador) de las que aún no lo están.
 *
 * NOTA: usa los ejercicios del plan tal cual (sin aplicar sustituciones del
 * usuario; eso es una mejora aparte).
 */

const { Routine } = require('../../models');
const userPlanService = require('../userPlan.service');

/**
 * Formatea un número quitando decimales innecesarios (60 en vez de 60.0).
 *
 * @param {number} n - Valor.
 * @returns {string} Número legible.
 */
function fmtNum(n) {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

/**
 * Describe un ejercicio de hoy: nombre + prescripción + estado de la carga.
 * Distingue calibrada (muestra el valor real) de SIN REGISTRAR (no inventa).
 *
 * @param {{ name: string, sets: ?number, reps: ?string, seconds: ?number,
 *   load: ?{ calibrated: boolean, suggestedValue: ?number, unit: string } }} ex
 * @returns {string} Línea descriptiva.
 */
function describeExercise(ex) {
  const sets = ex.sets ?? 1;
  const presc =
    ex.seconds != null ? `${sets}×${ex.seconds}s` : `${sets}×${ex.reps ?? '?'} reps`;

  const l = ex.load;
  let loadText = null;
  if (l && l.calibrated && l.suggestedValue != null) {
    loadText = `carga registrada: ${fmtNum(l.suggestedValue)} ${l.unit}`;
  } else if (l) {
    loadText = 'SIN REGISTRAR (el jugador aún no ha calibrado su marca; no inventes un valor)';
  }

  return `${ex.name} — ${presc}${loadText ? ` — ${loadText}` : ''}`;
}

/**
 * Formatea el contexto del plan (ya resuelto) como texto para el system prompt.
 * PURO: no toca la base de datos. Devuelve null si no hay contexto.
 *
 * @param {Object|null} ctx - Datos resueltos:
 *   { planName, currentCycle, completedDays,
 *     day: { dayNumber, category, title, isRestDay },
 *     exercises: Array<{ name, sets, reps, seconds, load }> }
 * @returns {string|null} Bloque de texto o null.
 */
function formatPlanContext(ctx) {
  if (!ctx || !ctx.day) return null;

  const lines = [
    'CONTEXTO DEL PLAN DEL JUGADOR (úsalo para dar consejos ESPECÍFICOS de hoy):',
    `- Plan: "${ctx.planName}", ciclo ${ctx.currentCycle}.`,
    `- Progreso de la semana: ${ctx.completedDays} de 7 días completados.`,
  ];

  const d = ctx.day;
  if (d.isRestDay) {
    lines.push(
      `- Hoy (día ${d.dayNumber}) es de DESCANSO: no hay ejercicios; refuerza la importancia de recuperar.`
    );
    return lines.join('\n');
  }

  lines.push(
    `- Hoy (día ${d.dayNumber}) es de categoría ${String(d.category).toUpperCase()}: "${d.title}".`
  );

  if (!ctx.exercises || ctx.exercises.length === 0) {
    lines.push('- (Hoy no tiene ejercicios detallados.)');
    return lines.join('\n');
  }

  lines.push('- Ejercicios de hoy:');
  for (const ex of ctx.exercises) {
    lines.push(`  · ${describeExercise(ex)}`);
  }
  return lines.join('\n');
}

/**
 * Resuelve el contexto del plan del usuario y lo devuelve YA formateado como
 * texto (o null si no tiene plan / algo falla — el chat nunca debe romperse por
 * esto). "Hoy" = primer día no completado del ciclo actual.
 *
 * @param {string} userId - Usuario.
 * @returns {Promise<string|null>} Bloque de contexto para el prompt, o null.
 */
async function resolveCoachContext(userId) {
  try {
    const plan = await userPlanService.getActivePlan(userId);
    if (!plan || !plan.weeklyPlanId) return null;

    const weekly = plan.weeklyPlanId; // poblado por getActivePlan
    const cycle = plan.currentCycleData;
    const daysProgress = cycle?.daysProgress ?? [];
    const completedDays = daysProgress.filter((dp) => dp.completed).length;

    // Hoy = primer día no completado (cae al día 1 si todos están completos).
    const todayNumber =
      daysProgress.find((dp) => !dp.completed)?.dayNumber ?? 1;
    const days = [...(weekly.days ?? [])].sort(
      (a, b) => a.dayNumber - b.dayNumber
    );
    const day = days.find((x) => x.dayNumber === todayNumber) ?? days[0];
    if (!day) return null;

    const base = {
      planName: weekly.name,
      currentCycle: plan.currentCycle,
      completedDays,
      day: {
        dayNumber: day.dayNumber,
        category: day.category,
        title: day.title,
        isRestDay: day.isRestDay,
      },
    };

    if (day.isRestDay || !(day.routines && day.routines.length)) {
      return formatPlanContext({ ...base, exercises: [] });
    }

    // Resuelve las rutinas de hoy con los nombres de sus ejercicios.
    const routines = await Routine.find({ _id: { $in: day.routines } })
      .populate('exercises.exerciseId', 'name')
      .lean();

    const loadsById = new Map(
      (cycle?.loads ?? []).map((l) => [String(l.exerciseId), l])
    );

    const exercises = [];
    // Respeta el orden de las rutinas del día y de los ejercicios dentro.
    for (const rid of day.routines) {
      const r = routines.find((x) => String(x._id) === String(rid));
      if (!r) continue;
      const ordered = [...r.exercises].sort((a, b) => a.order - b.order);
      for (const e of ordered) {
        const info = e.exerciseId; // { _id, name } poblado, o null si no existe
        if (!info) continue;
        exercises.push({
          name: info.name,
          sets: e.sets,
          reps: e.reps,
          seconds: e.seconds,
          load: loadsById.get(String(info._id)) ?? null,
        });
      }
    }

    return formatPlanContext({ ...base, exercises });
  } catch (_) {
    // Ante cualquier fallo, el chat sigue sin contexto de plan (no se rompe).
    return null;
  }
}

module.exports = { resolveCoachContext, formatPlanContext };
