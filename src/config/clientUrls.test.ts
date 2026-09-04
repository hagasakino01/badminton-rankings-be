import assert from "node:assert/strict";
import test from "node:test";

import { resolveClientUrls, selectClientAppUrl } from "./clientUrls";

test("uses localhost defaults only outside production", () => {
  assert.deepEqual(
    resolveClientUrls({ nodeEnv: "development" }),
    {
      clientOrigin: "http://localhost:3000",
      appUrl: "http://localhost:3000",
    },
  );
});

test("derives the public app URL from the first configured client origin", () => {
  assert.deepEqual(
    resolveClientUrls({
      nodeEnv: "production",
      clientOrigin: "https://diamond.example.com/, https://preview.example.com",
    }),
    {
      clientOrigin: "https://diamond.example.com,https://preview.example.com",
      appUrl: "https://diamond.example.com",
    },
  );
});

test("uses APP_URL as the CORS origin when CLIENT_ORIGIN is omitted", () => {
  assert.deepEqual(
    resolveClientUrls({
      nodeEnv: "production",
      appUrl: "https://diamond.example.com/",
    }),
    {
      clientOrigin: "https://diamond.example.com",
      appUrl: "https://diamond.example.com",
    },
  );
});

test("rejects missing or localhost production app URLs", () => {
  assert.throws(
    () => resolveClientUrls({ nodeEnv: "production" }),
    /CLIENT_ORIGIN or APP_URL is required/,
  );
  assert.throws(
    () =>
      resolveClientUrls({
        nodeEnv: "production",
        clientOrigin: "http://localhost:3000",
      }),
    /cannot point to localhost/,
  );
});

test("uses a request origin only when CORS configuration allows it", () => {
  const allowed = "https://diamond.example.com,https://preview.example.com";
  assert.equal(
    selectClientAppUrl(
      "https://preview.example.com",
      allowed,
      "https://diamond.example.com",
    ),
    "https://preview.example.com",
  );
  assert.equal(
    selectClientAppUrl("https://unknown.example.com", allowed, "https://diamond.example.com"),
    "https://diamond.example.com",
  );
});
