'use strict';

/**
 * @file Variables de entorno para los tests. Se ejecuta ANTES de cargar
 * cualquier módulo (setupFiles), por lo que `config` quedará aislado de la
 * DB real de Atlas y de Resend. dotenv no sobrescribe lo ya definido aquí.
 */

process.env.NODE_ENV = 'test';

// mongodb-memory-server: margen amplio de arranque en Windows y uso del
// binario ya cacheado globalmente.
process.env.MONGOMS_LAUNCH_TIMEOUT = '60000';
process.env.MONGOMS_PREFER_GLOBAL_PATH = '1';

process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/grysto_test';
process.env.DB_NAME = 'grysto_test';
process.env.JWT_ACCESS_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.JWT_ACCESS_EXPIRES = '15m';
process.env.JWT_REFRESH_EXPIRES = '7d';
process.env.RESEND_API_KEY = ''; // fuerza modo dev del email.service
process.env.FRONTEND_URL = 'http://localhost:5173';
process.env.CLIENT_VERIFY_URL = 'http://localhost:5173/verify-email';
process.env.CLIENT_RESET_URL = 'http://localhost:5173/reset-password';
