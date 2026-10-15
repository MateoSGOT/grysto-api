'use strict';

/**
 * @file El seed (`scripts/seed.js`) es idempotente y respeta los validadores
 * de Atlas. Corre el script real como proceso hijo contra la DB EN MEMORIA de
 * los tests (MONGODB_URI explícito: nunca toca Atlas).
 */

const path = require('path');
const { execFileSync } = require('child_process');
const mongoose = require('mongoose');
const {
  User,
  PlayerProfile,
  Exercise,
  Routine,
  WeeklyPlan,
  UserPlan,
} = require('../../src/models');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'seed.js');
const ADMIN_PASS = 'AdminSeed123';
const DEMO_PASS = 'DemoSeed123';

/** Corre el seed contra la DB en memoria y devuelve su stdout. */
function runSeed(args = []) {
  const { host, port, name } = mongoose.connection;
  return execFileSync(process.execPath, [SCRIPT, ...args], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      MONGODB_URI: `mongodb://${host}:${port}/?directConnection=true`,
      DB_NAME: name,
      SEED_ADMIN_PASSWORD: ADMIN_PASS,
      SEED_DEMO_PASSWORD: DEMO_PASS,
    },
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

/** Conteos de todo lo que el seed toca. */
async function counts() {
  return {
    users: await User.countDocuments(),
    profiles: await PlayerProfile.countDocuments(),
    exercises: await Exercise.countDocuments(),
    routines: await Routine.countDocuments(),
    weeklyPlans: await WeeklyPlan.countDocuments(),
    activePlans: await UserPlan.countDocuments({ status: 'active' }),
  };
}

describe('scripts/seed.js', () => {
  it('crea usuarios + catálogo y, corrido dos veces, NO duplica nada', async () => {
    const first = runSeed();
    const after1 = await counts();
    expect(after1).toEqual({
      users: 2,
      profiles: 2,
      exercises: 5,
      routines: 5,
      weeklyPlans: 1,
      activePlans: 1,
    });

    const admin = await User.findOne({ email: 'mateo@test.com' }).select('+password');
    expect(admin.role).toBe('admin');
    expect(admin.isEmailVerified).toBe(true);
    expect(await admin.comparePassword(ADMIN_PASS)).toBe(true);
    const demo = await User.findOne({ email: 'workout.demo@test.com' }).select('+password');
    expect(demo.isEmailVerified).toBe(true);
    expect(await demo.comparePassword(DEMO_PASS)).toBe(true);

    // Las contraseñas nunca aparecen en la salida.
    expect(first).not.toContain(ADMIN_PASS);
    expect(first).not.toContain(DEMO_PASS);

    const second = runSeed();
    expect(await counts()).toEqual(after1);
    expect(second).toMatch(/Resumen: 0 creados, 0 actualizados/);
  });

  it('--dry-run no escribe nada', async () => {
    const out = runSeed(['--dry-run']);
    expect(out).toContain('[dry-run]');
    expect(await counts()).toEqual({
      users: 0,
      profiles: 0,
      exercises: 0,
      routines: 0,
      weeklyPlans: 0,
      activePlans: 0,
    });
  });
});
