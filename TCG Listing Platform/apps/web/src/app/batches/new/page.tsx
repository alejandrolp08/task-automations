import Link from "next/link";
import { createBatchAction } from "./actions";

const intakeOptions = [
  {
    title: "Single video upload",
    body: "Record one Pokemon batch video on your phone, then upload one file to the platform for detection and review.",
    points: [
      "Best fit for micro sellers without scanner hardware",
      "One card at a time, one review flow after processing",
      "Main product differentiator",
    ],
  },
  {
    title: "Multiple images or scans",
    body: "Upload many existing card scans or photos and push them into the same matching and review pipeline.",
    points: [
      "Good for sellers with current image-based workflows",
      "Lets us serve users beyond the video-first wedge",
      "Same export goal, different intake path",
    ],
  },
];

const captureRules = [
  "Pokemon only for the first version",
  "Front side only",
  "Good lighting and low glare",
  "Plain background",
  "One card at a time for video mode",
  "CSV export for eBay comes after review",
];

export default function NewBatchPage() {
  return (
    <main className="page-shell">
      <section className="hero">
        <div className="hero-badge">Create Batch</div>

        <div className="hero-grid">
          <div className="hero-copy">
            <h1>Start a new seller batch</h1>
            <p>
              This page represents the real entry point for the product. A
              seller chooses the intake method, follows simple capture guidance,
              and creates the batch that later becomes a reviewable inventory.
            </p>

            <div className="hero-actions">
              <Link className="button-primary" href="/batches">
                Back to batches
              </Link>
              <a className="button-secondary" href="#batch-form">
                Jump to form
              </a>
            </div>
          </div>

          <aside className="hero-panel">
            <h2>V1 intake rules</h2>
            <ul className="list">
              {captureRules.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
          </aside>
        </div>
      </section>

      <section className="section">
        <div className="section-header">
          <div>
            <div className="section-badge">Choose Intake</div>
            <h2>Two entry paths, one downstream workflow</h2>
          </div>
          <p>
            Both options should eventually land in the same detection, review,
            and export pipeline. The difference is only how the seller brings
            cards into the system.
          </p>
        </div>

        <div className="intake-grid">
          {intakeOptions.map((option) => (
            <article className="intake-item" key={option.title}>
              <h3>{option.title}</h3>
              <p>{option.body}</p>
              <ul className="list">
                {option.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="section" id="batch-form">
        <div className="section-header">
          <div>
            <div className="section-badge">Seller Setup</div>
            <h2>Batch creation form</h2>
          </div>
          <p>
            For now this is a static product shell. The next backend step is to
            persist this form into the `Batch` and `Upload` tables.
          </p>
        </div>

        <form action={createBatchAction} className="form-shell">
          <div className="form-grid">
            <label className="field">
              <span>Batch name</span>
              <input
                name="name"
                defaultValue="March Pokemon lot"
                placeholder="Enter a batch name"
                required
              />
            </label>

            <label className="field">
              <span>Seller label</span>
              <input
                name="sellerLabel"
                defaultValue="Solo eBay seller"
                placeholder="Optional seller label"
              />
            </label>

            <label className="field">
              <span>Game</span>
              <select defaultValue="Pokemon" disabled>
                <option>Pokemon</option>
              </select>
            </label>

            <label className="field">
              <span>Intake mode</span>
              <select name="intakeMode" defaultValue="video">
                <option value="video">Single video upload</option>
                <option value="images">Multiple images or scans</option>
              </select>
            </label>
          </div>

          <label className="field">
            <span>Capture notes for the seller</span>
            <textarea
              defaultValue="Use a plain background, keep glare low, and show one card at a time if using video."
              rows={4}
            />
          </label>

          <div className="upload-placeholder">
            <strong>Upload area placeholder</strong>
            <p>
              The next step is to attach a real file input for MP4 or image
              batches and store the upload metadata in the database.
            </p>
          </div>

          <div className="hero-actions">
            <button className="button-primary" type="submit">
              Create batch
            </button>
            <Link className="button-secondary" href="/batches">
              Cancel
            </Link>
          </div>
        </form>
      </section>
    </main>
  );
}
