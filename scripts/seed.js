'use strict';

/**
 * @file SEED IDEMPOTENTE de Grysto: usuarios base + catálogo.
 * Correrlo dos veces NO duplica nada: busca cada entidad por su clave
 * natural y la crea o la actualiza.
 *
 * Crea / asegura:
 * - Admin `mateo@test.com` (role admin, verificado, con PlayerProfile).
 * - Demo `workout.demo@test.com` (user free, verificado, con PlayerProfile y
 *   el plan 1 activo para ver el Home con datos).
 * - Catálogo de `db/seed/catalog.js`: ejercicios (por `name`), rutinas (por
 *   `title`) y planes semanales (por `name`).
 *
 * Contraseñas: SOLO por variables de entorno (nunca en el código ni en logs).
 * Se usan al CREAR el usuario; si ya existe, su contraseña no se toca.
 *
 * Uso (PowerShell, con el validador de Atlas ya aplicado):
 *   $env:SEED_ADMIN_PASSWORD="..."; $env:SEED_DEMO_PASSWORD="..."; node scripts/seed.js --dry-run
 *   $env:SEED_ADMIN_PASSWORD="..."; $env:SEED_DEMO_PASSWORD="..."; node scripts/seed.js
 *
 * `--dry-run`: conecta y LEE, imprime qué crearía/actualizaría, no escribe.
 */

const { connectDB, disconnectDB } = require('../src/config/database');
const { config } = require('../src/config/env');
const {
  User,
  PlayerProfile,
  Exercise,
  Routine,
  WeeklyPlan,
  UserPlan,
} = require('../src/models');
const { ROLES, PLANS, PLAN_STATUS, PLAN_SOURCE, VIDEO_TYPES } = require('../src/constants/enums');
const { createUserPlanForUser } = require('../src/services/userPlan.service');
const { EXERCISES, ROUTINES, WEEKLY_PLANS } = require('../db/seed/catalog');

const DRY = process.argv.includes('--dry-run');

const ADMIN = { nombre: 'Mateo', email: 'mateo@test.com', envPassword: 'SEED_ADMIN_PASSWORD' };
const DEMO = { nombre: 'Demo Workout', email: 'workout.demo@test.com', envPassword: 'SEED_DEMO_PASSWORD' };

/** Perfil del admin (datos genéricos válidos según el validador). */
const ADMIN_PROFILE = {
  position: 'base',
  level: 'avanzado',
  goals: ['velocidad_agilidad', 'fuerza_masa'],
  trainingDaysPerWeek: '5-6',
  sessionDuration: '45-60min',
  height: 178,
  weight: 74,
  age: 25,
  weaknesses: ['defensa en el perímetro'],
  gymAccess: 'gym_completo',
};

/** Perfil del usuario demo (cuenta de demostración, datos genéricos). */
const DEMO_PROFILE = {
  position: 'escolta',
  level: 'intermedio',
  goals: ['salto_vertical', 'habilidades_tecnicas'],
  trainingDaysPerWeek: '3-4',
  sessionDuration: '45-60min',
  height: 180,
  weight: 75,
  age: 22,
  weaknesses: ['tiro de media distancia'],
  gymAccess: 'gym_completo',
};

/** Misma regla de contraseña que el registro (auth.validator). */
const PASSWORD_RULE = /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d).{8,}$/;

/** Resumen de lo hecho (sin datos sensibles). */
const report = { created: [], updated: [], unchanged: [], warnings: [] };

/** Log de una acción con prefijo de dry-run. */
function log(kind, what) {
  report[kind].push(what);
  // eslint-disable-next-line no-console
  console.log(`${DRY ? '[dry-run] ' : ''}${kind.padEnd(9)} ${what}`);
}

/**
 * Crea el usuario si no existe (con la contraseña del env) o asegura que esté
 * verificado/activo con el rol indicado. Nunca cambia una contraseña existente.
 */
async function ensureUser({ nombre, email, envPassword }, role) {
  const existing = await User.findOne({ email });
  if (existing) {
    const changes = {};
    if (!existing.isEmailVerified) changes.isEmailVerified = true;
    if (!existing.isActive) changes.isActive = true;
    if (existing.role !== role) changes.role = role;
    if (Object.keys(changes).length === 0) {
      log('unchanged', `user ${email}`);
    } else {
      if (!DRY) await User.updateOne({ _id: existing._id }, { $set: changes });
      log('updated', `user ${email} (${Object.keys(changes).join(', ')})`);
    }
    return existing;
  }

  const password = process.env[envPassword];
  if (!password || !PASSWORD_RULE.test(password)) {
    throw new Error(
      `Falta ${envPassword} o no cumple la regla (8+ caracteres, mayúscula, minúscula y número) para crear ${email}`
    );
  }
  if (DRY) {
    log('created', `user ${email} (${role})`);
    return null;
  }
  const user = await User.create({
    nombre,
    email,
    password, // se hashea en pre('validate')
    role,
    plan: PLANS.FREE,
    isEmailVerified: true,
    isActive: true,
  });
  log('created', `user ${email} (${role})`);
  return user;
}

/**
 * JSON canónico (claves ordenadas): compara valores sin depender del orden de
 * claves con que Mongo devuelve los subdocumentos.
 */
function canonical(value) {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && !v._bsontype
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]))
      : v
  );
}

