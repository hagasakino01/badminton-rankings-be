import { z } from "zod";
import mongoose, { type ClientSession, type Types } from "mongoose";

import { env } from "../config/env";
import { GroupModel } from "../models/Group";
import { GroupMemberModel } from "../models/GroupMember";
import { InvitationModel } from "../models/Invitation";
import { MatchModel } from "../models/Match";
import { PlayerProfileModel } from "../models/PlayerProfile";
import { RankingSnapshotModel } from "../models/RankingSnapshot";
import { SeasonParticipantModel } from "../models/SeasonParticipant";
import { SessionModel } from "../models/Session";
import { requireGroupPermission } from "../services/access.service";
import { writeAuditLog } from "../services/audit.service";
import { asyncHandler } from "../utils/asyncHandler";
import { AppError } from "../utils/appError";
import { createSecureToken, hashToken } from "../utils/secureToken";
import { routeParam } from "../utils/routeParam";

const createInvitationSchema = z.object({
  email: z.email().optional(),
});

async function replaceProfileReferences(
  groupId: string,
  fromProfileId: Types.ObjectId,
  toProfileId: Types.ObjectId,
  session: ClientSession,
) {
  await SeasonParticipantModel.updateMany(
    { groupId, playerProfileId: fromProfileId },
    { playerProfileId: toProfileId },
    { session },
  );
  await SessionModel.updateMany(
    { groupId, participantProfileIds: fromProfileId },
    { $set: { "participantProfileIds.$": toProfileId } },
    { session },
  );
  await SessionModel.updateMany(
    { groupId, absentProfileIds: fromProfileId },
    { $set: { "absentProfileIds.$": toProfileId } },
    { session },
  );
  await MatchModel.updateMany(
    { groupId, teamAProfileIds: fromProfileId },
    { $set: { "teamAProfileIds.$": toProfileId } },
    { session },
  );
  await MatchModel.updateMany(
    { groupId, teamBProfileIds: fromProfileId },
    { $set: { "teamBProfileIds.$": toProfileId } },
    { session },
  );
  await RankingSnapshotModel.updateMany(
    { groupId, "rows.playerProfileId": fromProfileId },
    { $set: { "rows.$.playerProfileId": toProfileId } },
    { session },
  );
}

export const createInvitation = asyncHandler(async (req, res) => {
  const payload = createInvitationSchema.parse(req.body ?? {});
  const { group, member: actor } = await requireGroupPermission(
    routeParam(req, "groupId"),
    req.user!.userId,
    "manage_members",
  );
  const member = await GroupMemberModel.findOne({
    _id: routeParam(req, "memberId"),
    groupId: group._id,
    status: { $ne: "removed" },
  });
  if (!member) {
    throw new AppError(404, "Group member not found", "GROUP_MEMBER_NOT_FOUND");
  }
  if (member.userId) {
    throw new AppError(409, "This player profile is already linked", "PROFILE_ALREADY_LINKED");
  }

  const profile = await PlayerProfileModel.findById(member.playerProfileId);
  if (!profile || profile.status !== "active") {
    throw new AppError(404, "Player profile not found", "PLAYER_PROFILE_NOT_FOUND");
  }

  const email = payload.email?.toLowerCase() ?? profile.email;
  if (!email) {
    throw new AppError(400, "An email is required to create an invitation", "INVITATION_EMAIL_REQUIRED");
  }

  await InvitationModel.updateMany(
    { groupMemberId: member._id, status: "pending" },
    {
      status: "revoked",
      revokedAt: new Date(),
      revokedByUserId: req.user!.userId,
    },
  );
  const { token, tokenHash, tokenHint } = createSecureToken();
  const invitation = await InvitationModel.create({
    groupId: group._id,
    groupMemberId: member._id,
    playerProfileId: profile._id,
    email,
    tokenHash,
    tokenHint,
    expiresAt: new Date(Date.now() + env.INVITATION_TTL_HOURS * 60 * 60_000),
    invitedByUserId: req.user!.userId,
  });
  await writeAuditLog({
    groupId: group._id,
    actorUserId: req.user!.userId,
    actorRole: actor.role,
    action: "invitation.created",
    targetType: "invitation",
    targetId: invitation._id,
    metadata: { groupMemberId: member._id, email, expiresAt: invitation.expiresAt },
  });

  res.status(201).json({
    invitation: {
      id: invitation._id,
      email: invitation.email,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      tokenHint: invitation.tokenHint,
    },
    inviteUrl: `${env.APP_URL}/invite/${encodeURIComponent(token)}`,
    token,
  });
});

export const listInvitations = asyncHandler(async (req, res) => {
  const groupId = routeParam(req, "groupId");
  await requireGroupPermission(groupId, req.user!.userId, "manage_members");
  const invitations = await InvitationModel.find({ groupId })
    .sort({ createdAt: -1 })
    .limit(100)
    .select("groupMemberId playerProfileId email tokenHint status expiresAt acceptedAt revokedAt createdAt")
    .lean();

  res.json({ invitations });
});

