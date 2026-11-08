// Check the Supabase connection, the API key type and that all tables exist.
// Usage (after filling .env.local and running supabase/schema.sql):  npm run check-db
import { createClient } from "@supabase/supabase-js";

const TABLES = ["users", "expenses", "budgets", "groups", "group_members",
  "group_expenses", "expense_splits", "settlements", "group_activity"];

function keyRole(key) {
  key = (key || "").trim();
  if (key.startsWith("sb_secret_")) return "service_role";
  if (key.startsWith("sb_publishable_")) return "anon";
  try {
    const payload = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8"));
    return payload.role ?? null;
  } catch {
    return null;
  }
}

const url = (process.env.SUPABASE_URL || "").trim();
const key = (process.env.SUPABASE_KEY || "").trim();
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_KEY must be set in .env.local");
  process.exit(1);
}

const role = keyRole(key);
if (role === "anon") {
  console.log("WARNING: SUPABASE_KEY is the public anon/publishable key. Tables use Row Level Security, " +
    "so reads return nothing and inserts fail. Use the secret / service_role key.");
} else if (role === "service_role") {
  console.log("API key: secret / service_role (good).");
} else {
  console.log("Could not tell which kind of API key this is.");
}

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const missing = [];
for (const table of TABLES) {
  const { error } = await db.from(table).select("*").limit(1);
  if (error) {
    missing.push(table);
    console.log(`  MISSING  ${table}  (${error.message.slice(0, 90)})`);
  } else {
    console.log(`  ok       ${table}`);
  }
}
if (missing.length) {
  console.log("\nRun supabase/schema.sql in the Supabase SQL editor, then run this again.");
  process.exit(1);
}
console.log("\nSupabase connection and all tables look good.");
