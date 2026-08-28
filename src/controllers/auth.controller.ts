import bcrypt from "bcryptjs";
import { z } from "zod";

import { env } from "../config/env";
import { GroupMemberModel } from "../models/GroupMember";
import { PasswordResetTokenModel } from "../models/PasswordResetToken";
import { PlayerProfileModel } from "../models/PlayerProfile";
import { UserModel } from "../models/User";
import { clearAuthCookie, setAuthCookie } from "../utils/authCookie";
import { asyncHandler } from "../utils/asyncHandler";
import { AppError } from "../utils/appError";
import { signToken } from "../utils/jwt";
import { createSecureToken, hashToken } from "../utils/secureToken";

const passwordSchema = z
  .string()
  .min(8, "Password must contain at least 8 characters")
  .max(128);

const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.email(),
  password: passwordSchema,
  timezone: z.string().trim().min(1).max(80).optional(),
});

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1).max(128),
});

const updateProfileSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    email: z.email().optional(),
    timezone: z.string().trim().min(1).max(80).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one profile field is required");

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: passwordSchema,
    confirmNewPassword: passwordSchema,
  })
  .refine((value) => value.newPassword === value.confirmNewPassword, {
    message: "New password confirmation does not match",
    path: ["confirmNewPassword"],
  });

const forgotPasswordSchema = z.object({ email: z.email() });

const resetPasswordSchema = z
  .object({
    token: z.string().min(20).max(200),
    newPassword: passwordSchema,
    confirmNewPassword: passwordSchema,
  })
  .refine((value) => value.newPassword === value.confirmNewPassword, {
    message: "New password confirmation does not match",
    path: ["confirmNewPassword"],
  });

function serializeUser(user: {
  _id: unknown;
  name: string;
  email: string;
  status: string;
  timezone: string;
  lastLoginAt?: Date | null;
}) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    status: user.status,
    timezone: user.timezone,
    lastLoginAt: user.lastLoginAt ?? null,
  };
}

function issueSession(
  req: Parameters<typeof setAuthCookie>[0],
  res: Parameters<typeof setAuthCookie>[1],
  user: { _id: unknown; email: string },
) {
  const token = signToken({ userId: String(user._id), email: user.email });
  setAuthCookie(req, res, token);
}

export const register = asyncHandler(async (req, res) => {
  const payload = registerSchema.parse(req.body);
  const email = payload.email.toLowerCase();
  const existingUser = await UserModel.findOne({ email }).lean();

  if (existingUser) {
    throw new AppError(409, "Email is already registered", "EMAIL_ALREADY_REGISTERED");
  }

  const user = await UserModel.create({
    name: payload.name,
    email,
    passwordHash: await bcrypt.hash(payload.password, 12),
    timezone: payload.timezone,
  });

  issueSession(req, res, user);
  res.status(201).json({ user: serializeUser(user) });
});

export const login = asyncHandler(async (req, res) => {
  const payload = loginSchema.parse(req.body);
  const user = await UserModel.findOne({ email: payload.email.toLowerCase() });

  if (!user || !(await bcrypt.compare(payload.password, user.passwordHash))) {
    throw new AppError(401, "Invalid email or password", "INVALID_CREDENTIALS");
  }
  if (user.status !== "active") {
    throw new AppError(403, "This account is disabled", "ACCOUNT_DISABLED");
  }

  user.lastLoginAt = new Date();
  await user.save();
  issueSession(req, res, user);
  res.json({ user: serializeUser(user) });
});

export const me = asyncHandler(async (req, res) => {
  const [user, playerProfile, groupCount] = await Promise.all([
    UserModel.findById(req.user!.userId).select("-passwordHash").lean(),
    PlayerProfileModel.findOne({ userId: req.user!.userId, status: "active" }).lean(),
    GroupMemberModel.countDocuments({
      userId: req.user!.userId,
      status: { $in: ["active", "inactive"] },
    }),
  ]);

  if (!user || user.status !== "active") {
    throw new AppError(404, "User not found", "USER_NOT_FOUND");
  }

  res.json({
    user: serializeUser(user),
    playerProfile: playerProfile
      ? {
          id: playerProfile._id,
          fullName: playerProfile.fullName,
          nickname: playerProfile.nickname ?? null,
          phone: playerProfile.phone ?? null,
          email: playerProfile.email ?? null,
          avatarUrl: playerProfile.avatarUrl ?? null,
        }
      : null,
    groupCount,
  });
});

