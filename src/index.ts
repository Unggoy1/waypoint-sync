import { Elysia } from "elysia";
import { login } from "./routes/login";
import { cors } from "@elysiajs/cors";
import { cron, Patterns } from "@elysiajs/cron";
import { waypointSync, paint, syncDelete, AssetKind } from "./sync";
import * as Sentry from "@sentry/bun";
import { client } from "./lucia";

// IMPORTANT: TEMPORARY CHANGE FOR 2-MONTH BACKFILL
// After completing the backfill (this will take several days), change the
// waypointSyncJob cron schedule back to the original every-3-hours pattern:
// pattern: "10 5,8,11,14,17,20,23,2 * * *"
// The current schedule runs only 3 times per day to allow longer sync windows

const PORT = process.env.PORT || 3200;

Sentry.init({
  dsn: "https://63208390aa276259472aeae4886a8de4@o4507187195019264.ingest.us.sentry.io/4507187239780352",
  // Performance Monitoring
  tracesSampleRate: 1.0, // Capture 100% of the transactions
});
function everyDayAt(time = "00:00") {
  const [hours, minutes] = time.split(":");
  return `${minutes} ${hours} * * *`;
}

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
      // Modified for 2-month backfill: running once per day at night (PDT)
      // This gives each job a full 24 hours to complete, which should be sufficient
      // even with enhanced rate limiting and the large 2-month backlog
      pattern: Patterns.everyHours(1),//Runs every hour
      run: async () => {
        const date = new Date();
        console.log(
          paint.blue("INFO: "),
          "Starting Backfill Sync Job: ",
          paint.cyan(date.toString()),
        );

        // Wrap in a try/catch to ensure we log any failures
        try {
          // Track total execution time
          const startTime = Date.now();
          await waypointSync();
          const elapsedMinutes = (Date.now() - startTime) / (1000 * 60);
          console.log(
            paint.blue("INFO: "),
            `Backfill Sync Job completed in ${elapsedMinutes.toFixed(2)} minutes`
          );
        } catch (error) {
          console.error(paint.red("ERROR: "), "Backfill Sync Job failed:", error);
          Sentry.captureException(error);
        }
      },
    }),
  )
  .use(
    cron({
      name: "waypointDeleteJob",
      pattern: everyDayAt("18:10"),
      run: async () => {
        const date = new Date();
        console.log(
          paint.blue("INFO: "),
          "Starting JOB JOB Cron Job: ",
          paint.cyan(date.toString()),
        );
        await syncDelete(AssetKind.Map);
        await syncDelete(AssetKind.Prefab);
        await syncDelete(AssetKind.Mode);
      },
    }),
  )
  .use(
    cron({
      name: "waypointDeleteJob2",
      pattern: everyDayAt("6:10"),
      run: async () => {
        const date = new Date();
        console.log(
          paint.blue("INFO: "),
          "Starting JOB JOB Cron Job: ",
          paint.cyan(date.toString()),
        );
        await syncDelete(AssetKind.Map);
        await syncDelete(AssetKind.Prefab);
        await syncDelete(AssetKind.Mode);
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
  .get("/", () => "Hello Elysia")
  .use(login)
  .listen(PORT);

Sentry.getCurrentScope().setLevel("error");
const userId = process.env.CRON_USER;
if (!userId) {
  Sentry.captureMessage("Error: Missing userId in ENV");
  console.error(`failed to GET USER FROM ENV`);
  process.exit(1);
}

console.log(
  `🦊 Elysia is running in the 90s at ${app.server?.hostname}:${app.server?.port}`,
);