export const revokeInvitation = asyncHandler(async (req, res) => {
  const invitation = await InvitationModel.findById(routeParam(req, "invitationId"));
  if (!invitation) {
    throw new AppError(404, "Invitation not found", "INVITATION_NOT_FOUND");
  }
  const { member: actor } = await requireGroupPermission(
    invitation.groupId.toString(),
    req.user!.userId,
    "manage_members",
  );
  if (invitation.status !== "pending") {
    throw new AppError(409, "Only pending invitations can be revoked", "INVITATION_NOT_PENDING");
  }

  invitation.status = "revoked";
  invitation.revokedAt = new Date();
  invitation.revokedByUserId = actor.userId;
  await invitation.save();
  await writeAuditLog({
    groupId: invitation.groupId,
    actorUserId: req.user!.userId,
    actorRole: actor.role,
    action: "invitation.revoked",
    targetType: "invitation",
    targetId: invitation._id,
  });

  res.status(204).send();
});

export const getInvitation = asyncHandler(async (req, res) => {
  const invitation = await InvitationModel.findOne({
    tokenHash: hashToken(routeParam(req, "token")),
    status: "pending",
    expiresAt: { $gt: new Date() },
  }).lean();
  if (!invitation) {
    throw new AppError(404, "Invitation is invalid or expired", "INVITATION_INVALID");
  }

  const [group, profile] = await Promise.all([
    GroupModel.findById(invitation.groupId).select("name description region status").lean(),
    PlayerProfileModel.findById(invitation.playerProfileId)
      .select("fullName nickname email avatarUrl status")
      .lean(),
  ]);
  if (!group || group.status === "archived" || !profile || profile.status !== "active") {
    throw new AppError(404, "Invitation is invalid or expired", "INVITATION_INVALID");
  }

  res.json({
    invitation: {
      id: invitation._id,
      email: invitation.email,
      expiresAt: invitation.expiresAt,
      group,
      playerProfile: profile,
    },
  });
});

export const acceptInvitation = asyncHandler(async (req, res) => {
  const tokenHash = hashToken(routeParam(req, "token"));
  const claimedAt = new Date();
  const databaseSession = await mongoose.startSession();
  let acceptance:
    | { groupId: string; groupMemberId: string; playerProfileId: string }
    | undefined;

  try {
    await databaseSession.withTransaction(async () => {
      const invitation = await InvitationModel.findOneAndUpdate(
        {
          tokenHash,
          status: "pending",
          expiresAt: { $gt: claimedAt },
        },
        {
          status: "accepted",
          acceptedAt: claimedAt,
          acceptedByUserId: req.user!.userId,
        },
        { returnDocument: "after", session: databaseSession },
      );
      if (!invitation) {
        throw new AppError(404, "Invitation is invalid or expired", "INVITATION_INVALID");
      }

      const group = await GroupModel.findById(invitation.groupId).session(databaseSession);
      const member = await GroupMemberModel.findById(invitation.groupMemberId).session(
        databaseSession,
      );
      const targetProfile = await PlayerProfileModel.findById(
        invitation.playerProfileId,
      ).session(databaseSession);
      const existingGroupMembership = await GroupMemberModel.findOne({
        groupId: invitation.groupId,
        userId: req.user!.userId,
        _id: { $ne: invitation.groupMemberId },
      })
        .session(databaseSession)
        .lean();

      if (!group || group.status === "archived" || !member || !targetProfile) {
        throw new AppError(404, "Invitation is no longer available", "INVITATION_TARGET_MISSING");
      }
      if (member.status === "removed") {
        throw new AppError(409, "The invited membership was removed", "INVITATION_TARGET_REMOVED");
      }
      if (existingGroupMembership) {
        throw new AppError(
          409,
          "Your account is already linked to another member in this group",
          "GROUP_MEMBERSHIP_ALREADY_LINKED",
        );
      }
      if (targetProfile.userId && targetProfile.userId.toString() !== req.user!.userId) {
        throw new AppError(
          409,
          "This player profile has already been claimed by another account",
          "PROFILE_ALREADY_LINKED",
        );
      }

      const canonicalProfile = await PlayerProfileModel.findOne({
        userId: req.user!.userId,
        status: "active",
      }).session(databaseSession);
      if (canonicalProfile && canonicalProfile._id.toString() !== targetProfile._id.toString()) {
        await replaceProfileReferences(
          group._id.toString(),
          targetProfile._id,
          canonicalProfile._id,
          databaseSession,
        );
        member.playerProfileId = canonicalProfile._id;
        targetProfile.status = "merged";
        targetProfile.mergedIntoProfileId = canonicalProfile._id;
        await targetProfile.save({ session: databaseSession });
      } else {
        targetProfile.userId = req.user!.userId as never;
        await targetProfile.save({ session: databaseSession });
      }

      member.userId = req.user!.userId as never;
      await member.save({ session: databaseSession });
      await writeAuditLog(
        {
          groupId: group._id,
          actorUserId: req.user!.userId,
          actorRole: member.role,
          action: "invitation.accepted",
          targetType: "invitation",
          targetId: invitation._id,
          metadata: {
            groupMemberId: member._id,
            playerProfileId: member.playerProfileId,
            mergedProfile: Boolean(
              canonicalProfile && canonicalProfile._id.toString() !== targetProfile._id.toString(),
            ),
          },
        },
        databaseSession,
      );

      acceptance = {
        groupId: group._id.toString(),
        groupMemberId: member._id.toString(),
        playerProfileId: member.playerProfileId.toString(),
      };
    });
  } finally {
    await databaseSession.endSession();
  }

  if (!acceptance) {
    throw new AppError(500, "Invitation acceptance could not be completed", "INVITATION_ACCEPT_FAILED");
  }

  res.json({
    message: "Player profile linked successfully",
    ...acceptance,
  });
});
