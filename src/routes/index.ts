import { Router } from "express";

import { authRouter } from "./auth.routes";
import { groupRouter } from "./group.routes";
import { seasonRouter } from "./season.routes";
import { sessionRouter } from "./session.routes";

const apiRouter = Router();

apiRouter.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

apiRouter.use("/auth", authRouter);
apiRouter.use("/groups", groupRouter);
apiRouter.use("/seasons", seasonRouter);
apiRouter.use("/sessions", sessionRouter);

export { apiRouter };
