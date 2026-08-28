import type { ManagerPermission } from "../domain/constants";
import { GroupModel } from "../models/Group";
import { GroupMemberModel } from "../models/GroupMember";
import { AppError } from "../utils/appError";

export async function requireGroupAccess(groupId: string, userId: string) {
  const [group, member] = await Promise.all([
    GroupModel.findById(groupId),
    GroupMemberModel.findOne({
      groupId,
      userId,
      status: { $in: ["active", "inactive"] },
    }),
  ]);

  if (!group || group.status === "archived") {
    throw new AppError(404, "Group not found", "GROUP_NOT_FOUND");
  }

  if (!member) {
    throw new AppError(403, "You do not have access to this group", "GROUP_ACCESS_DENIED");
  }

  return { group, member };
}

export async function requireActiveGroupMember(groupId: string, userId: string) {
  const access = await requireGroupAccess(groupId, userId);

  if (access.member.status !== "active") {
    throw new AppError(403, "Your group membership is inactive", "GROUP_MEMBER_INACTIVE");
  }

  return access;
}

export async function requireGroupPermission(
  groupId: string,
  userId: string,
  permission: ManagerPermission,
) {
  const access = await requireActiveGroupMember(groupId, userId);

  if (access.member.role === "host") {
    return access;
  }

  if (
    access.member.role !== "manager" ||
    !access.member.permissions.includes(permission)
  ) {
    throw new AppError(
      403,
      `Permission ${permission} is required`,
      "GROUP_PERMISSION_REQUIRED",
      { permission },
    );
  }

  return access;
}

export async function requireGroupHost(groupId: string, userId: string) {
  const access = await requireActiveGroupMember(groupId, userId);

  if (access.member.role !== "host" || access.group.hostUserId.toString() !== userId) {
    throw new AppError(403, "Only the Host can perform this action", "HOST_ONLY");
  }

  return access;
}
