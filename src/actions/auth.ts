"use server";

import { randomInt, timingSafeEqual } from "node:crypto";
import { redirect } from "next/navigation";
import { DuplicateKeyError, getOne, insertRow, updateRows } from "@/lib/db";
import { sendEmailSimple } from "@/lib/email";
import { flash } from "@/lib/flash";
import { hashPassword, verifyPassword } from "@/lib/password";
import { clearSession, getSession, setSession, updateSession } from "@/lib/session";

const str = (fd: FormData, name: string): string => {
  const v = fd.get(name);
  return typeof v === "string" ? v : "";
};

/** Parse a timestamp stored without a zone (Flask wrote naive UTC) as UTC. */
function parseUtc(value: string): number {
  let s = value.replace(/(\.\d{3})\d+/, "$1");
  if (!/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) s += "Z";
  return Date.parse(s);
}

export async function registerAction(formData: FormData): Promise<void> {
  const name = str(formData, "name").trim();
  const email = str(formData, "email").trim().toLowerCase();
  const password = str(formData, "password");
  if (!name || !email || !password) {
    await flash("All fields are required.");
    redirect("/register");
  }
  try {
    await insertRow("users", {
      name,
      email,
      password: hashPassword(password),
      otp: null,
      otp_expiry: null,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    if (err instanceof DuplicateKeyError) {
      await flash("Email already exists.");
      redirect("/register");
    }
    throw err;
  }
  await flash("Registration successful. Please login.");
  redirect("/login");
}

export async function loginAction(formData: FormData): Promise<void> {
  const email = str(formData, "email").trim().toLowerCase();
  const password = str(formData, "password");
  const user = await getOne("users", { email });
  if (user && verifyPassword(user.password, password)) {
    await setSession({ uid: user.id, name: user.name, email: user.email });
    redirect("/dashboard");
  }
  await flash("Invalid email or password.");
  redirect("/login");
}

export async function logoutAction(): Promise<void> {
  await clearSession();
  await flash("Logged out successfully.");
  redirect("/login");
}

export async function forgotPasswordAction(formData: FormData): Promise<void> {
  const email = str(formData, "email").trim().toLowerCase();
  const user = await getOne("users", { email }, "id,email");
  if (!user) {
    await flash("If the email is registered, a reset code will be sent.");
    redirect("/forgot_password");
  }
  const otp = String(randomInt(100000, 1000000));
  const expiry = new Date(Date.now() + 10 * 60_000).toISOString();
  await updateRows("users", { id: user.id }, { otp, otp_expiry: expiry });
  await sendEmailSimple(email, "Your OTP for Password Reset", `Your password reset OTP is ${otp}. It expires in 10 minutes.`);
  // Starting a new reset always clears any earlier verification (the Flask version did not).
  await updateSession({ resetEmail: email, otpVerified: undefined });
  await flash("If email is configured, an OTP has been sent.");
  redirect("/verify_otp");
}

export async function verifyOtpAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session.resetEmail) redirect("/forgot_password");
  const user = await getOne("users", { email: session.resetEmail }, "id,email,otp,otp_expiry");
  const otp = str(formData, "otp").trim();
  if (!user || !user.otp || !user.otp_expiry) {
    await flash("OTP not found. Please request a new one.");
    redirect("/forgot_password");
  }
  const expiry = parseUtc(String(user.otp_expiry));
  if (Number.isNaN(expiry) || Date.now() > expiry) {
    await flash("OTP expired. Please request a new one.");
    redirect("/forgot_password");
  }
  const a = Buffer.from(otp);
  const b = Buffer.from(String(user.otp));
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    await flash("Invalid OTP.");
    redirect("/verify_otp");
  }
  await updateSession({ otpVerified: true });
  await flash("OTP verified successfully.");
  redirect("/reset_password");
}

export async function resetPasswordAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session.resetEmail || !session.otpVerified) redirect("/forgot_password");
  const next = str(formData, "new_password");
  const confirm = str(formData, "confirm_password");
  if (!next || next !== confirm) {
    await flash("Passwords do not match.");
    redirect("/reset_password");
  }
  await updateRows(
    "users",
    { email: session.resetEmail },
    { password: hashPassword(next), otp: null, otp_expiry: null },
  );
  await updateSession({ resetEmail: undefined, otpVerified: undefined });
  await flash("Password reset successful. Please login.");
  redirect("/login");
}
