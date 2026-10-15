'use strict';

/**
 * @file Servicio de email (Resend). Envía los CÓDIGOS de 6 dígitos de
 * verificación de cuenta y de recuperación de contraseña (no hay links).
 *
 * - Remitente: `EMAIL_FROM` (config). Cambiarlo al dominio verificado no
 *   requiere tocar código.
 * - Sin `RESEND_API_KEY` (desarrollo) no envía: loguea el código en consola,
 *   salvo en producción.
 * - Los fallos de envío se registran pero NO interrumpen el flujo principal.
 */

const { Resend } = require('resend');
const { config } = require('../config/env');
const { AUTH_CODE_POLICY } = require('../constants/authCodes');

/** Paleta del sistema visual de Grysto (rojo solo como acento puntual). */
const COLORS = Object.freeze({
  background: '#000000',
  surface1: '#0D0D0D',
  surface2: '#141414',
  border: '#1F1F1F',
  accent: '#E63012',
  textPrimary: '#F5F5F5',
  textSecondary: '#8A8A8A',
});

const CODE_TTL_MIN = Math.round(AUTH_CODE_POLICY.ttlMs / 60000);

/** Cliente Resend (null si no hay API key configurada). */
const resend = config.email.resendApiKey
  ? new Resend(config.email.resendApiKey)
  : null;

/**
 * Escapa texto para interpolarlo en HTML (evita inyectar marcado vía `nombre`).
 *
 * @param {string} value - Texto sin escapar.
 * @returns {string} Texto seguro para HTML.
 */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Plantilla HTML con el código grande. Todos los textos dinámicos se escapan.
 *
 * @param {Object} params - Parámetros.
 * @param {string} params.title - Título.
 * @param {string} params.nombre - Nombre del usuario (sin escapar).
 * @param {string} params.bodyText - Texto del cuerpo.
 * @param {string} params.code - Código de 6 dígitos.
 * @param {string} params.footnote - Nota al pie.
 * @returns {string} HTML del email.
 */
function codeTemplate({ title, nombre, bodyText, code, footnote }) {
  const c = COLORS;
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${c.background};font-family:'Work Sans',Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${c.background};padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:${c.surface1};border:1px solid ${c.border};border-radius:12px;">
        <tr><td style="padding:28px 28px 0;">
          <p style="margin:0;color:${c.textPrimary};font-size:20px;font-weight:bold;letter-spacing:3px;">GRYSTO</p>
        </td></tr>
        <tr><td style="padding:24px 28px 32px;">
          <h1 style="margin:0 0 12px;color:${c.textPrimary};font-size:20px;">${escapeHtml(title)}</h1>
          <p style="margin:0 0 8px;font-size:15px;color:${c.textSecondary};">Hola, ${escapeHtml(nombre)}</p>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:${c.textSecondary};">${escapeHtml(bodyText)}</p>
          <div style="background:${c.surface2};border:1px solid ${c.border};border-radius:10px;padding:20px;text-align:center;">
            <span style="font-family:'Courier New',monospace;font-size:34px;font-weight:bold;letter-spacing:10px;color:${c.textPrimary};">${escapeHtml(code)}</span>
          </div>
          <p style="margin:12px 0 0;font-size:13px;color:${c.accent};text-align:center;">Vence en ${CODE_TTL_MIN} minutos</p>
          <p style="margin:24px 0 0;font-size:12px;color:${c.textSecondary};line-height:1.5;">${escapeHtml(footnote)}</p>
        </td></tr>
      </table>
      <p style="margin:16px 0 0;color:${c.textSecondary};font-size:11px;">© ${new Date().getFullYear()} Grysto · Medellín, Colombia</p>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Envía un email vía Resend o lo loguea en desarrollo. Nunca lanza.
 *
 * Resend v6 NO lanza ante errores de la API (dominio sin verificar,
 * destinatario no permitido en modo prueba, etc.): devuelve `{ data, error }`.
 * Por eso se revisa `error` explícitamente; si no, un envío rechazado se
 * daría por bueno.
 *
 * @param {Object} mail - Datos del email.
 * @param {string} mail.to - Destinatario.
 * @param {string} mail.subject - Asunto.
 * @param {string} mail.html - Cuerpo HTML.
 * @param {string} mail.devCode - Código a mostrar en consola en desarrollo.
 * @returns {Promise<{ sent: boolean }>} Resultado del envío.
 */
async function dispatch({ to, subject, html, devCode }) {
  if (!resend) {
    if (!config.isProduction) {
      // eslint-disable-next-line no-console
      console.log(`📧 [email:dev] Para: ${to} | ${subject} | Código: ${devCode}`);
    } else {
      // eslint-disable-next-line no-console
      console.error('✗ [email] RESEND_API_KEY no configurada: email no enviado');
    }
    return { sent: false };
  }
  try {
    const { error } = await resend.emails.send({
      from: config.email.from,
      to,
      subject,
      html,
    });
    if (error) {
      // eslint-disable-next-line no-console
      console.error(`✗ [email] Resend rechazó el envío a ${to}: ${error.message}`);
      return { sent: false };
    }
    return { sent: true };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`✗ [email] Fallo enviando a ${to}: ${err.message}`);
    return { sent: false };
  }
}

/**
 * Envía el código de verificación de cuenta.
 *
 * @param {string} to - Email del destinatario.
 * @param {string} nombre - Nombre del usuario.
 * @param {string} code - Código de 6 dígitos.
 * @returns {Promise<{ sent: boolean }>} Resultado.
 */
async function sendVerificationCode(to, nombre, code) {
  const html = codeTemplate({
    title: 'Verifica tu cuenta',
    nombre,
    bodyText: 'Escribe este código en la app para activar tu cuenta y empezar a entrenar.',
    code,
    footnote: 'Si no creaste una cuenta en Grysto, ignora este mensaje.',
  });
  return dispatch({
    to,
    subject: `${code} es tu código de Grysto`,
    html,
    devCode: code,
  });
}

/**
 * Envía el código de recuperación de contraseña.
 *
 * @param {string} to - Email del destinatario.
 * @param {string} nombre - Nombre del usuario.
 * @param {string} code - Código de 6 dígitos.
 * @returns {Promise<{ sent: boolean }>} Resultado.
 */
async function sendPasswordResetCode(to, nombre, code) {
  const html = codeTemplate({
    title: 'Restablece tu contraseña',
    nombre,
    bodyText: 'Escribe este código en la app para crear una contraseña nueva.',
    code,
    footnote:
      'Si no pediste cambiar tu contraseña, ignora este correo: tu cuenta sigue segura.',
  });
  return dispatch({
    to,
    subject: `${code} es tu código para restablecer la contraseña`,
    html,
    devCode: code,
  });
}

module.exports = { sendVerificationCode, sendPasswordResetCode, escapeHtml };
