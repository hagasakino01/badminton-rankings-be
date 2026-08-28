import { Router } from "express";

import { getMyStatistics } from "../controllers/statistics.controller";
import { requireAuth } from "../middlewares/authMiddleware";

const statisticsRouter = Router();

statisticsRouter.use(requireAuth);
statisticsRouter.get("/me", getMyStatistics);

export { statisticsRouter };
