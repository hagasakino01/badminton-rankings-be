import { Router } from "express";

import {
  activateGroup,
  archiveGroup,
  createGroup,
  createMember,
  getGroup,
  getGroupActivity,
  listGroups,
  transferGroupHost,
  updateGroup,
  updateMemberAccess,
  updateMemberProfile,
  updateMemberStatus,
} from "../controllers/group.controller";
import {
  createInvitation,
  listInvitations,
} from "../controllers/invitation.controller";
import { getAllSeasonsStats } from "../controllers/statistics.controller";
import { createSeason, listSeasons } from "../controllers/season.controller";
import { requireAuth } from "../middlewares/authMiddleware";

const groupRouter = Router();

groupRouter.use(requireAuth);
groupRouter.get("/", listGroups);
groupRouter.post("/", createGroup);
groupRouter.get("/:groupId/seasons", listSeasons);
groupRouter.post("/:groupId/seasons", createSeason);
groupRouter.get("/:groupId", getGroup);
groupRouter.patch("/:groupId", updateGroup);
groupRouter.post("/:groupId/activate", activateGroup);
groupRouter.post("/:groupId/transfer-host", transferGroupHost);
groupRouter.get("/:groupId/activity", getGroupActivity);
groupRouter.get("/:groupId/all-seasons-stats", getAllSeasonsStats);
groupRouter.get("/:groupId/invitations", listInvitations);
groupRouter.post("/:groupId/members", createMember);
groupRouter.post("/:groupId/members/:memberId/invitations", createInvitation);
groupRouter.patch("/:groupId/members/:memberId/profile", updateMemberProfile);
groupRouter.patch("/:groupId/members/:memberId/status", updateMemberStatus);
groupRouter.patch("/:groupId/members/:memberId/access", updateMemberAccess);

// Temporary aliases keep the pre-V3 client usable while the new screens are wired.
groupRouter.post("/:groupId/players", createMember);
groupRouter.patch("/:groupId/players/:playerId/status", updateMemberStatus);
groupRouter.delete("/:groupId", archiveGroup);

export { groupRouter };
