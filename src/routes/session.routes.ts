import { Router } from "express";

import { deleteSession, getSession, updateResults } from "../controllers/session.controller";
import { requireAuth } from "../middlewares/authMiddleware";

const sessionRouter = Router();

sessionRouter.use(requireAuth);
sessionRouter.get("/:sessionId", getSession);
sessionRouter.post("/:sessionId/results", updateResults);
sessionRouter.delete("/:sessionId", deleteSession);

export { sessionRouter };
