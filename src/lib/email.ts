/** Gmail SMTP sending (same SENDER_EMAIL / SENDER_PASSWORD variables as the Flask app). */
import "server-only";
import nodemailer from "nodemailer";

export interface MailResult {
  ok: boolean;
  message: string;
}

const NOT_CONFIGURED = "Email is not configured on this deployment.";
const FAILED = "Email sending failed. Check the email environment variables.";

function credentials(): { user: string; pass: string } | null {
  const user = process.env.SENDER_EMAIL;
  const pass = process.env.SENDER_PASSWORD;
  return user && pass ? { user, pass } : null;
}

function transport(auth: { user: string; pass: string }) {
  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 15_000,
  });
}

export async function sendEmailSimple(to: string, subject: string, body: string): Promise<MailResult> {
  const auth = credentials();
  if (!auth) {
    console.warn("Email was not sent because SENDER_EMAIL/SENDER_PASSWORD are not configured.");
    return { ok: false, message: NOT_CONFIGURED };
  }
  try {
    await transport(auth).sendMail({ from: auth.user, to, subject, text: body });
    return { ok: true, message: "Email sent successfully." };
  } catch (err) {
    console.error("Email delivery failed", err);
    return { ok: false, message: FAILED };
  }
}

export async function sendAttachmentEmail(
  to: string,
  subject: string,
  body: string,
  attachment: { filename: string; content: Uint8Array; contentType: string },
): Promise<MailResult> {
  const auth = credentials();
  if (!auth) return { ok: false, message: NOT_CONFIGURED };
  try {
    await transport(auth).sendMail({
      from: auth.user,
      to,
      subject,
      text: body,
      attachments: [
        { filename: attachment.filename, content: Buffer.from(attachment.content), contentType: attachment.contentType },
      ],
    });
    return { ok: true, message: "Report sent successfully." };
  } catch (err) {
    console.error("Report email failed", err);
    return { ok: false, message: FAILED };
  }
}

export async function sendBudgetAlertEmail(
  to: string,
  name: string,
  totalSpent: number,
  budgetLimit: number,
  kind: "warning" | "overflow",
): Promise<MailResult> {
  if (kind === "warning") {
    return sendEmailSimple(
      to,
      "Budget Warning - Spending is High",
      `Hello ${name},\n\nYour monthly spending has reached ₹${totalSpent.toFixed(2)} ` +
        `out of your budget of ₹${budgetLimit.toFixed(2)}.\nYou are close to exceeding your budget.\n\nRegards,\nGen-ZSplit`,
    );
  }
  return sendEmailSimple(
    to,
    "Budget Overflow Alert",
    `Hello ${name},\n\nYour monthly budget has been exceeded.\n` +
      `Total spent: ₹${totalSpent.toFixed(2)}\nBudget limit: ₹${budgetLimit.toFixed(2)}\n\nRegards,\nGen-ZSplit`,
  );
}
