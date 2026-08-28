import bcrypt from "bcryptjs";
import mongoose from "mongoose";

import { connectDatabase } from "../config/db";
import { env } from "../config/env";
import { MANAGER_PERMISSIONS } from "../domain/constants";
import { AuditLogModel } from "../models/AuditLog";
import { GroupModel } from "../models/Group";
import { GroupMemberModel } from "../models/GroupMember";
import { InvitationModel } from "../models/Invitation";
import { MatchModel } from "../models/Match";
import { PlayerProfileModel } from "../models/PlayerProfile";
import { RankingSnapshotModel } from "../models/RankingSnapshot";
import { SeasonModel } from "../models/Season";
import { SeasonParticipantModel } from "../models/SeasonParticipant";
import { SessionModel } from "../models/Session";
import { UserModel } from "../models/User";
import { calculateSeasonRankings } from "../services/ranking.service";
import { generateFairSchedule } from "../services/schedule.service";
import { createSecureToken } from "../utils/secureToken";

const DEMO_PASSWORD = "Diamond123!";

async function seedDatabase() {
  await connectDatabase();
  if (await UserModel.exists({})) {
    throw new Error("Seed refused because the V3 database is not empty. Run db:reset first.");
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const [host, manager] = await UserModel.create([
    {
      name: "Minh Nguyen",
      email: "host@diamond.local",
      passwordHash,
      timezone: "Asia/Ho_Chi_Minh",
    },
    {
      name: "Lan Tran",
      email: "manager@diamond.local",
      passwordHash,
      timezone: "Asia/Ho_Chi_Minh",
    },
  ]);
  const profiles = await PlayerProfileModel.create([
    {
      userId: host._id,
      fullName: host.name,
      nickname: "Minh",
      email: host.email,
      createdByUserId: host._id,
    },
    {
      userId: manager._id,
      fullName: manager.name,
      nickname: "Lan",
      email: manager.email,
      createdByUserId: host._id,
    },
    {
      fullName: "Bao Pham",
      nickname: "Bao",
      email: "bao@example.com",
      createdByUserId: host._id,
    },
    {
      fullName: "Ha Le",
      nickname: "Ha",
      email: "ha@example.com",
      createdByUserId: host._id,
    },
    {
      fullName: "Khoa Vo",
      nickname: "Khoa",
      email: "khoa@example.com",
      createdByUserId: host._id,
    },
    {
      fullName: "My Do",
      nickname: "My",
      email: "my@example.com",
      createdByUserId: host._id,
    },
  ]);
  const group = await GroupModel.create({
    name: "Diamond Badminton Club",
    description: "V3 demonstration group",
    region: "Ho Chi Minh City",
    defaultVenue: "Diamond Sports Hall",
    hostUserId: host._id,
    status: "active",
  });
  const members = await GroupMemberModel.insertMany(
    profiles.map((profile, index) => ({
      groupId: group._id,
      playerProfileId: profile._id,
      userId: index === 0 ? host._id : index === 1 ? manager._id : undefined,
      role: (index === 0 ? "host" : index === 1 ? "manager" : "member") as
        | "host"
        | "manager"
        | "member",
      permissions: index === 1 ? [...MANAGER_PERMISSIONS] : [],
      status: "active" as const,
    })),
  );
  const season = await SeasonModel.create({
    groupId: group._id,
    name: "Autumn 2026",
    mode: "doubles",
    status: "active",
    startsOn: new Date("2026-08-01T00:00:00.000Z"),
    rosterLocked: true,
    activatedAt: new Date("2026-08-01T00:00:00.000Z"),
    activatedByUserId: host._id,
    createdByUserId: host._id,
    version: 2,
  });
  await SeasonParticipantModel.create(
    profiles.map((profile, index) => ({
      groupId: group._id,
      seasonId: season._id,
      groupMemberId: members[index]._id,
      playerProfileId: profile._id,
      displayNameSnapshot: profile.fullName,
      nicknameSnapshot: profile.nickname,
      seedOrder: index + 1,
    })),
  );

  const profileIds = profiles.map((profile) => profile._id.toString());
  const completedSeason = await SeasonModel.create({
    groupId: group._id,
    name: "Summer 2026",
    mode: "doubles",
    status: "completed",
    startsOn: new Date("2026-06-01T00:00:00.000Z"),
    endsOn: new Date("2026-07-31T00:00:00.000Z"),
    rosterLocked: true,
    activatedAt: new Date("2026-06-01T00:00:00.000Z"),
    activatedByUserId: host._id,
    completedAt: new Date("2026-07-31T15:00:00.000Z"),
    completedByUserId: host._id,
    createdByUserId: host._id,
    version: 3,
  });
  await SeasonParticipantModel.create(
    profiles.map((profile, index) => ({
      groupId: group._id,
      seasonId: completedSeason._id,
      groupMemberId: members[index]._id,
      playerProfileId: profile._id,
      displayNameSnapshot: profile.fullName,
      nicknameSnapshot: profile.nickname,
      seedOrder: index + 1,
    })),
  );
  const summerPlan = generateFairSchedule("doubles", profileIds, "demo-summer-final");
  const summerSession = await SessionModel.create({
    groupId: group._id,
    seasonId: completedSeason._id,
    title: "Summer Final Night",
    venue: group.defaultVenue,
    scheduledFor: new Date("2026-07-26T12:00:00.000Z"),
    status: "locked",
    participantProfileIds: profiles.map((profile) => profile._id),
    absentProfileIds: [],
    scheduleType: "auto",
    scheduleSeed: "demo-summer-final",
    resultVersion: 2,
    lockedAt: new Date("2026-07-26T15:00:00.000Z"),
    lockedByUserId: host._id,
    createdByUserId: host._id,
  });
  await MatchModel.insertMany(
    summerPlan.matches.map((match, index) => {
      const teamAWins = index % 3 !== 1;
      return {
        groupId: group._id,
        seasonId: completedSeason._id,
        sessionId: summerSession._id,
        mode: completedSeason.mode,
        ...match,
        scoreA: teamAWins ? 21 : 17 + (index % 3),
        scoreB: teamAWins ? 15 + (index % 4) : 21,
        winnerTeam: (teamAWins ? "A" : "B") as "A" | "B",
        status: "completed" as const,
        resultVersion: 2,
        resultUpdatedAt: new Date("2026-07-26T14:30:00.000Z"),
        resultUpdatedByUserId: manager._id,
      };
    }),
  );
  const completedSeasonRanking = await calculateSeasonRankings(
    completedSeason._id.toString(),
    "official",
  );
  const finalSnapshot = await RankingSnapshotModel.create({
    groupId: group._id,
    seasonId: completedSeason._id,
    type: "season_final",
    rows: completedSeasonRanking.rows.map((row) => ({
      ...row,
      h2hApplied: row.headToHead.applied,
    })),
    sourceVersion: completedSeason.version,
    createdByUserId: host._id,
  });
  completedSeason.finalSnapshotId = finalSnapshot._id;
  await completedSeason.save();

  const completedPlan = generateFairSchedule("doubles", profileIds, "demo-locked-session");
  const lockedSession = await SessionModel.create({
    groupId: group._id,
    seasonId: season._id,
    title: "Opening Night",
    venue: group.defaultVenue,
    scheduledFor: new Date("2026-08-19T12:00:00.000Z"),
    status: "locked",
    participantProfileIds: profiles.map((profile) => profile._id),
    absentProfileIds: [],
    scheduleType: "auto",
    scheduleSeed: "demo-locked-session",
    resultVersion: 3,
    lockedAt: new Date("2026-08-19T15:00:00.000Z"),
    lockedByUserId: host._id,
    createdByUserId: host._id,
  });
  await MatchModel.insertMany(
    completedPlan.matches.map((match, index) => {
      const teamAWins = index % 2 === 0;
      return {
        groupId: group._id,
        seasonId: season._id,
        sessionId: lockedSession._id,
        mode: season.mode,
        ...match,
        scoreA: teamAWins ? 21 : 16 + (index % 3),
        scoreB: teamAWins ? 14 + (index % 4) : 21,
        winnerTeam: (teamAWins ? "A" : "B") as "A" | "B",
        status: "completed" as const,
        resultVersion: 2,
        resultUpdatedAt: new Date("2026-08-19T14:30:00.000Z"),
        resultUpdatedByUserId: manager._id,
      };
    }),
  );
  const ranking = await calculateSeasonRankings(season._id.toString(), "official");
  await RankingSnapshotModel.create({
    groupId: group._id,
    seasonId: season._id,
    sessionId: lockedSession._id,
    type: "session_lock",
    rows: ranking.rows.map((row) => ({ ...row, h2hApplied: row.headToHead.applied })),
    sourceVersion: lockedSession.resultVersion,
    createdByUserId: host._id,
  });

  const upcomingPlan = generateFairSchedule("doubles", profileIds, "demo-upcoming-session");
  const upcomingSession = await SessionModel.create({
    groupId: group._id,
    seasonId: season._id,
    title: "Wednesday Session",
    venue: group.defaultVenue,
    scheduledFor: new Date("2026-09-02T12:00:00.000Z"),
    status: "scheduled",
    participantProfileIds: profiles.map((profile) => profile._id),
    absentProfileIds: [],
    scheduleType: "auto",
    scheduleSeed: "demo-upcoming-session",
    resultVersion: 2,
    createdByUserId: manager._id,
  });
  await MatchModel.insertMany(
    upcomingPlan.matches.map((match) => ({
      groupId: group._id,
      seasonId: season._id,
      sessionId: upcomingSession._id,
      mode: season.mode,
      ...match,
      status: "scheduled" as const,
    })),
  );

  const { token, tokenHash, tokenHint } = createSecureToken();
  const invitation = await InvitationModel.create({
    groupId: group._id,
    groupMemberId: members[2]._id,
    playerProfileId: profiles[2]._id,
    email: profiles[2].email,
    tokenHash,
    tokenHint,
    expiresAt: new Date(Date.now() + env.INVITATION_TTL_HOURS * 60 * 60_000),
    invitedByUserId: host._id,
  });
  await AuditLogModel.create({
    groupId: group._id,
    actorUserId: host._id,
    actorRole: "host",
    action: "seed.completed",
    targetType: "group",
    targetId: group._id,
    metadata: {
      seasonId: season._id,
      completedSeasonId: completedSeason._id,
      invitationId: invitation._id,
    },
  });

  console.log(`Seed complete: ${env.MONGODB_DB_NAME}`);
  console.log(`Host: host@diamond.local / ${DEMO_PASSWORD}`);
  console.log(`Manager: manager@diamond.local / ${DEMO_PASSWORD}`);
  console.log(`Invite: ${env.APP_URL}/invite/${token}`);
}

seedDatabase()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
