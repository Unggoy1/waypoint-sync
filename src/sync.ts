import { client } from "./lucia";
import { getSpartanToken } from "./authTools";
import { Prisma } from "@prisma/client";

const reset = "\x1b[0m";

const log = {
  green: (text: string) => console.log("\x1b[32m" + text + reset),
  red: (text: string) => console.log("\x1b[31m" + text + reset),
  blue: (text: string) => console.log("\x1b[34m" + text + reset),
  yellow: (text: string) => console.log("\x1b[33m" + text + reset),
};
const paint = {
  green: (text: string) => "\x1b[32m" + text + reset,
  red: (text: string) => "\x1b[31m" + text + reset,
  blue: (text: string) => "\x1b[34m" + text + reset,
  yellow: (text: string) => "\x1b[33m" + text + reset,
  cyan: (text: string) => "\x1b[36m" + text + reset,
  magenta: (text: string) => "\x1b[35m" + text + reset,
};
export async function waypointSync() {
  log.blue("starting map sync");
  await sync(AssetKind.Map);
  log.blue("finished map sync");
  log.blue("starting prefab sync");
  await sync(AssetKind.Prefab);
  log.blue("finished prefab sync");
  log.blue("starting mode sync");
  await sync(AssetKind.Mode);
  log.blue("finished mode sync");
}

async function sync(assetKind: AssetKind) {
  const userId = process.env.CronUser;
  if (!userId) {
    console.log(paint.red("ERROR: "), "Missing userId. Add CronUser to Env");
    return;
    throw new Error(`failed to fetch data`);
  }

  const haloTokens = await getSpartanToken(userId);
  if (!haloTokens) {
    //make this a log about tokens issue
    console.log(
      paint.red("ERROR: "),
      "Falied to get spartan token. Sign in or fix token refresh logic",
    );
    return;
    throw new Error(`failed to fetch data`);
  }

  const headers: HeadersInit = {
    "X-343-Authorization-Spartan": haloTokens.spartanToken,
    "343-Clearance": haloTokens.clearanceToken,
  };

  //TODO CREATE SYNC MODEL AND GET LAST SYNCED TIME
  const waypointSync = await client.waypointSync.findUnique({
    where: {
      assetKind: assetKind,
    },
  });
  if (!waypointSync) {
    console.log(
      paint.red("ERROR: "),
      "Failed obtaining waypoint sync for assetKind: ",
      paint.yellow(assetKind),
    );
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
        console.log(
          paint.red("ERROR: "),
          "Failed to fetch url: ",
          paint.yellow(UgcEndpoints.Search),
          paint.red("CODE: " + response.status.toString()),
        );
        console.log(
          paint.red("cont... "),
          "count: ",
          paint.yellow(count.toString()),
          "start: ",
          paint.yellow(start.toString()),
          "assetKind: ",
          paint.yellow(assetKind),
        );
        return;
        throw new Error(`failed to fetch data. Status: ${response.status}`);
      }

      const assetList = await response.json();

      //put code here to loop through all the maps and do whatever jazz is needed.
      for (const assetSummary of assetList.Results) {
        const assetData = await getAsset(
          assetSummary.AssetId,
          assetKind,
          headers,
        );
        const contributorXuids = assetData.Contributors.filter(
          (contributor: string) => !contributor.startsWith("aaid"),
        );
        const gamertags = await getGamertags(contributorXuids, headers);

        const contributors: {
          xuid: string;
          gamertag: string;
          serviceTag: string;
        }[] = [];
        for (const gamertag of gamertags) {
          const serviceTag = await getAppearance(gamertag.xuid, headers);
          contributors.push({
            xuid: gamertag.xuid,
            gamertag: gamertag.gamertag,
            serviceTag: serviceTag,
          });
        }
        if (contributors.length < assetData.Contributors) {
          contributors.push({
            xuid: "343",
            gamertag: "343 Industries",
            serviceTag: "343i",
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
          authorId: assetData.Admin.startsWith("aaid")
            ? "343"
            : assetData.Admin,
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

      const updatedAt =
        assetList.Results[assetList.Results.length - 1].DatePublishedUtc
          .ISO8601Date;
      const assetUpdatedAt = new Date(updatedAt);
      if (lastSyncedAt > assetUpdatedAt) {
        console.log(
          paint.blue("INFO: "),
          "All maps updated to lastSyncedAt time",
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
        return true;
        //TODO log that we have finished syncing
      }
    } catch (error) {
      console.log(paint.red("ERROR: "), error);
      return;
      throw error;
    }
  } while (start < total || total === -1);

  console.log(paint.blue("INFO: "), "All maps updated to start time");
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
      console.log(
        paint.red("ERROR: "),
        "Failed to fetch url: ",
        paint.yellow(endpoint),
      );
      throw new Error(`failed to fetch data. Status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error(error);
    throw error;
  }
}

async function getGamertags(
  xuids: string[],
  headers: HeadersInit,
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
      //TODO add logging saying faild to get gamertags including all xuids
      console.log(
        paint.red("ERROR: "),
        "Failed to fetch url: ",
        paint.yellow(UgcEndpoints.Gamertags),
      );
      throw new Error(`failed to fetch data. Status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error(error);
    throw error;
  }
}

async function getAppearance(xuid: string, headers: HeadersInit) {
  try {
    const response = await fetch(
      UgcEndpoints.Appearance1 + `xuid(${xuid})` + UgcEndpoints.Appearance2,
      {
        method: "GET",
        headers: headers,
      },
    );
    if (!response.ok) {
      //TODO add logging saying faild to get gamertags including xuid
      throw new Error(`failed to fetch data. Status: ${response.status}`);
    }

    const result = await response.json();
    return result.Appearance.ServiceTag;
  } catch (error) {
    console.error(error);
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
