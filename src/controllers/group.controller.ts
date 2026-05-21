import { z } from "zod";

import { GroupModel } from "../models/Group";
import { MatchModel } from "../models/Match";
import { PlayerModel } from "../models/Player";
import { SeasonModel } from "../models/Season";
import { SessionModel } from "../models/Session";
import { asyncHandler } from "../utils/asyncHandler";
import { AppError } from "../utils/appError";
import { assertGroupManager } from "../utils/permissions";

const createGroupSchema = z.object({
  name: z.string().min(2).max(80),
  description: z.string().max(240).optional(),
});

const createPlayerSchema = z.object({
  fullName: z.string().min(2).max(80),
  nickname: z.string().max(40).optional(),
  contactInfo: z.string().max(120).optional(),
});

const updatePlayerStatusSchema = z.object({
  status: z.enum(["active", "inactive"]),
});

async function hasActiveSeason(groupId: string) {
  return Boolean(
    await SeasonModel.exists({
      groupId,
      status: "active",
    }),
  );
}

async function resolveNewPlayerStatus(groupId: string) {
  const [groupHasActiveSeason, activePlayerCount] = await Promise.all([
    hasActiveSeason(groupId),
    PlayerModel.countDocuments({ groupId, status: "active" }),
  ]);

  if (groupHasActiveSeason) {
    return {
      status: "inactive" as const,
      message:
        "Thành viên mới đã được thêm với trạng thái không hoạt động vì bảng đấu đang có mùa giải hoạt động.",
    };
  }

  if (activePlayerCount >= 20) {
    return {
      status: "inactive" as const,
      message:
        "Bảng đấu đã đạt tối đa 20 thành viên hoạt động. Thành viên mới được thêm với trạng thái không hoạt động.",
    };
  }

  return {
    status: "active" as const,
    message: "Thành viên mới đã được thêm với trạng thái hoạt động.",
  };
}

export const listGroups = asyncHandler(async (req, res) => {
  const groups = await GroupModel.find({ ownerId: req.user?.userId }).sort({ createdAt: -1 }).lean();

  const groupsWithCounts = await Promise.all(
    groups.map(async (group) => {
      const groupId = group._id.toString();
      const [playerCount, seasonCount] = await Promise.all([
        PlayerModel.countDocuments({ groupId, status: "active" }),
        SeasonModel.countDocuments({ groupId }),
      ]);

      return {
        ...group,
        playerCount,
        seasonCount,
      };
    }),
  );

  res.json({ groups: groupsWithCounts });
});

export const createGroup = asyncHandler(async (req, res) => {
  const payload = createGroupSchema.parse(req.body);

  if (!req.user) {
    throw new AppError(401, "Authentication required");
  }

  const group = await GroupModel.create({
    ...payload,
    ownerId: req.user.userId,
  });

  res.status(201).json({ group });
});

export const getGroup = asyncHandler(async (req, res) => {
  const groupId = String(req.params.groupId);
  const group = await assertGroupManager(groupId, req.user);
  const [players, seasons] = await Promise.all([
    PlayerModel.find({ groupId: group._id.toString() }).sort({ status: 1, fullName: 1 }).lean(),
    SeasonModel.find({ groupId: group._id.toString() }).sort({ createdAt: -1 }).lean(),
  ]);

  res.json({
    group,
    players,
    seasons,
  });
});

export const createPlayer = asyncHandler(async (req, res) => {
  const payload = createPlayerSchema.parse(req.body);
  const groupId = String(req.params.groupId);
  const group = await assertGroupManager(groupId, req.user);
  const normalizedGroupId = group._id.toString();
  const currentCount = await PlayerModel.countDocuments({ groupId: normalizedGroupId });

  if (currentCount >= 20) {
    throw new AppError(400, "A group can contain at most 20 players");
  }

  const statusResolution = await resolveNewPlayerStatus(normalizedGroupId);
  const player = await PlayerModel.create({
    groupId: normalizedGroupId,
    ...payload,
    status: statusResolution.status,
  });

  res.status(201).json({
    player,
    message: statusResolution.message,
  });
});

export const updatePlayerStatus = asyncHandler(async (req, res) => {
  const payload = updatePlayerStatusSchema.parse(req.body);
  const groupId = String(req.params.groupId);
  const playerId = String(req.params.playerId);
  const group = await assertGroupManager(groupId, req.user);
  const normalizedGroupId = group._id.toString();

  const player = await PlayerModel.findOne({
    _id: playerId,
    groupId: normalizedGroupId,
  });

  if (!player) {
    throw new AppError(404, "Không tìm thấy thành viên trong bảng đấu này.");
  }

  if (await hasActiveSeason(normalizedGroupId)) {
    throw new AppError(
      400,
      "Không thể thay đổi trạng thái thành viên khi bảng đấu đang có mùa giải hoạt động.",
    );
  }

  if (player.status !== payload.status && payload.status === "active") {
    const activePlayerCount = await PlayerModel.countDocuments({
      groupId: normalizedGroupId,
      status: "active",
    });

    if (activePlayerCount >= 20) {
      throw new AppError(400, "Bảng đấu đã đạt tối đa 20 thành viên hoạt động.");
    }
  }

  player.status = payload.status;
  await player.save();

  res.json({
    player,
    message:
      payload.status === "active"
        ? "Thành viên đã được chuyển sang hoạt động."
        : "Thành viên đã được chuyển sang không hoạt động.",
  });
});

export const deleteGroup = asyncHandler(async (req, res) => {
  const groupId = String(req.params.groupId);
  const group = await assertGroupManager(groupId, req.user);
  const normalizedGroupId = group._id.toString();

  await Promise.all([
    MatchModel.deleteMany({ groupId: normalizedGroupId }),
    SessionModel.deleteMany({ groupId: normalizedGroupId }),
    SeasonModel.deleteMany({ groupId: normalizedGroupId }),
    PlayerModel.deleteMany({ groupId: normalizedGroupId }),
  ]);

  await GroupModel.deleteOne({ _id: group._id });

  res.json({
    message: "Group deleted successfully",
  });
});
