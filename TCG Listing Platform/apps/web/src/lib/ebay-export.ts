import path from "node:path";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import crypto from "node:crypto";
import type { BatchListingSettings, EbayPreviewRow } from "./types";
import { getBatchDetail } from "./batch-repository";
import { createExportRun, getExportableBatchRows } from "./sqlite-repository";
import { resolveProjectRoot } from "./project-paths";

const EBAY_POKEMON_CATEGORY_ID = "183454";
const EBAY_TRADING_CARD_CONDITION_ID = "4000";
const EBAY_CARD_CONDITION_LABELS: Record<string, string> = {
  "400010": "Near Mint or Better",
  "400015": "Lightly Played (Excellent)",
  "400016": "Moderately Played (Very Good)",
  "400017": "Heavily Played (Poor)",
};
const EBAY_GAME_VALUE = "Pokemon TCG";
const DEFAULT_SHIPPING_OPTION = "CA_ExpeditedParcel";
const TEMPLATE_DOWNLOAD_PATH =
  "/Users/alejandroleiva/Downloads/eBay-category-listing-template-Mar-25-2026-14-54-7.csv";
const FALLBACK_INFO_ROW = [
  "Info",
  "Version=1.0.0",
  "Template=fx_category_template_EBAY_ENCA",
];
const FALLBACK_HEADER_ROW = [
  "*Action(SiteID=Canada|Country=CA|Currency=CAD|Version=1193|CC=UTF-8)",
  "CustomLabel",
  "*Category",
  "StoreCategory",
  "*Title",
  "Subtitle",
  "Relationship",
  "RelationshipDetails",
  "ScheduleTime",
  "*ConditionID",
  "CD:Professional Grader - (ID: 27501)",
  "CD:Grade - (ID: 27502)",
  "CDA:Certification Number - (ID: 27503)",
  "CD:Card Condition - (ID: 40001)",
  "*C:Game",
  "C:Card Name",
  "C:Character",
  "C:Grade",
  "C:Card Type",
  "C:Age Level",
  "C:Speciality",
  "C:Set",
  "C:Rarity",
  "C:Features",
  "C:Manufacturer",
  "C:Finish",
  "C:Attribute/MTG:Color",
  "C:Creature/Monster Type",
  "C:Autographed",
  "C:Card Number",
  "C:Language",
  "C:Stage",
  "C:Card Size",
  "C:Year Manufactured",
  "C:Graded",
  "C:Professional Grader",
  "C:Card Condition",
  "C:Vintage",
  "C:Material",
  "C:Country of Origin",
  "C:Signed By",
  "C:Convention/Event",
  "C:Franchise",
  "C:Autograph Format",
  "C:Autograph Authentication",
  "C:Certification Number",
  "C:Illustrator",
  "C:HP",
  "C:Attack/Power",
  "C:Defense/Toughness",
  "C:Cost",
  "C:Autograph Authentication Number",
  "C:Customized",
  "PicURL",
  "GalleryType",
  "VideoID",
  "*Description",
  "*Format",
  "*Duration",
  "*StartPrice",
  "BuyItNowPrice",
  "BestOfferEnabled",
  "BestOfferAutoAcceptPrice",
  "MinimumBestOfferPrice",
  "*Quantity",
  "ImmediatePayRequired",
  "*Location",
  "ShippingType",
  "ShippingService-1:Option",
  "ShippingService-1:Cost",
  "ShippingService-2:Option",
  "ShippingService-2:Cost",
  "*DispatchTimeMax",
  "PromotionalShippingDiscount",
  "ShippingDiscountProfileID",
  "DomesticRateTable",
  "*ReturnsAcceptedOption",
  "ReturnsWithinOption",
  "RefundOption",
  "ShippingCostPaidByOption",
  "AdditionalDetails",
  "ShippingProfileName",
  "ReturnProfileName",
  "PaymentProfileName",
  "ProductCompliancePolicyID",
  "Regional ProductCompliancePolicies",
  "Product Safety Pictograms",
  "Product Safety Statements",
  "Product Safety Component",
  "Regulatory Document Ids",
  "Manufacturer Name",
  "Manufacturer AddressLine1",
  "Manufacturer AddressLine2",
  "Manufacturer City",
  "Manufacturer Country",
  "Manufacturer PostalCode",
  "Manufacturer StateOrProvince",
  "Manufacturer Phone",
  "Manufacturer Email",
  "Manufacturer ContactURL",
  "Responsible Person 1",
  "Responsible Person 1 Type",
  "Responsible Person 1 AddressLine1",
  "Responsible Person 1 AddressLine2",
  "Responsible Person 1 City",
  "Responsible Person 1 Country",
  "Responsible Person 1 PostalCode",
  "Responsible Person 1 StateOrProvince",
  "Responsible Person 1 Phone",
  "Responsible Person 1 Email",
  "Responsible Person 1 ContactURL",
];

