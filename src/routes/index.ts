import { Router } from "express";

import { authRouter } from "./auth.routes";
import { groupRouter } from "./group.routes";
import { invitationRouter } from "./invitation.routes";
import { seasonRouter } from "./season.routes";
import { sessionRouter } from "./session.routes";
import { statisticsRouter } from "./statistics.routes";

const apiRouter = Router();

apiRouter.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

apiRouter.use("/auth", authRouter);
apiRouter.use("/groups", groupRouter);
apiRouter.use("/invitations", invitationRouter);
apiRouter.use("/seasons", seasonRouter);
apiRouter.use("/sessions", sessionRouter);
apiRouter.use("/statistics", statisticsRouter);

export { apiRouter };
