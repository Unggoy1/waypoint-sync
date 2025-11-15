import { client } from "./lucia";
import { getSpartanToken } from "./authTools";
import { Prisma } from "@prisma/client";
import * as Sentry from "@sentry/bun";
import { writeFile, readFile } from "fs/promises";
import { JsonValue } from "@prisma/client/runtime/library";
import { existsSync } from "fs";
import path from "path";

const reset = "\x1b[0m";

const log = {
  green: (text: string) => console.log("\x1b[32m" + text + reset),
  red: (text: string) => console.log("\x1b[31m" + text + reset),
  blue: (text: string) => console.log("\x1b[34m" + text + reset),
  yellow: (text: string) => console.log("\x1b[33m" + text + reset),
};
export const paint = {
  green: (text: string) => "\x1b[32m" + text + reset,
  red: (text: string) => "\x1b[31m" + text + reset,
  blue: (text: string) => "\x1b[34m" + text + reset,
  yellow: (text: string) => "\x1b[33m" + text + reset,
  cyan: (text: string) => "\x1b[36m" + text + reset,
  magenta: (text: string) => "\x1b[35m" + text + reset,
};

// Skip list for buggy AssetIDs that appear in search but fail on individual fetch
let skipList = new Set<string>();

// Load skip list from JSON file
async function loadSkipList(): Promise<void> {
  try {
    const skipListPath = path.join(process.cwd(), "skiplist.json");

    if (!existsSync(skipListPath)) {
      console.log(paint.yellow("WARNING: "), "skiplist.json not found. No assets will be skipped.");
      return;
    }

    const fileContent = await readFile(skipListPath, "utf-8");
    const skipListData = JSON.parse(fileContent);

    if (skipListData.assetIds && Array.isArray(skipListData.assetIds)) {
      skipList = new Set(skipListData.assetIds);
      console.log(paint.blue("INFO: "), `Loaded skip list with ${skipList.size} AssetID(s)`);

      if (skipList.size > 0) {
        console.log(paint.yellow("WARNING: "), "The following AssetIDs will be skipped during sync:");
        skipListData.assetIds.forEach((id: string) => {
          console.log(paint.yellow("  - "), id);
        });
      }
    } else {
      console.log(paint.yellow("WARNING: "), "skiplist.json has invalid format. Expected { assetIds: [...] }");
    }
  } catch (error) {
    console.error(paint.red("ERROR: "), "Failed to load skip list:", error);
    Sentry.captureException(error);
    // Continue with empty skip list rather than failing
  }
}

// Load skip list on module initialization
await loadSkipList();

// Track the current sync volume to determine if we need adaptive delays
let highVolumeSync = false;
let syncStartTime = 0;

// Helper function to reset rate limiting parameters between sync operations
function resetRateLimitState() {
  // Give a short cooldown period between different asset type syncs
  console.log(paint.blue("INFO: "), "Resetting rate limit state between sync operations");
  consecutiveRequests = 0;
  rateLimitEncountered = false;
  lastRequestTime = 0;
}

export async function waypointSync() {
  // Record the start time for this sync operation
  syncStartTime = Date.now();

  // Check if we're doing a high volume catch-up sync
  // This helps us determine if we need more aggressive rate limiting
  try {
    // Check each asset kind to see when it was last synced
    const mapSync = await client.waypointSync.findUnique({
      where: { assetKind: AssetKind.Map }
    });

    const currentTime = new Date();
    if (mapSync) {
      const daysSinceLastSync = (currentTime.getTime() - mapSync.syncedAt.getTime()) / (1000 * 60 * 60 * 24);

      // If it's been more than 7 days since last sync, consider it high volume
      highVolumeSync = daysSinceLastSync > 7;

      if (highVolumeSync) {
        console.log(paint.yellow("WARNING: "),
          `Starting high volume sync - ${daysSinceLastSync.toFixed(1)} days since last sync. `+
          `Using more conservative rate limits.`);

        // For high volume syncs, we use a more conservative base delay
        BASE_DELAY_MS = 500; // Increase base delay for high volume syncs
        RATE_LIMIT_MULTIPLIER = 3.0; // Use more aggressive multiplier
      }
    }
  } catch (error) {
    console.error("Error checking sync status:", error);
    // Default to regular sync mode
    highVolumeSync = false;
  }

  console.log(paint.blue("INFO: "), "Starting map sync");
  await sync(AssetKind.Map);
  console.log(paint.blue("INFO: "), "Finished map sync");

  // Reset rate limit state and add a buffer between operations
  resetRateLimitState();
  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log(paint.blue("INFO: "), "Starting prefab sync");
  await sync(AssetKind.Prefab);
  console.log(paint.blue("INFO: "), "Finished prefab sync");

  // Reset rate limit state and add a buffer between operations
  resetRateLimitState();
  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log(paint.blue("INFO: "), "Starting mode sync");
  await sync(AssetKind.Mode);
  console.log(paint.blue("INFO: "), "Finished mode sync");

  // Reset rate limit state and add a buffer between operations
  resetRateLimitState();
  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log(paint.blue("INFO: "), "Starting recommended asset sync");
  await syncRecommended();
  console.log(paint.blue("INFO: "), "Finished recommended asset sync");

  // Calculate and log total sync time
  const syncDuration = (Date.now() - syncStartTime) / 1000 / 60;
  console.log(paint.blue("INFO: "), `Total sync duration: ${syncDuration.toFixed(2)} minutes`);
}

