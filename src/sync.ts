import { client } from "./lucia";
import { getSpartanToken } from "./authTools";
import { Prisma } from "@prisma/client";
import * as Sentry from "@sentry/bun";

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
export async function waypointSync() {
  console.log(paint.blue("INFO: "), "Starting map sync");
  await sync(AssetKind.Map);
  console.log(paint.blue("INFO: "), "Finished map sync");
  console.log(paint.blue("INFO: "), "Starting prefab sync");
  await sync(AssetKind.Prefab);
  console.log(paint.blue("INFO: "), "Finished prefab sync");
  console.log(paint.blue("INFO: "), "Starting mode sync");
  await sync(AssetKind.Mode);
  console.log(paint.blue("INFO: "), "Finished mode sync");
}

async function syncDelete(assetKind: AssetKind) {
  Sentry.getCurrentScope().setLevel("error");
  const userId = process.env.CronUser;
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
      const response = await fetch(
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

      for (const asset of assetList.Results) {
        assetIds.push(asset.AssetId);
      }

      total = assetList.EstimatedTotal;
      firstTotal = start === 0 ? assetList.EstimatedTotal : firstTotal;
      start += count;
    } catch (error) {
      Sentry.captureException(error, {
        extra: {
          start: start,
        },
      });
      return;
    }
  } while (start < total || total === -1);

  const results = await client.ugc.findMany({
    where: {
      assetKind: 2,
      // assetId: {
      //   notIn: assetIds,
      // },
    },
    select: {
      assetId: true,
    },
  });

  const testt = results.map((t) => t.assetId);
  const logg = assetIds.filter((itemA) => !testt.includes(itemA));
  console.log(results);

  console.log("FIRST TOTAL: ", firstTotal);
  console.log("FINAL TOTAL: ", total);
  console.log("AssetIds LENGTH: ", assetIds.length);
  console.log(paint.blue("INFO: "), "Every map updated");
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

async function sync(assetKind: AssetKind) {
  Sentry.getCurrentScope().setLevel("error");
  const userId = process.env.CronUser;
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
      const response = await fetch(
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
        for (const gamertag of gamertags) {
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
        }
        if (
          contributors.length < assetData.Contributors ||
          !assetData.Admin.startsWith("xuid")
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

      if (start % 100 === 0) {
        console.log(start);
      }
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
      Sentry.captureException(error, {
        extra: {
          start: start,
        },
      });
      return;
      throw error;
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
    const response = await fetch(endpoint + assetId, {
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

    const response = await fetch(
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
    const response = await fetch(
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

    const emblemResponse = await fetch(
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
