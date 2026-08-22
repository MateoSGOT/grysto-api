'use strict';

/**
 * @file Tests de integración del CAMBIO DE PLAN con carry-load (premium):
 * preview de matches por categoría y confirmación transaccional.
 */

const request = require('supertest');
const app = require('../../src/app');
const { UserPlan } = require('../../src/models');
const {
  createAdmin,
  createFreeUser,
  createPremiumUser,
  authHeader,
  validExercisePayload,
  validRoutinePayload,
  validWeeklyPlanPayload,
} = require('../fixtures');

const WP = '/api/v1/weekly-plans';
const MP = '/api/v1/my-plan';

/** Crea un ejercicio (nombre + categoría) y devuelve su id. */
async function makeExercise(admin, name, category) {
  const res = await request(app)
    .post('/api/v1/exercises')
    .set(authHeader(admin))
    .send(validExercisePayload({ name, category }));
  return res.body.data.exercise._id;
}

/** Crea una rutina con los ejercicios dados (en orden) y devuelve su id. */
async function makeRoutine(admin, title, exerciseIds) {
  const exercises = exerciseIds.map((id, i) => ({
    exerciseId: String(id),
    order: i + 1,
    sets: 4,
    reps: '10',
  }));
  const res = await request(app)
    .post('/api/v1/routines')
    .set(authHeader(admin))
    .send({ ...validRoutinePayload(exerciseIds[0]), title, exercises });
  return res.body.data.routine._id;
}

/** Crea un weekly plan (día 1 = rutina, resto descanso) y devuelve su id. */
async function makePlan(admin, name, routineId) {
  const res = await request(app)
    .post(WP)
    .set(authHeader(admin))
    .send(validWeeklyPlanPayload(routineId, { name }));
  return res.body.data.weeklyPlan._id;
}

/**
 * Escenario base: plan ORIGEN con una sentadilla (fuerza) y plan DESTINO con
 * dos ejercicios de fuerza + uno de salto. Devuelve los ids relevantes.
 */
async function seedScenario(admin) {
  const srcFuerza = await makeExercise(admin, 'Sentadilla trasera', 'fuerza');
  const srcRoutine = await makeRoutine(admin, 'Fuerza origen', [srcFuerza]);
  const sourcePlanId = await makePlan(admin, 'Plan origen', srcRoutine);

  const tgtBulgara = await makeExercise(admin, 'Sentadilla búlgara', 'fuerza');
  const tgtPesoMuerto = await makeExercise(admin, 'Peso muerto', 'fuerza');
  const tgtSalto = await makeExercise(admin, 'Salto al cajón profundo', 'salto');
  const tgtRoutine = await makeRoutine(admin, 'Fuerza destino', [
    tgtBulgara,
    tgtPesoMuerto,
    tgtSalto,
  ]);
  const targetPlanId = await makePlan(admin, 'Plan destino', tgtRoutine);

  return { srcFuerza, sourcePlanId, tgtBulgara, tgtPesoMuerto, tgtSalto, targetPlanId };
}

/** Activa el plan origen para el usuario y calibra la sentadilla en 62 kg. */
async function activateAndCalibrate(user, sourcePlanId, srcFuerza) {
  await request(app)
    .post(`${MP}/activate`)
    .set(authHeader(user))
    .send({ weeklyPlanId: sourcePlanId });
  await request(app)
    .post(`${MP}/confirm-load`)
    .set(authHeader(user))
    .send({ exerciseId: srcFuerza, actualValue: 62 });
}

describe('Cambio de plan — preview', () => {
  it('cruza por categoría: match de fuerza (con su carga) + newInTargetPlan de salto', async () => {
    const admin = await createAdmin();
    const s = await seedScenario(admin);
    const user = await createPremiumUser();
    await activateAndCalibrate(user, s.sourcePlanId, s.srcFuerza);

    const res = await request(app)
      .get(`${WP}/${s.targetPlanId}/change-preview`)
      .set(authHeader(user));

    expect(res.status).toBe(200);
    const { matches, newInTargetPlan } = res.body.data;

    expect(matches).toHaveLength(1);
    const m = matches[0];
    expect(m.category).toBe('fuerza');
    expect(m.currentExercise.name).toBe('Sentadilla trasera');
    expect(m.currentExercise.actualValue).toBe(62);
    expect(m.currentExercise.unit).toBe('kg');
    // Dos ejercicios de fuerza en el destino → el front debe pedir elegir.
    expect(m.targetExercises.map((e) => e.name).sort()).toEqual([
      'Peso muerto',
      'Sentadilla búlgara',
    ]);
    // La categoría salto no tenía carga calibrada → informativa.
    expect(newInTargetPlan.some((n) => n.category === 'salto')).toBe(true);
  });

  it('400 si el plan destino es el mismo que el activo', async () => {
    const admin = await createAdmin();
    const s = await seedScenario(admin);
    const user = await createPremiumUser();
    await activateAndCalibrate(user, s.sourcePlanId, s.srcFuerza);

    const res = await request(app)
      .get(`${WP}/${s.sourcePlanId}/change-preview`)
      .set(authHeader(user));
    expect(res.status).toBe(400);
  });

  it('403 si el usuario NO es premium', async () => {
    const admin = await createAdmin();
    const s = await seedScenario(admin);
    const user = await createFreeUser();
    await request(app)
      .post(`${MP}/activate`)
      .set(authHeader(user))
      .send({ weeklyPlanId: s.sourcePlanId });

    const res = await request(app)
      .get(`${WP}/${s.targetPlanId}/change-preview`)
      .set(authHeader(user));
    expect(res.status).toBe(403);
  });
});

