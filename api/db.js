import { createClient } from "@supabase/supabase-js";

const configuredUrl = (process.env.SUPABASE_URL || "").trim().split(/\s+/)[0];
const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "")
  .trim()
  .split(/\s+/)[0];

export const supabaseUrl = (() => {
  try {
    const url = new URL(configuredUrl);
    if (
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname))
    )
      return url.toString().replace(/\/+$/, "");
  } catch {}
  return "";
})();

export const db = createClient(
  supabaseUrl || "https://placeholder.supabase.co",
  key || "placeholder",
  { auth: { persistSession: false, autoRefreshToken: false } },
);
