'use strict';

/**
 * @file Tests de integración de UserPlans: activación, reglas de cambio,
 * ciclos recurrentes y sobrecarga progresiva.
 */

const request = require('supertest');
const app = require('../../src/app');
const { WeeklyPlan } = require('../../src/models');
const userPlanService = require('../../src/services/userPlan.service');
const { PLAN_SOURCE } = require('../../src/constants/enums');
const {
  createAdmin,
  createFreeUser,
  createPremiumUser,
  authHeader,
  validExercisePayload,
  validRoutinePayload,
  validWeeklyPlanPayload,
} = require('../fixtures');

const BASE = '/api/v1/my-plan';

/**
 * Crea ejercicio (fuerza) + rutina como admin y devuelve el routineId.
 *
 * @param {import('mongoose').Document} admin - Admin.
 * @returns {Promise<string>} Id de la rutina.
 */
async function seedRoutine(admin) {
  const ex = await request(app)
    .post('/api/v1/exercises')
    .set(authHeader(admin))
    .send(validExercisePayload({ category: 'fuerza' }));
  const routine = await request(app)
    .post('/api/v1/routines')
    .set(authHeader(admin))
    .send(validRoutinePayload(ex.body.data.exercise._id));
  return routine.body.data.routine._id;
}

/**
 * Crea un weekly plan vía API y devuelve su id.
 *
 * @param {import('mongoose').Document} admin - Admin.
 * @param {string} routineId - Rutina del día 1.
 * @param {Object} [overrides={}] - Overrides del payload.
 * @returns {Promise<string>} Id del weekly plan.
 */
async function seedWeeklyPlan(admin, routineId, overrides = {}) {
  const res = await request(app)
    .post('/api/v1/weekly-plans')
    .set(authHeader(admin))
    .send(validWeeklyPlanPayload(routineId, overrides));
  return res.body.data.weeklyPlan._id;
}

describe('UserPlans — activación', () => {
  it('un usuario activa un plan (201) y getActivePlan lo retorna', async () => {
    const admin = await createAdmin();
    const routineId = await seedRoutine(admin);
    const planId = await seedWeeklyPlan(admin, routineId);
    const user = await createFreeUser();

    const activate = await request(app)
      .post(`${BASE}/activate`)
      .set(authHeader(user))
      .send({ weeklyPlanId: planId });
    expect(activate.status).toBe(201);

    const mine = await request(app).get(BASE).set(authHeader(user));
    expect(mine.status).toBe(200);
    expect(mine.body.data.plan.status).toBe('active');
    expect(mine.body.data.plan.weeklyPlanId._id).toBe(planId);
    expect(mine.body.data.plan.currentCycle).toBe(1);
  });
});

describe('UserPlans — reglas de cambio de plan', () => {
  it('FREE con plan recomendado puede cambiar UNA vez', async () => {
    const admin = await createAdmin();
    const routineId = await seedRoutine(admin);
    const planA = await seedWeeklyPlan(admin, routineId);
    const planB = await seedWeeklyPlan(admin, routineId);
    const free = await createFreeUser();

    // Sembrar plan recomendado para el usuario free.
    const planADoc = await WeeklyPlan.findById(planA);
    await userPlanService.createUserPlanForUser({
      userId: free._id,
      weeklyPlan: planADoc,
      source: PLAN_SOURCE.RECOMMENDED,
    });

    const change = await request(app)
      .post(`${BASE}/activate`)
      .set(authHeader(free))
      .send({ weeklyPlanId: planB });
    expect(change.status).toBe(201);

    const mine = await request(app).get(BASE).set(authHeader(free));
    expect(mine.body.data.plan.weeklyPlanId._id).toBe(planB);
    expect(mine.body.data.plan.source).toBe(PLAN_SOURCE.SELECTED);
  });

  it('FREE con plan propio NO puede cambiar (403)', async () => {
    const admin = await createAdmin();
    const routineId = await seedRoutine(admin);
    const planA = await seedWeeklyPlan(admin, routineId);
    const planB = await seedWeeklyPlan(admin, routineId);
    const free = await createFreeUser();

    // Primera activación → user_selected.
    await request(app)
      .post(`${BASE}/activate`)
      .set(authHeader(free))
      .send({ weeklyPlanId: planA });

    const change = await request(app)
      .post(`${BASE}/activate`)
      .set(authHeader(free))
      .send({ weeklyPlanId: planB });
    expect(change.status).toBe(403);
  });

  it('FREE no puede activar un plan premium (403)', async () => {
    const admin = await createAdmin();
    const routineId = await seedRoutine(admin);
    const premiumPlan = await seedWeeklyPlan(admin, routineId, { isPremium: true });
    const free = await createFreeUser();

    const res = await request(app)
      .post(`${BASE}/activate`)
      .set(authHeader(free))
      .send({ weeklyPlanId: premiumPlan });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Este plan es solo para usuarios premium');
  });

  it('PREMIUM debe abandonar antes de cambiar (409), luego puede activar', async () => {
    const admin = await createAdmin();
    const routineId = await seedRoutine(admin);
    const planA = await seedWeeklyPlan(admin, routineId);
    const planB = await seedWeeklyPlan(admin, routineId);
    const premium = await createPremiumUser();

    await request(app)
      .post(`${BASE}/activate`)
      .set(authHeader(premium))
      .send({ weeklyPlanId: planA });

    const conflict = await request(app)
      .post(`${BASE}/activate`)
      .set(authHeader(premium))
      .send({ weeklyPlanId: planB });
    expect(conflict.status).toBe(409);

    const abandon = await request(app).post(`${BASE}/abandon`).set(authHeader(premium));
    expect(abandon.status).toBe(200);

    const retry = await request(app)
      .post(`${BASE}/activate`)
      .set(authHeader(premium))
      .send({ weeklyPlanId: planB });
    expect(retry.status).toBe(201);
  });
});

