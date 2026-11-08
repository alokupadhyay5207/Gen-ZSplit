import Link from "next/link";
import { forgotPasswordAction } from "@/actions/auth";
import { AuthShell } from "@/components/AuthShell";
import { SubmitButton } from "@/components/LegacyBits";

export const metadata = { title: "Forgot Password" };

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      heading="Recover your account securely"
      blurb="Don’t worry. Enter your registered email and we’ll send you a one-time OTP to reset your password safely."
      features={[
        ["📧", "Email Verification", "Receive a secure OTP on your registered email address."],
        ["🔒", "Safe Reset", "Reset your password without losing your expense data."],
        ["⚡", "Quick Access", "Get back to your dashboard in just a few steps."],
      ]}
      cardTitle="Forgot Password"
      cardText="Enter your email to receive a verification OTP."
      links={<Link href="/login">Back to Login</Link>}
    >
      <form action={forgotPasswordAction} className="premium-auth-form">
        <div className="input-group">
          <label>Email Address</label>
          <input type="email" name="email" placeholder="Enter your registered email" required autoComplete="email" />
        </div>
        <SubmitButton className="premium-btn">Send OTP</SubmitButton>
      </form>
    </AuthShell>
  );
}
