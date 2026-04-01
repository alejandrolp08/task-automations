import Link from "next/link";
import { listBatches } from "@/lib/batch-repository";

export const dynamic = "force-dynamic";

const statusLabels = {
  draft: "Draft",
  processing: "Processing",
  review: "Needs review",
  ready: "Ready to export",
  exported: "Exported",
};

export default async function BatchesPage() {
  const batchSummaries = await listBatches();

  return (
    <main className="page-shell">
      <section className="hero">
        <div className="hero-badge">Batch Workspace</div>

        <div className="hero-grid">
          <div className="hero-copy">
            <h1>Pokemon intake batches</h1>
            <p>
              This is the first real product surface for the MVP. Each batch
              represents one seller upload flow that eventually turns into a
              reviewable inventory and an eBay CSV export.
            </p>

            <div className="hero-actions">
              <Link className="button-primary" href="/batches/new">
                Create batch
              </Link>
              <Link className="button-secondary" href="/">
                Back to overview
              </Link>
            </div>
          </div>

          <aside className="hero-panel">
            <h2>Current batch goals</h2>
            <div className="hero-stat-grid">
              <div className="stat">
                <strong>{batchSummaries.length}</strong>
                <span>Mock seller batches covering video and image intake.</span>
              </div>
              <div className="stat">
                <strong>
                  {batchSummaries.reduce((sum, batch) => sum + batch.reviewCount, 0)}
                </strong>
                <span>Review items currently blocking export confidence.</span>
              </div>
            </div>
          </aside>
        </div>
      </section>

      <section className="section" id="batch-list">
        <div className="section-header">
          <div>
            <div className="section-badge">Working Inventory</div>
            <h2>Batches in the pipeline</h2>
          </div>
          <p>
            The real app will eventually source this from the database. For now
            it is a typed product model that matches the MVP workflow we want to
            build next.
          </p>
        </div>

        <div className="table-shell">
          <table className="data-table">
            <thead>
              <tr>
                <th>Batch</th>
                <th>Mode</th>
                <th>Status</th>
                <th>Cards</th>
                <th>Review</th>
                <th>Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {batchSummaries.map((batch) => (
                <tr key={batch.id}>
                  <td>
                    <div className="table-title">{batch.name}</div>
                    <div className="table-subtitle">{batch.sellerLabel}</div>
                  </td>
                  <td>{batch.intakeMode === "video" ? "Video" : "Images"}</td>
                  <td>
                    <span className={`status-pill status-${batch.status}`}>
                      {statusLabels[batch.status]}
                    </span>
                  </td>
                  <td>{batch.itemCount}</td>
                  <td>{batch.reviewCount}</td>
                  <td>{batch.updatedAt}</td>
                  <td>
                    <Link className="inline-link" href={`/batches/${batch.id}`}>
                      Open batch
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
