import Link from "next/link";
import { notFound } from "next/navigation";
import { getBatchDetail, getBatchVideoDebug } from "@/lib/batch-repository";
import { getEbayPreviewRows } from "@/lib/ebay-export";
import { batches } from "@/lib/mock-data";
import { uploadBatchMediaAction } from "./upload-actions";
import { resolveReviewItemAction } from "./review-actions";
import { generateExportAction } from "./export-actions";
import { saveListingSettingsAction } from "./listing-settings-actions";
import { saveDetectionOverridesAction } from "./detection-overrides-actions";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{
    batchId: string;
  }>;
};

export function generateStaticParams() {
  return batches.map((batch) => ({ batchId: batch.id }));
}

export default async function BatchDetailPage({ params }: PageProps) {
  const { batchId } = await params;
  const batch = await getBatchDetail(batchId);

  if (!batch) {
    notFound();
  }

  const previewRows = await getEbayPreviewRows(batchId);
  const videoDebugUploads = await getBatchVideoDebug(batchId);

  const listingReadyDetections = batch.detections.filter(
    (detection) => detection.status === "matched" && !detection.excludeFromExport,
  );
  const blockedDetections = batch.detections.filter((detection) => detection.status === "needs_review");
  const excludedDetections = batch.detections.filter((detection) => detection.excludeFromExport);
  const previewPriceOverrides = previewRows.filter((row) => row.hasPriceOverride).length;
  const previewManualMatches = previewRows.filter((row) => row.matchSource === "manual_review").length;
  const previewConditionOverrides = previewRows.filter((row) => row.hasConditionOverride).length;
  const totalExtractedFrames = videoDebugUploads.reduce((sum, upload) => sum + upload.frameCount, 0);
  const totalMatchedFrames = videoDebugUploads.reduce((sum, upload) => sum + upload.matchedFrameCount, 0);

  return (
    <main className="page-shell">
      <section className="hero">
        <div className="hero-badge">Batch Detail</div>

        <div className="hero-grid">
          <div className="hero-copy">
            <h1>{batch.name}</h1>
            <p>
              This detail view mirrors the real seller workflow: upload intake,
              detection output, review queue, and export readiness. It gives us
              a concrete product skeleton before wiring in storage and actual
              card recognition.
            </p>

            <div className="hero-actions">
              <Link className="button-primary" href="/batches">
                Back to batches
              </Link>
              <a className="button-secondary" href="#review-queue">
                Jump to review queue
              </a>
            </div>
          </div>

          <aside className="hero-panel">
            <h2>Batch snapshot</h2>
            <div className="hero-stat-grid">
              <div className="stat">
                <strong>{batch.intakeMode === "video" ? "Video" : "Images"}</strong>
                <span>Current intake method for this seller batch.</span>
              </div>
              <div className="stat">
                <strong>{batch.itemCount}</strong>
                <span>Cards currently in the working inventory.</span>
              </div>
              <div className="stat">
                <strong>{batch.reviewCount}</strong>
                <span>Cards still waiting on manual confirmation.</span>
              </div>
              <div className="stat">
                <strong>{batch.exportReady ? "Ready" : "Blocked"}</strong>
                <span>CSV export state for the current batch.</span>
              </div>
            </div>
          </aside>
        </div>
      </section>

      <section className="section">
        <div className="section-header">
          <div>
            <div className="section-badge">Listing Settings</div>
            <h2>Batch-level seller defaults</h2>
          </div>
          <p>
            These are the values that should come from the seller, not from the
            card detection engine. The eBay export will use these settings.
          </p>
        </div>

        <form action={saveListingSettingsAction} className="form-shell">
          <input name="batchId" type="hidden" value={batch.id} />

          <div className="form-grid">
            <label className="field">
              <span>Location</span>
              <input defaultValue={batch.listingSettings.location} name="location" />
            </label>

            <label className="field">
              <span>Dispatch time max</span>
              <input defaultValue={batch.listingSettings.dispatchTimeMax} name="dispatchTimeMax" />
            </label>

            <label className="field">
              <span>Shipping type</span>
              <select defaultValue={batch.listingSettings.shippingType} name="shippingType">
                <option value="Flat">Flat</option>
                <option value="Free">Free</option>
              </select>
            </label>

            <label className="field">
              <span>Shipping cost</span>
              <input defaultValue={batch.listingSettings.shippingCost} name="shippingCost" />
            </label>

            <label className="field">
              <span>Returns accepted</span>
              <select
                defaultValue={batch.listingSettings.returnsAcceptedOption}
                name="returnsAcceptedOption"
              >
                <option value="ReturnsAccepted">Returns accepted</option>
                <option value="ReturnsNotAccepted">Returns not accepted</option>
              </select>
            </label>

            <label className="field">
              <span>Returns within</span>
              <input defaultValue={batch.listingSettings.returnsWithinOption} name="returnsWithinOption" />
            </label>

            <label className="field">
              <span>Refund option</span>
              <input defaultValue={batch.listingSettings.refundOption} name="refundOption" />
            </label>

            <label className="field">
              <span>Shipping paid by</span>
              <select
                defaultValue={batch.listingSettings.shippingCostPaidByOption}
                name="shippingCostPaidByOption"
              >
                <option value="Buyer">Buyer</option>
                <option value="Seller">Seller</option>
              </select>
            </label>

            <label className="field">
              <span>Card condition descriptor</span>
              <select
                defaultValue={batch.listingSettings.cardConditionDescriptor}
                name="cardConditionDescriptor"
              >
                <option value="400010">Near Mint or Better</option>
                <option value="400015">Lightly Played (Excellent)</option>
                <option value="400016">Moderately Played (Very Good)</option>
                <option value="400017">Heavily Played (Poor)</option>
              </select>
            </label>
          </div>

          <label className="field">
            <span>Description template</span>
            <textarea
              defaultValue={batch.listingSettings.descriptionTemplate}
              name="descriptionTemplate"
              rows={5}
            />
          </label>

          <div className="hero-actions">
            <button className="button-primary" type="submit">
              Save listing settings
            </button>
          </div>
        </form>
      </section>

      <section className="section">
        <div className="section-header">
          <div>
            <div className="section-badge">Upload Intake</div>
            <h2>Attach seller media</h2>
          </div>
          <p>
            This is the next real workflow after batch creation. The file is
            stored locally and registered as an upload for this batch.
          </p>
        </div>

        <form action={uploadBatchMediaAction} className="form-shell">
          <input name="batchId" type="hidden" value={batch.id} />

          <div className="form-grid">
            <label className="field">
              <span>Intake mode</span>
              <select defaultValue={batch.intakeMode} name="intakeMode">
                <option value="video">Single video upload</option>
                <option value="images">Image or scan upload</option>
              </select>
            </label>

            <label className="field">
              <span>Media file</span>
              <input name="media" type="file" required />
            </label>
          </div>

          <div className="hero-actions">
            <button className="button-primary" type="submit">
              Save upload
            </button>
          </div>
        </form>
      </section>

      <section className="section">
        <div className="section-header">
          <div>
            <div className="section-badge">Uploads</div>
            <h2>Batch media</h2>
          </div>
          <p>
            Later this will be fed by object storage and processing jobs. Right
            now it defines the UX and data we need from the backend.
          </p>
        </div>

        <div className="card-grid two-up">
          {batch.uploads.map((upload) => (
            <article className="card" key={upload.id}>
              <h3>{upload.fileName}</h3>
              <p>
                {upload.type === "video"
                  ? `Video upload${upload.durationLabel ? ` · ${upload.durationLabel}` : ""}`
                  : `Image batch${upload.imageCount ? ` · ${upload.imageCount} files` : ""}`}
              </p>
              <ul className="list">
                <li>Status: {upload.status}</li>
                <li>Uploaded: {upload.uploadedAt}</li>
              </ul>
            </article>
          ))}
        </div>
      </section>

      {videoDebugUploads.length > 0 ? (
        <section className="section">
          <div className="section-header">
            <div>
              <div className="section-badge">Video Debug</div>
              <h2>Extracted frames and matched catalog references</h2>
            </div>
            <p>
              This debug view helps us tune video intake: which frames were extracted, what
              card each frame matched, and which official reference image the matcher compared against.
            </p>
          </div>

          <div className="hero-stat-grid">
            <div className="stat">
              <strong>{videoDebugUploads.length}</strong>
              <span>Video uploads available for frame-level debugging.</span>
            </div>
            <div className="stat">
              <strong>{totalExtractedFrames}</strong>
              <span>Total extracted frames currently saved for this batch.</span>
            </div>
            <div className="stat">
              <strong>{totalMatchedFrames}</strong>
              <span>Frames that currently have a saved detection candidate.</span>
            </div>
          </div>

          <div className="debug-upload-stack">
            {videoDebugUploads.map((upload) => (
              <article className="panel" key={`${upload.uploadId}-debug`}>
                <h3>{upload.fileName}</h3>
                <p>
                  Uploaded {upload.uploadedAt}
                  {upload.durationLabel ? ` · ${upload.durationLabel}` : ""}
                  {` · ${upload.frameCount} extracted frames`}
                </p>

                {upload.frames.length === 0 ? (
                  <p>No extracted frames were found for this upload yet.</p>
                ) : (
                  <div className="frame-debug-grid">
                    {upload.frames.map((frame) => (
                      <article className="frame-debug-card" key={`${upload.uploadId}-${frame.frameLabel}`}>
                        <div className="frame-debug-column">
                          <strong>{frame.frameLabel}</strong>
                          <img
                            alt={`${upload.fileName} ${frame.frameLabel}`}
                            className="frame-debug-image"
                            src={frame.frameImageUrl}
                          />
                        </div>

                        <div className="frame-debug-column">
                          <strong>OCR crops</strong>
                          <div className="ocr-debug-stack">
                            {frame.cardCropImageUrl ? (
                              <div>
                                <span className="ocr-debug-label">Card crop</span>
                                <img
                                  alt={`${upload.fileName} ${frame.frameLabel} card crop`}
                                  className="frame-debug-image"
                                  src={frame.cardCropImageUrl}
                                />
                              </div>
                            ) : null}
                            {frame.ocrTopImageUrl ? (
                              <div>
                                <span className="ocr-debug-label">Top OCR zone</span>
                                <img
                                  alt={`${upload.fileName} ${frame.frameLabel} top OCR zone`}
                                  className="frame-debug-image"
                                  src={frame.ocrTopImageUrl}
                                />
                              </div>
                            ) : null}
                            {frame.ocrBottomImageUrl ? (
                              <div>
                                <span className="ocr-debug-label">Bottom OCR zone</span>
                                <img
                                  alt={`${upload.fileName} ${frame.frameLabel} bottom OCR zone`}
                                  className="frame-debug-image"
                                  src={frame.ocrBottomImageUrl}
                                />
                              </div>
                            ) : null}
                            {!frame.cardCropImageUrl && !frame.ocrTopImageUrl && !frame.ocrBottomImageUrl ? (
                              <div className="frame-debug-placeholder">No OCR crops saved for this frame.</div>
                            ) : null}
                          </div>
                        </div>

                        <div className="frame-debug-column">
                          <strong>Matched reference</strong>
                          {frame.referenceImageUrl ? (
                            <img
                              alt={frame.referenceImageLabel || "Matched catalog reference"}
                              className="frame-debug-image"
                              src={frame.referenceImageUrl}
                            />
                          ) : (
                            <div className="frame-debug-placeholder">No catalog reference image available.</div>
                          )}
                        </div>

                        <div className="frame-debug-meta">
                          <div className="table-title">
                            {frame.matchedCardName
                              ? `${frame.matchedCardName} · ${frame.matchedCardNumber}`
                              : "No saved detection"}
                          </div>
                          <div className="table-subtitle">
                            {frame.matchedSetName
                              ? `${frame.matchedSetName} · ${frame.matchedRarity || "Unknown rarity"}`
                              : "This frame has not been linked to a catalog candidate."}
                          </div>
                          {typeof frame.confidence === "number" ? (
                            <div className="table-subtitle">
                              Confidence {Math.round(frame.confidence * 100)}% ·{" "}
                              {frame.status === "matched"
                                ? "Matched"
                                : frame.status === "needs_review"
                                  ? "Needs review"
                                  : "Rejected"}
                            </div>
                          ) : null}
                          {frame.notes ? <div className="table-subtitle">{frame.notes}</div> : null}
                          {frame.resolvedByReview ? (
                            <div className="table-subtitle">Resolved by seller review.</div>
                          ) : null}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="section">
        <div className="section-header">
          <div>
            <div className="section-badge">Detections</div>
            <h2>Detected cards</h2>
          </div>
          <p>
            Each detection should eventually map to a stable inventory row,
            confidence score, and review state.
          </p>
        </div>

        <div className="card-grid two-up">
          {batch.detections.map((detection) => (
            <article className="card" key={`${detection.id}-overrides`}>
              <h3>{detection.frameLabel}</h3>
              <p>
                {detection.cardName} · {detection.setName} · {detection.cardNumber}
              </p>
              <form action={saveDetectionOverridesAction} className="form-shell compact-form">
                <input name="batchId" type="hidden" value={batch.id} />
                <input name="detectionId" type="hidden" value={detection.id} />

                <div className="form-grid">
                  <label className="field">
                    <span>Custom title</span>
                    <input defaultValue={detection.titleOverride} name="titleOverride" />
                  </label>

                  <label className="field">
                    <span>Price override</span>
                    <input defaultValue={detection.priceOverride} name="priceOverride" />
                  </label>

                  <label className="field">
                    <span>Quantity</span>
                    <input defaultValue={detection.quantityOverride ?? "1"} name="quantityOverride" />
                  </label>

                  <label className="field">
                    <span>Condition override</span>
                    <select
                      defaultValue={
                        detection.conditionOverride || batch.listingSettings.cardConditionDescriptor
                      }
                      name="conditionOverride"
                    >
                      <option value="">Use batch default</option>
                      <option value="400010">Near Mint or Better</option>
                      <option value="400015">Lightly Played (Excellent)</option>
                      <option value="400016">Moderately Played (Very Good)</option>
                      <option value="400017">Heavily Played (Poor)</option>
                    </select>
                  </label>
                </div>

                <label className="checkbox-field">
                  <input
                    defaultChecked={detection.excludeFromExport}
                    name="excludeFromExport"
                    type="checkbox"
                  />
                  <span>Exclude this card from export</span>
                </label>

                <div className="hero-actions">
                  <button className="button-secondary" type="submit">
                    Save card overrides
                  </button>
                </div>
              </form>
            </article>
          ))}
        </div>

        <div className="table-shell">
          <table className="data-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Suggested match</th>
                <th>Set</th>
                <th>No.</th>
                <th>Rarity</th>
                <th>Confidence</th>
                <th>Status</th>
                <th>Export</th>
              </tr>
            </thead>
            <tbody>
              {batch.detections.map((detection) => (
                <tr key={detection.id}>
                  <td>{detection.frameLabel}</td>
                  <td>
                    <div className="table-title">{detection.cardName}</div>
                    {detection.notes ? (
                      <div className="table-subtitle">{detection.notes}</div>
                    ) : null}
                    {detection.resolvedByReview ? (
                      <div className="table-subtitle">Resolved manually by seller review.</div>
                    ) : null}
                  </td>
                  <td>{detection.setName}</td>
                  <td>{detection.cardNumber}</td>
                  <td>{detection.rarity}</td>
                  <td>{Math.round(detection.confidence * 100)}%</td>
                  <td>
                    <span className={`status-pill status-${detection.status}`}>
                      {detection.status === "matched"
                        ? "Matched"
                        : detection.status === "needs_review"
                          ? "Needs review"
                          : "Rejected"}
                    </span>
                  </td>
                  <td>{detection.excludeFromExport ? "Excluded" : "Included"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section" id="review-queue">
        <div className="section-header">
          <div>
            <div className="section-badge">Review Queue</div>
            <h2>Cards that still need human help</h2>
          </div>
          <p>
            This queue is the heart of the MVP. It should be fast, clear, and
            good enough that the seller only reviews exceptions instead of the
            entire batch.
          </p>
        </div>

        {batch.reviewQueue.length === 0 ? (
          <div className="panel">
            <h3>No open review items</h3>
            <p>
              This batch is clean enough to move into pricing and CSV export
              preparation.
            </p>
          </div>
        ) : (
          <div className="card-grid two-up">
            {batch.reviewQueue.map((item) => (
              <article className="card" key={item.id}>
                <h3>{item.frameLabel}</h3>
                <p>{item.reason}</p>
                <div className="review-layout">
                  {item.frameCropImageUrl ? (
                    <div className="review-source-card">
                      <div className="table-title">Video crop</div>
                      <img
                        alt={`${item.frameLabel} card crop`}
                        className="review-source-image"
                        src={item.frameCropImageUrl}
                      />
                    </div>
                  ) : null}
                  <div className="review-match-stack">
                  <div className="review-match-card">
                    {item.suggestedMatchImageUrl ? (
                      <img
                        alt={item.suggestedMatch}
                        className="review-match-image"
                        src={item.suggestedMatchImageUrl}
                      />
                    ) : null}
                    <div>
                      <div className="table-title">Suggested</div>
                      <div className="table-subtitle">{item.suggestedMatch}</div>
                    </div>
                  </div>
                  {item.alternateMatches.map((match) => (
                    <div className="review-match-card" key={match}>
                      {item.alternateMatchImageUrls?.[match] ? (
                        <img
                          alt={match}
                          className="review-match-image"
                          src={item.alternateMatchImageUrls[match]}
                        />
                      ) : null}
                      <div>
                        <div className="table-title">Alternate</div>
                        <div className="table-subtitle">{match}</div>
                      </div>
                    </div>
                  ))}
                  </div>
                </div>
                <form action={resolveReviewItemAction} className="form-shell compact-form">
                  <input name="batchId" type="hidden" value={batch.id} />
                  <input name="reviewItemId" type="hidden" value={item.id} />
                  <label className="field">
                    <span>Choose final match</span>
                    <select defaultValue={item.suggestedMatch} name="selectedMatch">
                      <option value={item.suggestedMatch}>{item.suggestedMatch}</option>
                      {item.alternateMatches.map((match) => (
                        <option key={match} value={match}>
                          {match}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="inline-actions">
                  <button className="button-primary" name="decision" type="submit" value="accept">
                    Accept selected match
                  </button>
                  <button className="button-secondary" name="decision" type="submit" value="dismiss">
                    Dismiss item
                  </button>
                  </div>
                </form>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-header">
          <div>
            <div className="section-badge">Listing Prep</div>
            <h2>What is currently ready for export</h2>
          </div>
          <p>
            This is the seller-facing checkpoint before generating the eBay CSV:
            matched cards in, unresolved or excluded cards out.
          </p>
        </div>

        <div className="hero-stat-grid">
          <div className="stat">
            <strong>{listingReadyDetections.length}</strong>
            <span>Matched cards currently included in export.</span>
          </div>
          <div className="stat">
            <strong>{blockedDetections.length}</strong>
            <span>Cards still blocked by review.</span>
          </div>
          <div className="stat">
            <strong>{excludedDetections.length}</strong>
            <span>Cards manually excluded from export.</span>
          </div>
        </div>

        {listingReadyDetections.length === 0 ? (
          <div className="panel">
            <h3>No export-ready cards yet</h3>
            <p>Resolve review items or re-include cards before generating the draft CSV.</p>
          </div>
        ) : (
          <div className="card-grid two-up">
            {listingReadyDetections.map((detection) => (
              <article className="card" key={`${detection.id}-listing-prep`}>
                <h3>{detection.titleOverride || detection.cardName}</h3>
                <p>
                  {detection.setName} · {detection.cardNumber} · Qty {detection.quantityOverride || "1"}
                </p>
                <ul className="list">
                  <li>Source: {detection.frameLabel}</li>
                  <li>
                    Match source: {detection.resolvedByReview ? "Manual review" : "Automatic recognition"}
                  </li>
                  <li>Price: {detection.priceOverride || "Auto-estimated at export"}</li>
                  <li>
                    Condition: {detection.conditionOverride || batch.listingSettings.cardConditionDescriptor}
                  </li>
                </ul>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-header">
          <div>
            <div className="section-badge">Export Preview</div>
            <h2>Final eBay draft rows before CSV generation</h2>
          </div>
          <p>
            This is the seller-friendly final check. It shows the effective title, pricing,
            condition, and source that will be written into the eBay CSV.
          </p>
        </div>

        <div className="hero-stat-grid">
          <div className="stat">
            <strong>{previewRows.length}</strong>
            <span>Rows currently going into the CSV draft.</span>
          </div>
          <div className="stat">
            <strong>{previewPriceOverrides}</strong>
            <span>Rows using manual price overrides instead of auto-estimated pricing.</span>
          </div>
          <div className="stat">
            <strong>{previewManualMatches}</strong>
            <span>Rows resolved by seller review instead of automatic recognition.</span>
          </div>
          <div className="stat">
            <strong>{previewConditionOverrides}</strong>
            <span>Rows using a card-level condition override.</span>
          </div>
        </div>

        {previewRows.length === 0 ? (
          <div className="panel">
            <h3>No preview rows yet</h3>
            <p>Resolve review items and keep at least one matched card included to unlock the final export preview.</p>
          </div>
        ) : (
          <div className="preview-stack">
            <div className="table-shell">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Final listing</th>
                    <th>Price</th>
                    <th>Qty</th>
                    <th>Condition</th>
                    <th>Match source</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row) => (
                    <tr key={`${row.detectionId}-preview`}>
                      <td>{row.sourceLabel}</td>
                      <td>
                        <div className="table-title">{row.title}</div>
                        <div className="table-subtitle">
                          {row.cardName} · {row.setName} · {row.cardNumber} · {row.rarity}
                        </div>
                        <div className="table-subtitle">
                          {row.hasTitleOverride ? "Manual title override" : "Default title builder"}
                        </div>
                      </td>
                      <td>
                        <div className="table-title">${row.price}</div>
                        <div className="table-subtitle">
                          {row.hasPriceOverride ? "Manual price override" : "Auto-estimated at export time"}
                        </div>
                      </td>
                      <td>{row.quantity}</td>
                      <td>
                        <div className="table-title">{row.conditionLabel}</div>
                        <div className="table-subtitle">{row.conditionDescriptor}</div>
                      </td>
                      <td>
                        <div className="table-title">
                          {row.matchSource === "manual_review" ? "Manual review" : "Automatic recognition"}
                        </div>
                        <div className="table-subtitle">
                          {row.hasConditionOverride
                            ? "Card-level condition override applied"
                            : "Batch default condition applied"}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="card-grid two-up">
              {previewRows.map((row) => (
                <article className="card" key={`${row.detectionId}-preview-detail`}>
                  <h3>{row.title}</h3>
                  <p>
                    {row.sourceLabel} · ${row.price} · Qty {row.quantity}
                  </p>
                  <div className="preview-detail">
                    <strong>PicURL</strong>
                    {row.imageUrl ? (
                      <a className="inline-link preview-link" href={row.imageUrl} target="_blank">
                        {row.imageUrl}
                      </a>
                    ) : (
                      <p>No image URL resolved for this row.</p>
                    )}
                  </div>
                  <div className="preview-detail">
                    <strong>Description</strong>
                    <pre className="preview-copy">{row.description}</pre>
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="section">
        <div className="panel">
          <h3>Next backend milestone</h3>
          <p>
            Replace this mock batch model with real tables for batches, uploads,
            detections, review items, and export runs. That will give us the
            right foundation for Pokemon catalog sync and media processing jobs.
          </p>
          {batch.exportReady ? (
            <form action={generateExportAction} className="hero-actions">
              <input name="batchId" type="hidden" value={batch.id} />
              <button className="button-primary" type="submit">
                Generate eBay draft CSV
              </button>
            </form>
          ) : null}
        </div>
      </section>

      <section className="section">
        <div className="section-header">
          <div>
            <div className="section-badge">Exports</div>
            <h2>Generated CSV files</h2>
          </div>
          <p>
            The current MVP export writes draft CSV files into the local project
            under `data/exports` and records each run in SQLite.
          </p>
        </div>

        {batch.exportRuns.length === 0 ? (
          <div className="panel">
            <h3>No exports yet</h3>
            <p>Generate the first eBay draft CSV once this batch is ready.</p>
          </div>
        ) : (
          <div className="card-grid two-up">
            {batch.exportRuns.map((run) => (
              <article className="card" key={run.id}>
                <h3>{run.format}</h3>
                <p>Created {run.createdAt}</p>
                <ul className="list">
                  <li>Status: {run.status}</li>
                  <li>File: {run.filePath ?? "n/a"}</li>
                </ul>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
