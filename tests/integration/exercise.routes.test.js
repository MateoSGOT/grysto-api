'use strict';

/**
 * @file Tests de integración de los endpoints de Exercises.
 */

const request = require('supertest');
const app = require('../../src/app');
const {
  createAdmin,
  createFreeUser,
  authHeader,
  validExercisePayload,
  validRoutinePayload,
} = require('../fixtures');

const BASE = '/api/v1/exercises';

/**
 * Crea un ejercicio vía API como admin y devuelve su id.
 *
 * @param {import('mongoose').Document} admin - Admin autenticado.
 * @param {Object} [overrides={}] - Overrides del payload.
 * @returns {Promise<string>} Id del ejercicio creado.
 */
async function createExerciseAs(admin, overrides = {}) {
  const res = await request(app)
    .post(BASE)
    .set(authHeader(admin))
    .send(validExercisePayload(overrides));
  return res.body.data.exercise._id;
}

describe('Exercises — escritura (solo admin)', () => {
  it('admin crea un ejercicio (201)', async () => {
    const admin = await createAdmin();
    const res = await request(app)
      .post(BASE)
      .set(authHeader(admin))
      .send(validExercisePayload());

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.exercise.name).toBe('Salto al cajón');
  });

  it('un usuario normal NO puede crear (403)', async () => {
    const user = await createFreeUser();
    const res = await request(app)
      .post(BASE)
      .set(authHeader(user))
      .send(validExercisePayload());

    expect(res.status).toBe(403);
  });

  it('rechaza demoVideo cloudinary sin cloudinaryUrl (422)', async () => {
    const admin = await createAdmin();
    const res = await request(app)
      .post(BASE)
      .set(authHeader(admin))
      .send(
        validExercisePayload({
          demoVideo: { type: 'cloudinary', youtubeUrl: 'https://youtu.be/x' },
        })
      );

    expect(res.status).toBe(422);
    expect(res.body.details.some((d) => d.field === 'demoVideo.cloudinaryUrl')).toBe(
      true
    );
  });
});

describe('Exercises — lectura y paginación', () => {
  it('lista paginada con y sin filtros', async () => {
    const admin = await createAdmin();
    await createExerciseAs(admin, { category: 'salto' });
    await createExerciseAs(admin, { category: 'tiro' });
    await createExerciseAs(admin, { category: 'defensa' });

    const reader = await createFreeUser();

    // Sin filtros, paginado a 2 por página.
    const page1 = await request(app)
      .get(`${BASE}?limit=2&page=1`)
      .set(authHeader(reader));
    expect(page1.status).toBe(200);
    expect(page1.body.data.total).toBe(3);
    expect(page1.body.data.totalPages).toBe(2);
    expect(page1.body.data.exercises).toHaveLength(2);

    // Con filtro de categoría.
    const filtered = await request(app)
      .get(`${BASE}?category=salto`)
      .set(authHeader(reader));
    expect(filtered.status).toBe(200);
    expect(filtered.body.data.total).toBe(1);
    expect(filtered.body.data.exercises[0].category).toBe('salto');
  });
});

describe('Exercises — borrado con integridad referencial', () => {
  it('NO permite borrar un ejercicio en uso por una rutina (409)', async () => {
    const admin = await createAdmin();
    const exerciseId = await createExerciseAs(admin);

    // Crear rutina que referencia el ejercicio.
    const routineRes = await request(app)
      .post('/api/v1/routines')
      .set(authHeader(admin))
      .send(validRoutinePayload(exerciseId));
    expect(routineRes.status).toBe(201);

    // Intentar borrar el ejercicio en uso.
    const del = await request(app)
      .delete(`${BASE}/${exerciseId}`)
      .set(authHeader(admin));
    expect(del.status).toBe(409);
    expect(del.body.message).toBe('Ejercicio en uso por una o más rutinas');
  });
});
