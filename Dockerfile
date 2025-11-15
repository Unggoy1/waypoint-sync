# Build stage
FROM oven/bun:1.2 AS build

# Install Node.js (required for Prisma)
RUN apt-get update && apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

RUN apt-get update -y && apt-get install -y openssl

WORKDIR /app

# Copy package.json and lockfile
COPY package.json bun.lockb* ./

# Copy Prisma schema
COPY prisma ./prisma

# Install dependencies
RUN bun install

# Generate Prisma client
RUN bunx prisma generate

# Copy source files
COPY ./src ./src

# Copy skiplist.json template (optional, can be overridden with volume mount)
COPY skiplist.json ./skiplist.json

# Build the application
ENV NODE_ENV=production
RUN bun build \
    --compile \
    --minify-whitespace \
    --minify-syntax \
    --target bun \
    --outfile server \
    ./src/index.ts

# Production stage
FROM oven/bun:1.2 AS production

WORKDIR /app

# Copy the compiled server and Prisma generated files
COPY --from=build /app/server server
COPY --from=build /app/node_modules/.prisma node_modules/.prisma

# Copy skiplist.json template (can be overridden with volume mount)
COPY --from=build /app/skiplist.json skiplist.json

# Set production environment
ENV NODE_ENV=production

# Volume for skiplist.json - mount your custom skiplist to override the default
# Example: docker run -v /path/to/your/skiplist.json:/app/skiplist.json ...
VOLUME ["/app/skiplist.json"]

# Run the server
CMD ["./server"]

# Expose the port
EXPOSE 3000
