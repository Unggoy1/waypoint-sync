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
    });
  //   "/browse",
  //   async ({ user, query: { assetKind, sort, order, page, searchTerm } }) => {
  //     if (!user) {
  //       return new Response(null, {
  //         status: 401,
  //       });
  //     }
  //
  //     const haloTokens = await getSpartanToken(user.id);
  //     if (!haloTokens) {
  //       return new Response(null, {
  //         status: 401,
  //       });
  //     }
  //
  //     //const ugcEndpoint =
  //     //"https://www.halowaypoint.com/halo-infinite/ugc/browse?";
  //     const ugcEndpoint =
  //       "https://discovery-infiniteugc.svc.halowaypoint.com/hi/search?";
  //     const headers: HeadersInit = {
  //       "X-343-Authorization-Spartan": haloTokens.spartanToken,
  //       "343-Clearance": haloTokens.clearanceToken,
  //     };
  //     const queryParams: UgcFetchData = {
  //       sort: sort ?? "DatePublishedUtc",
  //       order: order ?? "Desc",
  //       count: page ?? "20",
  //       assetKind: "Prefab",
  //       start: "0",
  //       "include-times": "true",
  //     };
  //     // if (assetKind) {
  //     //   queryParams.assetKind = assetKind;
  //     // }
  //     // if (searchTerm) {
  //     //   queryParams.searchTerm = searchTerm;
  //     // }
  //     try {
  //       const response = await fetch(
  //         ugcEndpoint + new URLSearchParams({ ...queryParams }),
  //         {
  //           method: "GET",
  //           headers: headers,
  //         },
  //       );
  //
  //       if (!response.ok) {
  //         throw new Error(`failed to fetch data. Status: ${response.status}`);
  //       }
  //
  //       return await response.json();
  //     } catch (error) {
  //       console.error(error);
  //       throw error;
  //     }
  //   },
  // )
});

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
