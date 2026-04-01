const productPrinciples = [
  {
    title: "Video-first intake",
    body: "Let smaller sellers upload one Pokemon batch video instead of managing hundreds of card files.",
  },
  {
    title: "Flexible capture",
    body: "Support both guided video uploads and multi-image uploads so sellers can use what they already have.",
  },
  {
    title: "Review by exception",
    body: "Push low-confidence cards into a fast manual correction flow instead of forcing a full review of everything.",
  },
];

const flowSteps = [
  {
    label: "Step 1",
    title: "Create a batch",
    body: "A seller starts a Pokemon batch and chooses either one video upload or a multi-image intake.",
  },
  {
    label: "Step 2",
    title: "Process media",
    body: "The system extracts card candidates, runs matching against the internal Pokemon catalog, and scores confidence.",
  },
  {
    label: "Step 3",
    title: "Review only doubts",
    body: "Ambiguous cards surface in a focused review queue with suggested matches, previews, and quick manual fixes.",
  },
  {
    label: "Step 4",
    title: "Export for eBay",
    body: "The approved batch becomes a clean inventory export that can power eBay bulk listing workflows with stock images.",
  },
];

const intakeModes = [
  {
    label: "Primary mode",
    title: "Single video upload",
    body: "The main differentiator. A seller records one guided batch video on their phone and uploads one file to the platform.",
    bullets: [
      "Pokemon only for the first version",
      "One card shown at a time",
      "Stock images used for initial listings",
    ],
  },
  {
    label: "Secondary mode",
    title: "Multiple scans or photos",
    body: "A compatibility path for sellers who already use scanners, flat lays, or one-image-per-card workflows today.",
    bullets: [
      "Upload many existing card images",
      "Run the same matching and review flow",
      "Generate the same export format",
    ],
  },
];

const roadmapNotes = [
  {
    label: "Now",
    title: "Inventory capture",
    body: "Build the shortest path from card media to a reviewable Pokemon inventory batch.",
  },
  {
    label: "Next",
    title: "CSV confidence",
    body: "Make the output strong enough that sellers trust the batch before we add marketplace linking.",
  },
  {
    label: "Later",
    title: "Captured frames and direct listing",
    body: "Once the intake engine is stable, add seller-owned listing images and direct eBay publishing.",
  },
  {
    label: "Future",
    title: "Pricing and selling intelligence",
    body: "Layer repricing and selling recommendations on top of the same clean inventory foundation.",
  },
];

export default function Home() {
  return (
    <main className="page-shell">
      <section className="hero">
        <div className="hero-badge">Pokemon Seller Workflow</div>

        <div className="hero-grid">
          <div className="hero-copy">
            <h1>One upload. One review flow. One cleaner path to eBay listings.</h1>
            <p>
              TCG Listing Platform is being designed as a web-first intake tool
              for Pokemon sellers who want a simpler path from physical cards to
              listing-ready inventory. The first version focuses on turning
              either one video or many images into a reviewable batch with a CSV
              export for eBay.
            </p>

            <div className="hero-actions">
              <a className="button-primary" href="#mvp-flow">
                View MVP flow
              </a>
              <Link className="button-secondary" href="/batches">
                Open batch workspace
              </Link>
            </div>
          </div>

          <aside className="hero-panel">
            <h2>Version 1 focus</h2>

            <div className="hero-stat-grid">
              <div className="stat">
                <strong>Pokemon only</strong>
                <span>We start narrow so matching, review, and export stay reliable.</span>
              </div>
              <div className="stat">
                <strong>Web only</strong>
                <span>No mobile app needed for the first release.</span>
              </div>
              <div className="stat">
                <strong>Video + images</strong>
                <span>Different sellers can keep the capture method that fits them best.</span>
              </div>
              <div className="stat">
                <strong>CSV first</strong>
                <span>Export value now, then add direct marketplace connections later.</span>
              </div>
            </div>
          </aside>
        </div>
      </section>

      <section className="section" id="principles">
        <div className="section-header">
          <div>
            <div className="section-badge">Product Principles</div>
            <h2>What we are optimizing for</h2>
          </div>
          <p>
            The product should feel faster and simpler than existing seller
            workflows without promising unrealistic fully automatic perfection.
          </p>
        </div>

        <div className="card-grid">
          {productPrinciples.map((item) => (
            <article className="card" key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section" id="mvp-flow">
        <div className="section-header">
          <div>
            <div className="section-badge">MVP Flow</div>
            <h2>How the first usable product should work</h2>
          </div>
          <p>
            Keep the first release centered on intake, matching, manual review,
            and eBay CSV output. That is the shortest path to a meaningful tool.
          </p>
        </div>

        <div className="flow-grid">
          {flowSteps.map((step) => (
            <article className="flow-step" key={step.title}>
              <strong>{step.label}</strong>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section" id="intake-modes">
        <div className="section-header">
          <div>
            <div className="section-badge">Intake Modes</div>
            <h2>Two ways into the same review pipeline</h2>
          </div>
          <p>
            Video is the product wedge, but multi-image intake keeps the tool
            useful for sellers who already have existing scans or photos.
          </p>
        </div>

        <div className="intake-grid">
          {intakeModes.map((mode) => (
            <article className="intake-item" key={mode.title}>
              <strong>{mode.label}</strong>
              <h3>{mode.title}</h3>
              <p>{mode.body}</p>
              <ul className="list">
                {mode.bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-header">
          <div>
            <div className="section-badge">Roadmap Shape</div>
            <h2>What comes after the first clean batch export</h2>
          </div>
          <p>
            The key is to earn trust on catalog accuracy and seller workflow
            first. Marketplace automation should sit on top of that, not before it.
          </p>
        </div>

        <div className="notes-grid">
          {roadmapNotes.map((note) => (
            <article className="note" key={note.title}>
              <strong>{note.label}</strong>
              <h3>{note.title}</h3>
              <p>{note.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="panel">
          <h3>Next implementation focus</h3>
          <p>
            The next engineering step is to add the first real data model for
            batches, uploads, detected cards, and review states. After that we
            can build the initial upload experience and wire in Pokemon catalog
            sync work.
          </p>
          <div className="hero-actions">
            <Link className="button-primary" href="/batches">
              Explore mock batches
            </Link>
          </div>
        </div>

        <div className="footer-note">
          Current direction: stock catalog images for eBay CSV exports first,
          then captured frame images, and only after that direct marketplace API
          publishing.
        </div>
      </section>
    </main>
  );
}
import Link from "next/link";
