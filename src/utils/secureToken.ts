import crypto from "node:crypto";

export function createSecureToken() {
  const token = crypto.randomBytes(32).toString("base64url");

  return {
    token,
    tokenHash: hashToken(token),
    tokenHint: token.slice(-8),
  };
}

export function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}
