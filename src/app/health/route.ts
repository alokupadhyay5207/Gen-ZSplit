import { NextResponse } from "next/server";
import { fetchRows } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /health: checks the Supabase connection (same contract as the Flask /health). */
export async function GET() {
  try {
    await fetchRows("users", { columns: "id", limit: 1 });
    return NextResponse.json({ status: "ok", database: "supabase" });
  } catch (err) {
    console.error("Supabase health check failed", err);
    return NextResponse.json(
      { status: "error", database: "unavailable", reason: err instanceof Error ? err.name : "Error" },
      { status: 503 },
    );
  }
}
