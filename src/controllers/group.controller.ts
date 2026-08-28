import mongoose, { isValidObjectId } from "mongoose";
import { z } from "zod";

import {
  GROUP_MAX_ACTIVE_MEMBERS,
  GROUP_MIN_ACTIVE_MEMBERS,
  MANAGER_PERMISSIONS,
} from "../domain/constants";
import { AuditLogModel } from "../models/AuditLog";
import { GroupModel } from "../models/Group";
import { GroupMemberModel } from "../models/GroupMember";
import { PlayerProfileModel } from "../models/PlayerProfile";
import { SeasonModel } from "../models/Season";
import { SessionModel } from "../models/Session";
import { UserModel } from "../models/User";
import {
  requireActiveGroupMember,
  requireGroupAccess,
  requireGroupHost,
  requireGroupPermission,
} from "../services/access.service";
import { writeAuditLog } from "../services/audit.service";
import {
  assertCanReduceActiveMembers,
  assertGroupHasCapacity,
  resolveNewMemberStatus,
  synchronizeGroupStatus,
} from "../services/groupLifecycle.service";
import { asyncHandler } from "../utils/asyncHandler";
import { AppError } from "../utils/appError";
import { routeParam } from "../utils/routeParam";

const createGroupSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional(),
  region: z.string().trim().max(120).optional(),
  defaultVenue: z.string().trim().max(160).optional(),
});

const updateGroupSchema = createGroupSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "At least one group field is required",
);

const createMemberSchema = z.object({
  fullName: z.string().trim().min(2).max(80),
  nickname: z.string().trim().max(40).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z.email().optional(),
});

