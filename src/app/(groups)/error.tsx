"use client";

export default function GroupsError({ reset }: { error: Error; reset: () => void }) {
  return (
    <section className="gz-empty">
      <h2 className="gz-h2">Something went wrong</h2>
      <p>We couldn&apos;t load this page. Nothing was changed.</p>
      <div className="gz-btn-row">
        <button type="button" className="gz-btn gz-btn--primary" onClick={reset}>
          Try again
        </button>
      </div>
    </section>
  );
}
