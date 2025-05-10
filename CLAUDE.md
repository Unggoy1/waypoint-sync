# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Waypoint-sync is a server application that mirrors User Generated Content (UGC) data from Halo Waypoint into the Unggoy Database. This data is then used for display on unggoy-web through unggoy-api. The application primarily synchronizes map, prefab, and game mode data from Halo Waypoint, handling authentication with Microsoft/Xbox Live services.

## Environment Setup

The project uses:
- Bun as the JavaScript/TypeScript runtime
- Elysia.js as the web framework
- Prisma for database ORM
- MySQL as the database

## Common Commands

### Development

```bash
# Install dependencies
bun install

# Generate Prisma client
npx prisma generate

# Run development server with hot reload
bun run dev

# Build the application
bun run build

# Run in production mode
bun run start
```

### Docker

```bash
# Build Docker image
docker build -t waypoint-sync .

# Run Docker container
docker run -p 3200:3000 -e DATABASE_URL=your_db_url -e CRON_USER=your_user_id waypoint-sync
```

## Application Architecture

### Core Components

1. **Authentication System** (`auth.ts`, `authTools.ts`, `lucia.ts`)
   - Handles OAuth authentication with Microsoft/Entra ID
   - Exchanges tokens for Xbox Live and Halo Waypoint access
   - Manages user sessions and refresh tokens

2. **Sync System** (`sync.ts`)
   - Core functionality that fetches UGC assets from Halo Waypoint API
   - Syncs maps, prefabs, and game modes
   - Tracks deleted assets and marks them in the database
   - Handles recommended assets sync

3. **Server & Routes** (`index.ts`, `routes/login.ts`)
   - Elysia.js server configuration
   - CORS setup
   - Scheduled cron jobs for periodic syncing
   - API endpoints for status checks and login

4. **Database Models** (`prisma/schema.prisma`)
   - User data including Xbox authentication
   - UGC assets (maps, prefabs, modes)
   - Contributors and authors
   - Tags, playlists, and waypoint sync state

### Sync Process

The application runs scheduled jobs that:
1. Authenticate with Halo Waypoint using stored credentials
2. Fetch UGC assets (maps, prefabs, game modes) from Waypoint API
3. Store or update assets in the database
4. Track contributors and their metadata
5. Run cleanup jobs to mark deleted assets
6. Sync recommended assets from featured Waypoint content

### Environment Variables

Required environment variables:
- `DATABASE_URL`: MySQL connection string
- `CRON_USER`: User ID for automated sync jobs
- `PORT`: (Optional) Server port (defaults to 3200)
- `URL`: (Optional) CORS origin (defaults to localhost:5173)

## Important Notes

1. The system relies on Microsoft/Xbox authentication tokens that expire, so token refresh logic is critical
2. Sync jobs run on a schedule defined in `index.ts` using cron patterns
3. Error handling uses Sentry for monitoring and reporting
4. The sync process is designed to be incremental, using timestamps to only fetch new or updated content