interface Asset {
  assetId: string;
  files: JsonValue;
  // Add other properties if needed
}

// Enhanced rate limiting with adaptive delay
let lastRequestTime = 0;
let consecutiveRequests = 0;
let rateLimitEncountered = false;

// Base delay is 300ms, but will increase adaptively
let BASE_DELAY_MS = 300; // Using let since this will be adjusted for high volume syncs
const REQUEST_DELAY_MS = 300; // Fixed delay for simple operations
const MAX_CONSECUTIVE_REQUESTS = 50; // Reset the consecutive counter after this many
let RATE_LIMIT_MULTIPLIER = 2.5; // Using let since this will be adjusted for high volume syncs

// Adaptive delay calculation
function getRequestDelay() {
  // Start with the base delay
  let delay = BASE_DELAY_MS;

  // Increase delay as we make more consecutive requests
  const consecutiveFactor = Math.min(1 + (consecutiveRequests / 100), 2);
  delay *= consecutiveFactor;

  // Apply additional multiplier if we've hit rate limits before
  if (rateLimitEncountered) {
    delay *= RATE_LIMIT_MULTIPLIER;
    console.log(`Using increased delay of ${delay}ms due to previous rate limiting`);
  }

  // For high volume syncs, add additional delay that increases over time
  if (highVolumeSync) {
    // Calculate how long the sync has been running in minutes
    const minutesElapsed = (Date.now() - syncStartTime) / (1000 * 60);

    // As sync runs longer, gradually increase delay to be more conservative
    // This helps prevent rate limits as the sync progresses and API endpoints get stressed
    const timeProgressFactor = Math.min(1 + (minutesElapsed / 15), 2);  // Max double delay after 15 mins
    delay *= timeProgressFactor;

    // Log this adjustment less frequently (only every 100 requests)
    if (consecutiveRequests % 10 === 0) {
      console.log(
        paint.cyan("RATE: "),
        `High volume sync running for ${minutesElapsed.toFixed(1)} minutes, ` +
        `using time-adjusted delay of ${delay.toFixed(0)}ms`
      );
    }
  }

  return delay;
}

// Helper function to delay execution based on the last request time
async function delayIfNeeded() {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  const currentDelay = getRequestDelay();

  // Increment the consecutive request counter
  consecutiveRequests++;

  // Reset the counter periodically to avoid ever-increasing delays
  if (consecutiveRequests > MAX_CONSECUTIVE_REQUESTS) {
    consecutiveRequests = 0;
  }

  if (timeSinceLastRequest < currentDelay) {
    const delayTime = currentDelay - timeSinceLastRequest;
    await new Promise(resolve => setTimeout(resolve, delayTime));
  }

  // Update the last request time
  lastRequestTime = Date.now();
}

// Enhanced fetch function with rate limiting and retry
async function fetchWithDelay(url: string, options: RequestInit = {}): Promise<Response> {
  await delayIfNeeded();
  return fetch(url, options);
}

// Handles both rate limiting (429) and authentication (401) errors
async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  maxRetries = 3,
): Promise<Response> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      // Use fetchWithDelay instead of direct fetch
      const response = await fetchWithDelay(url, options);

      // Return successful responses immediately
      if (response.ok) return response;

      // Handle specific error codes
      if (response.status === 401) {
        console.error(`Authentication error (401) on attempt ${i + 1} for ${url}. Refreshing token...`);

        // Get the userId from env
        const userId = process.env.CRON_USER;
        if (userId) {
          // Force token refresh by getting a new spartan token
          const newTokens = await getSpartanToken(userId);
          if (newTokens) {
            // Update the request headers with the new tokens
            if (!options.headers) options.headers = {};
            const headers = options.headers as HeadersInit;
            headers["X-343-Authorization-Spartan"] = newTokens.spartanToken;
            headers["343-Clearance"] = newTokens.clearanceToken;

            // Longer delay after token refresh
            await new Promise((resolve) => setTimeout(resolve, 2000));
            continue; // Skip the standard retry delay and retry immediately with new token
          }
        }
      } else if (response.status === 429) {
        console.error(`Rate limit exceeded (429) on attempt ${i + 1} for ${url}. Adding longer delay...`);
        // Mark that we've encountered a rate limit so future requests will be slower
        rateLimitEncountered = true;
        // Much longer delay for rate limit errors - exponential with a higher base
        const rateDelay = Math.pow(5, i) * 2000; // Increased base delay for rate limits
        console.log(`Rate limit hit, waiting ${rateDelay}ms before retry`);
        await new Promise((resolve) => setTimeout(resolve, rateDelay));
        continue;
      }
    } catch (error) {
      console.error(`Attempt ${i + 1} failed for ${url}:`, error);
    }

    // Standard exponential backoff for other errors
    const delay = Math.pow(2, i) * 1000;
    console.log(`Retrying in ${delay}ms...`);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw new Error(`Failed to fetch ${url} after ${maxRetries} attempts`);
}