/**
 * Activa el plan para un usuario y devuelve la primera carga (sin calibrar)
 * del ciclo actual, junto con su exerciseId.
 *
 * @param {import('express').Application} app - App.
 * @param {import('mongoose').Document} user - Usuario.
 * @param {string} planId - Weekly plan a activar.
 * @returns {Promise<{ load: Object, exerciseId: string }>} Primera carga.
 */
async function activateAndGetFirstLoad(user, planId) {
  await request(app)
    .post(`${BASE}/activate`)
    .set(authHeader(user))
    .send({ weeklyPlanId: planId });
  const mine = await request(app).get(BASE).set(authHeader(user));
  const load = mine.body.data.plan.currentCycleData.loads[0];
  return { load, exerciseId: load.exerciseId };
}

describe('UserPlans — calibración de cargas', () => {
  it('las cargas nacen SIN CALIBRAR (suggestedValue null, calibrated false)', async () => {
    const admin = await createAdmin();
    const routineId = await seedRoutine(admin);
    const planId = await seedWeeklyPlan(admin, routineId);
    const user = await createFreeUser();

    const { load } = await activateAndGetFirstLoad(user, planId);
    expect(load.suggestedValue).toBeNull();
    expect(load.calibrated).toBe(false);
    // fuerza → métrica peso/kg (se conoce desde la categoría aunque no el valor).
    expect(load.metric).toBe('peso');
    expect(load.unit).toBe('kg');
  });

  it('confirm-load de un ejercicio sin calibrar lo calibra y fija la base', async () => {
    const admin = await createAdmin();
    const routineId = await seedRoutine(admin);
    const planId = await seedWeeklyPlan(admin, routineId);
    const user = await createFreeUser();

    const { exerciseId } = await activateAndGetFirstLoad(user, planId);

    const res = await request(app)
      .post(`${BASE}/confirm-load`)
      .set(authHeader(user))
      .send({ exerciseId, actualValue: 50 });

    expect(res.status).toBe(200);
    expect(res.body.data.load.calibrated).toBe(true);
    expect(res.body.data.load.suggestedValue).toBe(50);
    expect(res.body.data.load.actualValue).toBe(50);
    expect(res.body.data.load.confirmed).toBe(true);
  });

  it('confirm-load rechaza un valor fuera de rango (400)', async () => {
    const admin = await createAdmin();
    const routineId = await seedRoutine(admin);
    const planId = await seedWeeklyPlan(admin, routineId);
    const user = await createFreeUser();

    const { exerciseId } = await activateAndGetFirstLoad(user, planId);

    const res = await request(app)
      .post(`${BASE}/confirm-load`)
      .set(authHeader(user))
      .send({ exerciseId, actualValue: -10 }); // peso negativo imposible
    expect(res.status).toBe(400);
  });
});

