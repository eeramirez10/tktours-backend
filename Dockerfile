FROM node:22-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /app

RUN corepack enable \
  && corepack prepare pnpm@11.9.0 --activate \
  && apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

FROM base AS dependencies

# argon2 includes a native module. These tools provide a fallback when a prebuilt binary is unavailable.
RUN apt-get update \
  && apt-get install --yes --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS build

COPY prisma ./prisma
RUN pnpm prisma:generate

COPY tsconfig.json ./
COPY src ./src
RUN pnpm run build

# This target keeps the Prisma CLI and migration files. Invoke it with the compose migrate profile.
FROM build AS migrations
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]

FROM build AS production-dependencies
RUN pnpm prune --prod

FROM base AS runtime

ENV NODE_ENV=production
ENV PORT=4001
ENV RESOURCES_STORAGE_DIR=/app/storage/resources

RUN groupadd --gid 10001 app \
  && useradd --uid 10001 --gid app --create-home --shell /usr/sbin/nologin app

COPY --chown=app:app package.json ./
COPY --from=production-dependencies --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist

RUN mkdir --parents /app/storage/resources \
  && chown --recursive app:app /app/storage

USER app

EXPOSE 4001

CMD ["node", "dist/src/index.js"]
