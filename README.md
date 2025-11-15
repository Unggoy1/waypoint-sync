# waypoint-sync
A server app responsible for mirroring UGC data from Halo Waypoint into the Unggoy Database for display on unggoy-web through unggoy-api

## Skip List for Buggy Assets

Some AssetIDs from Halo Waypoint API may appear in global search results but fail when fetching individual asset details. To prevent these buggy assets from blocking the sync process, you can add them to a skip list.

### Configuration

The skip list is managed through a `skiplist.json` file:

```json
{
  "description": "List of AssetIDs to skip during sync",
  "assetIds": [
    "asset-id-1",
    "asset-id-2"
  ]
}
```

### Usage

#### Local Development

1. Edit `skiplist.json` in the project root
2. Add buggy AssetIDs to the `assetIds` array
3. Restart the application to load the updated skip list

#### Docker

When running in Docker, mount your custom skip list as a volume:

```bash
# Using docker run
docker run -p 3200:3000 \
  -v /path/to/your/skiplist.json:/app/skiplist.json \
  -e DATABASE_URL=your_db_url \
  -e CRON_USER=your_user_id \
  waypoint-sync

# Using docker-compose
services:
  waypoint-sync:
    image: waypoint-sync
    volumes:
      - ./skiplist.json:/app/skiplist.json
    environment:
      - DATABASE_URL=your_db_url
      - CRON_USER=your_user_id
```

#### Adding AssetIDs to Skip List

1. When you encounter a sync error for a specific AssetID, note the ID from the logs
2. Add the AssetID to your `skiplist.json` file
3. Restart the container: `docker restart waypoint-sync`

The skip list will be loaded on startup and assets in the list will be skipped during sync with a logged warning.