describe('UserPlans — ciclos y sobrecarga progresiva', () => {
  it('un ejercicio calibrado progresa desde el valor REAL en el ciclo siguiente', async () => {
    const admin = await createAdmin();
    const routineId = await seedRoutine(admin);
    const planId = await seedWeeklyPlan(admin, routineId);
    const user = await createFreeUser();

    const { exerciseId } = await activateAndGetFirstLoad(user, planId);

    // Calibrar con la marca real: 50 kg.
    await request(app)
      .post(`${BASE}/confirm-load`)
      .set(authHeader(user))
      .send({ exerciseId, actualValue: 50 });

    let lastResponse;
    for (let day = 1; day <= 7; day += 1) {
      // eslint-disable-next-line no-await-in-loop
      lastResponse = await request(app)
        .post(`${BASE}/confirm-day`)
        .set(authHeader(user))
        .send({ dayNumber: day });
    }

    expect(lastResponse.status).toBe(200);
    expect(lastResponse.body.data.cycleCompleted).toBe(true);
    expect(lastResponse.body.data.currentCycle).toBe(2);

    // Ciclo 2 progresa desde 50 kg reales + 2.5 = 52.5 (no desde un valor falso).
    const mine = await request(app).get(BASE).set(authHeader(user));
    expect(mine.body.data.plan.currentCycle).toBe(2);
    const load = mine.body.data.plan.currentCycleData.loads[0];
    expect(load.calibrated).toBe(true);
    expect(load.suggestedValue).toBe(52.5);
  });

  it('un ejercicio NUNCA calibrado no genera progresión inventada', async () => {
    const admin = await createAdmin();
    const routineId = await seedRoutine(admin);
    const planId = await seedWeeklyPlan(admin, routineId);
    const user = await createFreeUser();

    await activateAndGetFirstLoad(user, planId); // sin calibrar

    for (let day = 1; day <= 7; day += 1) {
      // eslint-disable-next-line no-await-in-loop
      await request(app)
        .post(`${BASE}/confirm-day`)
        .set(authHeader(user))
        .send({ dayNumber: day });
    }

    // El ciclo 2 sigue sin calibrar: null, no un número inventado.
    const mine = await request(app).get(BASE).set(authHeader(user));
    expect(mine.body.data.plan.currentCycle).toBe(2);
    const load = mine.body.data.plan.currentCycleData.loads[0];
    expect(load.calibrated).toBe(false);
    expect(load.suggestedValue).toBeNull();
  });

  it('progression-preview marca pendientes de calibrar y muestra incrementos tras calibrar', async () => {
    const admin = await createAdmin();
    const routineId = await seedRoutine(admin);
    const planId = await seedWeeklyPlan(admin, routineId);
    const user = await createFreeUser();

    const { exerciseId } = await activateAndGetFirstLoad(user, planId);

    // Sin calibrar → preview no inventa valores.
    let preview = await request(app)
      .get(`${BASE}/progression-preview`)
      .set(authHeader(user));
    expect(preview.status).toBe(200);
    let row = preview.body.data.preview[0];
    expect(row.calibrated).toBe(false);
    expect(row.currentValue).toBeNull();
    expect(row.nextSuggestedValue).toBeNull();

    // Tras calibrar → muestra base real + incremento.
    await request(app)
      .post(`${BASE}/confirm-load`)
      .set(authHeader(user))
      .send({ exerciseId, actualValue: 40 });

    preview = await request(app)
      .get(`${BASE}/progression-preview`)
      .set(authHeader(user));
    row = preview.body.data.preview[0];
    expect(row.calibrated).toBe(true);
    expect(row.currentValue).toBe(40);
    expect(row.nextSuggestedValue).toBe(42.5);

    // progression-preview no inició el ciclo: sigue en 1.
    const mine = await request(app).get(BASE).set(authHeader(user));
    expect(mine.body.data.plan.currentCycle).toBe(1);
  });
});

/**
 * Crea un ejercicio vía API (admin) y devuelve su id.
 *
 * @param {import('mongoose').Document} admin - Admin.
 * @param {Object} overrides - Overrides del payload (name, category…).
 * @returns {Promise<string>} Id del ejercicio.
 */
async function createExercise(admin, overrides) {
  const res = await request(app)
    .post('/api/v1/exercises')
    .set(authHeader(admin))
    .send(validExercisePayload(overrides));
  return res.body.data.exercise._id;
}

