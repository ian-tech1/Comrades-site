export function resolveRequestPath(requestUrl) {
  const url = new URL(requestUrl, "https://vercel.local");
  const rewrittenPath = url.searchParams.get("__path");
  if (rewrittenPath !== null) {
    return `/api/${rewrittenPath.replace(/^\/+/, "").replace(/\/+$/, "")}`;
  }
  return url.pathname.replace(/\/+$/, "") || "/";
}