type TemplateShape = {
  infoRow: string[];
  headers: string[];
};

function escapeCsvValue(value: string) {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return value;
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const nextCharacter = line[index + 1];

    if (character === '"') {
      if (inQuotes && nextCharacter === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (character === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  values.push(current.replace(/\r$/, ""));
  return values;
}

async function loadTemplateShape(): Promise<TemplateShape> {
  if (!fsSync.existsSync(TEMPLATE_DOWNLOAD_PATH)) {
    return {
      infoRow: FALLBACK_INFO_ROW,
      headers: FALLBACK_HEADER_ROW,
    };
  }

  const template = await fs.readFile(TEMPLATE_DOWNLOAD_PATH, "utf8");
  const lines = template.split("\n").slice(0, 2).map((line) => line.replace(/^\uFEFF/, ""));

  if (lines.length < 2) {
    return {
      infoRow: FALLBACK_INFO_ROW,
      headers: FALLBACK_HEADER_ROW,
    };
  }

  return {
    infoRow: parseCsvLine(lines[0]),
    headers: parseCsvLine(lines[1]),
  };
}

function buildImageUrl(row: Awaited<ReturnType<typeof getExportableBatchRows>>[number]) {
  if (row.imageLargeUrl) {
    return row.imageLargeUrl;
  }

  if (row.imageSmallUrl) {
    return row.imageSmallUrl;
  }

  if (row.externalSetId && row.cardNumber) {
    const collectorNumber = row.cardNumber.split("/")[0];
    return `https://images.pokemontcg.io/${row.externalSetId}/${collectorNumber}_hires.png`;
  }

  return "";
}

function estimatePrice(rarity: string | null) {
  switch (rarity) {
    case "Special Illustration Rare":
      return "24.99";
    case "Shiny Rare":
      return "6.99";
    case "Double Rare":
      return "4.99";
    case "Uncommon":
      return "0.99";
    default:
      return "1.49";
  }
}

function buildTitle(row: Awaited<ReturnType<typeof getExportableBatchRows>>[number]) {
  if (row.titleOverride) {
    return row.titleOverride.slice(0, 80);
  }

  const pieces = [
    row.cardName ?? "Pokemon Card",
    row.cardNumber ?? "",
    row.setName ?? "",
    "Pokemon TCG",
    row.rarity ?? "",
  ].filter(Boolean);

  return pieces.join(" ").slice(0, 80);
}

function buildDescription(row: Awaited<ReturnType<typeof getExportableBatchRows>>[number]) {
  const lines = [
    `${row.cardName ?? "Pokemon Card"} from ${row.setName ?? "unknown set"}.`,
    `Card number: ${row.cardNumber ?? "n/a"}.`,
    `Rarity: ${row.rarity ?? "n/a"}.`,
    "",
    "Generated by TCG Listing Platform draft export.",
    "Review title, pricing, condition descriptors, and listing details before publishing in eBay.",
  ];

  return lines.join("\n");
}

function fillTemplate(template: string, row: Awaited<ReturnType<typeof getExportableBatchRows>>[number]) {
  return template
    .replaceAll("{card_name}", row.cardName ?? "Pokemon Card")
    .replaceAll("{set_name}", row.setName ?? "unknown set")
    .replaceAll("{card_number}", row.cardNumber ?? "n/a")
    .replaceAll("{rarity}", row.rarity ?? "n/a");
}

function buildPreviewRow(
  row: Awaited<ReturnType<typeof getExportableBatchRows>>[number],
  listingSettings: BatchListingSettings,
): EbayPreviewRow {
  const conditionDescriptor = row.conditionOverride || listingSettings.cardConditionDescriptor;

  return {
    detectionId: row.detectionId,
    sourceLabel: row.sourceLabel,
    title: buildTitle(row),
    cardName: row.cardName ?? "Pokemon Card",
    setName: row.setName ?? "Unknown set",
    cardNumber: row.cardNumber ?? "n/a",
    rarity: row.rarity ?? "n/a",
    price: row.priceOverride || estimatePrice(row.rarity),
    quantity: String(row.quantityOverride ?? 1),
    conditionDescriptor,
    conditionLabel: EBAY_CARD_CONDITION_LABELS[conditionDescriptor] ?? "Near Mint or Better",
    imageUrl: buildImageUrl(row),
    description: fillTemplate(listingSettings.descriptionTemplate, row) || buildDescription(row),
    matchSource: "automatic_recognition",
    hasTitleOverride: Boolean(row.titleOverride),
    hasPriceOverride: Boolean(row.priceOverride),
    hasConditionOverride: Boolean(row.conditionOverride),
  };
}

export async function getEbayPreviewRows(batchId: string): Promise<EbayPreviewRow[]> {
  const batch = await getBatchDetail(batchId);

  if (!batch) {
    throw new Error("Batch not found.");
  }

  const rows = await getExportableBatchRows(batchId);

  return rows.map((row) => {
    const detection = batch.detections.find((item) => item.id === row.detectionId);
    const previewRow = buildPreviewRow(row, batch.listingSettings);

    return {
      ...previewRow,
      matchSource: detection?.resolvedByReview ? "manual_review" : "automatic_recognition",
    };
  });
}

function buildTemplateRow(
  headers: string[],
  row: Awaited<ReturnType<typeof getExportableBatchRows>>[number],
  batchId: string,
  index: number,
  listingSettings: BatchListingSettings,
) {
  const values = Object.fromEntries(headers.map((header) => [header, ""]));

  values["*Action(SiteID=Canada|Country=CA|Currency=CAD|Version=1193|CC=UTF-8)"] = "Add";
  values["CustomLabel"] = `${batchId}-${String(index + 1).padStart(3, "0")}`;
  values["*Category"] = EBAY_POKEMON_CATEGORY_ID;
  values["*Title"] = buildTitle(row);
  values["*ConditionID"] = EBAY_TRADING_CARD_CONDITION_ID;
  values["CD:Card Condition - (ID: 40001)"] =
    row.conditionOverride || listingSettings.cardConditionDescriptor;
  values["*C:Game"] = EBAY_GAME_VALUE;
  values["C:Card Name"] = row.cardName ?? "";
  values["C:Set"] = row.setName ?? "";
  values["C:Rarity"] = row.rarity ?? "";
  values["C:Card Number"] = row.cardNumber ?? "";
  values["C:Language"] = "English";
  values["C:Graded"] = "No";
  values["C:Card Condition"] =
    EBAY_CARD_CONDITION_LABELS[row.conditionOverride || listingSettings.cardConditionDescriptor] ??
    "Near Mint or Better";
  values["PicURL"] = buildImageUrl(row);
  values["*Description"] = fillTemplate(listingSettings.descriptionTemplate, row) || buildDescription(row);
  values["*Format"] = "FixedPrice";
  values["*Duration"] = "GTC";
  values["*StartPrice"] = row.priceOverride || estimatePrice(row.rarity);
  values["*Quantity"] = String(row.quantityOverride ?? 1);
  values["*Location"] = listingSettings.location;
  values["ShippingType"] = listingSettings.shippingType;
  values["ShippingService-1:Option"] = DEFAULT_SHIPPING_OPTION;
  values["ShippingService-1:Cost"] =
    listingSettings.shippingType === "Free" ? "0.00" : listingSettings.shippingCost;
  values["*DispatchTimeMax"] = listingSettings.dispatchTimeMax;
  values["*ReturnsAcceptedOption"] = listingSettings.returnsAcceptedOption;
  values["ReturnsWithinOption"] =
    listingSettings.returnsAcceptedOption === "ReturnsAccepted"
      ? listingSettings.returnsWithinOption
      : "";
  values["RefundOption"] =
    listingSettings.returnsAcceptedOption === "ReturnsAccepted" ? listingSettings.refundOption : "";
  values["ShippingCostPaidByOption"] =
    listingSettings.returnsAcceptedOption === "ReturnsAccepted"
      ? listingSettings.shippingCostPaidByOption
      : "";

  return headers.map((header) => values[header] ?? "");
}

export async function generateEbayDraftCsv(batchId: string) {
  const projectRoot = resolveProjectRoot();
  const template = await loadTemplateShape();
  const batch = await getBatchDetail(batchId);
  const rows = await getExportableBatchRows(batchId);

  if (!batch) {
    throw new Error("Batch not found.");
  }

  if (rows.length === 0) {
    throw new Error("Batch has no detections to export.");
  }

  const csvRows = rows.map((row, index) =>
    buildTemplateRow(template.headers, row, batchId, index, batch.listingSettings),
  );

  const csv = [template.infoRow, template.headers, ...csvRows]
    .map((row) => row.map((value) => escapeCsvValue(String(value))).join(","))
    .join("\n");

  const exportDirectory = path.join(projectRoot, "data", "exports");
  await fs.mkdir(exportDirectory, { recursive: true });

  const fileName = `${batchId}-ebay-draft-${crypto.randomUUID()}.csv`;
  const absoluteFilePath = path.join(exportDirectory, fileName);
  await fs.writeFile(absoluteFilePath, csv, "utf8");

  await createExportRun(batchId, "ebay_draft_csv", "generated", path.join("data", "exports", fileName));

  return {
    fileName,
    absoluteFilePath,
    csv,
    rowCount: rows.length,
  };
}
