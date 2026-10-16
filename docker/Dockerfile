FROM node:22-bookworm-slim AS builder
WORKDIR /app

# Prisma needs openssl present to detect the correct libssl flavour; without it
# it emits a warning and falls back to openssl-1.1.x.
RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY . .
RUN npm ci
RUN DATABASE_URL="postgresql://jobpilot:buildplaceholder@localhost:5432/jobpilot" npx prisma generate --schema=prisma/schema.prisma
ARG API_INTERNAL_URL=http://job-pilot-api:3001
ENV API_INTERNAL_URL=${API_INTERNAL_URL}
RUN npm run build

FROM builder AS api
CMD ["npm", "run", "start", "--workspace=@shs/api"]

FROM builder AS worker
CMD ["npm", "run", "start", "--workspace=@shs/worker"]

FROM builder AS web
EXPOSE 3000
CMD ["npm", "run", "start", "--workspace=@shs/web"]
