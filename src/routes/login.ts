import Elysia from "elysia";
import { lucia, entraId, client } from "../lucia";
import { authApp } from "../middleware";
import {
  generateState,
  generateCodeVerifier,
  MicrosoftEntraIdTokens,
  OAuth2RequestError,
} from "arctic";
import { generateId } from "lucia";
import { parseJWT } from "oslo/jwt";
import { jwtDecode } from "jwt-decode";
import { entraIdTokenPayload } from "../interface";
import { refreshSpartanToken } from "../auth";

export const login = new Elysia().group("/login", (app) => {
  return app
    .use(authApp)
    .get(
      "/azure",
      async ({
        set,
        cookie: { entra_oauth_state, entra_oauth_verifier },
        user,
      }) => {
        //TODO Research if this should be removed, or how we handle sessions when you try to relogin when session is active
        // if (user) {
        //   set.status = 302;
        //   set.redirect = "/";
        //   return user;
        // }
        // redirect_url.set({
        //   value: redirectUrl || process.env.URL || "http://localhost:5173",
        //   httpOnly: true,
        //   secure: process.env.NODE_ENV === "production",
        //   path: "/",
        //   maxAge: 60 * 60,
        // });
        const state = generateState();
        const codeVerifier = generateCodeVerifier();
        const authorizationUrl = await entraId.createAuthorizationURL(
          state,
          codeVerifier,
          {
            scopes: ["Xboxlive.signin", "Xboxlive.offline_access"],
          },
        );

        entra_oauth_state.set({
          value: state,
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          path: "/",
          maxAge: 60 * 60,
        });
        entra_oauth_verifier.set({
          value: codeVerifier,
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          path: "/",
          maxAge: 60 * 60,
        });
        set.status = 302;
        set.redirect = authorizationUrl.toString();
      },
    )
    .get(
      "/azure-ad/callback",
      async ({
        query,
        set,
        cookie: {
          auth_session,
          entra_oauth_state,
          entra_oauth_verifier,
          redirect_url,
        },
      }) => {
        const storedState = entra_oauth_state.value;
        const codeVerifier = entra_oauth_verifier.value;
        const state = query.state;
        const code = query.code;

        //validatestate
        if (
          !storedState ||
          !state ||
          storedState !== state ||
          typeof code !== "string" ||
          !storedState ||
          typeof storedState !== "string"
        ) {
          set.status = 400;
          return;
        }
        try {
          const tokens: MicrosoftEntraIdTokens =
            await entraId.validateAuthorizationCode(code, codeVerifier);
          const user = await jwtDecode<entraIdTokenPayload>(tokens.idToken);
          const xboxUser = await refreshSpartanToken(tokens.refreshToken!);
          if (!xboxUser) {
            throw new Error("Xbox Authentication Error");
          }

          const existingUser = await client.user.findFirst({
            where: {
              oid: user.oid,
            },
          });

          if (existingUser) {
            if (existingUser.username !== xboxUser.gamertag) {
              await client.user.update({
                where: {
                  oid: user.oid,
                },
                data: {
                  username: xboxUser.gamertag,
                },
              });
            }
            const session = await lucia.createSession(existingUser.id, {});
            const sessionCookie = lucia.createSessionCookie(session.id);
            auth_session.set({
              value: sessionCookie.value,
              ...sessionCookie.attributes,
            });

            await client.oauth.update({
              where: {
                userId: existingUser.id,
              },
              data: {
                spartanToken: xboxUser.spartanToken.SpartanToken,
                spartanTokenExpiresAt:
                  xboxUser.spartanToken.ExpiresUtc.ISO8601Date,
                refreshToken: xboxUser.refreshToken,
                clearanceToken: xboxUser.clearanceToken,
              },
            });

            set.status = 302;
            set.redirect = "/";
            return;
          }

          const userId = generateId(15);

          await client.user.create({
            data: {
              id: userId,
              username: xboxUser.gamertag,
              oid: user.oid,
              xuid: xboxUser.xuid,
            },
          });

          await client.oauth.create({
            data: {
              userId: userId,
              spartanToken: xboxUser.spartanToken.SpartanToken,
              spartanTokenExpiresAt:
                xboxUser.spartanToken.ExpiresUtc.ISO8601Date,
              refreshToken: xboxUser.refreshToken,
              clearanceToken: xboxUser.clearanceToken,
            },
          });

          const session = await lucia.createSession(userId, {});
          const sessionCookie = lucia.createSessionCookie(session.id);
          auth_session.set({
            value: sessionCookie.value,
            ...sessionCookie.attributes,
          });
          //TODO Look at the sessionCookie.attrubute
          //TODO See what attributes should be used for spartan token cookie
          //TODO See how we can refresh this spartan token as long as our session is active
          set.status = 302;
          set.redirect = "/";
          return;
        } catch (error) {
          console.error(error);
          if (error instanceof OAuth2RequestError) {
            set.status = 400;
            return;
          }
          set.status = 500;
          return;
        }
      },
    );
});
