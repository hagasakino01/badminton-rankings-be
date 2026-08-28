import jwt from "jsonwebtoken";

import { env } from "../config/env";

export type JwtPayload = {
  userId: string;
  email: string;
};

export function signToken(payload: JwtPayload) {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string) {
  return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
}
