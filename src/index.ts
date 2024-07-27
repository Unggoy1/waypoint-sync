import { Elysia } from "elysia";
import { login } from "./routes/login";
import { cors } from "@elysiajs/cors";
import dotenv from "dotenv";
import { cron, Patterns } from "@elysiajs/cron";
import { waypointSync, paint } from "./sync";
import * as Sentry from "@sentry/bun";

dotenv.config();
const PORT = process.env.PORT || 3000;

Sentry.init({
  dsn: "https://63208390aa276259472aeae4886a8de4@o4507187195019264.ingest.us.sentry.io/4507187239780352",
  // Performance Monitoring
  tracesSampleRate: 1.0, // Capture 100% of the transactions
});

const app = new Elysia()
  .use(
    cors({
      origin: process.env.URL || "localhost:5173", //TODO properly fix this and use ENV or replace this entirely
      allowedHeaders: ["Content-Type", "Authorization"],
      credentials: true,
    }),
  )
  .use(
    cron({
      name: "waypointSyncJob",
      pattern: Patterns.everyMinutes(30),
      run: async () => {
        const date = new Date();
        console.log(
          paint.blue("INFO: "),
          "Starting Cron Job: ",
          paint.cyan(date.toString()),
        );
        await waypointSync();
      },
    }),
  )
  // .get(
  //   "/stop",
  //   ({
  //     store: {
  //       cron: { waypointSyncJob },
  //     },
  //   }) => {
  //     waypointSyncJob.stop();
  //
  //     return "Stop heartbeat";
  //   },
  // )
  .get(
    "/status",
    ({
      store: {
        cron: { waypointSyncJob },
      },
    }) => {
      const time = waypointSyncJob.nextRun();

      return time?.toString();
    },
  )
  .get("/error", ({}) => {
    try {
      throw new Error("Sentry Bun Test");
    } catch (e) {
      Sentry.captureException(e);
    }
  })
  .get("/", () => "Hello Elysia")
  .use(login)
  .listen(PORT);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`,
);
