export const GROUP_STATUSES = ["draft", "active", "archived"] as const;
export type GroupStatus = (typeof GROUP_STATUSES)[number];

export const GROUP_MEMBER_ROLES = ["host", "manager", "member"] as const;
export type GroupMemberRole = (typeof GROUP_MEMBER_ROLES)[number];

export const GROUP_MEMBER_STATUSES = ["active", "inactive", "removed"] as const;
export type GroupMemberStatus = (typeof GROUP_MEMBER_STATUSES)[number];

export const MANAGER_PERMISSIONS = [
  "manage_members",
  "manage_seasons",
  "manage_matches",
  "enter_results",
  "lock_sessions",
  "view_statistics",
] as const;
export type ManagerPermission = (typeof MANAGER_PERMISSIONS)[number];

export const SEASON_STATUSES = ["upcoming", "active", "completed"] as const;
export type SeasonStatus = (typeof SEASON_STATUSES)[number];

export const COMPETITION_MODES = ["singles", "doubles"] as const;
export type CompetitionMode = (typeof COMPETITION_MODES)[number];

export const SESSION_STATUSES = [
  "draft",
  "scheduled",
  "in_progress",
  "completed",
  "locked",
] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const SCHEDULE_TYPES = ["auto", "manual"] as const;
export type ScheduleType = (typeof SCHEDULE_TYPES)[number];

export const MATCH_STATUSES = ["scheduled", "completed", "cancelled"] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

export const INVITATION_STATUSES = ["pending", "accepted", "revoked"] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export const GROUP_MIN_ACTIVE_MEMBERS = 5;
export const GROUP_MAX_ACTIVE_MEMBERS = 20;
export const DEFAULT_MATCHES_PER_PLAYER = 4;
export const DEFAULT_COURT_NUMBER = 1;
