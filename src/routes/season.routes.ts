import { Router } from "express";

import {
  activateSeason,
  completeSeason,
  deleteSeason,
  getSeason,
  getSeasonHeadToHead,
  getSeasonRankings,
  replaceSeasonRoster,
  updateSeason,
} from "../controllers/season.controller";
import { createSession, listSessions } from "../controllers/session.controller";
import { requireAuth } from "../middlewares/authMiddleware";

const seasonRouter = Router();

seasonRouter.use(requireAuth);
seasonRouter.get("/:seasonId", getSeason);
seasonRouter.patch("/:seasonId", updateSeason);
seasonRouter.put("/:seasonId/roster", replaceSeasonRoster);
seasonRouter.post("/:seasonId/activate", activateSeason);
seasonRouter.get("/:seasonId/rankings", getSeasonRankings);
seasonRouter.get("/:seasonId/head-to-head", getSeasonHeadToHead);
seasonRouter.get("/:seasonId/sessions", listSessions);
seasonRouter.post("/:seasonId/sessions", createSession);
seasonRouter.post("/:seasonId/complete", completeSeason);
seasonRouter.post("/:seasonId/finalize", completeSeason);
seasonRouter.delete("/:seasonId", deleteSeason);

export { seasonRouter };
