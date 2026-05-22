import type { CookieOptions, Request, Response } from "express";

export const AUTH_COOKIE_NAME = "badminton-rankings-token";
const AUTH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function isLocalHostname(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function resolveIsSecureRequest(req: Request) {
  const forwardedProtoHeader = req.headers["x-forwarded-proto"];
  const forwardedProto = Array.isArray(forwardedProtoHeader)
    ? forwardedProtoHeader[0]
    : forwardedProtoHeader?.split(",")[0]?.trim();

  return req.secure || forwardedProto === "https";
}

function buildCookieOptions(req: Request): CookieOptions {
  const isSecureRequest = resolveIsSecureRequest(req);
  let sameSite: CookieOptions["sameSite"] = "lax";
  let secure = isSecureRequest;

  const requestHost = req.get("host");
  const originHeader = req.headers.origin;

  if (requestHost && originHeader) {
    try {
      const requestUrl = new URL(`${isSecureRequest ? "https" : "http"}://${requestHost}`);
      const originUrl = new URL(originHeader);
      const isLocalRequest =
        isLocalHostname(requestUrl.hostname) && isLocalHostname(originUrl.hostname);
      const isCrossOrigin = requestUrl.origin !== originUrl.origin;

      if (isCrossOrigin && !isLocalRequest && isSecureRequest) {
        sameSite = "none";
        secure = true;
      }
    } catch {
      // Fall back to same-site local-friendly cookies when URL parsing fails.
    }
  }

  return {
    httpOnly: true,
    sameSite,
    secure,
    maxAge: AUTH_COOKIE_MAX_AGE_MS,
    path: "/",
  };
}

export function setAuthCookie(req: Request, res: Response, token: string) {
  res.cookie(AUTH_COOKIE_NAME, token, buildCookieOptions(req));
}

export function clearAuthCookie(req: Request, res: Response) {
  const { httpOnly, sameSite, secure, path } = buildCookieOptions(req);
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly,
    sameSite,
    secure,
    path,
  });
}

export function readAuthCookie(req: Request) {
  return req.cookies?.[AUTH_COOKIE_NAME] as string | undefined;
}
