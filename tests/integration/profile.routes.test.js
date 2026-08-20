'use strict';

/**
 * @file Tests de integración de /profile: lectura y PATCH acotado a los datos
 * físicos (peso/altura/edad), rechazando cualquier otro cambio.
 */

const request = require('supertest');
const app = require('../../src/app');
const { PlayerProfile } = require('../../src/models');
const { createFreeUser, authHeader } = require('../fixtures');

const BASE = '/api/v1/profile';

/**
 * Crea un PlayerProfile para un usuario.
 *
 * @param {import('mongoose').Document} user - Usuario.
 * @param {Object} [overrides={}] - Overrides.
 * @returns {Promise<import('mongoose').Document>} Perfil.
 */
function createProfileFor(user, overrides = {}) {
  return PlayerProfile.create({
    userId: user._id,
    position: 'base',
    level: 'intermedio',
    goals: ['salto_vertical'],
    trainingDaysPerWeek: '3-4',
    sessionDuration: '45-60min',
    height: 178,
    weight: 72,
    age: 22,
    weaknesses: ['tiro de media distancia'],
    gymAccess: 'gym_completo',
    ...overrides,
  });
}

describe('Profile — lectura', () => {
  it('GET /profile devuelve el perfil del usuario', async () => {
    const user = await createFreeUser();
    await createProfileFor(user);

    const res = await request(app).get(BASE).set(authHeader(user));
    expect(res.status).toBe(200);
    expect(res.body.data.profile.position).toBe('base');
    expect(res.body.data.profile.weight).toBe(72);
    expect(res.body.data.profile.goals).toEqual(['salto_vertical']);
  });

  it('404 si el usuario no tiene perfil', async () => {
    const user = await createFreeUser();
    const res = await request(app).get(BASE).set(authHeader(user));
    expect(res.status).toBe(404);
  });
});

describe('Profile — PATCH (solo peso/altura/edad)', () => {
  it('actualiza height/weight/age (200) y no toca lo demás', async () => {
    const user = await createFreeUser();
    await createProfileFor(user);

    const res = await request(app)
      .patch(BASE)
      .set(authHeader(user))
      .send({ height: 180, weight: 75, age: 23 });

    expect(res.status).toBe(200);
    expect(res.body.data.profile.height).toBe(180);
    expect(res.body.data.profile.weight).toBe(75);
    expect(res.body.data.profile.age).toBe(23);
    // El resto del perfil intacto.
    expect(res.body.data.profile.position).toBe('base');
    expect(res.body.data.profile.level).toBe('intermedio');
  });

  it('acepta actualización parcial (solo weight)', async () => {
    const user = await createFreeUser();
    await createProfileFor(user);

    const res = await request(app)
      .patch(BASE)
      .set(authHeader(user))
      .send({ weight: 80 });

    expect(res.status).toBe(200);
    expect(res.body.data.profile.weight).toBe(80);
    expect(res.body.data.profile.age).toBe(22);
  });

  it('rechaza cambiar campos NO físicos con 422 (goals/level/position/gymAccess)', async () => {
    const user = await createFreeUser();
    await createProfileFor(user);

    const cases = [
      { goals: ['fuerza_masa'] },
      { level: 'avanzado' },
      { position: 'pivot' },
      { trainingDaysPerWeek: 'todos' },
      { weight: 75, gymAccess: 'solo_cancha' }, // uno válido + uno prohibido
    ];
    for (const bad of cases) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app).patch(BASE).set(authHeader(user)).send(bad);
      expect(res.status).toBe(422);
    }
    // Nada cambió.
    const p = await PlayerProfile.findOne({ userId: user._id }).lean();
    expect(p.weight).toBe(72);
    expect(p.level).toBe('intermedio');
  });

  it('rechaza valores fuera de rango con 422 (y edad no entera)', async () => {
    const user = await createFreeUser();
    await createProfileFor(user);

    const cases = [
      { height: 300 },
      { height: 100 },
      { weight: 10 },
      { weight: 500 },
      { age: 5 },
      { age: 99 },
      { age: 22.5 }, // edad debe ser entera (Atlas: int)
    ];
    for (const bad of cases) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app).patch(BASE).set(authHeader(user)).send(bad);
      expect(res.status).toBe(422);
    }
    const p = await PlayerProfile.findOne({ userId: user._id }).lean();
    expect(p.height).toBe(178);
    expect(p.age).toBe(22);
  });

  it('body vacío → 422 (al menos un campo)', async () => {
    const user = await createFreeUser();
    await createProfileFor(user);
    const res = await request(app).patch(BASE).set(authHeader(user)).send({});
    expect(res.status).toBe(422);
  });
});
