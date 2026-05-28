import cors from 'cors';
import express from 'express';
import { pinoHttp } from 'pino-http';

import { logger } from './shared/config/logger.js';
import { errorHandler } from './shared/presentation/http/middlewares/error-handler.js';
import { notFoundHandler } from './shared/presentation/http/middlewares/not-found-handler.js';
import { apiRouter } from './shared/presentation/http/routes/index.js';

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json({ limit: '10mb' }));
  app.use(pinoHttp({ logger }));

  app.use(apiRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
