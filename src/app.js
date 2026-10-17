'use strict';

/**
 * @file Configuración de la aplicación Express (sin arranque del server).
 * Separado de server.js para facilitar tests con supertest.
 */

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const { config } = require('./config/env');
const apiRouter = require('./routes');
const ApiError = require('./utils/ApiError');
const errorMiddleware = require('./middlewares/error.middleware');
const { accessLog } = require('./middlewares/accessLog.middleware');
const { health } = require('./controllers/health.controller');

const app = express();

// Detrás del proxy de Render, `req.ip` sería la IP del proxy y los rate limits
// por IP quedarían GLOBALES (todos los usuarios compartiendo un contador).
// Confiar en N saltos hace que Express tome la IP real del cliente desde
// X-Forwarded-For sin aceptar valores que el cliente agregue por delante.
app.set('trust proxy', config.trustProxy);

// Seguridad y parsing.
app.disable('x-powered-by');
app.use(helmet());

// Health check de Render: antes del access log (lo llama cada pocos segundos).
app.get('/health', health);

if (!config.isTest) app.use(accessLog());
app.use(
  cors({
    origin: config.client.frontendUrl,
    credentials: true,
  })
);
// 100kb es suficiente: la API solo recibe JSON pequeño (las imágenes van por
// URL a Cloudinary). Limita la superficie de DoS por payloads gigantes.
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(cookieParser());

// Rutas versionadas.
app.use('/api/v1', apiRouter);

// 404 — cualquier ruta no encontrada.
app.use((req, res, next) => {
  next(ApiError.notFound(`Ruta no encontrada: ${req.method} ${req.originalUrl}`));
});

// Manejo central de errores (siempre al final).
app.use(errorMiddleware);

module.exports = app;
