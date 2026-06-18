'use strict';

/**
 * @file Tests de integración de los endpoints de Routines, incluyendo el
 * control de acceso premium/preview.
 */

const request = require('supertest');
const app = require('../../src/app');
const {
  createAdmin,
  createFreeUser,
  createPremiumUser,
  authHeader,
  validExercisePayload,
  validRoutinePayload,
} = require('../fixtures');

const BASE = '/api/v1/routines';
const EXERCISES = '/api/v1/exercises';

/**
 * Crea un ejercicio vía API como admin y devuelve su id.
 *
 * @param {import('mongoose').Document} admin - Admin autenticado.
 * @returns {Promise<string>} Id del ejercicio.
 */
async function createExerciseAs(admin) {
  const res = await request(app)
    .post(EXERCISES)
    .set(authHeader(admin))
    .send(validExercisePayload());
  return res.body.data.exercise._id;
}

describe('Routines — escritura (solo admin)', () => {
  it('admin crea una rutina (201)', async () => {
    const admin = await createAdmin();
    const exerciseId = await createExerciseAs(admin);

    const res = await request(app)
      .post(BASE)
      .set(authHeader(admin))
      .send(validRoutinePayload(exerciseId));

    expect(res.status).toBe(201);
    expect(res.body.data.routine.title).toBe('Rutina de salto');
    expect(res.body.data.routine.createdBy).toBe(admin._id.toString());
  });

  it('rechaza un exerciseId inexistente (422)', async () => {
    const admin = await createAdmin();
    const fakeId = '0123456789abcdef01234567';

    const res = await request(app)
      .post(BASE)
      .set(authHeader(admin))
      .send(validRoutinePayload(fakeId));

    expect(res.status).toBe(422);
    expect(res.body.message).toContain('Ejercicio no encontrado');
  });

  it('un usuario normal NO puede crear/editar/borrar (403)', async () => {
    const admin = await createAdmin();
    const user = await createFreeUser();
    const exerciseId = await createExerciseAs(admin);

    const created = await request(app)
      .post(BASE)
      .set(authHeader(admin))
      .send(validRoutinePayload(exerciseId));
    const routineId = created.body.data.routine._id;

    const createRes = await request(app)
      .post(BASE)
      .set(authHeader(user))
      .send(validRoutinePayload(exerciseId));
    expect(createRes.status).toBe(403);

    const updateRes = await request(app)
      .put(`${BASE}/${routineId}`)
      .set(authHeader(user))
      .send({ title: 'Hackeado' });
    expect(updateRes.status).toBe(403);

    const deleteRes = await request(app)
      .delete(`${BASE}/${routineId}`)
      .set(authHeader(user));
    expect(deleteRes.status).toBe(403);
  });
});

describe('Routines — control de acceso premium/preview', () => {
  /**
   * Crea una rutina premium y devuelve su id.
   *
   * @returns {Promise<string>} Id de la rutina premium.
   */
  async function createPremiumRoutine() {
    const admin = await createAdmin();
    const exerciseId = await createExerciseAs(admin);
    const res = await request(app)
      .post(BASE)
      .set(authHeader(admin))
      .send(validRoutinePayload(exerciseId, { isPremium: true }));
    return res.body.data.routine._id;
  }

  it('usuario free ve preview (locked:true, exercises vacío) de rutina premium', async () => {
    const routineId = await createPremiumRoutine();
    const free = await createFreeUser();

    const res = await request(app)
      .get(`${BASE}/${routineId}`)
      .set(authHeader(free));

    expect(res.status).toBe(200);
    expect(res.body.data.routine.locked).toBe(true);
    expect(res.body.data.routine.exercises).toEqual([]);
  });

  it('usuario premium ve la rutina premium completa', async () => {
    const routineId = await createPremiumRoutine();
    const premium = await createPremiumUser();

    const res = await request(app)
      .get(`${BASE}/${routineId}`)
      .set(authHeader(premium));

    expect(res.status).toBe(200);
    expect(res.body.data.routine.locked).toBe(false);
    expect(res.body.data.routine.exercises.length).toBeGreaterThan(0);
    // El ejercicio viene poblado.
    expect(res.body.data.routine.exercises[0].exerciseId.name).toBe('Salto al cajón');
  });

  it('rutina NO premium se ve completa por cualquier usuario', async () => {
    const admin = await createAdmin();
    const exerciseId = await createExerciseAs(admin);
    const created = await request(app)
      .post(BASE)
      .set(authHeader(admin))
      .send(validRoutinePayload(exerciseId, { isPremium: false }));
    const routineId = created.body.data.routine._id;

    const free = await createFreeUser();
    const res = await request(app)
      .get(`${BASE}/${routineId}`)
      .set(authHeader(free));

    expect(res.status).toBe(200);
    expect(res.body.data.routine.locked).toBe(false);
    expect(res.body.data.routine.exercises.length).toBeGreaterThan(0);
  });
});
