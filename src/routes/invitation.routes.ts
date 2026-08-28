import { Router } from "express";

import {
  acceptInvitation,
  getInvitation,
  revokeInvitation,
} from "../controllers/invitation.controller";
import { requireAuth } from "../middlewares/authMiddleware";

const invitationRouter = Router();

invitationRouter.post("/:invitationId/revoke", requireAuth, revokeInvitation);
invitationRouter.get("/:token", getInvitation);
invitationRouter.post("/:token/accept", requireAuth, acceptInvitation);

export { invitationRouter };
