import { Router } from "express";

import {
  createGroup,
  createPlayer,
  deleteGroup,
  getGroup,
  listGroups,
} from "../controllers/group.controller";
import { requireAuth } from "../middlewares/authMiddleware";

const groupRouter = Router();

groupRouter.use(requireAuth);
groupRouter.get("/", listGroups);
groupRouter.post("/", createGroup);
groupRouter.get("/:groupId", getGroup);
groupRouter.post("/:groupId/players", createPlayer);
groupRouter.delete("/:groupId", deleteGroup);

export { groupRouter };