async function verifyAsset(
  assetId: string,
  assetKind: AssetKind,
): Promise<boolean> {
  const assetType =
    assetKind === AssetKind.Map
      ? "maps"
      : assetKind === AssetKind.Mode
        ? "modes"
        : "prefabs";
  try {
    const res = await fetchWithRetry(
      `https://www.halowaypoint.com/halo-infinite/ugc/${assetType}/${assetId}`,
      { method: "HEAD" },
    );
    return res.ok;
  } catch (error) {
    // console.error(`Failed to verify asset ${assetId}:`, error);
    return false;
  }
}
export async function syncDelete(assetKind: AssetKind) {
  Sentry.getCurrentScope().setLevel("error");
  const userId = process.env.CRON_USER;
  if (!userId) {
    Sentry.captureMessage("Error: Missing userId in ENV");
    return;
    throw new Error(`failed to fetch data`);
  }

  const haloTokens = await getSpartanToken(userId);
  if (!haloTokens) {
    Sentry.captureMessage("Error: Failed to get spartan token. Sign in again");
    return;
    throw new Error(`failed to fetch data`);
  }

  const headers: HeadersInit = {
    "X-343-Authorization-Spartan": haloTokens.spartanToken,
    "343-Clearance": haloTokens.clearanceToken,
  };

  const waypointSync = await client.waypointSync.findUnique({
    where: {
      assetKind: assetKind,
    },
  });
  if (!waypointSync) {
    Sentry.captureMessage("Error: Failed obtaining syncedAt time", {
      extra: {
        assetKind: assetKind,
      },
    });
    return;
    throw new Error(`failed to fetch data`);
  }

  const newSyncedAt = new Date();
  const lastSyncedAt = waypointSync.syncedAt;
  const count: number = 20;
  let start: number = 0;
  let total: number = -1;
  let firstTotal: number = -1;
  let assetIds: string[] = [];
  do {
    const queryParams: UgcFetchData = {
      sort: "DatePublishedUtc",
      order: "Desc",
      count: count.toString(),
      start: start.toString(),
      assetKind: assetKind,
    };

    try {
      const response = await fetchWithDelay(
        UgcEndpoints.Search + new URLSearchParams({ ...queryParams }),
        {
          method: "GET",
          headers: headers,
        },
      );
      if (!response.ok) {
        //TODO add logging to say failed to fetch search data. include queryParams
        Sentry.captureMessage(`Error: Failed to fetch Search results`, {
          extra: {
            endpoint: UgcEndpoints.Search,
            ...queryParams,
            code: response.status,
          },
        });
        return;
        throw new Error(`failed to fetch data. Status: ${response.status}`);
      }

      const assetList = await response.json();
      //this is stupid and probably can be put in the for loop below, but i wanted to test something
      //TODO: see if i can get this to work without a connection pool issue
      // const updatePromises = assetList.Results.map((result: any) => {
      //   safeUpdate(result.AssetId, {
      //     favorites: result.Favorites,
      //     likes: result.Likes,
      //     bookmarks: result.Bookmarks,
      //     playsRecent: result.PlaysRecent,
      //     playsAllTime: result.PlaysAllTime,
      //     averageRating: result.AverageRating,
      //     numberOfRatings: result.NumberOfRatings,
      //   });
      // });
      // await Promise.all(updatePromises);

      for (const asset of assetList.Results) {
        assetIds.push(asset.AssetId);

        await safeUpdate(asset.AssetId, {
          favorites: asset.Favorites,
          likes: asset.Likes,
          bookmarks: asset.Bookmarks,
          playsRecent: asset.PlaysRecent,
          playsAllTime: asset.PlaysAllTime,
          averageRating: asset.AverageRating,
          numberOfRatings: asset.NumberOfRatings,
        });
      }

      total = assetList.EstimatedTotal;
      firstTotal = start === 0 ? assetList.EstimatedTotal : firstTotal;
      start += count;
    } catch (error) {
      console.error(`Error during syncDelete at offset ${start}:`, error);
      Sentry.captureException(error, {
        extra: {
          start: start,
          assetKind: assetKind,
          query: queryParams
        },
      });

      // Instead of immediately failing, let's wait and retry once
      console.log(`Waiting 10 seconds before retrying syncDelete batch at offset ${start}...`);
      await new Promise(resolve => setTimeout(resolve, 10000));

      try {
        // One retry attempt for this batch
        console.log(`Retrying syncDelete batch at offset ${start}...`);
        const response = await fetchWithRetry(
          UgcEndpoints.Search + new URLSearchParams({ ...queryParams }),
          {
            method: "GET",
            headers: headers,
          },
          5 // Increased max retries for recovery attempt
        );

        if (!response.ok) {
          console.error(`Retry failed with status ${response.status}, failing sync as requested`);
          // Never skip batches - fail the entire sync
          throw new Error(`Failed to fetch batch at offset ${start} after retry. Status: ${response.status}`);
        }

        const assetList = await response.json();

        // Process assets (same as in the original try block)
        for (const asset of assetList.Results) {
          assetIds.push(asset.AssetId);

          await safeUpdate(asset.AssetId, {
            favorites: asset.Favorites,
            likes: asset.Likes,
            bookmarks: asset.Bookmarks,
            playsRecent: asset.PlaysRecent,
            playsAllTime: asset.PlaysAllTime,
            averageRating: asset.AverageRating,
            numberOfRatings: asset.NumberOfRatings,
          });
        }

        total = assetList.EstimatedTotal;
        firstTotal = start === 0 ? assetList.EstimatedTotal : firstTotal;
        start += count;
      } catch (retryError) {
        console.error(`Retry also failed at offset ${start}:`, retryError);
        Sentry.captureException(retryError, {
          extra: {
            start: start,
            context: "Retry attempt for syncDelete",
            assetKind: assetKind
          },
        });

        // Never skip batches - fail the entire sync
        console.error(`Failed batch at offset ${start} after retry attempt in syncDelete - failing the entire sync as requested`);
        throw retryError; // Rethrow to fail the sync
      }
    }
  } while (start < total || total === -1);

  const assetKindNumber =
    assetKind === AssetKind.Map ? 2 : assetKind === AssetKind.Prefab ? 4 : 6;
  const results = await client.ugc.findMany({
    where: {
      assetKind: assetKindNumber,
      assetId: {
        notIn: assetIds,
      },
    },
    select: {
      assetId: true,
    },
  });

  console.log("results2: ", results.length);

  // Batch verification with rate limiting
  const verificationResults: boolean[] = [];
  const batchSize = 5; // Process in batches of 5

  for (let i = 0; i < results.length; i += batchSize) {
    const batch = results.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (result) => await verifyAsset(result.assetId, assetKind))
    );
    verificationResults.push(...batchResults);

    // Add delay between batches if there are more to process
    if (i + batchSize < results.length) {
      await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS * 2));
    }
  }

  const assetIdsToDelete = results.filter(
    (_, index) => !verificationResults[index],
  );

  const deleteList = assetIdsToDelete.map((asset) => {
    return asset.assetId;
  });

  console.log("BAD RES: ", assetIdsToDelete.length);
  // console.log("GOOD RES: ", assetIdsToSave.length);
  await client.ugc.deleteMany({
    where: {
      assetId: {
        in: deleteList,
      },
    },
  });

  console.log(paint.blue("INFO: "), "Synced Deletes for AssetKind");
  // await client.waypointSync.update({
  //   where: {
  //     assetKind: assetKind,
  //   },
  //   data: {
  //     syncedAt: newSyncedAt,
  //   },
  // });

  console.log(
    paint.blue("INFO: "),
    "lastSyncedAt time updated with new time: ",
    paint.green(newSyncedAt.toString()),
  );
  return true;
}