describe('UserPlans — sustitución de ejercicios', () => {
  it('sustituye por uno de la MISMA categoría (200): override registrado y load sin calibrar', async () => {
    const admin = await createAdmin();
    const routineId = await seedRoutine(admin); // ejercicio fuerza
    const planId = await seedWeeklyPlan(admin, routineId);
    const user = await createFreeUser();
    const { exerciseId: original } = await activateAndGetFirstLoad(user, planId);
    const alt = await createExercise(admin, { name: 'Peso muerto', category: 'fuerza' });

    const res = await request(app)
      .post(`${BASE}/substitute-exercise`)
      .set(authHeader(user))
      .send({ originalExerciseId: original, newExerciseId: alt });

    expect(res.status).toBe(200);
    const plan = res.body.data.plan;
    // Override registrado (ancla = original del catálogo).
    expect(
      plan.substitutions.some(
        (s) => s.originalExerciseId === original && s.newExerciseId === alt
      )
    ).toBe(true);
    // Load del nuevo, SIN CALIBRAR; el del viejo ya no está.
    const loads = plan.currentCycleData.loads;
    const newLoad = loads.find((l) => l.exerciseId === alt);
    expect(newLoad).toBeDefined();
    expect(newLoad.calibrated).toBe(false);
    expect(newLoad.suggestedValue).toBeNull();
    expect(loads.some((l) => l.exerciseId === original)).toBe(false);
  });

  it('rechaza sustituir por OTRA categoría (422)', async () => {
    const admin = await createAdmin();
    const routineId = await seedRoutine(admin);
    const planId = await seedWeeklyPlan(admin, routineId);
    const user = await createFreeUser();
    const { exerciseId: original } = await activateAndGetFirstLoad(user, planId);
    const salto = await createExercise(admin, { name: 'Salto profundo', category: 'salto' });

    const res = await request(app)
      .post(`${BASE}/substitute-exercise`)
      .set(authHeader(user))
      .send({ originalExerciseId: original, newExerciseId: salto });
    expect(res.status).toBe(422);
  });

  it('rechaza un sustituto inexistente (404)', async () => {
    const admin = await createAdmin();
    const routineId = await seedRoutine(admin);
    const planId = await seedWeeklyPlan(admin, routineId);
    const user = await createFreeUser();
    const { exerciseId: original } = await activateAndGetFirstLoad(user, planId);

    const res = await request(app)
      .post(`${BASE}/substitute-exercise`)
      .set(authHeader(user))
      .send({
        originalExerciseId: original,
        newExerciseId: '0123456789abcdef01234567',
      });
    expect(res.status).toBe(404);
  });

  it('GET /my-plan refleja la sustitución (substitutions + load nuevo sin calibrar)', async () => {
    const admin = await createAdmin();
    const routineId = await seedRoutine(admin);
    const planId = await seedWeeklyPlan(admin, routineId);
    const user = await createFreeUser();
    const { exerciseId: original } = await activateAndGetFirstLoad(user, planId);
    const alt = await createExercise(admin, { name: 'Zancadas con barra', category: 'fuerza' });

    await request(app)
      .post(`${BASE}/substitute-exercise`)
      .set(authHeader(user))
      .send({ originalExerciseId: original, newExerciseId: alt });

    const mine = await request(app).get(BASE).set(authHeader(user));
    expect(mine.body.data.plan.substitutions.some((s) => s.newExerciseId === alt)).toBe(true);
    const load = mine.body.data.plan.currentCycleData.loads.find((l) => l.exerciseId === alt);
    expect(load).toBeDefined();
    expect(load.calibrated).toBe(false);
  });

  it('la rutina del día (GET /routines/:id) devuelve el sustituto, no el original', async () => {
    const admin = await createAdmin();
    const routineId = await seedRoutine(admin);
    const planId = await seedWeeklyPlan(admin, routineId);
    const user = await createFreeUser();
    const { exerciseId: original } = await activateAndGetFirstLoad(user, planId);
    const alt = await createExercise(admin, { name: 'Hip thrust', category: 'fuerza' });

    await request(app)
      .post(`${BASE}/substitute-exercise`)
      .set(authHeader(user))
      .send({ originalExerciseId: original, newExerciseId: alt });

    const routine = await request(app)
      .get(`/api/v1/routines/${routineId}`)
      .set(authHeader(user));
    expect(routine.status).toBe(200);
    const exIds = routine.body.data.routine.exercises.map((e) => e.exerciseId._id);
    expect(exIds).toContain(alt); // devuelve el sustituto
    expect(exIds).not.toContain(original); // ya no el original
  });
});
