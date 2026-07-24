'use strict';

/**
 * @file Tests de integración de DELETE /auth/account: borrado real + atómico
 * de todos los datos del usuario, con re-autenticación.
 */

const request = require('supertest');
const app = require('../../src/app');
const {
  User,
  PlayerProfile,
  UserPlan,
  CoachConversation,
  RefreshToken,
  Exercise,
} = require('../../src/models');
const {
  createFreeUser,
  createAdmin,
  authHeader,
  validExercisePayload,
} = require('../fixtures');

const BASE = '/api/v1/auth/account';

/** Siembra datos del usuario (perfil + plan + conversación + refresh token). */
async function seedUserData(user) {
  await PlayerProfile.create({
    userId: user._id,
    position: 'base',
    level: 'intermedio',
    goals: ['salto_vertical'],
    trainingDaysPerWeek: '3-4',
    sessionDuration: '45-60min',
    height: 178,
    weight: 72,
    age: 22,
    weaknesses: ['tiro'],
    gymAccess: 'gym_completo',
  });
  await UserPlan.create({
    userId: user._id,
    source: 'user_selected',
    status: 'active',
    startedAt: new Date(),
    currentCycle: 1,
    cycles: [],
  });
  await CoachConversation.create({ userId: user._id });
  await RefreshToken.generateToken(user._id);
}

describe('DELETE /auth/account', () => {
  it('con password incorrecta → 401 y NO borra nada', async () => {
    const user = await createFreeUser(); // password: Password123
    await seedUserData(user);

    const res = await request(app)
      .delete(BASE)
      .set(authHeader(user))
      .send({ password: 'ClaveMala9' });

    expect(res.status).toBe(401);
    expect(await User.findById(user._id)).not.toBeNull();
    expect(await PlayerProfile.findOne({ userId: user._id })).not.toBeNull();
    expect(await UserPlan.findOne({ userId: user._id })).not.toBeNull();
  });

  it('sin password → 422', async () => {
    const user = await createFreeUser();
    const res = await request(app).delete(BASE).set(authHeader(user)).send({});
    expect(res.status).toBe(422);
  });

  it('con password correcta → borra TODO lo del usuario; el catálogo intacto', async () => {
    // Catálogo compartido (no debe borrarse).
    const admin = await createAdmin();
    const exRes = await request(app)
      .post('/api/v1/exercises')
      .set(authHeader(admin))
      .send(validExercisePayload());
    const exId = exRes.body.data.exercise._id;

    const user = await createFreeUser();
    await seedUserData(user);

    const res = await request(app)
      .delete(BASE)
      .set(authHeader(user))
      .send({ password: 'Password123' });

    expect(res.status).toBe(200);
    expect(await User.findById(user._id)).toBeNull();
    expect(await PlayerProfile.findOne({ userId: user._id })).toBeNull();
    expect(await UserPlan.findOne({ userId: user._id })).toBeNull();
    expect(await CoachConversation.findOne({ userId: user._id })).toBeNull();
    expect(await RefreshToken.findOne({ userId: user._id })).toBeNull();
    // El catálogo compartido NO se toca.
    expect(await Exercise.findById(exId)).not.toBeNull();
  });

  it('si algo falla a mitad, la transacción hace rollback (no borra nada)', async () => {
    const user = await createFreeUser();
    await seedUserData(user);

    const spy = jest
      .spyOn(CoachConversation, 'deleteMany')
      .mockRejectedValueOnce(new Error('fallo simulado'));

    const res = await request(app)
      .delete(BASE)
      .set(authHeader(user))
      .send({ password: 'Password123' });

    spy.mockRestore();

    expect(res.status).toBeGreaterThanOrEqual(500);
    // Rollback: todo sigue existiendo.
    expect(await User.findById(user._id)).not.toBeNull();
    expect(await PlayerProfile.findOne({ userId: user._id })).not.toBeNull();
    expect(await UserPlan.findOne({ userId: user._id })).not.toBeNull();
  });
});
