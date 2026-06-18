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

  server = app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(
      `✓ [server] GRYSTO API en http://localhost:${config.port}/api/v1 (${config.nodeEnv})`
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
