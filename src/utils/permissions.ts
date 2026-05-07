import { GroupModel } from "../models/Group";
import { AppError } from "./appError";
import type { JwtPayload } from "./jwt";

export async function assertGroupManager(groupId: string, user: JwtPayload | undefined) {
  if (!user) {
    throw new AppError(401, "Authentication required");
  }

  const group = await GroupModel.findById(groupId);
  if (!group) {
    throw new AppError(404, "Group not found");
  }

  if (user.role !== "admin" && group.ownerId.toString() !== user.userId) {
    throw new AppError(403, "You do not have access to this group");
  }

  if (user.role === "admin" && group.ownerId.toString() !== user.userId) {
    throw new AppError(403, "Only the owner can modify this group");
  }

  return group;
}
