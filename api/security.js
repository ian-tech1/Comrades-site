import crypto from "node:crypto";

export function isSameOriginRequest(req) {
  const origin = req.headers?.origin;
  if (!origin) return true;

  const host = String(req.headers?.host || "")
    .trim()
    .toLowerCase();
  if (!host) return false;

  try {
    const parsedOrigin = new URL(origin);
    return (
      (parsedOrigin.protocol === "https:" ||
        parsedOrigin.protocol === "http:") &&
      parsedOrigin.host.toLowerCase() === host
    );
  } catch {
    return false;
  }
}

export function safeEquals(left, right) {
  const a = Buffer.from(String(left), "utf8");
  const b = Buffer.from(String(right), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
