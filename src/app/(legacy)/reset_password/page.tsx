import Link from "next/link";
import { redirect } from "next/navigation";
import { resetPasswordAction } from "@/actions/auth";
import { AuthShell } from "@/components/AuthShell";
import { SubmitButton } from "@/components/LegacyBits";
import { getSession } from "@/lib/session";

export const metadata = { title: "Reset Password" };

export default async function ResetPasswordPage() {
  const s = await getSession();
  if (!s.resetEmail || !s.otpVerified) redirect("/forgot_password");
  return (
    <AuthShell
      heading="Create a new secure password"
      blurb="Your identity is verified. Now set a strong new password to regain access to your premium expense tracking dashboard."
      features={[
        ["🔑", "Fresh Password", "Choose a new password to secure your account."],
        ["🔐", "Protected Access", "Your old password is replaced with the new encrypted one."],
        ["🚀", "Continue Fast", "Reset and get back to your dashboard quickly."],
      ]}
      cardTitle="Reset Password"
      cardText="Enter and confirm your new password below."
      links={<Link href="/login">Back to Login</Link>}
    >
      <form action={resetPasswordAction} className="premium-auth-form">
        <div className="input-group">
          <label>New Password</label>
          <input type="password" name="new_password" placeholder="Enter new password" required autoComplete="new-password" />
        </div>
        <div className="input-group">
          <label>Confirm Password</label>
          <input type="password" name="confirm_password" placeholder="Confirm new password" required autoComplete="new-password" />
        </div>
        <SubmitButton className="premium-btn">Reset Password</SubmitButton>
      </form>
    </AuthShell>
  );
}
