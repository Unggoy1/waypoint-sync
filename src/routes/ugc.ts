import Elysia from "elysia";
import { authApp } from "../middleware";
import { client } from "../lucia";
import { getSpartanToken } from "../authTools";
import { Prisma } from "@prisma/client";

export const maps = new Elysia().group("/ugc", (app) => {
  return app
    .use(authApp)
    .get("/maps/:assetId", async ({ user, params: { assetId } }) => {
      if (!user) {
        return new Response(null, {
          status: 401,
        });
      }

      const haloTokens = await getSpartanToken(user.id);
      if (!haloTokens) {
        return new Response(null, {
          status: 401,
        });
      }
      const headers: HeadersInit = {
        "X-343-Authorization-Spartan": haloTokens.spartanToken,
        "343-Clearance": haloTokens.clearanceToken,
      };
      const ugcEndpoint =
        "https://discovery-infiniteugc.svc.halowaypoint.com/hi/maps/" + assetId;

      try {
        console.log(ugcEndpoint);
        const response = await fetch(ugcEndpoint, {
          method: "GET",
          headers: headers,
        });

        if (!response.ok) {
          throw new Error(`failed to fetch data. Status: ${response.status}`);
        }

        return await response.json();
      } catch (error) {
        console.error(error);
        throw error;
      }
    })
    .get("/modes/:assetId", async ({ user, params: { assetId } }) => {
      if (!user) {
        return new Response(null, {
          status: 401,
        });
      }

      const haloTokens = await getSpartanToken(user.id);
      if (!haloTokens) {
        return new Response(null, {
          status: 401,
        });
      }

      const ugcEndpoint =
        "https://discovery-infiniteugc.svc.halowaypoint.com/hi/ugcGameVariants/" +
        assetId;
      const headers: HeadersInit = {
        "X-343-Authorization-Spartan": haloTokens.spartanToken,
        "343-Clearance": haloTokens.clearanceToken,
      };
      try {
        console.log(ugcEndpoint);
        const response = await fetch(ugcEndpoint, {
          method: "GET",
          headers: headers,
        });

        if (!response.ok) {
          throw new Error(`failed to fetch data. Status: ${response.status}`);
        }
        return await response.json();
      } catch (error) {
        console.error(error);
        throw error;
      }
    })
    .get("/prefabs/:assetId", async ({ user, params: { assetId } }) => {
      if (!user) {
        return new Response(null, {
          status: 401,
        });
      }

      const haloTokens = await getSpartanToken(user.id);
      if (!haloTokens) {
        return new Response(null, {
          status: 401,
        });
      }

      const ugcEndpoint =
        "https://discovery-infiniteugc.svc.halowaypoint.com/hi/prefabs/" +
        assetId;
      const headers: HeadersInit = {
        "X-343-Authorization-Spartan": haloTokens.spartanToken,
        "343-Clearance": haloTokens.clearanceToken,
      };
      try {
        console.log(ugcEndpoint);
        const response = await fetch(ugcEndpoint, {
          method: "GET",
          headers: headers,
        });

        if (!response.ok) {
          throw new Error(`failed to fetch data. Status: ${response.status}`);
        }
        return await response.json();
      } catch (error) {
        console.error(error);
        throw error;
      }
    })
    .get(
      "/browse",
      async ({ user, query: { assetKind, sort, order, page, searchTerm } }) => {
        if (!user) {
          return new Response(null, {
            status: 401,
          });
        }

        const haloTokens = await getSpartanToken(user.id);
        if (!haloTokens) {
          return new Response(null, {
            status: 401,
          });
        }

        //const ugcEndpoint =
        //"https://www.halowaypoint.com/halo-infinite/ugc/browse?";
        const ugcEndpoint =
          "https://discovery-infiniteugc.svc.halowaypoint.com/hi/search?";
        const headers: HeadersInit = {
          "X-343-Authorization-Spartan": haloTokens.spartanToken,
          "343-Clearance": haloTokens.clearanceToken,
        };
        const queryParams: UgcFetchData = {
          sort: sort ?? "datepublishedutc",
          order: order ?? "desc",
          count: page ?? "20",
          assetKind: "Map",
          start: "15979",
        };
        // if (assetKind) {
        //   queryParams.assetKind = assetKind;
        // }
        // if (searchTerm) {
        //   queryParams.searchTerm = searchTerm;
        // }
        try {
          const response = await fetch(
            ugcEndpoint + new URLSearchParams({ ...queryParams }),
            {
              method: "GET",
              headers: headers,
            },
          );

          if (!response.ok) {
            throw new Error(`failed to fetch data. Status: ${response.status}`);
          }

          return await response.json();
        } catch (error) {
          console.error(error);
          throw error;
        }
      },
    )
    .get("/sync", async ({ user }) => {
      if (!user) {
        return new Response(null, {
          status: 401,
        });
      }

      const haloTokens = await getSpartanToken(user.id);
      if (!haloTokens) {
        return new Response(null, {
          status: 401,
        });
      }

      const ugcEndpoint =
        "https://discovery-infiniteugc.svc.halowaypoint.com/hi/search?";
      const headers: HeadersInit = {
        "X-343-Authorization-Spartan": haloTokens.spartanToken,
        "343-Clearance": haloTokens.clearanceToken,
      };
      const count: number = 20;
      let start: number = 15600;
      let total: number = -1;
      do {
        const queryParams: UgcFetchData = {
          sort: "datepublishedutc",
          order: "desc",
          count: count.toString(),
          start: start.toString(),
          assetKind: "Map",
        };

        try {
          const response = await fetch(
            ugcEndpoint + new URLSearchParams({ ...queryParams }),
            {
              method: "GET",
              headers: headers,
            },
          );
          if (!response.ok) {
            throw new Error(`failed to fetch data. Status: ${response.status}`);
          }

          const results = await response.json();

          //put code here to loop through all the maps and do whatever jazz is needed.
          for (const map of results.Results) {
            const mapData = await getMap(map.AssetId, headers);
            const contribs = mapData.Contributors.filter(
              (contributor: string) => !contributor.startsWith("aaid"),
            );
            const gamertags = await getGamertags(contribs, headers);

            const contributors = [];
            for (const gamertag of gamertags) {
              const serviceTag = await getAppearance(gamertag.xuid, headers);
              contributors.push({
                xuid: gamertag.xuid,
                gamertag: gamertag.gamertag,
                serviceTag: serviceTag,
              });
            }
            if (contributors.length < mapData.Contributors) {
              contributors.push({
                xuid: "343",
                gamertag: "343 Industries",
                serviceTag: "343i",
              });
            }

            //create or updaet all the contributors of the map in the database
            const requests = contributors.map((contributor) =>
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
            await client.$transaction(requests);

            //create an object to upsert into the database
            const asset: UgcDatabaseData = {
              assetId: mapData.AssetId,
              versionId: mapData.VersionId,
              version: mapData.VersionNumber,
              name: mapData.PublicName,
              description: mapData.Description,
              assetKind: map.AssetKind,
              thumbnailUrl: map.ThumbnailUrl,
              favorites: mapData.AssetStats.Favorites,
              likes: mapData.AssetStats.Likes,
              bookmarks: mapData.AssetStats.Bookmarks,
              playsRecent: mapData.AssetStats.PlaysRecent,
              playsAllTime: mapData.AssetStats.PlaysAllTime,
              averageRating: mapData.AssetStats.AverageRating,
              numberOfRatings: mapData.AssetStats.NumberOfRatings,
              createdAt: map.DateCreatedUtc.ISO8601Date,
              updatedAt: map.DateModifiedUtc.ISO8601Date,
              publishedAt: map.DatePublishedUtc.ISO8601Date,
              hasNodeGraph: mapData.CustomData.HasNodeGraph,
              readOnlyClones: map.ReadOnlyClones,
              numberOfObjects: map.NumberOfObjects,
              tags: { tags: mapData.Tags } as Prisma.JsonObject,
              files: {
                prefix: mapData.Files.Prefix,
                fileRelativePaths: mapData.Files.FileRelativePaths,
              } as Prisma.JsonObject,
              contributors: {
                connect: contributors.map((contributor) => {
                  return { xuid: contributor.xuid };
                }),
              },
              authorId: mapData.Admin.startsWith("aaid")
                ? "343"
                : mapData.Admin,
            };

            await client.ugc.upsert({
              where: { assetId: map.AssetId },
              update: {
                ...asset,
              },
              create: {
                ...asset,
              },
            });
          }
          total = results.EstimatedTotal;
          start += count;
        } catch (error) {
          console.error(error);
          throw error;
        }
      } while (start < total || total === -1);

      return { status: "success" };
    });
});

async function getMap(assetId: string, headers: HeadersInit) {
  try {
    const response = await fetch(UgcEndpoints.Map + assetId, {
      method: "GET",
      headers: headers,
    });

    if (!response.ok) {
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

export interface UgcFetchData {
  assetKind?: string; //'Map' | 'UgcGameVariant' | 'Prefab';
  sort?: string; //'datepublishedutc';
  order?: string; //'desc' | 'asc';
  count?: string; //number
  start?: string; //number
  includeTimes?: string;
  searchTerm?: string;
}
export interface UgcData {
  AssetId: string;
  AssetVersionId: string;
  Name: string;
  Description: string;
  AssetKind: number; //replace with enumm for map, variant, prefab
  Tags?: string[]; // list of tags, might replace with diff data type
  ThumbnailUrl: string;
  RefrencedAssets?: string[]; //Seems unused but idk???
  OriginalAuthor: string; // of the form "xuid(123123123123)"
  Likes: number;
  Bookmarks: number;
  PlaysRecent: number;
  NumberOfObjects: number;
  DateCreatedUtc: {
    ISO8601Date: Date;
  };

  DateModifiedUtc: {
    ISO8601Date: Date;
  };
  DatePublishedUtc: {
    ISO8601Date: Date;
  };
  HasNodeGraph: boolean;
  ReadOnlyClones: boolean;
  PlaysAllTime: number;
  Contributors: string[]; // of the form "xuid()"
  ParentAssetCount: number;
  AverageRating: number; // float/double
  NumberOfRatings: number;
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
  tags?: Prisma.JsonObject;
  files: Prisma.JsonObject;
  contributors: {
    connect: { xuid: string }[];
  };
  authorId: string;
}
