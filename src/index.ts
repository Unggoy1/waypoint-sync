import { Elysia } from "elysia";
import { login } from "./routes/login";
import { cors } from "@elysiajs/cors";
import { cron, Patterns } from "@elysiajs/cron";
import { waypointSync, paint, syncDelete, AssetKind } from "./sync";
import * as Sentry from "@sentry/bun";
import { client } from "./lucia";

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
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`,
);