const updateMemberProfileSchema = z
  .object({
    fullName: z.string().trim().min(2).max(80).optional(),
    nickname: z.string().trim().max(40).nullable().optional(),
    phone: z.string().trim().max(30).nullable().optional(),
    email: z.email().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one profile field is required");

const memberStatusSchema = z.object({
  status: z.enum(["active", "inactive", "removed"]),
});

const memberAccessSchema = z
  .object({
    role: z.enum(["manager", "member"]),
    permissions: z.array(z.enum(MANAGER_PERMISSIONS)).default([]),
  })
  .transform((value) => ({
    role: value.role,
    permissions: value.role === "manager" ? Array.from(new Set(value.permissions)) : [],
  }));

const archiveGroupSchema = z.object({
  reason: z.string().trim().min(3).max(300).optional(),
});

const transferHostSchema = z.object({
  targetMemberId: z.string().min(1),
  previousHostPermissions: z
    .array(z.enum(MANAGER_PERMISSIONS))
    .default([...MANAGER_PERMISSIONS])
    .transform((permissions) => Array.from(new Set(permissions))),
});

async function getMember(groupId: string, memberId: string) {
  if (!isValidObjectId(memberId)) {
    throw new AppError(400, "Invalid member identifier", "INVALID_MEMBER_ID");
  }

  const member = await GroupMemberModel.findOne({
    groupId,
    $or: [{ _id: memberId }, { playerProfileId: memberId }],
  });
  if (!member || member.status === "removed") {
    throw new AppError(404, "Group member not found", "GROUP_MEMBER_NOT_FOUND");
  }
  return member;
}

function memberView(
  member: {
    _id: unknown;
    playerProfileId: unknown;
    userId?: unknown;
    role: string;
    permissions: string[];
    status: string;
    joinedAt: Date;
  },
  profile?: {
    fullName: string;
    nickname?: string | null;
    phone?: string | null;
    email?: string | null;
    avatarUrl?: string | null;
  },
) {
  return {
    id: member._id,
    playerProfileId: member.playerProfileId,
    userId: member.userId ?? null,
    fullName: profile?.fullName ?? "Unknown player",
    nickname: profile?.nickname ?? null,
    phone: profile?.phone ?? null,
    email: profile?.email ?? null,
    avatarUrl: profile?.avatarUrl ?? null,
    linked: Boolean(member.userId),
    role: member.role,
    permissions: member.permissions,
    status: member.status,
    joinedAt: member.joinedAt,
  };
}

export const listGroups = asyncHandler(async (req, res) => {
  const memberships = await GroupMemberModel.find({
    userId: req.user!.userId,
    status: { $in: ["active", "inactive"] },
  })
    .sort({ updatedAt: -1 })
    .lean();
  const groups = await GroupModel.find({
    _id: { $in: memberships.map((membership) => membership.groupId) },
    status: { $ne: "archived" },
  })
    .sort({ updatedAt: -1 })
    .lean();
  const membershipByGroup = new Map(
    memberships.map((membership) => [membership.groupId.toString(), membership]),
  );

  const items = await Promise.all(
    groups.map(async (group) => {
      const [activeMemberCount, activeSeason, nextSession] = await Promise.all([
        GroupMemberModel.countDocuments({ groupId: group._id, status: "active" }),
        SeasonModel.findOne({ groupId: group._id, status: "active" })
          .select("_id name mode status")
          .lean(),
        SessionModel.findOne({
          groupId: group._id,
          status: { $in: ["draft", "scheduled", "in_progress"] },
          scheduledFor: { $gte: new Date() },
        })
          .sort({ scheduledFor: 1 })
          .select("_id title scheduledFor status")
          .lean(),
      ]);
      const membership = membershipByGroup.get(group._id.toString())!;

      return {
        ...group,
        activeMemberCount,
        minimumActiveMembers: GROUP_MIN_ACTIVE_MEMBERS,
        maximumActiveMembers: GROUP_MAX_ACTIVE_MEMBERS,
        currentMembership: {
          id: membership._id,
          role: membership.role,
          permissions: membership.permissions,
          status: membership.status,
        },
        activeSeason,
        nextSession,
      };
    }),
  );

  res.json({ groups: items });
});

export const createGroup = asyncHandler(async (req, res) => {
  const payload = createGroupSchema.parse(req.body);
  const user = await UserModel.findById(req.user!.userId).lean();
  if (!user) {
    throw new AppError(404, "User not found", "USER_NOT_FOUND");
  }

  let profile = await PlayerProfileModel.findOne({ userId: user._id, status: "active" });
  if (!profile) {
    profile = await PlayerProfileModel.create({
      userId: user._id,
      fullName: user.name,
      email: user.email,
      createdByUserId: user._id,
    });
  }

  const group = await GroupModel.create({
    ...payload,
    hostUserId: user._id,
    status: "draft",
  });

  try {
    const member = await GroupMemberModel.create({
      groupId: group._id,
      playerProfileId: profile._id,
      userId: user._id,
      role: "host",
      permissions: [],
      status: "active",
    });
    await writeAuditLog({
      groupId: group._id,
      actorUserId: user._id,
      actorRole: "host",
      action: "group.created",
      targetType: "group",
      targetId: group._id,
      metadata: { name: group.name },
    });

    res.status(201).json({
      group,
      activeMemberCount: 1,
      minimumActiveMembers: GROUP_MIN_ACTIVE_MEMBERS,
      currentMembership: {
        id: member._id,
        role: member.role,
        permissions: member.permissions,
        status: member.status,
      },
    });
  } catch (error) {
    await GroupModel.deleteOne({ _id: group._id });
    throw error;
  }
});

export const getGroup = asyncHandler(async (req, res) => {
  const { group, member: currentMember } = await requireGroupAccess(
    routeParam(req, "groupId"),
    req.user!.userId,
  );
  const [members, seasons] = await Promise.all([
    GroupMemberModel.find({ groupId: group._id, status: { $ne: "removed" } })
      .sort({ role: 1, joinedAt: 1 })
      .lean(),
    SeasonModel.find({ groupId: group._id })
      .sort({ createdAt: -1 })
      .select("name mode status startsOn endsOn rosterLocked completedAt")
      .lean(),
  ]);
  const profiles = await PlayerProfileModel.find({
    _id: { $in: members.map((item) => item.playerProfileId) },
  }).lean();
  const profilesById = new Map(profiles.map((profile) => [profile._id.toString(), profile]));
  const activeMemberCount = members.filter((item) => item.status === "active").length;

  res.json({
    group,
    activeMemberCount,
    minimumActiveMembers: GROUP_MIN_ACTIVE_MEMBERS,
    maximumActiveMembers: GROUP_MAX_ACTIVE_MEMBERS,
    canCreateSeason: group.status === "active" && activeMemberCount >= GROUP_MIN_ACTIVE_MEMBERS,
    currentMembership: {
      id: currentMember._id,
      role: currentMember.role,
      permissions: currentMember.permissions,
      status: currentMember.status,
    },
    members: members.map((item) =>
      memberView(item, profilesById.get(item.playerProfileId.toString())),
    ),
    seasons,
  });
});

export const updateGroup = asyncHandler(async (req, res) => {
  const payload = updateGroupSchema.parse(req.body);
  const { group, member } = await requireGroupHost(
    routeParam(req, "groupId"),
    req.user!.userId,
  );
  const before = {
    name: group.name,
    description: group.description,
    region: group.region,
    defaultVenue: group.defaultVenue,
  };

  group.set(payload);
  await group.save();
  await writeAuditLog({
    groupId: group._id,
    actorUserId: req.user!.userId,
    actorRole: member.role,
    action: "group.updated",
    targetType: "group",
    targetId: group._id,
    metadata: { before, after: payload },
  });

  res.json({ group });
});

export const createMember = asyncHandler(async (req, res) => {
  const payload = createMemberSchema.parse(req.body);
  const { group, member: actor } = await requireGroupPermission(
    routeParam(req, "groupId"),
    req.user!.userId,
    "manage_members",
  );
  const initialStatus = await resolveNewMemberStatus(group._id.toString());

  const profile = await PlayerProfileModel.create({
    fullName: payload.fullName,
    nickname: payload.nickname,
    phone: payload.phone,
    email: payload.email?.toLowerCase(),
    createdByUserId: req.user!.userId,
  });

  try {
    const member = await GroupMemberModel.create({
      groupId: group._id,
      playerProfileId: profile._id,
      role: "member",
      permissions: [],
      status: initialStatus,
    });
    const { group: synchronizedGroup, activeMemberCount } = await synchronizeGroupStatus(
      group._id.toString(),
    );
    await writeAuditLog({
      groupId: group._id,
      actorUserId: req.user!.userId,
      actorRole: actor.role,
      action: "member.created",
      targetType: "group_member",
      targetId: member._id,
      metadata: {
        playerProfileId: profile._id,
        fullName: profile.fullName,
        initialStatus,
      },
    });

    res.status(201).json({
      member: memberView(member, profile),
      groupStatus: synchronizedGroup?.status,
      activeMemberCount,
    });
  } catch (error) {
    await PlayerProfileModel.deleteOne({ _id: profile._id, userId: { $exists: false } });
    throw error;
  }
});

export const updateMemberStatus = asyncHandler(async (req, res) => {
  const payload = memberStatusSchema.parse(req.body);
  const { group, member: actor } = await requireGroupPermission(
    routeParam(req, "groupId"),
    req.user!.userId,
    "manage_members",
  );
  const member = await getMember(
    group._id.toString(),
    req.params.memberId ? routeParam(req, "memberId") : routeParam(req, "playerId"),
  );

  if (member.role === "host") {
    throw new AppError(409, "The Host membership cannot be deactivated", "HOST_MEMBERSHIP_REQUIRED");
  }
  if (member.status === payload.status) {
    const status = await synchronizeGroupStatus(group._id.toString());
    res.json({ member, groupStatus: status.group?.status, activeMemberCount: status.activeMemberCount });
    return;
  }
  if (payload.status === "active") {
    await assertGroupHasCapacity(group._id.toString());
  } else if (member.status === "active") {
    await assertCanReduceActiveMembers(group._id.toString());
  }

  const previousStatus = member.status;
  member.status = payload.status;
  member.inactivatedAt = payload.status === "inactive" ? new Date() : undefined;
  member.removedAt = payload.status === "removed" ? new Date() : undefined;
  await member.save();
  const status = await synchronizeGroupStatus(group._id.toString());
  await writeAuditLog({
    groupId: group._id,
    actorUserId: req.user!.userId,
    actorRole: actor.role,
    action: "member.status_changed",
    targetType: "group_member",
    targetId: member._id,
    metadata: { previousStatus, status: member.status },
  });

  res.json({
    member,
    groupStatus: status.group?.status,
    activeMemberCount: status.activeMemberCount,
  });
});

export const updateMemberProfile = asyncHandler(async (req, res) => {
  const payload = updateMemberProfileSchema.parse(req.body);
  const { group, member: actor } = await requireGroupPermission(
    routeParam(req, "groupId"),
    req.user!.userId,
    "manage_members",
  );
  const member = await getMember(group._id.toString(), routeParam(req, "memberId"));
  const profile = await PlayerProfileModel.findById(member.playerProfileId);

  if (!profile || profile.status !== "active") {
    throw new AppError(404, "Player profile not found", "PLAYER_PROFILE_NOT_FOUND");
  }
  if (profile.userId || member.userId) {
    throw new AppError(
      409,
      "Linked player profiles are managed by their account owner",
      "LINKED_PROFILE_SELF_MANAGED",
    );
  }

  const before = {
    fullName: profile.fullName,
    nickname: profile.nickname ?? null,
    phone: profile.phone ?? null,
    email: profile.email ?? null,
  };
  if (payload.fullName !== undefined) profile.fullName = payload.fullName;
  if (payload.nickname !== undefined) profile.nickname = payload.nickname ?? undefined;
  if (payload.phone !== undefined) profile.phone = payload.phone ?? undefined;
  if (payload.email !== undefined) profile.email = payload.email?.toLowerCase() ?? undefined;
  await profile.save();
  await writeAuditLog({
    groupId: group._id,
    actorUserId: req.user!.userId,
    actorRole: actor.role,
    action: "member.profile_updated",
    targetType: "player_profile",
    targetId: profile._id,
    metadata: { before, after: payload, groupMemberId: member._id },
  });

  res.json({ member: memberView(member, profile) });
});

export const updateMemberAccess = asyncHandler(async (req, res) => {
  const payload = memberAccessSchema.parse(req.body);
  const { group, member: actor } = await requireGroupHost(
    routeParam(req, "groupId"),
    req.user!.userId,
  );
  const member = await getMember(group._id.toString(), routeParam(req, "memberId"));

  if (member.role === "host") {
    throw new AppError(409, "Host access cannot be changed", "HOST_ACCESS_IMMUTABLE");
  }
  if (!member.userId && payload.role === "manager") {
    throw new AppError(
      409,
      "A member must accept their invitation before becoming a Manager",
      "MANAGER_ACCOUNT_REQUIRED",
    );
  }

  const before = { role: member.role, permissions: [...member.permissions] };
  member.role = payload.role;
  member.permissions = payload.permissions;
  await member.save();
  await writeAuditLog({
    groupId: group._id,
    actorUserId: req.user!.userId,
    actorRole: actor.role,
    action: "member.access_changed",
    targetType: "group_member",
    targetId: member._id,
    metadata: { before, after: payload },
  });

  res.json({ member });
});

export const activateGroup = asyncHandler(async (req, res) => {
  const { group, member } = await requireGroupHost(
    routeParam(req, "groupId"),
    req.user!.userId,
  );
  const status = await synchronizeGroupStatus(group._id.toString());
  if (status.activeMemberCount < GROUP_MIN_ACTIVE_MEMBERS) {
    throw new AppError(
      409,
      "At least 5 active members are required to activate a group",
      "GROUP_MINIMUM_MEMBERS_REQUIRED",
      { activeMemberCount: status.activeMemberCount, minimum: GROUP_MIN_ACTIVE_MEMBERS },
    );
  }

  await writeAuditLog({
    groupId: group._id,
    actorUserId: req.user!.userId,
    actorRole: member.role,
    action: "group.activated",
    targetType: "group",
    targetId: group._id,
  });
  res.json({ group: status.group, activeMemberCount: status.activeMemberCount });
});

export const archiveGroup = asyncHandler(async (req, res) => {
  const payload = archiveGroupSchema.parse(req.body ?? {});
  const { group, member } = await requireGroupHost(
    routeParam(req, "groupId"),
    req.user!.userId,
  );
  const activeSeason = await SeasonModel.findOne({ groupId: group._id, status: "active" })
    .select("_id name")
    .lean();
  if (activeSeason) {
    throw new AppError(
      409,
      "Complete the active season before archiving this group",
      "ACTIVE_SEASON_EXISTS",
      { activeSeasonId: activeSeason._id, activeSeasonName: activeSeason.name },
    );
  }

  group.status = "archived";
  group.archivedAt = new Date();
  group.archivedByUserId = group.hostUserId;
  await group.save();
  await writeAuditLog({
    groupId: group._id,
    actorUserId: req.user!.userId,
    actorRole: member.role,
    action: "group.archived",
    targetType: "group",
    targetId: group._id,
    reason: payload.reason,
  });

  res.status(204).send();
});

export const transferGroupHost = asyncHandler(async (req, res) => {
  const payload = transferHostSchema.parse(req.body);
  const { group, member: currentHost } = await requireGroupHost(
    routeParam(req, "groupId"),
    req.user!.userId,
  );
  const targetMember = await getMember(group._id.toString(), payload.targetMemberId);

  if (targetMember._id.toString() === currentHost._id.toString()) {
    throw new AppError(400, "Choose another member as the new Host", "HOST_TRANSFER_SELF");
  }
  if (targetMember.status !== "active") {
    throw new AppError(
      409,
      "The new Host must be an active group member",
      "HOST_TRANSFER_TARGET_INACTIVE",
    );
  }
  if (!targetMember.userId) {
    throw new AppError(
      409,
      "The new Host must have a linked user account",
      "HOST_TRANSFER_TARGET_UNLINKED",
    );
  }

  const databaseSession = await mongoose.startSession();
  try {
    await databaseSession.withTransaction(async () => {
      const transactionGroup = await GroupModel.findOne({
        _id: group._id,
        hostUserId: req.user!.userId,
        status: { $ne: "archived" },
      }).session(databaseSession);
      const transactionHost = await GroupMemberModel.findOne({
        _id: currentHost._id,
        groupId: group._id,
        userId: req.user!.userId,
        role: "host",
        status: "active",
      }).session(databaseSession);
      const transactionTarget = await GroupMemberModel.findOne({
        _id: targetMember._id,
        groupId: group._id,
        status: "active",
        userId: { $exists: true },
      }).session(databaseSession);

      if (!transactionGroup || !transactionHost || !transactionTarget?.userId) {
        throw new AppError(
          409,
          "Group access changed while transferring Host",
          "HOST_TRANSFER_STATE_CHANGED",
        );
      }

      transactionTarget.role = "host";
      transactionTarget.permissions = [];
      transactionHost.role = "manager";
      transactionHost.permissions = payload.previousHostPermissions;
      transactionGroup.hostUserId = transactionTarget.userId;

      await transactionTarget.save({ session: databaseSession });
      await transactionHost.save({ session: databaseSession });
      await transactionGroup.save({ session: databaseSession });
      await writeAuditLog(
        {
          groupId: transactionGroup._id,
          actorUserId: req.user!.userId,
          actorRole: "host",
          action: "group.host_transferred",
          targetType: "group_member",
          targetId: transactionTarget._id,
          metadata: {
            previousHostMemberId: transactionHost._id,
            newHostMemberId: transactionTarget._id,
            previousHostPermissions: payload.previousHostPermissions,
          },
        },
        databaseSession,
      );
    });
  } finally {
    await databaseSession.endSession();
  }

  const [updatedGroup, updatedPreviousHost, updatedNewHost] = await Promise.all([
    GroupModel.findById(group._id),
    GroupMemberModel.findById(currentHost._id),
    GroupMemberModel.findById(targetMember._id),
  ]);
  if (!updatedGroup || !updatedPreviousHost || !updatedNewHost) {
    throw new AppError(500, "Host transfer completed but could not be reloaded", "HOST_TRANSFER_RELOAD_FAILED");
  }

  res.json({
    group: updatedGroup,
    previousHost: memberView(updatedPreviousHost),
    newHost: memberView(updatedNewHost),
  });
});

export const getGroupActivity = asyncHandler(async (req, res) => {
  const groupId = routeParam(req, "groupId");
  await requireActiveGroupMember(groupId, req.user!.userId);
  const limit = z.coerce.number().int().min(1).max(100).default(40).parse(req.query.limit);
  const logs = await AuditLogModel.find({ groupId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  const users = await UserModel.find({
    _id: { $in: logs.map((log) => log.actorUserId) },
  })
    .select("name email")
    .lean();
  const usersById = new Map(users.map((user) => [user._id.toString(), user]));

  res.json({
    activity: logs.map((log) => ({
      ...log,
      actor: usersById.get(log.actorUserId.toString()) ?? null,
    })),
  });
});
