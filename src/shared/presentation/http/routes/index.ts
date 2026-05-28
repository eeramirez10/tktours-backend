import { Router } from 'express';

import { catalogRoutes } from '../../../../features/catalog/presentation/http/routes/catalog.routes.js';
import { conversationsRoutes } from '../../../../features/conversations/presentation/http/routes/conversations.routes.js';
import { inquiriesRoutes } from '../../../../features/inquiries/presentation/http/routes/inquiries.routes.js';
import { resourcesRoutes } from '../../../../features/resources/presentation/http/routes/resources.routes.js';
import { healthRoute } from './health.route.js';
import { conciergeRoutes } from '../../../../features/concierge/presentation/http/routes/concierge.routes.js';
import { twilioWhatsAppRoutes } from '../../../../features/whatsapp/presentation/http/routes/twilio-whatsapp.routes.js';

export const apiRouter = Router();

apiRouter.use(healthRoute);
apiRouter.use('/api', catalogRoutes);
apiRouter.use('/api', resourcesRoutes);
apiRouter.use('/api', inquiriesRoutes);
apiRouter.use('/api', conversationsRoutes);
apiRouter.use('/api', conciergeRoutes);
apiRouter.use(twilioWhatsAppRoutes);
