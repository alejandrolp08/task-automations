import Link from "next/link";

export default function NotFound() {
  return (
    <main className="page-shell">
      <section className="hero">
        <div className="hero-badge">Not Found</div>
        <div className="hero-grid">
          <div className="hero-copy">
            <h1>This page does not exist.</h1>
            <p>
              The requested route is not available in the current TCG Listing
              Platform prototype.
            </p>
            <div className="hero-actions">
              <Link className="button-primary" href="/">
                Back to home
              </Link>
              <Link className="button-secondary" href="/batches">
                View batches
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
