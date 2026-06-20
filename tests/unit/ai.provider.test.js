'use strict';

/**
 * @file Tests unitarios de los proveedores de IA. fetch SIEMPRE mockeado —
 * nunca se llama a Gemini real.
 */

const { GeminiProvider } = require('../../src/services/ai/providers/gemini.provider');
const { AnthropicProvider } = require('../../src/services/ai/providers/anthropic.provider');

/** Respuesta de ejemplo con la forma real de Gemini. */
const GEMINI_SAMPLE = {
  candidates: [
    {
      content: { role: 'model', parts: [{ text: 'Hoy toca fuerza de piernas. 💪' }] },
      finishReason: 'STOP',
    },
  ],
  usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 12, totalTokenCount: 52 },
};

const MESSAGES = [
  { role: 'system', content: 'Eres el Coach IA de Grysto.' },
  { role: 'user', content: 'hola' },
  { role: 'assistant', content: 'hey, ¿en qué te ayudo?' },
  { role: 'user', content: '¿qué entreno hoy?' },
];

describe('GeminiProvider.buildRequestBody — conversión de formato', () => {
  it('mueve system a systemInstruction y mapea assistant → model', () => {
    const body = GeminiProvider.buildRequestBody(MESSAGES);

    expect(body.systemInstruction.parts[0].text).toBe('Eres el Coach IA de Grysto.');
    // El system NO aparece en contents.
    expect(body.contents).toHaveLength(3);
    expect(body.contents.map((c) => c.role)).toEqual(['user', 'model', 'user']);
    expect(body.contents[1].parts[0].text).toBe('hey, ¿en qué te ayudo?');
  });
});

describe('GeminiProvider.generate — normalización (fetch mockeado)', () => {
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

  it('normaliza la respuesta al formato estándar', async () => {
    const provider = new GeminiProvider();
    const result = await provider.generate(MESSAGES);

    expect(result.content).toBe('Hoy toca fuerza de piernas. 💪');
    expect(result.provider).toBe('gemini');
    expect(result.model).toBe('gemini-2.5-flash');
    expect(result.tokensInput).toBe(40);
    expect(result.tokensOutput).toBe(12);
    expect(typeof result.responseTimeMs).toBe('number');
    expect(result.metadata.finishReason).toBe('STOP');
  });

  it('envía a Gemini el body convertido (system + roles)', async () => {
    const provider = new GeminiProvider();
    await provider.generate(MESSAGES);

    const [, options] = global.fetch.mock.calls[0];
    const sentBody = JSON.parse(options.body);
    expect(sentBody.systemInstruction.parts[0].text).toContain('Coach IA');
    expect(sentBody.contents.map((c) => c.role)).toEqual(['user', 'model', 'user']);
    expect(options.headers['x-goog-api-key']).toBe('test-gemini-key');
  });

  it('traduce un 429 de Gemini a ApiError 429', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({}),
      text: async () => 'rate limited',
    });
    const provider = new GeminiProvider();
    await expect(provider.generate(MESSAGES)).rejects.toMatchObject({
      statusCode: 429,
    });
  });
});

describe('AnthropicProvider — stub', () => {
  it('lanza error 503 al no estar configurado', async () => {
    const provider = new AnthropicProvider();
    await expect(provider.generate(MESSAGES)).rejects.toMatchObject({
      statusCode: 503,
      message: 'Proveedor Anthropic aún no configurado',
    });
  });

  it('buildRequestPayload separa system de los mensajes user/assistant', () => {
    const payload = AnthropicProvider.buildRequestPayload(MESSAGES);
    expect(payload.system).toBe('Eres el Coach IA de Grysto.');
    expect(payload.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
  });
});
