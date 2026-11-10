import { WhatsAppInboxWorker } from './features/whatsapp/application/services/whatsapp-inbox-worker.service.js';
import { createApp } from './app.js';
import { conversationRealtimeHub } from './features/conversations/infrastructure/realtime/conversation-realtime-hub.js';
import { env } from './shared/config/env.js';
import { logger } from './shared/config/logger.js';

const app = createApp();

const server = app.listen(env.PORT, '0.0.0.0', () => {
  logger.info({ port: env.PORT }, 'server listening');
});

conversationRealtimeHub.attach(server);
const inboxWorker = new WhatsAppInboxWorker();
inboxWorker.start();

function shutdown(signal: NodeJS.Signals) {
  logger.info({ signal }, 'shutting down server');
  inboxWorker.stop();
  conversationRealtimeHub.close();

  server.close((error) => {
    if (error) {
      logger.error({ err: error }, 'server shutdown failed');
      process.exit(1);
    }

    process.exit(0);
  });

  setTimeout(() => {
    logger.error('forcing server shutdown after timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
