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

describe('UserPlans — ciclos y sobrecarga progresiva', () => {
  it('completar los 7 días inicia un nuevo ciclo con cargas mayores', async () => {
    const admin = await createAdmin();
    const routineId = await seedRoutine(admin);
    const planId = await seedWeeklyPlan(admin, routineId);
    const user = await createFreeUser();

    await request(app)
      .post(`${BASE}/activate`)
      .set(authHeader(user))
      .send({ weeklyPlanId: planId });

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

    // El ciclo 2 sugiere más carga (fuerza: 10 base + 2.5).
    const mine = await request(app).get(BASE).set(authHeader(user));
    expect(mine.body.data.plan.currentCycle).toBe(2);
    const load = mine.body.data.plan.currentCycleData.loads[0];
    expect(load.suggestedValue).toBeGreaterThan(10);
    expect(load.suggestedValue).toBe(12.5);
  });

  it('progression-preview muestra incrementos sin iniciar el ciclo', async () => {
    const admin = await createAdmin();
    const routineId = await seedRoutine(admin);
    const planId = await seedWeeklyPlan(admin, routineId);
    const user = await createFreeUser();

    await request(app)
      .post(`${BASE}/activate`)
      .set(authHeader(user))
      .send({ weeklyPlanId: planId });

    const preview = await request(app)
      .get(`${BASE}/progression-preview`)
      .set(authHeader(user));
    expect(preview.status).toBe(200);
    expect(preview.body.data.currentCycle).toBe(1);
    expect(preview.body.data.nextCycle).toBe(2);
    const row = preview.body.data.preview[0];
    expect(row.nextSuggestedValue).toBeGreaterThan(row.currentValue);

    // No inició el ciclo: sigue en 1.
    const mine = await request(app).get(BASE).set(authHeader(user));
    expect(mine.body.data.plan.currentCycle).toBe(1);
  });
});
