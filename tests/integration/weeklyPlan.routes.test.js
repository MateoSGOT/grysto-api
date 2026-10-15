'use strict';

/**
 * @file Tests de integración de los endpoints de WeeklyPlans.
 */

const request = require('supertest');
const app = require('../../src/app');
const {
  createAdmin,
  createFreeUser,
  authHeader,
  validExercisePayload,
  validRoutinePayload,
  validWeeklyPlanPayload,
} = require('../fixtures');

const BASE = '/api/v1/weekly-plans';

/**
 * Crea ejercicio + rutina como admin y devuelve el routineId.
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

describe('WeeklyPlans — escritura (solo admin)', () => {
  it('admin crea un plan con 7 días (201)', async () => {
    const admin = await createAdmin();
    const routineId = await seedRoutine(admin);

    const res = await request(app)
      .post(BASE)
      .set(authHeader(admin))
      .send(validWeeklyPlanPayload(routineId));

    expect(res.status).toBe(201);
    expect(res.body.data.weeklyPlan.days).toHaveLength(7);
    expect(res.body.data.weeklyPlan.createdBy).toBe(admin._id.toString());
  });

  it('un usuario normal NO puede crear (403)', async () => {
    const admin = await createAdmin();
    const routineId = await seedRoutine(admin);
    const user = await createFreeUser();

    const res = await request(app)
      .post(BASE)
      .set(authHeader(user))
      .send(validWeeklyPlanPayload(routineId));
    expect(res.status).toBe(403);
  });
});

describe('WeeklyPlans — validaciones', () => {
  it('rechaza un plan con 6 días (422)', async () => {
    const admin = await createAdmin();
    const routineId = await seedRoutine(admin);
    const payload = validWeeklyPlanPayload(routineId);
    payload.days = payload.days.slice(0, 6); // 6 días

    const res = await request(app).post(BASE).set(authHeader(admin)).send(payload);
    expect(res.status).toBe(422);
  });

  it('rechaza un día de descanso con rutinas (422)', async () => {
    const admin = await createAdmin();
    const routineId = await seedRoutine(admin);
    const payload = validWeeklyPlanPayload(routineId);
    payload.days[1] = {
      dayNumber: 2,
      category: 'descanso',
      title: 'Descanso con rutina',
      isRestDay: true,
      routines: [routineId],
    };

    const res = await request(app).post(BASE).set(authHeader(admin)).send(payload);
    expect(res.status).toBe(422);
  });

  it('rechaza un routineId inexistente en un día (422)', async () => {
    const admin = await createAdmin();
    const routineId = await seedRoutine(admin);
    const payload = validWeeklyPlanPayload(routineId);
    payload.days[0].routines = ['0123456789abcdef01234567'];

    const res = await request(app).post(BASE).set(authHeader(admin)).send(payload);
    expect(res.status).toBe(422);
    expect(res.body.message).toContain('Rutina no encontrada');
  });
});

describe('WeeklyPlans — soft delete', () => {
  it('DELETE no borra, marca isActive=false', async () => {
    const admin = await createAdmin();
    const routineId = await seedRoutine(admin);
    const created = await request(app)
      .post(BASE)
      .set(authHeader(admin))
      .send(validWeeklyPlanPayload(routineId));
    const id = created.body.data.weeklyPlan._id;

    const del = await request(app).delete(`${BASE}/${id}`).set(authHeader(admin));
    expect(del.status).toBe(200);

    // Sigue existiendo, pero inactivo.
    const fetched = await request(app).get(`${BASE}/${id}`).set(authHeader(admin));
    expect(fetched.status).toBe(200);
    expect(fetched.body.data.weeklyPlan.isActive).toBe(false);
  });
});

describe('WeeklyPlans — catálogo solo con planes activos', () => {
  it('un usuario NO ve planes desactivados (aunque pida isActive=false); el admin sí', async () => {
    const admin = await createAdmin();
    const routineId = await seedRoutine(admin);
    const active = await request(app)
      .post(BASE)
      .set(authHeader(admin))
      .send(validWeeklyPlanPayload(routineId, { name: 'Plan vigente' }));
    const retired = await request(app)
      .post(BASE)
      .set(authHeader(admin))
      .send(validWeeklyPlanPayload(routineId, { name: 'Plan retirado' }));
    await request(app)
      .delete(`${BASE}/${retired.body.data.weeklyPlan._id}`)
      .set(authHeader(admin));

    const user = await createFreeUser();
    const forUser = await request(app).get(BASE).set(authHeader(user));
    expect(forUser.status).toBe(200);
    const userIds = forUser.body.data.weeklyPlans.map((p) => p._id);
    expect(userIds).toEqual([active.body.data.weeklyPlan._id]);
    expect(forUser.body.data.total).toBe(1);

    const sneaky = await request(app).get(`${BASE}?isActive=false`).set(authHeader(user));
    // El filtro se ignora para no-admin: sigue viendo solo los activos.
    expect(sneaky.body.data.weeklyPlans.map((p) => p._id)).toEqual(userIds);

    const forAdmin = await request(app).get(`${BASE}?isActive=false`).set(authHeader(admin));
    expect(forAdmin.body.data.weeklyPlans.map((p) => p._id)).toEqual([
      retired.body.data.weeklyPlan._id,
    ]);
  });
});