/** Upsert genérico por clave natural: crea, actualiza si cambió, o no toca. */
async function upsertBy(Model, keyField, data, label) {
  const existing = await Model.findOne({ [keyField]: data[keyField] }).lean();
  if (!existing) {
    if (DRY) {
      log('created', `${label} "${data[keyField]}"`);
      return null;
    }
    const doc = await Model.create(data);
    log('created', `${label} "${data[keyField]}"`);
    return doc;
  }
  // Compara solo los campos del seed (ignora _id, timestamps, createdBy).
  const changed = Object.keys(data).filter(
    (k) => k !== 'createdBy' && canonical(existing[k]) !== canonical(data[k])
  );
  if (changed.length === 0) {
    log('unchanged', `${label} "${data[keyField]}"`);
    return existing;
  }
  if (!DRY) {
    await Model.updateOne({ _id: existing._id }, { $set: data }, { runValidators: true });
  }
  log('updated', `${label} "${data[keyField]}" (${changed.join(', ')})`);
  return existing;
}

async function seedCatalog(adminId) {
  const exerciseIds = new Map();
  for (const e of EXERCISES) {
    if (!e.videoUrl) {
      report.warnings.push(`"${e.name}" sin videoUrl (se crea sin video)`);
    }
    // eslint-disable-next-line no-await-in-loop
    const doc = await upsertBy(
      Exercise,
      'name',
      {
        name: e.name,
        description: e.description,
        category: e.category,
        difficulty: e.difficulty,
        demoVideo: { type: VIDEO_TYPES.CLOUDINARY, cloudinaryUrl: e.videoUrl, youtubeUrl: null },
      },
      'exercise'
    );
    if (doc) exerciseIds.set(e.name, doc._id);
  }

  const routineIds = new Map();
  for (const r of ROUTINES) {
    const exercises = r.exercises.map((x, i) => ({
      exerciseId: exerciseIds.get(x.exercise),
      order: i + 1,
      sets: x.sets ?? null,
      reps: x.reps ?? null,
      seconds: x.seconds ?? null,
      restSeconds: x.restSeconds ?? null,
      notes: null,
    }));
    if (exercises.some((x) => !x.exerciseId)) {
      if (DRY) {
        log('created', `routine "${r.title}" (depende de ejercicios nuevos)`);
        continue;
      }
      throw new Error(`Rutina "${r.title}": ejercicio inexistente en el catálogo`);
    }
    // eslint-disable-next-line no-await-in-loop
    const doc = await upsertBy(
      Routine,
      'title',
      {
        title: r.title,
        description: `${r.title}: rutina del catálogo base de Grysto.`,
        level: 'intermedio',
        category: r.category,
        duration_min: r.duration_min,
        isPremium: false,
        exercises,
        createdBy: adminId,
      },
      'routine'
    );
    if (doc) routineIds.set(r.title, doc._id);
  }

  const planIds = [];
  for (const p of WEEKLY_PLANS) {
    const days = p.days.map((d) => ({ ...d, routines: d.routines.map((t) => routineIds.get(t)) }));
    if (days.some((d) => d.routines.some((id) => !id))) {
      if (DRY) {
        log('created', `weeklyPlan "${p.name}" (depende de rutinas nuevas)`);
        continue;
      }
      throw new Error(`Plan "${p.name}": rutina inexistente en el catálogo`);
    }
    // eslint-disable-next-line no-await-in-loop
    const doc = await upsertBy(
      WeeklyPlan,
      'name',
      { ...p, days, coverImage: null, isActive: true, createdBy: adminId },
      'weeklyPlan'
    );
    if (doc) planIds.push(doc._id);
  }
  return planIds;
}

/** Crea el PlayerProfile del usuario si no tiene (nunca pisa uno existente). */
async function ensureProfile(user, data, label) {
  if (!user) {
    log('created', `playerProfile ${label}`); // dry-run con usuario nuevo
    return;
  }
  const profile = await PlayerProfile.findOne({ userId: user._id }).lean();
  if (profile) {
    log('unchanged', `playerProfile ${label}`);
    return;
  }
  if (!DRY) await PlayerProfile.create({ userId: user._id, ...data });
  log('created', `playerProfile ${label}`);
}

async function ensureDemoPlan(demo, firstPlanId) {
  if (!demo) return; // dry-run con demo nuevo

  const active = await UserPlan.findOne({ userId: demo._id, status: PLAN_STATUS.ACTIVE }).lean();
  if (active) {
    log('unchanged', 'userPlan activo demo');
    return;
  }
  if (!firstPlanId) return;
  if (!DRY) {
    await createUserPlanForUser({
      userId: demo._id,
      weeklyPlan: await WeeklyPlan.findById(firstPlanId),
      source: PLAN_SOURCE.RECOMMENDED,
    });
  }
  log('created', 'userPlan activo demo (plan 1, recomendado)');
}

async function main() {
  // eslint-disable-next-line no-console
  console.log(`Seed ${DRY ? '(DRY-RUN, no escribe) ' : ''}→ DB "${config.db.name}"`);
  await connectDB();
  try {
    const admin = await ensureUser(ADMIN, ROLES.ADMIN);
    const demo = await ensureUser(DEMO, ROLES.USER);
    await ensureProfile(admin, ADMIN_PROFILE, 'admin');
    await ensureProfile(demo, DEMO_PROFILE, 'demo');
    const planIds = await seedCatalog(admin?._id);
    await ensureDemoPlan(demo, planIds[0]);
  } finally {
    await disconnectDB();
  }

  // eslint-disable-next-line no-console
  console.log(
    `\nResumen: ${report.created.length} creados, ${report.updated.length} actualizados, ` +
      `${report.unchanged.length} sin cambios.`
  );
  for (const w of report.warnings) {
    // eslint-disable-next-line no-console
    console.warn(`⚠ ${w}`);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`✗ [seed] ${err.message}`);
  process.exit(1);
});
