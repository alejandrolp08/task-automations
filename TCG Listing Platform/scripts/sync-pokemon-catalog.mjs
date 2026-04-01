import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const API_BASE_URL = "https://api.pokemontcg.io/v2";

function parseArgs(argv) {
  const options = {
    pageSize: 250,
    maxPages: null,
    startPage: 1,
    setsOnly: false,
    cardsOnly: false,
    query: "",
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    const nextValue = argv[index + 1];

    if (value === "--page-size" && nextValue) {
      options.pageSize = Math.max(1, Math.min(250, Number.parseInt(nextValue, 10) || 250));
      index += 1;
      continue;
    }

    if (value === "--max-pages" && nextValue) {
      options.maxPages = Math.max(1, Number.parseInt(nextValue, 10) || 1);
      index += 1;
      continue;
    }

    if (value === "--start-page" && nextValue) {
      options.startPage = Math.max(1, Number.parseInt(nextValue, 10) || 1);
      index += 1;
      continue;
    }

    if (value === "--query" && nextValue) {
      options.query = nextValue;
      index += 1;
      continue;
    }

    if (value === "--sets-only") {
      options.setsOnly = true;
      continue;
    }

    if (value === "--cards-only") {
      options.cardsOnly = true;
      continue;
    }

    if (value === "--dry-run") {
      options.dryRun = true;
    }
  }

  return options;
}

function parseSourceDate(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/\//g, "-").replace(" ", "T");
  const candidate = new Date(`${normalized}Z`);

  return Number.isNaN(candidate.getTime()) ? null : candidate;
}