export const updateProfile = asyncHandler(async (req, res) => {
  const payload = updateProfileSchema.parse(req.body);
  const user = await UserModel.findById(req.user!.userId);

  if (!user) {
    throw new AppError(404, "User not found", "USER_NOT_FOUND");
  }

  const email = payload.email?.toLowerCase();
  if (email && email !== user.email) {
    const emailOwner = await UserModel.exists({ email, _id: { $ne: user._id } });
    if (emailOwner) {
      throw new AppError(409, "Email is already registered", "EMAIL_ALREADY_REGISTERED");
    }
  }

  if (payload.name) user.name = payload.name;
  if (email) user.email = email;
  if (payload.timezone) user.timezone = payload.timezone;
  await user.save();

  await PlayerProfileModel.updateOne(
    { userId: user._id, status: "active" },
    {
      ...(payload.name ? { fullName: payload.name } : {}),
      ...(email ? { email } : {}),
    },
  );

  issueSession(req, res, user);
  res.json({ user: serializeUser(user) });
});

export const changePassword = asyncHandler(async (req, res) => {
  const payload = changePasswordSchema.parse(req.body);
  const user = await UserModel.findById(req.user!.userId);

  if (!user) {
    throw new AppError(404, "User not found", "USER_NOT_FOUND");
  }
  if (!(await bcrypt.compare(payload.currentPassword, user.passwordHash))) {
    throw new AppError(400, "Current password is incorrect", "CURRENT_PASSWORD_INCORRECT");
  }
  if (await bcrypt.compare(payload.newPassword, user.passwordHash)) {
    throw new AppError(
      400,
      "New password must be different from the current password",
      "PASSWORD_UNCHANGED",
    );
  }

  user.passwordHash = await bcrypt.hash(payload.newPassword, 12);
  await user.save();
  await PasswordResetTokenModel.updateMany(
    { userId: user._id, usedAt: { $exists: false } },
    { usedAt: new Date() },
  );

  res.json({ message: "Password updated successfully" });
});

export const forgotPassword = asyncHandler(async (req, res) => {
  const payload = forgotPasswordSchema.parse(req.body);
  const user = await UserModel.findOne({ email: payload.email.toLowerCase(), status: "active" });
  let developmentReset: { token: string; resetUrl: string } | undefined;

  if (user) {
    await PasswordResetTokenModel.deleteMany({ userId: user._id });
    const { token, tokenHash } = createSecureToken();
    await PasswordResetTokenModel.create({
      userId: user._id,
      tokenHash,
      expiresAt: new Date(Date.now() + env.PASSWORD_RESET_TTL_MINUTES * 60_000),
    });
    if (env.NODE_ENV !== "production") {
      developmentReset = {
        token,
        resetUrl: `${env.APP_URL}/reset-password?token=${encodeURIComponent(token)}`,
      };
    }
  }

  res.json({
    message: "If that email exists, password reset instructions have been created.",
    ...(developmentReset ? { developmentReset } : {}),
  });
});

export const resetPassword = asyncHandler(async (req, res) => {
  const payload = resetPasswordSchema.parse(req.body);
  const resetToken = await PasswordResetTokenModel.findOne({
    tokenHash: hashToken(payload.token),
    usedAt: { $exists: false },
    expiresAt: { $gt: new Date() },
  });

  if (!resetToken) {
    throw new AppError(400, "Reset link is invalid or expired", "PASSWORD_RESET_INVALID");
  }

  const user = await UserModel.findById(resetToken.userId);
  if (!user || user.status !== "active") {
    throw new AppError(400, "Reset link is invalid or expired", "PASSWORD_RESET_INVALID");
  }

  user.passwordHash = await bcrypt.hash(payload.newPassword, 12);
  resetToken.usedAt = new Date();
  await Promise.all([user.save(), resetToken.save()]);
  await PasswordResetTokenModel.updateMany(
    { userId: user._id, _id: { $ne: resetToken._id }, usedAt: { $exists: false } },
    { usedAt: new Date() },
  );

  res.json({ message: "Password reset successfully" });
});

export const logout = asyncHandler(async (req, res) => {
  clearAuthCookie(req, res);
  res.status(204).send();
});
