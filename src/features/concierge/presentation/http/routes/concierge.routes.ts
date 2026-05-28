import { Router } from 'express';

import { ConciergeController } from '../controller/concierge.controller.js';

export const conciergeRoutes = Router();

const conciergeController = new ConciergeController();

conciergeRoutes.get('/concierge/turns', (req, res, next) => conciergeController.listTurns(req, res, next));
conciergeRoutes.get('/concierge/turns/:turnId', (req, res, next) => conciergeController.getTurnById(req, res, next));
conciergeRoutes.post('/concierge/run-turn', (req, res, next) => conciergeController.runTurn(req, res, next));
