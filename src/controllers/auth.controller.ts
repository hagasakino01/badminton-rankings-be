import bcrypt from "bcryptjs";
import { z } from "zod";

import { UserModel } from "../models/User";
import { clearAuthCookie, setAuthCookie } from "../utils/authCookie";
import { asyncHandler } from "../utils/asyncHandler";
import { AppError } from "../utils/appError";
import { signToken } from "../utils/jwt";

const registerSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.email(),
  password: z.string().min(6).max(128),
});

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(6).max(128),
});

const updateProfileSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.email(),
});

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(6).max(128),
    newPassword: z.string().min(6).max(128),
    confirmNewPassword: z.string().min(6).max(128),
  })
  .refine((value) => value.newPassword === value.confirmNewPassword, {
    message: "New password confirmation does not match",
    path: ["confirmNewPassword"],
  });

export const register = asyncHandler(async (req, res) => {
  const payload = registerSchema.parse(req.body);
  const existingUser = await UserModel.findOne({ email: payload.email.toLowerCase() });

  if (existingUser) {
    throw new AppError(409, "Email is already registered");
  }

  const passwordHash = await bcrypt.hash(payload.password, 10);
  const user = await UserModel.create({
    name: payload.name,
    email: payload.email.toLowerCase(),
    passwordHash,
    role: "admin",
  });

  const token = signToken({
    userId: user._id.toString(),
    role: user.role,
    email: user.email,
  });

  setAuthCookie(req, res, token);
  res.status(201).json({
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  });
});

export const login = asyncHandler(async (req, res) => {
  const payload = loginSchema.parse(req.body);
  const user = await UserModel.findOne({ email: payload.email.toLowerCase() });

  if (!user) {
    throw new AppError(401, "Invalid email or password");
  }

  const matches = await bcrypt.compare(payload.password, user.passwordHash);

  if (!matches) {
    throw new AppError(401, "Invalid email or password");
  }

  const token = signToken({
    userId: user._id.toString(),
    role: user.role,
    email: user.email,
  });

  setAuthCookie(req, res, token);
  res.json({
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  });
});

export const me = asyncHandler(async (req, res) => {
  const user = await UserModel.findById(req.user?.userId).select("-passwordHash").lean();

  if (!user) {
    throw new AppError(404, "User not found");
  }

  res.json({ user });
});

export const updateProfile = asyncHandler(async (req, res) => {
  const payload = updateProfileSchema.parse(req.body);
  const user = await UserModel.findById(req.user?.userId);

  if (!user) {
    throw new AppError(404, "User not found");
  }

  const normalizedEmail = payload.email.toLowerCase();

  const existingUser = await UserModel.findOne({
    email: normalizedEmail,
    _id: { $ne: user._id },
  }).lean();

  if (existingUser) {
    throw new AppError(409, "Email is already registered");
  }

  user.name = payload.name;
  user.email = normalizedEmail;
  await user.save();

  const token = signToken({
    userId: user._id.toString(),
    role: user.role,
    email: user.email,
  });

  setAuthCookie(req, res, token);
  res.json({
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  });
});

export const changePassword = asyncHandler(async (req, res) => {
  const payload = changePasswordSchema.parse(req.body);
  const user = await UserModel.findById(req.user?.userId);

  if (!user) {
    throw new AppError(404, "User not found");
  }

  const matches = await bcrypt.compare(payload.currentPassword, user.passwordHash);
  if (!matches) {
    throw new AppError(400, "Current password is incorrect");
  }

  if (payload.currentPassword === payload.newPassword) {
    throw new AppError(400, "New password must be different from the current password");
  }

  user.passwordHash = await bcrypt.hash(payload.newPassword, 10);
  await user.save();

  res.json({
    message: "Password updated successfully",
  });
});

export const logout = asyncHandler(async (req, res) => {
  clearAuthCookie(req, res);
  res.status(204).send();
});
