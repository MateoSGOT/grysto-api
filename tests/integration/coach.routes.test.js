'use strict';

/**
 * @file Tests de integración del Coach IA. fetch a Gemini SIEMPRE mockeado.
 */

const request = require('supertest');
const app = require('../../src/app');
const {
  createUser,
  createAdmin,
  createFreeUser,
  authHeader,
  validExercisePayload,
  validRoutinePayload,
  validWeeklyPlanPayload,
} = require('../fixtures');

const BASE = '/api/v1/coach';

const GEMINI_SAMPLE = {
  candidates: [
    {
      content: { role: 'model', parts: [{ text: 'Hoy: fuerza de piernas y tiro libre.' }] },
      finishReason: 'STOP',
    },
  ],
  usageMetadata: { promptTokenCount: 35, candidatesTokenCount: 14, totalTokenCount: 49 },
};

let originalFetch;

beforeEach(() => {
  originalFetch = global.fetch;
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => GEMINI_SAMPLE,
    text: async () => '',
  });
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('Coach — chat', () => {
  it('envía un mensaje y recibe respuesta (Gemini mockeado)', async () => {
    const user = await createUser();

    const res = await request(app)
      .post(`${BASE}/chat`)
      .set(authHeader(user))
      .send({ message: '¿qué entreno hoy?' });

    expect(res.status).toBe(200);
    expect(res.body.data.reply).toBe('Hoy: fuerza de piernas y tiro libre.');
    expect(res.body.data.provider).toBe('gemini');
    expect(res.body.data.tokensInput).toBe(35);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('persiste la conversación con mensajes y metadatos (tokens, provider)', async () => {
    const user = await createUser();

    const chat = await request(app)
      .post(`${BASE}/chat`)
      .set(authHeader(user))
      .send({ message: '¿qué entreno hoy?' });
    const conversationId = chat.body.data.conversationId;

    const res = await request(app)
      .get(`${BASE}/conversations/${conversationId}`)
      .set(authHeader(user));

    expect(res.status).toBe(200);
    const { messages } = res.body.data.conversation;
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].provider).toBe('gemini');
    expect(messages[1].tokensInput).toBe(35);
    expect(messages[1].tokensOutput).toBe(14);
  });
});

describe('Coach — conversaciones', () => {
  it('lista las conversaciones ordenadas por lastMessageAt desc', async () => {
    const user = await createUser();

    // Conversación 1 con un chat.
    await request(app)
      .post(`${BASE}/chat`)
      .set(authHeader(user))
      .send({ message: 'hola coach' });

    // Conversación 2 nueva (lastMessageAt más reciente).
    const created = await request(app)
      .post(`${BASE}/conversations`)
      .set(authHeader(user));
    const newestId = created.body.data.conversation._id;

    const res = await request(app)
      .get(`${BASE}/conversations`)
      .set(authHeader(user));

    expect(res.status).toBe(200);
    expect(res.body.data.conversations.length).toBe(2);
    expect(res.body.data.conversations[0]._id).toBe(newestId);
  });
});

describe('Coach — contexto del plan', () => {
  /** Siembra ejercicio (fuerza) + rutina + plan semanal; devuelve su id. */
  async function seedPlan(admin) {
    const ex = await request(app)
      .post('/api/v1/exercises')
      .set(authHeader(admin))
      .send(validExercisePayload({ category: 'fuerza' }));
    const rt = await request(app)
      .post('/api/v1/routines')
      .set(authHeader(admin))
      .send(validRoutinePayload(ex.body.data.exercise._id));
    const wp = await request(app)
      .post('/api/v1/weekly-plans')
      .set(authHeader(admin))
      .send(validWeeklyPlanPayload(rt.body.data.routine._id));
    return wp.body.data.weeklyPlan._id;
  }

  it('inyecta los ejercicios de hoy y el estado de la carga en el prompt', async () => {
    const admin = await createAdmin();
    const weeklyPlanId = await seedPlan(admin);

    const user = await createFreeUser();
    await request(app)
      .post('/api/v1/my-plan/activate')
      .set(authHeader(user))
      .send({ weeklyPlanId });

    await request(app)
      .post(`${BASE}/chat`)
      .set(authHeader(user))
      .send({ message: '¿cómo hago el ejercicio de hoy?' });

    // El cuerpo enviado a Gemini debe llevar el contexto del plan de hoy.
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    const systemText = body.systemInstruction.parts[0].text;
    expect(systemText).toContain('Ejercicios de hoy');
    expect(systemText).toContain('Salto al cajón'); // ejercicio del día 1
    expect(systemText).toContain('SIN REGISTRAR'); // carga aún sin calibrar
    // Temperatura baja aplicada a la generación.
    expect(body.generationConfig.temperature).toBeLessThanOrEqual(0.7);
  });
});

describe('Coach — validación y ownership', () => {
  it('rechaza un mensaje vacío (422)', async () => {
    const user = await createUser();
    const res = await request(app)
      .post(`${BASE}/chat`)
      .set(authHeader(user))
      .send({ message: '' });
    expect(res.status).toBe(422);
  });

  it('rechaza un mensaje demasiado largo (422)', async () => {
    const user = await createUser();
    const res = await request(app)
      .post(`${BASE}/chat`)
      .set(authHeader(user))
      .send({ message: 'a'.repeat(2001) });
    expect(res.status).toBe(422);
  });

  it('un usuario no puede ver la conversación de otro (403/404)', async () => {
    const userA = await createUser();
    const userB = await createUser();

    const chat = await request(app)
      .post(`${BASE}/chat`)
      .set(authHeader(userA))
      .send({ message: 'mi plan secreto' });
    const conversationId = chat.body.data.conversationId;

    const res = await request(app)
      .get(`${BASE}/conversations/${conversationId}`)
      .set(authHeader(userB));

    expect([403, 404]).toContain(res.status);
  });
});
