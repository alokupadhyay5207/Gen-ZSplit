"use client";

export default function LegacyError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="premium-login-page">
      <div className="premium-auth-card">
        <div className="premium-auth-header">
          <h2>Something went wrong</h2>
          <p>We couldn&apos;t complete that. Nothing was lost; please try again.</p>
        </div>
        <button type="button" className="premium-btn" onClick={reset}>
          Try again
        </button>
      </div>
    </div>
  );
}
