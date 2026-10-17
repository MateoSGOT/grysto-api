'use strict';

/**
 * @file Tests unitarios de la generación/hash de códigos y del envío de email
 * (escape de HTML y manejo de errores de Resend, que NO lanza).
 */

const authCodeService = require('../../src/services/authCode.service');
const { escapeHtml } = require('../../src/services/email.service');

describe('authCode.service — generación y hash', () => {
  it('genera siempre 6 dígitos (con ceros a la izquierda)', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(authCodeService.generateCode()).toMatch(/^\d{6}$/);
    }
  });

  it('el hash depende del propósito y del usuario (no intercambiable)', () => {
    const uid = '507f1f77bcf86cd799439011';
    const other = '507f1f77bcf86cd799439012';
    const base = authCodeService.hashCode('email_verification', uid, '123456');
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(base).not.toContain('123456');
    expect(authCodeService.hashCode('password_reset', uid, '123456')).not.toBe(base);
    expect(authCodeService.hashCode('email_verification', other, '123456')).not.toBe(base);
    expect(authCodeService.hashCode('email_verification', uid, '123456')).toBe(base);
  });
});

describe('email.service — plantilla', () => {
  it('escapa HTML del nombre (sin inyección de marcado)', () => {
    expect(escapeHtml('<a href="x">Hola</a> & \'y\'')).toBe(
      '&lt;a href=&quot;x&quot;&gt;Hola&lt;/a&gt; &amp; &#39;y&#39;'
    );
  });
});

describe('email.service — envío con Resend', () => {
  /**
   * Carga email.service con una API key de prueba y un Resend simulado.
   *
   * @param {jest.Mock} send - Mock de `resend.emails.send`.
   * @returns {Object} Módulo email.service aislado.
   */
  function loadWithResend(send) {
    let svc;
    const prevKey = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = 're_test_key';
    jest.isolateModules(() => {
      jest.doMock('resend', () => ({
        Resend: jest.fn().mockImplementation(() => ({ emails: { send } })),
      }));
      // eslint-disable-next-line global-require
      svc = require('../../src/services/email.service');
    });
    process.env.RESEND_API_KEY = prevKey;
    return svc;
  }

  afterEach(() => jest.dontMock('resend'));

  it('envía con el remitente de EMAIL_FROM y el nombre escapado', async () => {
    const send = jest.fn().mockResolvedValue({ data: { id: 'x' }, error: null });
    const svc = loadWithResend(send);

    const res = await svc.sendVerificationCode('a@b.com', '<b>Mateo</b>', '042917');
    expect(res).toEqual({ sent: true });
    const arg = send.mock.calls[0][0];
    expect(arg.to).toBe('a@b.com');
    expect(arg.from).toEqual(expect.any(String));
    expect(arg.html).toContain('042917');
    expect(arg.html).toContain('&lt;b&gt;Mateo&lt;/b&gt;');
    expect(arg.html).not.toContain('<b>Mateo</b>');
  });

  it('si Resend devuelve { error } (no lanza), NO lo da por enviado', async () => {
    const send = jest.fn().mockResolvedValue({
      data: null,
      error: { message: 'You can only send testing emails to your own email address' },
    });
    const svc = loadWithResend(send);
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await svc.sendPasswordResetCode('ana@b.com', 'Mateo', '123456');
    expect(res).toEqual({ sent: false });
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('Resend rechazó'));
    // El log no expone el código ni el email completo.
    const logged = spy.mock.calls.flat().join(' ');
    expect(logged).toContain('a***@b.com');
    expect(logged).not.toContain('ana@b.com');
    expect(logged).not.toContain('123456');
    spy.mockRestore();
  });
});
