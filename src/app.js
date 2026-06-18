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

const app = express();

// Seguridad y parsing.
app.disable('x-powered-by');
app.use(helmet());
app.use(
  cors({
    origin: config.client.frontendUrl,
    credentials: true,
  })
);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
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
