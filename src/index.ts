import { Elysia } from "elysia";
import { login } from "./routes/login";
import { cors } from "@elysiajs/cors";
import dotenv from "dotenv";
import { cron, Patterns } from "@elysiajs/cron";
import { waypointSync } from "./sync";

dotenv.config();
const PORT = process.env.PORT || 3000;
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
      pattern: Patterns.everyHours(1),
      run: async () => {
        const date = new Date();
        console.log("Starting Cron Job: ", date.toString());
        await waypointSync();
      },
    }),
  )
  .get(
    "/stop",
    ({
      store: {
        cron: { waypointSyncJob },
      },
    }) => {
      waypointSyncJob.stop();

      return "Stop heartbeat";
    },
  )
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

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`,
);
