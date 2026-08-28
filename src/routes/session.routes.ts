import { Router } from "express";

import {
  deleteSession,
  getSession,
  lockSession,
  scheduleSession,
  unlockSession,
  updateMatchResult,
  updateSession,
} from "../controllers/session.controller";
import { requireAuth } from "../middlewares/authMiddleware";

const sessionRouter = Router();

sessionRouter.use(requireAuth);
sessionRouter.get("/:sessionId", getSession);
sessionRouter.patch("/:sessionId", updateSession);
sessionRouter.post("/:sessionId/schedule", scheduleSession);
sessionRouter.put("/:sessionId/matches/:matchId/result", updateMatchResult);
sessionRouter.post("/:sessionId/lock", lockSession);
sessionRouter.post("/:sessionId/unlock", unlockSession);
sessionRouter.delete("/:sessionId", deleteSession);

export { sessionRouter };
