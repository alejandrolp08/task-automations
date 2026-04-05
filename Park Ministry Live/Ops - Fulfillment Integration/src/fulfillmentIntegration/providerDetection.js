function normalizeProviderKey(providerName) {
  const normalized = String(providerName || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

  if (!normalized) {
    return "unknown";
  }

  const aliases = {
    way: "way",
    "way.com": "way",
    spothero: "spothero",
    "spot hero": "spothero",
    premiumparking: "premiumparking",
    "premium parking": "premiumparking",
    bestparking: "bestparking",
    "best parking": "bestparking",
    parkobility: "parkobility",
    "park obility": "parkobility",
    clicknpark: "clicknpark",
    "click n park": "clicknpark",
    grs: "grs",
    "grs parking": "grs",
    grsparking: "grs",
    "rightway parking": "rightwayparking",
    rightwayparking: "rightwayparking",
    "fly louisville": "flylouisville",
    flylouisville: "flylouisville",
    "fargo airport": "fargoairport",
    fargoairport: "fargoairport",
    hersheypark: "hersheypark",
    "hershey park": "hersheypark",
    "sfa airport": "sfaairport",
    sfaairport: "sfaairport",
  };

  return aliases[normalized] || normalized.replace(/[^a-z0-9]+/g, "");
}

function inferProviderKeyFromReservationUrl(reservationUrl) {
  const raw = String(reservationUrl || "").trim();

  if (!raw) {
    return "unknown";
  }

  let hostname = "";
  let pathname = "";

  try {
    const parsed = new URL(raw);
    hostname = String(parsed.hostname || "").toLowerCase();
    pathname = String(parsed.pathname || "").toLowerCase();
  } catch {
    const normalized = raw.toLowerCase();

    if (normalized.includes("way.com/order-print")) {
      return "way";
    }
    if (normalized.includes("parkobility.com")) {
      return "parkobility";
    }
    if (normalized.includes("premiumparking.com")) {
      return "premiumparking";
    }
    if (normalized.includes("spothero.com")) {
      return "spothero";
    }
    if (normalized.includes("bestparking.com")) {
      return "bestparking";
    }
    if (normalized.includes("clicknpark.com")) {
      return "clicknpark";
    }
    if (normalized.includes("grsparking.com") || normalized.includes("grs.lazparking.com")) {
      return "grs";
    }
    if (normalized.includes("rightwayparking.com")) {
      return "rightwayparking";
    }
    if (normalized.includes("flylouisville.com")) {
      return "flylouisville";
    }

    return "unknown";
  }

  if (hostname.includes("way.com") && pathname.includes("/order-print/")) {
    return "way";
  }
  if (hostname.includes("parkobility.com")) {
    return "parkobility";
  }
  if (hostname.includes("premiumparking.com")) {
    return "premiumparking";
  }
  if (hostname.includes("spothero.com")) {
    return "spothero";
  }
  if (hostname.includes("bestparking.com")) {
    return "bestparking";
  }
  if (hostname.includes("clicknpark.com")) {
    return "clicknpark";
  }
  if (hostname.includes("grsparking.com") || hostname.includes("grs.lazparking.com")) {
    return "grs";
  }
  if (hostname.includes("rightwayparking.com")) {
    return "rightwayparking";
  }
  if (hostname.includes("flylouisville.com")) {
    return "flylouisville";
  }

  return "unknown";
}

function inferProviderKeyFromPdfText(pdfText) {
  const normalized = String(pdfText || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  if (!normalized) {
    return "unknown";
  }

  const patterns = [
    ["premiumparking", ["premium parking", "receipt at p", "property name"]],
    ["rightwayparking", ["rightway parking", "rightwayparking com"]],
    ["fargoairport", ["fargo airport"]],
    ["flylouisville", ["fly louisville", "your qr code for parking reservation"]],
    ["hersheypark", ["hersheypark", "hershey park"]],
    ["sfaairport", ["sfa airport"]],
    ["parkobility", ["parkobility"]],
    ["bestparking", ["bestparking", "best parking"]],
    ["clicknpark", ["clicknpark", "click n park"]],
    ["grs", ["grs parking", "grsparking", "reservationweb grs", "reservationwebv2"]],
    ["spothero", ["spot hero", "spothero"]],
    ["way", ["way com", "way parking"]],
  ];

  for (const [providerKey, tokens] of patterns) {
    if (tokens.some((token) => normalized.includes(token))) {
      return providerKey;
    }
  }

  return "unknown";
}

const PROVIDER_PROFILES = {
  premiumparking: {
    key: "premiumparking",
    allowMissingLocation: true,
    requiresReservationIdForAutoPass: true,
  },
  rightwayparking: {
    key: "rightwayparking",
    allowMissingLocation: true,
    requiresReservationIdForAutoPass: false,
  },
  fargoairport: {
    key: "fargoairport",
    allowMissingLocation: true,
    requiresReservationIdForAutoPass: true,
  },
  flylouisville: {
    key: "flylouisville",
    allowMissingLocation: true,
    requiresReservationIdForAutoPass: true,
  },
  hersheypark: {
    key: "hersheypark",
    allowMissingLocation: true,
    requiresReservationIdForAutoPass: true,
  },
  sfaairport: {
    key: "sfaairport",
    allowMissingLocation: true,
    requiresReservationIdForAutoPass: true,
  },
  parkobility: {
    key: "parkobility",
    allowMissingLocation: true,
    requiresReservationIdForAutoPass: true,
  },
  bestparking: {
    key: "bestparking",
    allowMissingLocation: true,
    requiresReservationIdForAutoPass: true,
  },
  clicknpark: {
    key: "clicknpark",
    allowMissingLocation: true,
    requiresReservationIdForAutoPass: true,
  },
  grs: {
    key: "grs",
    allowMissingLocation: true,
    requiresReservationIdForAutoPass: true,
  },
};

function resolveProviderProfile(record = {}, pdfText = "") {
  const configuredProvider = normalizeProviderKey(
    record.effective_provider ||
      record.provider_name ||
      record.provider ||
      record.inferred_provider,
  );
  const urlProvider = inferProviderKeyFromReservationUrl(record.reservation_url);
  const pdfProvider = inferProviderKeyFromPdfText(pdfText);
  const resolvedKey =
    configuredProvider !== "unknown"
      ? configuredProvider
      : urlProvider !== "unknown"
        ? urlProvider
        : pdfProvider;

  return {
    key: resolvedKey,
    source:
      configuredProvider !== "unknown"
        ? "record"
        : urlProvider !== "unknown"
          ? "reservation_url"
          : pdfProvider !== "unknown"
            ? "pdf_text"
            : "unknown",
    allowMissingLocation: Boolean(PROVIDER_PROFILES[resolvedKey]?.allowMissingLocation),
    requiresReservationIdForAutoPass: Boolean(
      PROVIDER_PROFILES[resolvedKey]?.requiresReservationIdForAutoPass,
    ),
  };
}

module.exports = {
  normalizeProviderKey,
  inferProviderKeyFromReservationUrl,
  inferProviderKeyFromPdfText,
  resolveProviderProfile,
};
