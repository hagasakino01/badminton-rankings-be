const LOCAL_CLIENT_URL = "http://localhost:3000";

type ClientUrlInput = {
  nodeEnv: "development" | "test" | "production";
  clientOrigin?: string;
  appUrl?: string;
};

type ClientUrlConfig = {
  clientOrigin: string;
  appUrl: string;
};

function parseWebUrl(value: string, label: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid absolute URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label} must use http or https`);
  }
  return url;
}

function normalizeAppUrl(value: string) {
  const url = parseWebUrl(value, "APP_URL");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

function isLoopbackUrl(value: string) {
  const hostname = new URL(value).hostname.toLowerCase();
  return (
    hostname === "localhost" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname.startsWith("127.")
  );
}

export function resolveClientUrls(input: ClientUrlInput): ClientUrlConfig {
  const configuredOrigins = input.clientOrigin
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  let origins = configuredOrigins?.map((origin, index) =>
    origin === "*" ? origin : parseWebUrl(origin, `CLIENT_ORIGIN[${index}]`).origin,
  );

  if (!origins?.length && input.appUrl) {
    origins = [parseWebUrl(input.appUrl, "APP_URL").origin];
  }
  if (!origins?.length) {
    if (input.nodeEnv === "production") {
      throw new Error("CLIENT_ORIGIN or APP_URL is required in production");
    }
    origins = [LOCAL_CLIENT_URL];
  }

  const concreteOrigin = origins.find((origin) => origin !== "*");
  const appUrlSource =
    input.appUrl?.trim() ||
    concreteOrigin ||
    (input.nodeEnv === "production" ? undefined : LOCAL_CLIENT_URL);

  if (!appUrlSource) {
    throw new Error("APP_URL is required when CLIENT_ORIGIN only contains wildcard origins");
  }

  const appUrl = normalizeAppUrl(appUrlSource);
  if (input.nodeEnv === "production" && isLoopbackUrl(appUrl)) {
    throw new Error("APP_URL cannot point to localhost in production");
  }

  return {
    clientOrigin: origins.join(","),
    appUrl,
  };
}

export function selectClientAppUrl(
  requestOrigin: string | undefined,
  clientOrigin: string,
  appUrl: string,
) {
  if (!requestOrigin) return appUrl;

  let normalizedRequestOrigin: string;
  try {
    normalizedRequestOrigin = parseWebUrl(requestOrigin, "Request origin").origin;
  } catch {
    return appUrl;
  }

  const allowedOrigins = clientOrigin.split(",").map((origin) => origin.trim());
  return allowedOrigins.includes("*") || allowedOrigins.includes(normalizedRequestOrigin)
    ? normalizedRequestOrigin
    : appUrl;
}
