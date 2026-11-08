import Link from "next/link";
import { redirect } from "next/navigation";
import { verifyOtpAction } from "@/actions/auth";
import { AuthShell } from "@/components/AuthShell";
import { SubmitButton } from "@/components/LegacyBits";
import { getSession } from "@/lib/session";

export const metadata = { title: "Verify OTP" };

export default async function VerifyOtpPage() {
  if (!(await getSession()).resetEmail) redirect("/forgot_password");
  return (
    <AuthShell
      heading="Verify your identity"
      blurb="Enter the OTP sent to your email to confirm that it’s really you and continue with password reset."
      features={[
        ["🛡️", "Secure Verification", "OTP verification protects your account from unauthorized access."],
        ["⏳", "Time Sensitive", "Your OTP works for a limited time for better security."],
        ["✅", "Fast Confirmation", "Verify once and continue to create a new password."],
      ]}
      cardTitle="Verify OTP"
      cardText="Enter the 6-digit OTP sent to your registered email."
      links={<Link href="/forgot_password">Resend / Go Back</Link>}
    >
      <form action={verifyOtpAction} className="premium-auth-form">
        <div className="input-group">
          <label>OTP Code</label>
          <input type="text" name="otp" placeholder="Enter 6-digit OTP" required inputMode="numeric" autoComplete="one-time-code" />
        </div>
        <SubmitButton className="premium-btn">Verify OTP</SubmitButton>
      </form>
    </AuthShell>
  );
}
