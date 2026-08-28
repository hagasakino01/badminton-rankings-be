import { GROUP_MAX_ACTIVE_MEMBERS, GROUP_MIN_ACTIVE_MEMBERS } from "../domain/constants";
import { GroupModel } from "../models/Group";
import { GroupMemberModel } from "../models/GroupMember";
import { SeasonModel } from "../models/Season";
import { AppError } from "../utils/appError";

export async function countActiveGroupMembers(groupId: string) {
  return GroupMemberModel.countDocuments({ groupId, status: "active" });
}

export async function assertGroupHasCapacity(groupId: string) {
  const activeMemberCount = await countActiveGroupMembers(groupId);
  if (activeMemberCount >= GROUP_MAX_ACTIVE_MEMBERS) {
    throw new AppError(
      409,
      `A group can have at most ${GROUP_MAX_ACTIVE_MEMBERS} active members`,
      "GROUP_MEMBER_LIMIT_REACHED",
      { activeMemberCount, maximum: GROUP_MAX_ACTIVE_MEMBERS },
    );
  }
  return activeMemberCount;
}

export function determineNewMemberStatus(
  activeMemberCount: number,
  hasActiveSeason: boolean,
): "active" | "inactive" {
  if (hasActiveSeason || activeMemberCount >= GROUP_MAX_ACTIVE_MEMBERS) {
    return "inactive";
  }

  return "active";
}

export async function resolveNewMemberStatus(groupId: string) {
  const [activeMemberCount, activeSeason] = await Promise.all([
    countActiveGroupMembers(groupId),
    SeasonModel.exists({ groupId, status: "active" }),
  ]);

  return determineNewMemberStatus(activeMemberCount, Boolean(activeSeason));
}

export async function assertCanReduceActiveMembers(groupId: string, reduction = 1) {
  const activeMemberCount = await countActiveGroupMembers(groupId);
  const resultingCount = activeMemberCount - reduction;

  if (resultingCount < GROUP_MIN_ACTIVE_MEMBERS) {
    const activeSeason = await SeasonModel.findOne({ groupId, status: "active" })
      .select("_id name")
      .lean();
    if (activeSeason) {
      throw new AppError(
        409,
        "An active season cannot be maintained with fewer than 5 active group members",
        "ACTIVE_SEASON_MINIMUM_MEMBERS",
        {
          activeMemberCount,
          resultingCount,
          activeSeasonId: activeSeason._id,
          activeSeasonName: activeSeason.name,
        },
      );
    }
  }

  return { activeMemberCount, resultingCount };
}

export async function synchronizeGroupStatus(groupId: string) {
  const [group, activeMemberCount] = await Promise.all([
    GroupModel.findById(groupId),
    countActiveGroupMembers(groupId),
  ]);

  if (!group || group.status === "archived") {
    return { group, activeMemberCount };
  }

  const nextStatus = activeMemberCount >= GROUP_MIN_ACTIVE_MEMBERS ? "active" : "draft";
  if (group.status !== nextStatus) {
    group.status = nextStatus;
    await group.save();
  }

  return { group, activeMemberCount };
}
