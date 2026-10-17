'use strict';

/**
 * @file El seed (`scripts/seed.js`) es idempotente y respeta los validadores
 * de Atlas. Corre el script real como proceso hijo contra la DB EN MEMORIA de
 * los tests (MONGODB_URI explícito: nunca toca Atlas).
 */

const fs = require('fs');
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
function runSeed(args = [], dbName = mongoose.connection.name) {
  const { host, port } = mongoose.connection;
  return execFileSync(process.execPath, [SCRIPT, ...args], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      MONGODB_URI: `mongodb://${host}:${port}/?directConnection=true`,
      DB_NAME: dbName,
      SEED_ADMIN_PASSWORD: ADMIN_PASS,
      SEED_DEMO_PASSWORD: DEMO_PASS,
    },
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 90000, // un seed colgado falla el test en vez de trabar la suite
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

  describe('--prod', () => {
    const prodDb = () => mongoose.connection.useDb('grysto_prod', { useCache: false });

    /** Como DEPLOY_RENDER.md §1.1: las 12 colecciones creadas con su validador. */
    async function createProdCollections() {
      const dir = path.join(__dirname, '..', '..', 'db', 'validators');
      const { db } = prodDb();
      for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
        // eslint-disable-next-line no-await-in-loop
        await db.createCollection(path.basename(file, '.json'), {
          validator: JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')),
          validationLevel: 'strict',
          validationAction: 'error',
        });
      }
    }

    afterEach(async () => {
      await prodDb().dropDatabase();
    });

    it('sin las colecciones creadas aborta sin crear nada (no quedan sin validador)', async () => {
      expect(() => runSeed(['--prod'], 'grysto_prod')).toThrow(/Faltan colecciones/);
      expect(await prodDb().db.listCollections().toArray()).toHaveLength(0);
    });

    it('crea SOLO el catálogo y el admin de producción, nunca el demo', async () => {
      await createProdCollections();
      const out = runSeed(['--prod'], 'grysto_prod');
      expect(out).toContain('PRODUCCIÓN');
      expect(out).not.toContain(ADMIN_PASS);

      const db = prodDb().db;
      const users = await db.collection('users').find({}).toArray();
      expect(users.map((u) => u.email)).toEqual(['grystoworkouts@gmail.com']);
      expect(users[0].role).toBe('admin');
      expect(users[0].isEmailVerified).toBe(true);
      expect(await db.collection('exercises').countDocuments()).toBe(5);
      expect(await db.collection('weeklyPlans').countDocuments()).toBe(1);
      expect(await db.collection('userPlans').countDocuments()).toBe(0);
      // La base de desarrollo no se tocó.
      expect(await User.countDocuments()).toBe(0);
      // No crea índices (los crea el server): solo los _id de cada colección.
      expect(await db.collection('users').indexes()).toHaveLength(1);

      // Idempotente.
      expect(runSeed(['--prod'], 'grysto_prod')).toMatch(/Resumen: 0 creados, 0 actualizados/);
    });

    it('--prod contra otra base aborta sin escribir', () => {
      expect(() => runSeed(['--prod'])).toThrow(/--prod solo corre contra DB_NAME=grysto_prod/);
    });

    it('sin --prod contra grysto_prod aborta (el demo nunca llega a producción)', async () => {
      expect(() => runSeed([], 'grysto_prod')).toThrow(/usá --prod/);
      expect(await prodDb().db.collection('users').countDocuments()).toBe(0);
    });
  });
});
