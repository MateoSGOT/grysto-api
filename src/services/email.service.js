'use strict';

/**
 * @file Servicio de email (Resend). Si RESEND_API_KEY está vacío (desarrollo),
 * loguea el enlace en consola en lugar de enviar — así se prueba sin Resend.
 * Los fallos de envío se registran pero NO interrumpen el flujo principal.
 */

const { Resend } = require('resend');
const { config } = require('../config/env');

const BRAND_RED = '#E63012';
const BRAND_BG = '#0F0F0F';

/** Cliente Resend (null si no hay API key configurada). */
const resend = config.email.resendApiKey
  ? new Resend(config.email.resendApiKey)
  : null;

/**
 * Plantilla HTML base con la marca Grysto.
 *
 * @param {Object} params - Parámetros de la plantilla.
 * @param {string} params.title - Título principal.
 * @param {string} params.greeting - Saludo personalizado.
 * @param {string} params.bodyText - Texto del cuerpo.
 * @param {string} params.buttonText - Texto del botón.
 * @param {string} params.buttonUrl - URL del botón.
 * @param {string} params.footnote - Nota al pie.
 * @returns {string} HTML del email.
 */
function baseTemplate({ title, greeting, bodyText, buttonText, buttonUrl, footnote }) {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${BRAND_BG};font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND_BG};padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#1A1A1A;border-radius:12px;overflow:hidden;">
        <tr><td style="background:${BRAND_RED};padding:24px;text-align:center;">
          <h1 style="margin:0;color:#fff;font-size:26px;letter-spacing:2px;">GRYSTO</h1>
        </td></tr>
        <tr><td style="padding:32px 28px;color:#EDEDED;">
          <h2 style="margin:0 0 12px;color:#fff;font-size:20px;">${title}</h2>
          <p style="margin:0 0 8px;font-size:15px;color:#BDBDBD;">${greeting}</p>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#BDBDBD;">${bodyText}</p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
            <tr><td style="border-radius:8px;background:${BRAND_RED};">
              <a href="${buttonUrl}" target="_blank"
                 style="display:inline-block;padding:14px 32px;color:#fff;text-decoration:none;font-weight:bold;font-size:15px;">
                ${buttonText}
              </a>
            </td></tr>
          </table>
          <p style="margin:24px 0 0;font-size:12px;color:#777;line-height:1.5;">${footnote}</p>
          <p style="margin:12px 0 0;font-size:12px;color:#555;word-break:break-all;">${buttonUrl}</p>
        </td></tr>
        <tr><td style="padding:18px;text-align:center;background:#111;color:#555;font-size:11px;">
          © ${new Date().getFullYear()} Grysto · Medellín, Colombia
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Envía un email vía Resend o lo loguea en desarrollo. Nunca lanza.
 *
 * @param {Object} mail - Datos del email.
 * @param {string} mail.to - Destinatario.
 * @param {string} mail.subject - Asunto.
 * @param {string} mail.html - Cuerpo HTML.
 * @param {string} mail.devLink - Enlace a mostrar en consola en desarrollo.
 * @returns {Promise<{ sent: boolean }>} Resultado del envío.
 */
async function dispatch({ to, subject, html, devLink }) {
  if (!resend) {
    // eslint-disable-next-line no-console
    console.log(`📧 [email:dev] Para: ${to} | ${subject}\n   Link: ${devLink}`);
    return { sent: false };
  }
  try {
    await resend.emails.send({ from: config.email.from, to, subject, html });
    return { sent: true };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`✗ [email] Fallo enviando a ${to}: ${err.message}`);
    return { sent: false };
  }
}

/**
 * Envía el email de verificación de cuenta.
 *
 * @param {string} to - Email del destinatario.
 * @param {string} nombre - Nombre del usuario.
 * @param {string} token - Token de verificación.
 * @returns {Promise<{ sent: boolean }>} Resultado.
 */
async function sendVerificationEmail(to, nombre, token) {
  const url = `${config.client.verifyUrl}?token=${encodeURIComponent(token)}`;
  const html = baseTemplate({
    title: 'Verifica tu cuenta',
    greeting: `¡Hola, ${nombre}!`,
    bodyText:
      'Gracias por unirte a Grysto. Confirma tu correo para activar tu cuenta y empezar a entrenar.',
    buttonText: 'Verificar mi email',
    buttonUrl: url,
    footnote:
      'Si no creaste esta cuenta, ignora este mensaje. El enlace expira en 24 horas.',
  });
  return dispatch({ to, subject: 'Verifica tu cuenta en Grysto', html, devLink: url });
}

/**
 * Envía el email de recuperación de contraseña.
 *
 * @param {string} to - Email del destinatario.
 * @param {string} nombre - Nombre del usuario.
 * @param {string} token - Token de reset.
 * @returns {Promise<{ sent: boolean }>} Resultado.
 */
async function sendPasswordResetEmail(to, nombre, token) {
  const url = `${config.client.resetUrl}?token=${encodeURIComponent(token)}`;
  const html = baseTemplate({
    title: 'Restablece tu contraseña',
    greeting: `Hola, ${nombre}`,
    bodyText:
      'Recibimos una solicitud para restablecer tu contraseña. Si fuiste tú, haz clic en el botón.',
    buttonText: 'Cambiar contraseña',
    buttonUrl: url,
    footnote:
      'Si no solicitaste esto, ignora este correo. El enlace expira en 30 minutos.',
  });
  return dispatch({ to, subject: 'Restablece tu contraseña en Grysto', html, devLink: url });
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
