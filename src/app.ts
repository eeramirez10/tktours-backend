import cors from 'cors';
import express from 'express';
import { pinoHttp } from 'pino-http';

import { env } from './shared/config/env.js';
import { logger } from './shared/config/logger.js';
import { errorHandler } from './shared/presentation/http/middlewares/error-handler.js';
import { notFoundHandler } from './shared/presentation/http/middlewares/not-found-handler.js';
import { apiRouter } from './shared/presentation/http/routes/index.js';

export function createApp() {
  const app = express();

  app.use(cors({ origin: env.CORS_ORIGIN ?? true }));
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json({
    limit: '10mb',
    verify: (req, _res, buffer) => {
      const request = req as express.Request;
      if (request.originalUrl.startsWith('/webhooks/meta/whatsapp')) {
        request.rawBody = Buffer.from(buffer);
      }
    },
  }));
  app.use(pinoHttp({ logger }));

  app.use(apiRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