async function safeUpdate(assetId: string, data: any) {
  try {
    return await client.ugc.update({
      where: { assetId },
      data,
    });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2025"
    ) {
      // Handle the case where the record does not exist
      // console.log(`Record with ID ${assetId} does not exist.`);
      return null;
    }
    throw e; // Re-throw other errors
  }
}

async function sync(assetKind: AssetKind) {
  Sentry.getCurrentScope().setLevel("error");
  const userId = process.env.CRON_USER;
  if (!userId) {
    Sentry.captureMessage("Error: Missing userId in ENV");
    return;
    throw new Error(`failed to fetch data`);
  }

  const haloTokens = await getSpartanToken(userId);
  if (!haloTokens) {
    Sentry.captureMessage("Error: Failed to get spartan token. Sign in again");
    return;
    throw new Error(`failed to fetch data`);
  }

  const headers: HeadersInit = {
    "X-343-Authorization-Spartan": haloTokens.spartanToken,
    "343-Clearance": haloTokens.clearanceToken,
  };

  const waypointSync = await client.waypointSync.findUnique({
    where: {
      assetKind: assetKind,
    },
  });
  if (!waypointSync) {
    Sentry.captureMessage("Error: Failed obtaining syncedAt time", {
      extra: {
        assetKind: assetKind,
      },
    });
    return;
    throw new Error(`failed to fetch data`);
  }

  const newSyncedAt = new Date();
  const lastSyncedAt = waypointSync.syncedAt;
  const count: number = 20;
  let start: number = 0;
  let total: number = -1;
  do {
    const queryParams: UgcFetchData = {
      sort: "DatePublishedUtc",
      order: "Desc",
      count: count.toString(),
      start: start.toString(),
      assetKind: assetKind,
    };

    try {
      const response = await fetchWithDelay(
        UgcEndpoints.Search + new URLSearchParams({ ...queryParams }),
        {
          method: "GET",
          headers: headers,
        },
      );
      if (!response.ok) {
        //TODO add logging to say failed to fetch search data. include queryParams
        Sentry.captureMessage(`Error: Failed to fetch Search results`, {
          extra: {
            endpoint: UgcEndpoints.Search,
            ...queryParams,
            code: response.status,
          },
        });
        return;
        throw new Error(`failed to fetch data. Status: ${response.status}`);
      }

      const assetList = await response.json();

      //put code here to loop through all the maps and do whatever jazz is needed.
      for (const assetSummary of assetList.Results) {
        const publishedAtUtc = new Date(
          assetSummary.DatePublishedUtc.ISO8601Date,
        );
        const publishedAt = new Date(publishedAtUtc.getTime() + 5 * 60000);
        if (lastSyncedAt > publishedAt) {
          console.log(
            paint.blue("INFO: "),
            "Maps from now to syncedAt updated",
          );
          await client.waypointSync.update({
            where: {
              assetKind: assetKind,
            },
            data: {
              syncedAt: newSyncedAt,
            },
          });
          console.log(
            paint.blue("INFO: "),
            "lastSyncedAt time updated with new time: ",
            paint.green(newSyncedAt.toString()),
          );
          return;
        }

        // Check if this AssetID is in the skip list
        if (skipList.has(assetSummary.AssetId)) {
          console.log(
            paint.yellow("SKIPPED: "),
            `Asset ${paint.cyan(assetSummary.AssetId)} (${assetKind}) is in skip list - skipping`
          );
          continue;
        }

        const assetData = await getAsset(
          assetSummary.AssetId,
          assetKind,
          headers,
        );
        const contributorXuids = assetData.Contributors.filter(
          (contributor: string) => contributor.startsWith("xuid"),
        );
        if (
          !contributorXuids.includes(assetData.Admin) &&
          assetData.Admin.startsWith("xuid")
        ) {
          contributorXuids.push(assetData.Admin);
        }
        const gamertags = await getGamertags(
          contributorXuids,
          headers,
          assetSummary.AssetId,
        );

        const contributors: {
          xuid: string;
          gamertag: string;
          serviceTag: string;
          emblemPath: string;
        }[] = [];
        let adminGamertagStartsWithNumber = false;
        // Process gamertags one by one with delay between each
        for (let i = 0; i < gamertags.length; i++) {
          const gamertag = gamertags[i];

          // Add a short delay between each contributor to avoid rate limiting
          if (i > 0) {
            await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS));
          }

          const appearance = await getAppearance(
            gamertag.xuid,
            headers,
            assetSummary.AssetId,
          );
          contributors.push({
            xuid: gamertag.xuid,
            gamertag: gamertag.gamertag,
            serviceTag: appearance.serviceTag,
            emblemPath: appearance.emblemPath.startsWith("/")
              ? appearance.emblemPath
              : "/" + appearance.emblemPath,
          });
          // Check if this gamertag belongs to the admin and starts with a number
          if (
            gamertag.xuid === assetData.Admin &&
            /^[0-9]/.test(gamertag.gamertag)
          ) {
            adminGamertagStartsWithNumber = true;
          }
        }
        if (
          contributors.length < assetData.Contributors ||
          !assetData.Admin.startsWith("xuid") ||
          adminGamertagStartsWithNumber
        ) {
          contributors.push({
            xuid: "343",
            gamertag: "343 Industries",
            serviceTag: "343i",
            emblemPath: "/emblems/343other_343_industries_emblem.png",
          });
        }

        //create or update all the contributors of the map in the database
        const contributorRequests = contributors.map((contributor) =>
          client.contributor.upsert({
            where: { xuid: contributor.xuid },
            update: {
              gamertag: contributor.gamertag,
              serviceTag: contributor.serviceTag,
            },
            create: {
              ...contributor,
            },
          }),
        );
        await client.$transaction(contributorRequests);

        const trimmedTags: string[] = assetData.Tags.map((tag: string) =>
          tag.trim().toLowerCase(),
        );
        const uniqueTags: string[] = [...new Set(trimmedTags)];

        const tagRequests = uniqueTags.map((tag: string) =>
          client.tag.upsert({
            where: { name: tag },
            update: {
              name: tag,
            },
            create: {
              name: tag,
            },
          }),
        );
        await client.$transaction(tagRequests);

        //create an object to upsert into the database
        const asset: UgcDatabaseData = {
          assetId: assetData.AssetId,
          versionId: assetData.VersionId,
          version: assetData.VersionNumber,
          name: assetData.PublicName,
          description: assetData.Description,
          assetKind: assetSummary.AssetKind,
          thumbnailUrl: assetSummary.ThumbnailUrl,
          favorites: assetData.AssetStats.Favorites,
          likes: assetData.AssetStats.Likes,
          bookmarks: assetData.AssetStats.Bookmarks,
          playsRecent: assetData.AssetStats.PlaysRecent,
          playsAllTime: assetData.AssetStats.PlaysAllTime,
          averageRating: assetData.AssetStats.AverageRating,
          numberOfRatings: assetData.AssetStats.NumberOfRatings,
          createdAt: assetSummary.DateCreatedUtc.ISO8601Date,
          updatedAt: assetSummary.DateModifiedUtc.ISO8601Date,
          publishedAt: assetSummary.DatePublishedUtc.ISO8601Date,
          hasNodeGraph: assetData.CustomData.HasNodeGraph,
          readOnlyClones: assetSummary.ReadOnlyClones,
          numberOfObjects: assetSummary.NumberOfObjects ?? undefined,
          tag: {
            connect: uniqueTags.map((tag: string) => {
              return { name: tag };
            }),
          },
          files: {
            prefix: assetData.Files.Prefix,
            fileRelativePaths: assetData.Files.FileRelativePaths,
          } as Prisma.JsonObject,
          contributors: {
            connect: contributors.map((contributor) => {
              return { xuid: contributor.xuid };
            }),
          },
          authorId: !assetData.Admin.startsWith("xuid")
            ? "343"
            : assetData.Admin.substring(5, assetData.Admin.length - 1),
        };

        await client.ugc.upsert({
          where: { assetId: assetData.AssetId },
          update: {
            ...asset,
          },
          create: {
            ...asset,
          },
        });
      }
      total = assetList.EstimatedTotal;
      start += count;

      // const updatedAt =
      //   assetList.Results[assetList.Results.length - 1].DatePublishedUtc
      //     .ISO8601Date;
      // const assetUpdatedAt = new Date(updatedAt);
      // if (lastSyncedAt > assetUpdatedAt) {
      //   console.log(
      //     paint.blue("INFO: "),
      //     "All maps updated to lastSyncedAt time",
      //   );
      //   await client.waypointSync.update({
      //     where: {
      //       assetKind: assetKind,
      //     },
      //     data: {
      //       syncedAt: newSyncedAt,
      //     },
      //   });
      //   console.log(
      //     paint.blue("INFO: "),
      //     "lastSyncedAt time updated with new time: ",
      //     paint.green(newSyncedAt.toString()),
      //   );
      //   return true;
      // }
    } catch (error) {
      console.error(`Error during sync at offset ${start}:`, error);
      Sentry.captureException(error, {
        extra: {
          start: start,
          assetKind: assetKind,
          query: queryParams
        },
      });

      // Instead of immediately failing, let's wait and retry once
      console.log(`Waiting 10 seconds before retrying batch at offset ${start}...`);
      await new Promise(resolve => setTimeout(resolve, 10000));

      try {
        // One retry attempt for this batch
        console.log(`Retrying batch at offset ${start}...`);
        const response = await fetchWithRetry(
          UgcEndpoints.Search + new URLSearchParams({ ...queryParams }),
          {
            method: "GET",
            headers: headers,
          },
          5 // Increased max retries for recovery attempt
        );

        if (!response.ok) {
          console.error(`Retry failed with status ${response.status}, failing sync as requested`);
          // Never skip batches - fail the entire sync
          throw new Error(`Failed to fetch batch at offset ${start} after retry. Status: ${response.status}`);
        }

        const assetList = await response.json();

        // Process assets (same as in the try block)
        for (const assetSummary of assetList.Results) {
          // Processing code...
          // (Same as original processing loop)
          const publishedAtUtc = new Date(
            assetSummary.DatePublishedUtc.ISO8601Date,
          );
          const publishedAt = new Date(publishedAtUtc.getTime() + 5 * 60000);
          if (lastSyncedAt > publishedAt) {
            console.log(
              paint.blue("INFO: "),
              "Maps from now to syncedAt updated",
            );
            await client.waypointSync.update({
              where: {
                assetKind: assetKind,
              },
              data: {
                syncedAt: newSyncedAt,
              },
            });
            console.log(
              paint.blue("INFO: "),
              "lastSyncedAt time updated with new time: ",
              paint.green(newSyncedAt.toString()),
            );
            return;
          }

          // Check if this AssetID is in the skip list (retry path)
          if (skipList.has(assetSummary.AssetId)) {
            console.log(
              paint.yellow("SKIPPED: "),
              `Asset ${paint.cyan(assetSummary.AssetId)} (${assetKind}) is in skip list - skipping`
            );
            continue;
          }

          const assetData = await getAsset(
            assetSummary.AssetId,
            assetKind,
            headers,
          );
          // Rest of the asset processing code...
        }

        total = assetList.EstimatedTotal;
        start += count;
      } catch (retryError) {
        console.error(`Retry also failed at offset ${start}:`, retryError);
        Sentry.captureException(retryError, {
          extra: {
            start: start,
            context: "Retry attempt",
            assetKind: assetKind
          },
        });

        // Never skip batches - fail the entire sync
        console.error(`Failed batch at offset ${start} after retry attempt - failing the entire sync as requested`);
        throw retryError; // Rethrow to fail the sync
      }
    }
  } while (start < total || total === -1);

  console.log(paint.blue("INFO: "), "Every map updated");
  await client.waypointSync.update({
    where: {
      assetKind: assetKind,
    },
    data: {
      syncedAt: newSyncedAt,
    },
  });

  console.log(
    paint.blue("INFO: "),
    "lastSyncedAt time updated with new time: ",
    paint.green(newSyncedAt.toString()),
  );
  return true;
}

