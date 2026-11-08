import Link from "next/link";
import { loginAction } from "@/actions/auth";
import { AuthShell } from "@/components/AuthShell";
import { SubmitButton } from "@/components/LegacyBits";

export const metadata = { title: "Login" };

export default function LoginPage() {
  return (
    <AuthShell
      heading="Manage money with style and clarity"
      blurb="Track expenses, set budgets, view smart analytics, and generate reports from one premium dashboard experience."
      features={[
        ["📊", "Smart Insights", "Understand your spending with interactive graphs."],
        ["💸", "Budget Alerts", "Stay in control with warnings and overflow alerts."],
        ["📁", "Reports", "Send PDF and Excel reports directly to your email."],
      ]}
      cardTitle="Welcome Back"
      cardText="Login to continue to your premium expense dashboard."
      links={
        <>
          <Link href="/forgot_password">Forgot Password?</Link>
          <span>•</span>
          <Link href="/register">Create account</Link>
        </>
      }
    >
      <form action={loginAction} className="premium-auth-form">
        <div className="input-group">
          <label>Email Address</label>
          <input type="email" name="email" placeholder="Enter your email" required autoComplete="email" />
        </div>
        <div className="input-group">
          <label>Password</label>
          <input type="password" name="password" placeholder="Enter your password" required autoComplete="current-password" />
        </div>
        <SubmitButton className="premium-btn">Login</SubmitButton>
      </form>
    </AuthShell>
  );
}
