# AgentDock — single image, two runtime commands.
#
# The SAME image runs both processes; the command selects which:
#   web    → npm run start   (Next.js server, uses PORT; defaults to :3000)
#   worker → npm run worker  (claims run jobs and executes flows via tsx)
# docker-compose.yml runs them as two supervised services (restart: unless-stopped).
#
# The worker executes TypeScript directly (tsx) and spawns the first-party MCP
# servers as child processes from their prebuilt dist, so the runtime image keeps
# the full source + all dependencies (including tsx). Simplicity and a correct
# worker beat a smaller standalone image for an alpha.

FROM node:22-slim

# OpenSSL + CA certs for Prisma engines and outbound TLS (model APIs, Google).
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies against a cached layer (includes dev deps: the worker needs
# tsx, and the build needs typescript/prisma).
COPY package.json package-lock.json ./
RUN npm ci

# App source.
COPY . .

# Generate the Prisma client, compile the first-party MCP servers to dist, and
# build the Next.js app. No secrets are needed at build time (all routes are
# dynamic and read env at runtime).
RUN npx prisma generate \
  && npm run build:gmail \
  && npm run build:search \
  && npm run build

ENV NODE_ENV=production
# Bind Next to all interfaces inside the container.
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
EXPOSE 3000

# Default to the web server; Compose or Railway's worker config overrides this.
CMD ["npm", "run", "start"]
