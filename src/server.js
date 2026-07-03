'use strict';

/**
 * @file Arranque del servidor: conecta a la DB, levanta Express y gestiona
 * el cierre ordenado ante señales del sistema y errores fatales.
 */

const app = require('./app');
const { config } = require('./config/env');
const { connectDB, disconnectDB } = require('./config/database');

let server = null;

/**
 * Cierre ordenado: deja de aceptar conexiones y cierra Mongoose.
 *
 * @param {string} signal - Señal o causa que dispara el cierre.
 * @param {number} [exitCode=0] - Código de salida del proceso.
 * @returns {Promise<void>}
 */
async function shutdown(signal, exitCode = 0) {
  // eslint-disable-next-line no-console
  console.log(`… [server] Cierre iniciado (${signal})`);
  try {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
      // eslint-disable-next-line no-console
      console.log('✓ [server] HTTP cerrado');
    }
    await disconnectDB();
    // eslint-disable-next-line no-console
    console.log('✓ [db] Conexión cerrada');
    process.exit(exitCode);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('✗ [server] Error durante el cierre:', err.message);
    process.exit(1);
  }
}

/**
 * Punto de entrada: conecta DB y levanta el server.
 *
 * @returns {Promise<void>}
 */
async function bootstrap() {
  await connectDB();

  // 0.0.0.0 = todas las interfaces de red (no solo localhost), para que el
  // server sea alcanzable desde otros dispositivos de la LAN (p. ej. un
  // celular por WiFi apuntando a la IP de esta PC).
  const HOST = '0.0.0.0';
  server = app.listen(config.port, HOST, () => {
    // eslint-disable-next-line no-console
    console.log(
      `✓ [server] GRYSTO API escuchando en ${HOST}:${config.port} (${config.nodeEnv})`
    );
    // eslint-disable-next-line no-console
    console.log(`  · local:   http://localhost:${config.port}/api/v1`);
    // eslint-disable-next-line no-console
    console.log(
      `  · red LAN: http://<IP-de-esta-PC>:${config.port}/api/v1  (dispositivo físico)`
    );
  });
}

// Señales de terminación.
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Errores fatales no capturados.
process.on('unhandledRejection', (reason) => {
  // eslint-disable-next-line no-console
  console.error('✗ [server] unhandledRejection:', reason);
  shutdown('unhandledRejection', 1);
});
process.on('uncaughtException', (err) => {
  // eslint-disable-next-line no-console
  console.error('✗ [server] uncaughtException:', err);
  shutdown('uncaughtException', 1);
});

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('✗ [server] Fallo en el arranque:', err.message);
  process.exit(1);
});