describe('Cambio de plan — confirmar', () => {
  it('carry_load: crea plan nuevo activo con la carga llevada; el viejo queda switched', async () => {
    const admin = await createAdmin();
    const s = await seedScenario(admin);
    const user = await createPremiumUser();
    await activateAndCalibrate(user, s.sourcePlanId, s.srcFuerza);

    const res = await request(app)
      .post(`${WP}/${s.targetPlanId}/change`)
      .set(authHeader(user))
      .send({
        decisions: [
          {
            category: 'fuerza',
            decision: 'carry_load',
            targetExerciseId: s.tgtBulgara,
          },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.plan.status).toBe('active');

    // El plan viejo quedó switched; el nuevo es el activo.
    const plans = await UserPlan.find({ userId: user._id }).lean();
    expect(plans).toHaveLength(2);
    const switched = plans.find((p) => p.status === 'switched');
    const active = plans.find((p) => p.status === 'active');
    expect(switched).toBeTruthy();
    expect(switched.cycles[0].completedAt).not.toBeNull();
    expect(String(active.weeklyPlanId)).toBe(String(s.targetPlanId));

    // La carga llevada quedó calibrada en la búlgara; el resto sin calibrar.
    const loads = active.cycles[0].loads;
    const bulgara = loads.find((l) => String(l.exerciseId) === String(s.tgtBulgara));
    const pesoMuerto = loads.find((l) => String(l.exerciseId) === String(s.tgtPesoMuerto));
    const salto = loads.find((l) => String(l.exerciseId) === String(s.tgtSalto));
    expect(bulgara.calibrated).toBe(true);
    expect(bulgara.actualValue).toBe(62);
    expect(bulgara.suggestedValue).toBe(62);
    expect(pesoMuerto.calibrated).toBe(false);
    expect(pesoMuerto.actualValue).toBeNull();
    expect(salto.calibrated).toBe(false);
  });

  it('422 si carry_load con dos ejercicios en la categoría y sin targetExerciseId', async () => {
    const admin = await createAdmin();
    const s = await seedScenario(admin);
    const user = await createPremiumUser();
    await activateAndCalibrate(user, s.sourcePlanId, s.srcFuerza);

    const res = await request(app)
      .post(`${WP}/${s.targetPlanId}/change`)
      .set(authHeader(user))
      .send({ decisions: [{ category: 'fuerza', decision: 'carry_load' }] });

    expect(res.status).toBe(422);
    // No se creó un segundo plan (la transacción no llegó a ejecutarse).
    const plans = await UserPlan.find({ userId: user._id }).lean();
    expect(plans).toHaveLength(1);
    expect(plans[0].status).toBe('active');
  });

  it('403 si el usuario NO es premium', async () => {
    const admin = await createAdmin();
    const s = await seedScenario(admin);
    const user = await createFreeUser();
    await request(app)
      .post(`${MP}/activate`)
      .set(authHeader(user))
      .send({ weeklyPlanId: s.sourcePlanId });

    const res = await request(app)
      .post(`${WP}/${s.targetPlanId}/change`)
      .set(authHeader(user))
      .send({ decisions: [] });
    expect(res.status).toBe(403);
  });
});

describe('WeeklyPlans — isCurrentPlan en el listado', () => {
  it('marca isCurrentPlan en el plan activo del usuario', async () => {
    const admin = await createAdmin();
    const s = await seedScenario(admin);
    const user = await createPremiumUser();
    await request(app)
      .post(`${MP}/activate`)
      .set(authHeader(user))
      .send({ weeklyPlanId: s.sourcePlanId });

    const res = await request(app).get(WP).set(authHeader(user));
    expect(res.status).toBe(200);
    const items = res.body.data.weeklyPlans;
    const source = items.find((p) => String(p._id) === String(s.sourcePlanId));
    const target = items.find((p) => String(p._id) === String(s.targetPlanId));
    expect(source.isCurrentPlan).toBe(true);
    expect(target.isCurrentPlan).toBe(false);
  });
});
