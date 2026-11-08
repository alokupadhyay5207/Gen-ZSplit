import Link from "next/link";
import { registerAction } from "@/actions/auth";
import { AuthShell } from "@/components/AuthShell";
import { SubmitButton } from "@/components/LegacyBits";

export const metadata = { title: "Register" };

export default function RegisterPage() {
  return (
    <AuthShell
      heading="Start your smart finance journey today"
      blurb="Create your account to manage expenses, set budgets, view premium analytics, and receive smart financial reports directly to your email."
      features={[
        ["🔐", "Secure Access", "Email-based login with password protection and recovery support."],
        ["📈", "Visual Dashboard", "Track your money with premium charts, counters, and clean layouts."],
        ["📤", "Easy Reports", "Export and receive Excel or PDF reports whenever you need them."],
      ]}
      cardTitle="Create Account"
      cardText="Register now and unlock your premium expense tracking dashboard."
      links={
        <>
          <span>Already have an account?</span>
          <Link href="/login">Login</Link>
        </>
      }
    >
      <form action={registerAction} className="premium-auth-form">
        <div className="input-group">
          <label>Full Name</label>
          <input type="text" name="name" placeholder="Enter your full name" required autoComplete="name" />
        </div>
        <div className="input-group">
          <label>Email Address</label>
          <input type="email" name="email" placeholder="Enter your email" required autoComplete="email" />
        </div>
        <div className="input-group">
          <label>Password</label>
          <input type="password" name="password" placeholder="Create a password" required autoComplete="new-password" />
        </div>
        <SubmitButton className="premium-btn">Create Account</SubmitButton>
      </form>
    </AuthShell>
  );
}
