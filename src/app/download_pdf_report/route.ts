import { NextResponse } from "next/server";
import { FLASH_COOKIE } from "@/lib/flash";
import { getFilteredExpenses } from "@/lib/personal";
import { attachmentHeader, createPdfReport } from "@/lib/reports";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** GET /download_pdf_report: the signed-in user's full expense report as a PDF download. */
export async function GET(request: Request) {
  const s = await getSession();
  if (typeof s.uid !== "number") return NextResponse.redirect(new URL("/login", request.url));

  const url = new URL(request.url);
  const expenses = await getFilteredExpenses(s.uid, {
    sortBy: url.searchParams.get("sort_by") ?? "date",
    sortOrder: url.searchParams.get("sort_order") ?? "desc",
  });
  const report = await createPdfReport(expenses, s.name ?? "user", false);
  if (!report) {
    const res = NextResponse.redirect(new URL("/dashboard", request.url));
    const msg = Buffer.from(JSON.stringify(["No expense records found."]), "utf8").toString("base64url");
    res.cookies.set(FLASH_COOKIE, msg, { path: "/", maxAge: 120, sameSite: "lax", httpOnly: false });
    return res;
  }
  return new Response(new Uint8Array(report.bytes), {
    headers: {
      "Content-Type": report.contentType,
      "Content-Disposition": attachmentHeader(report.fileName),
      "Cache-Control": "private, no-store",
    },
  });
}