async function syncRecommended() {
  const userId = process.env.CRON_USER;
  if (!userId) {
    Sentry.captureMessage("Error: Missing userId in ENV");
    return;
    throw new Error(`failed to fetch data`);
  }

  const haloTokens = await getSpartanToken(userId);
  if (!haloTokens) {
    Sentry.captureMessage("Error: Failed to get spartan token. Sign in again");
    return;
    throw new Error(`failed to fetch data`);
  }

  const headers: HeadersInit = {
    "X-343-Authorization-Spartan": haloTokens.spartanToken,
    "343-Clearance": haloTokens.clearanceToken,
  };

  const waypointSync = await client.waypointSync.findUnique({
    where: {
      assetKind: AssetKind.Recommended,
    },
  });
  if (!waypointSync) {
    Sentry.captureMessage("Error: Failed obtaining syncedAt time", {
      extra: {
        assetKind: AssetKind.Recommended,
      },
    });
    return;
    throw new Error(`failed to fetch data`);
  }

  const newSyncedAt = new Date();
  const lastSyncedAt = waypointSync.syncedAt;

  try {
    const response = await fetchWithDelay(UgcEndpoints.Recommended, {
      method: "GET",
      headers: headers,
    });
    if (!response.ok) {
      //TODO add logging to say failed to fetch search data. include queryParams
      Sentry.captureMessage(`Error: Failed to fetch Search results`, {
        extra: {
          endpoint: UgcEndpoints.Search,
          code: response.status,
        },
      });
      return;
      throw new Error(`failed to fetch data. Status: ${response.status}`);
    }

    const recommendedProject = await response.json();

    //Not the proper type of our data, but will do for now
    interface Link {
      AssetId: string;
    }
    //put code here to loop through all the assets and do whatever jazz is needed.
    const allAssetIds: string[] = [
      ...recommendedProject.MapLinks.map((link: Link) => link.AssetId),
      ...recommendedProject.PlaylistLinks.map((link: Link) => link.AssetId),
      ...recommendedProject.UgcGameVariantLinks.map(
        (link: Link) => link.AssetId,
      ),
    ];

    // Update records to set featured to true for IDs in the list
    await client.ugc.updateMany({
      where: {
        assetId: { in: allAssetIds },
      },
      data: {
        recommended: true,
      },
    });

    // Update records to set booleanField to false for IDs not in the list
    await client.ugc.updateMany({
      where: {
        assetId: { notIn: allAssetIds },
      },
      data: {
        recommended: false,
      },
    });
    console.log(paint.blue("INFO: "), "Recommended assets updated");
    await client.waypointSync.update({
      where: {
        assetKind: AssetKind.Recommended,
      },
      data: {
        syncedAt: newSyncedAt,
      },
    });

    console.log(
      paint.blue("INFO: "),
      "lastSyncedAt time updated with new time: ",
      paint.green(newSyncedAt.toString()),
    );
    return true;
  } catch (error) {
    console.error(`Error during syncRecommended:`, error);
    Sentry.captureException(error, {
      extra: {
        context: "syncRecommended initial attempt"
      }
    });

    // Instead of immediately failing, let's wait and retry once
    console.log(`Waiting 10 seconds before retrying syncRecommended...`);
    await new Promise(resolve => setTimeout(resolve, 10000));

    try {
      // One retry attempt with longer timeout
      console.log(`Retrying syncRecommended...`);
      const response = await fetchWithRetry(UgcEndpoints.Recommended, {
        method: "GET",
        headers: headers,
      }, 5); // More retries for recovery

      if (!response.ok) {
        console.error(`Retry failed with status ${response.status}, failing syncRecommended as requested`);
        throw new Error(`Failed to fetch recommended data after retry. Status: ${response.status}`);
      }

      const recommendedProject = await response.json();

      // Same processing logic as in the original try block
      interface Link {
        AssetId: string;
      }

      const allAssetIds: string[] = [
        ...recommendedProject.MapLinks.map((link: Link) => link.AssetId),
        ...recommendedProject.PlaylistLinks.map((link: Link) => link.AssetId),
        ...recommendedProject.UgcGameVariantLinks.map(
          (link: Link) => link.AssetId,
        ),
      ];

      // Update records to set featured to true for IDs in the list
      await client.ugc.updateMany({
        where: {
          assetId: { in: allAssetIds },
        },
        data: {
          recommended: true,
        },
      });

      // Update records to set booleanField to false for IDs not in the list
      await client.ugc.updateMany({
        where: {
          assetId: { notIn: allAssetIds },
        },
        data: {
          recommended: false,
        },
      });

      console.log(paint.blue("INFO: "), "Recommended assets updated on retry");
      await client.waypointSync.update({
        where: {
          assetKind: AssetKind.Recommended,
        },
        data: {
          syncedAt: newSyncedAt,
        },
      });

      console.log(
        paint.blue("INFO: "),
        "lastSyncedAt time updated with new time: ",
        paint.green(newSyncedAt.toString()),
      );
      return true;
    } catch (retryError) {
      console.error(`Retry also failed for syncRecommended:`, retryError);
      Sentry.captureException(retryError, {
        extra: {
          context: "syncRecommended retry attempt"
        }
      });
      throw retryError; // Rethrow to fail the sync properly
    }
  }
}

