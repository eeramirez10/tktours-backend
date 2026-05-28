import { createApp } from './app.js';
import { env } from './shared/config/env.js';
import { logger } from './shared/config/logger.js';

const app = createApp();

app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'server listening');
});
