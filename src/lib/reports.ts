/** PDF and Excel expense reports, built in memory (no temp files, so it works on serverless). */
import "server-only";
import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { Expense } from "./personal";

export interface ReportFile {
  bytes: Uint8Array;
  fileName: string;
  contentType: string;
}

export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const PDF_TYPE = "application/pdf";

function fileName(userName: string, filtered: boolean, ext: string): string {
  return `${userName.replace(/ /g, "_")}_${filtered ? "filtered_" : ""}expense_report.${ext}`;
}

export async function createExcelReport(
  expenses: Expense[],
  userName: string,
  filtered: boolean,
): Promise<ReportFile | null> {
  if (!expenses.length) return null;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  const keys = Object.keys(expenses[0]);
  ws.columns = keys.map((key) => ({ header: key, key }));
  for (const e of expenses) ws.addRow(e);
  const raw = (await wb.xlsx.writeBuffer()) as unknown as ArrayLike<number>;
  return { bytes: new Uint8Array(raw), fileName: fileName(userName, filtered, "xlsx"), contentType: XLSX_TYPE };
}

/** The built-in PDF fonts only cover Latin-1; anything else would make drawText throw. */
function latin1(text: string): string {
  return text.replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

export async function createPdfReport(
  expenses: Expense[],
  userName: string,
  filtered: boolean,
): Promise<ReportFile | null> {
  if (!expenses.length) return null;
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const [width, height] = [595.28, 841.89]; // A4
  let page = pdf.addPage([width, height]);
  const text = (s: string, x: number, y: number, size: number, font = regular) =>
    page.drawText(latin1(s), { x, y, size, font });

  let y = height - 50;
  text("Gen-ZSplit - Expense Report", 50, y, 16, bold);
  y -= 30;
  text(`User: ${userName}`, 50, y, 11);
  y -= 20;
  text(`Generated on: ${new Date().toISOString().slice(0, 19).replace("T", " ")}`, 50, y, 11);
  y -= 30;
  for (const [label, x] of [["Title", 50], ["Amount", 220], ["Category", 320], ["Date", 450]] as const) {
    text(label, x, y, 11, bold);
  }
  y -= 15;
  page.drawLine({ start: { x: 50, y }, end: { x: 550, y }, thickness: 1 });

  let total = 0;
  for (const e of expenses) {
    y -= 20;
    if (y < 80) {
      page = pdf.addPage([width, height]);
      y = height - 50;
    }
    text(String(e.title).slice(0, 25), 50, y, 10);
    text(`Rs. ${e.amount.toFixed(2)}`, 220, y, 10);
    text(String(e.category).slice(0, 15), 320, y, 10);
    text(String(e.date), 450, y, 10);
    total += e.amount;
  }
  y -= 30;
  text(`Total Expense: Rs. ${total.toFixed(2)}`, 50, y, 12, bold);

  return { bytes: await pdf.save(), fileName: fileName(userName, filtered, "pdf"), contentType: PDF_TYPE };
}

/** Content-Disposition value that survives non-ASCII names. */
export function attachmentHeader(name: string): string {
  const ascii = name.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
