FROM node:22-bookworm-slim AS builder
WORKDIR /app

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