function normalizeName(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

async function fetchApiJson(endpoint, apiKey) {
  let attempt = 0;

  while (attempt < 4) {
    attempt += 1;

    const response = await fetch(endpoint, {
      headers: apiKey
        ? {
            "X-Api-Key": apiKey,
          }
        : undefined,
    });

    if (response.ok) {
      return response.json();
    }

    const body = await response.text().catch(() => "");
    const shouldRetry = [429, 500, 502, 503, 504].includes(response.status);

    if (!shouldRetry || attempt >= 4) {
      throw new Error(`Pokemon TCG API request failed (${response.status}): ${body}`);
    }

    const waitMs = attempt * 2000;
    console.warn(`Pokemon TCG API transient error ${response.status}. Retrying in ${waitMs}ms...`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  throw new Error("Pokemon TCG API request failed after retries.");
}

async function syncSets(apiKey, dryRun) {
  const endpoint = `${API_BASE_URL}/sets?page=1&pageSize=250&orderBy=releaseDate`;
  const payload = await fetchApiJson(endpoint, apiKey);
  const sets = Array.isArray(payload.data) ? payload.data : [];

  if (dryRun) {
    console.log(`Dry run: would sync ${sets.length} sets.`);
    return { count: sets.length };
  }

  for (const set of sets) {
    await prisma.catalogSet.upsert({
      where: {
        externalSetId: set.id,
      },
      create: {
        externalSource: "pokemon_tcg_api",
        externalSetId: set.id,
        name: set.name,
        code: set.ptcgoCode ?? null,
        series: set.series ?? null,
        printedTotal: typeof set.printedTotal === "number" ? set.printedTotal : null,
        total: typeof set.total === "number" ? set.total : null,
        ptcgoCode: set.ptcgoCode ?? null,
        releaseDate: set.releaseDate ?? null,
        updatedAtSource: parseSourceDate(set.updatedAt),
        syncedAt: new Date(),
      },
      update: {
        name: set.name,
        code: set.ptcgoCode ?? null,
        series: set.series ?? null,
        printedTotal: typeof set.printedTotal === "number" ? set.printedTotal : null,
        total: typeof set.total === "number" ? set.total : null,
        ptcgoCode: set.ptcgoCode ?? null,
        releaseDate: set.releaseDate ?? null,
        updatedAtSource: parseSourceDate(set.updatedAt),
        syncedAt: new Date(),
      },
    });
  }

  console.log(`Synced ${sets.length} sets.`);
  return { count: sets.length };
}

async function syncCards({ apiKey, pageSize, maxPages, startPage, query, dryRun }) {
  let page = startPage ?? 1;
  let totalSynced = 0;
  let totalPages = 1;

  do {
    const searchParams = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      orderBy: "set.releaseDate,number,name",
    });

    if (query) {
      searchParams.set("q", query);
    }

    const endpoint = `${API_BASE_URL}/cards?${searchParams.toString()}`;
    const payload = await fetchApiJson(endpoint, apiKey);
    const cards = Array.isArray(payload.data) ? payload.data : [];
    totalPages = Number(payload.totalCount && payload.pageSize ? Math.ceil(payload.totalCount / payload.pageSize) : page);

    if (dryRun) {
      console.log(`Dry run: page ${page} would sync ${cards.length} cards.`);
      totalSynced += cards.length;
      page += 1;
      continue;
    }

    for (const card of cards) {
      let setId = null;

      if (card.set?.id) {
        const setRecord = await prisma.catalogSet.upsert({
          where: {
            externalSetId: card.set.id,
          },
          create: {
            externalSource: "pokemon_tcg_api",
            externalSetId: card.set.id,
            name: card.set.name,
            code: card.set.ptcgoCode ?? null,
            series: card.set.series ?? null,
            printedTotal: typeof card.set.printedTotal === "number" ? card.set.printedTotal : null,
            total: typeof card.set.total === "number" ? card.set.total : null,
            ptcgoCode: card.set.ptcgoCode ?? null,
            releaseDate: card.set.releaseDate ?? null,
            updatedAtSource: parseSourceDate(card.set.updatedAt),
            syncedAt: new Date(),
          },
          update: {
            name: card.set.name,
            code: card.set.ptcgoCode ?? null,
            series: card.set.series ?? null,
            printedTotal: typeof card.set.printedTotal === "number" ? card.set.printedTotal : null,
            total: typeof card.set.total === "number" ? card.set.total : null,
            ptcgoCode: card.set.ptcgoCode ?? null,
            releaseDate: card.set.releaseDate ?? null,
            updatedAtSource: parseSourceDate(card.set.updatedAt),
            syncedAt: new Date(),
          },
          select: {
            id: true,
          },
        });

        setId = setRecord.id;
      }

      await prisma.catalogCard.upsert({
        where: {
          externalCardId: card.id,
        },
        create: {
          setId,
          externalSource: "pokemon_tcg_api",
          externalCardId: card.id,
          name: card.name,
          normalizedName: normalizeName(card.name),
          setName: card.set?.name ?? "Unknown Set",
          setCode: card.set?.ptcgoCode ?? null,
          cardNumber: card.number ?? "",
          rarity: card.rarity ?? null,
          supertype: card.supertype ?? null,
          subtypes: Array.isArray(card.subtypes) ? card.subtypes.join("||") : null,
          imageSmallUrl: card.images?.small ?? null,
          imageLargeUrl: card.images?.large ?? null,
          imageHashFull: null,
          imageHashCandidates: null,
          rawSourceJson: JSON.stringify(card),
          updatedAtSource: parseSourceDate(card.updatedAt),
          syncedAt: new Date(),
        },
        update: {
          setId,
          name: card.name,
          normalizedName: normalizeName(card.name),
          setName: card.set?.name ?? "Unknown Set",
          setCode: card.set?.ptcgoCode ?? null,
          cardNumber: card.number ?? "",
          rarity: card.rarity ?? null,
          supertype: card.supertype ?? null,
          subtypes: Array.isArray(card.subtypes) ? card.subtypes.join("||") : null,
          imageSmallUrl: card.images?.small ?? null,
          imageLargeUrl: card.images?.large ?? null,
          rawSourceJson: JSON.stringify(card),
          updatedAtSource: parseSourceDate(card.updatedAt),
          syncedAt: new Date(),
        },
      });
    }

    totalSynced += cards.length;
    console.log(`Synced page ${page}: ${cards.length} cards (total ${totalSynced}).`);
    page += 1;
  } while ((maxPages === null || page <= maxPages) && page <= totalPages);

  return { count: totalSynced };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const apiKey = process.env.POKEMON_TCG_API_KEY || "";

  if (!options.cardsOnly) {
    await syncSets(apiKey, options.dryRun);
  }

  if (!options.setsOnly) {
    await syncCards({
      apiKey,
      pageSize: options.pageSize,
      maxPages: options.maxPages,
      startPage: options.startPage,
      query: options.query,
      dryRun: options.dryRun,
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
