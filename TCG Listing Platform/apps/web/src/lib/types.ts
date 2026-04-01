export type IntakeMode = "video" | "images";
export type BatchStatus = "draft" | "processing" | "review" | "ready" | "exported";
export type UploadStatus = "uploaded" | "processing" | "complete" | "failed";
export type DetectionStatus = "matched" | "needs_review" | "rejected";

export type BatchListingSettings = {
  location: string;
  shippingType: "Flat" | "Free";
  shippingCost: string;
  returnsAcceptedOption: "ReturnsAccepted" | "ReturnsNotAccepted";
  returnsWithinOption: string;
  refundOption: string;
  shippingCostPaidByOption: "Buyer" | "Seller";
  dispatchTimeMax: string;
  cardConditionDescriptor: string;
  descriptionTemplate: string;
};

export type BatchSummary = {
  id: string;
  name: string;
  sellerLabel: string;
  game: "Pokemon";
  intakeMode: IntakeMode;
  status: BatchStatus;
  itemCount: number;
  reviewCount: number;
  exportReady: boolean;
  updatedAt: string;
};

export type UploadRecord = {
  id: string;
  fileName: string;
  type: IntakeMode;
  status: UploadStatus;
  durationLabel?: string;
  imageCount?: number;
  uploadedAt: string;
};

export type DetectionRecord = {
  id: string;
  frameLabel: string;
  cardName: string;
  setName: string;
  cardNumber: string;
  rarity: string;
  confidence: number;
  status: DetectionStatus;
  notes?: string;
  titleOverride?: string;
  priceOverride?: string;
  quantityOverride?: string;
  conditionOverride?: string;
  excludeFromExport: boolean;
  resolvedByReview: boolean;
};

export type ReviewItem = {
  id: string;
  frameLabel: string;
  frameImageUrl?: string;
  frameCropImageUrl?: string;
  suggestedMatch: string;
  suggestedMatchImageUrl?: string;
  alternateMatches: string[];
  alternateMatchImageUrls?: Record<string, string>;
  reason: string;
};

export type ExportRecord = {
  id: string;
  format: string;
  status: string;
  filePath?: string;
  createdAt: string;
};

export type EbayPreviewRow = {
  detectionId: string;
  sourceLabel: string;
  title: string;
  cardName: string;
  setName: string;
  cardNumber: string;
  rarity: string;
  price: string;
  quantity: string;
  conditionDescriptor: string;
  conditionLabel: string;
  imageUrl: string;
  description: string;
  matchSource: "manual_review" | "automatic_recognition";
  hasTitleOverride: boolean;
  hasPriceOverride: boolean;
  hasConditionOverride: boolean;
};

export type VideoDebugFrame = {
  frameLabel: string;
  frameImageUrl: string;
  cardCropImageUrl?: string;
  ocrTopImageUrl?: string;
  ocrBottomImageUrl?: string;
  matchedCardName?: string;
  matchedSetName?: string;
  matchedCardNumber?: string;
  matchedRarity?: string;
  confidence?: number;
  status?: DetectionStatus;
  notes?: string;
  referenceImageUrl?: string;
  referenceImageLabel?: string;
  resolvedByReview: boolean;
};

export type VideoDebugUpload = {
  uploadId: string;
  fileName: string;
  uploadedAt: string;
  durationLabel?: string;
  frameCount: number;
  matchedFrameCount: number;
  frames: VideoDebugFrame[];
};

export type BatchDetail = BatchSummary & {
  listingSettings: BatchListingSettings;
  uploads: UploadRecord[];
  detections: DetectionRecord[];
  reviewQueue: ReviewItem[];
  exportRuns: ExportRecord[];
};