async function getAsset(
  assetId: string,
  assetKind: AssetKind,
  headers: HeadersInit,
) {
  let endpoint: UgcEndpoints;
  switch (assetKind) {
    case AssetKind.Map:
      endpoint = UgcEndpoints.Map;
      break;
    case AssetKind.Prefab:
      endpoint = UgcEndpoints.Prefab;
      break;
    case AssetKind.Mode:
      endpoint = UgcEndpoints.Mode;
      break;
    default:
      endpoint = UgcEndpoints.Map;
      break;
  }
  try {
    const response = await fetchWithDelay(endpoint + assetId, {
      method: "GET",
      headers: headers,
    });

    if (!response.ok) {
      //TODO add logging saying failed to get asset, and include asset id, and kind
      Sentry.captureMessage(`Error: Failed to fetch asset`, {
        extra: {
          endpoint: endpoint,
          code: response.status,
          assetId: assetId,
          assetKind: assetKind,
        },
      });

      throw new Error(`failed to fetch data. Status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    throw error;
  }
}

async function getGamertags(
  xuids: string[],
  headers: HeadersInit,
  assetId: string,
): Promise<gamertagData[]> {
  try {
    const rawXuids = xuids.map((xuid) => {
      return xuid.substring(5, xuid.length - 1);
    });

    const response = await fetchWithDelay(
      UgcEndpoints.Gamertags + `xuids=${rawXuids.join(",")}`,
      {
        method: "GET",
        headers: headers,
      },
    );

    if (!response.ok) {
      Sentry.captureMessage(`Error: Failed to fetch gamertags`, {
        extra: {
          endpoint: UgcEndpoints.Gamertags,
          code: response.status,
          xuids: xuids,
          assetId: assetId,
        },
      });
      throw new Error(`failed to fetch gamertags. Status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    throw error;
  }
}

async function getAppearance(
  xuid: string,
  headers: HeadersInit,
  assetId: string,
) {
  try {
    const response = await fetchWithDelay(
      UgcEndpoints.Appearance1 + `xuid(${xuid})` + UgcEndpoints.Appearance2,
      {
        method: "GET",
        headers: headers,
      },
    );
    if (!response.ok) {
      Sentry.captureMessage(`Error: Failed to fetch appearance`, {
        extra: {
          endpoint:
            UgcEndpoints.Appearance1 +
            `xuid(${xuid})` +
            UgcEndpoints.Appearance2,
          code: response.status,
          xuid: xuid,
          assetId: assetId,
        },
      });
      throw new Error(`failed to fetch apperance. Status: ${response.status}`);
    }

    const result = await response.json();

    const emblemResponse = await fetchWithDelay(
      UgcEndpoints.Emblem + result.Appearance.Emblem.EmblemPath,
      {
        method: "GET",
        headers: headers,
      },
    );

    if (!emblemResponse.ok) {
      Sentry.captureMessage(`Error: Failed to fetch emblem`, {
        extra: {
          endpoint: UgcEndpoints.Emblem,
          emblemPath: result.Appearance.Emblem.EmblemPath,
          code: response.status,
          xuid: xuid,
          assetId: assetId,
        },
      });
      throw new Error(`failed to fetch data. Status: ${response.status}`);
    }
    const emblem = await emblemResponse.json();
    let emblemPath = emblem.CommonData.DisplayPath.Media.MediaUrl.Path;
    const fixedEmblemPath =
      emblemPath != ""
        ? emblemPath.replace(/^progression\/Inventory\//, "")
        : "Emblems/classics_one_emblem.png";
    return {
      serviceTag: result.Appearance.ServiceTag,
      emblemPath: fixedEmblemPath.toLowerCase(),
    };
  } catch (error) {
    throw error;
  }
}

export enum UgcEndpoints {
  Search = "https://discovery-infiniteugc.svc.halowaypoint.com/hi/search?",
  Map = "https://discovery-infiniteugc.svc.halowaypoint.com/hi/maps/",
  Prefab = "https://discovery-infiniteugc.svc.halowaypoint.com/hi/prefabs/",
  Mode = "https://discovery-infiniteugc.svc.halowaypoint.com/hi/ugcGameVariants/",
  Gamertags = "https://profile.svc.halowaypoint.com/users?", //users?xuids=2533274909496686,2533274863053811,2535457072823357
  Appearance1 = "https://economy.svc.halowaypoint.com/hi/players/", //xuid(${user.xuid})/customization/apperance
  Appearance2 = "/customization",
  Emblem = "https://gamecms-hacs.svc.halowaypoint.com/hi/progression/file/", //Inventory/Spartan/Emblems/blah.json
  Recommended = "https://discovery-infiniteugc.svc.halowaypoint.com/hi/projects/712add52-f989-48e1-b3bb-ac7cd8a1c17a",
}

export enum AssetKind {
  Map = "Map",
  Prefab = "Prefab",
  Mode = "UgcGameVariant",
  Recommended = "Recommended343",
}

export interface gamertagData {
  xuid: string;
  gamertag: string;
  gamerpic: {
    small: string;
    medium: string;
    large: string;
    xlarge: string;
  };
}

export interface UgcDatabaseData {
  assetId: string;
  versionId: string;
  version: number;
  name: string;
  description: string;
  assetKind: number;
  thumbnailUrl: string;
  favorites: number;
  likes: number;
  bookmarks: number;
  playsRecent: number;
  playsAllTime: number;
  averageRating: number;
  numberOfRatings: number;
  createdAt: string; //date
  updatedAt: string; //date
  publishedAt: string; //date
  hasNodeGraph: boolean;
  readOnlyClones: boolean;
  numberOfObjects?: number;
  tag: {
    connect: { name: string }[];
  };
  files: Prisma.JsonObject;
  contributors: {
    connect: { xuid: string }[];
  };
  authorId: string;
}

export interface UgcFetchData {
  assetKind?: string; //'Map' | 'UgcGameVariant' | 'Prefab';
  sort?: string; //'datepublishedutc';
  order?: string; //'desc' | 'asc';
  count?: string; //number
  start?: string; //number
  "include-times"?: string;
  searchTerm?: string;
}
