import { Router } from "express";

import {
  createSeason,
  deleteSeason,
  finalizeSeason,
  getSeason,
  getSeasonRankings,
} from "../controllers/season.controller";
import { generateSession } from "../controllers/session.controller";
import { requireAuth } from "../middlewares/authMiddleware";

const seasonRouter = Router();

seasonRouter.use(requireAuth);
seasonRouter.post("/groups/:groupId/seasons", createSeason);
seasonRouter.get("/:seasonId", getSeason);
seasonRouter.get("/:seasonId/rankings", getSeasonRankings);
seasonRouter.post("/:seasonId/sessions", generateSession);
seasonRouter.post("/:seasonId/finalize", finalizeSeason);
seasonRouter.delete("/:seasonId", deleteSeason);

export { seasonRouter };
