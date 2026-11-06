# ---------- build stage -------------------------------------------------------
# Install ALL dependencies (including dev tools) and compile TypeScript.
FROM node:24-alpine AS build

WORKDIR /app

# Copy only the manifests first. Docker caches this layer, so `npm ci` reruns
# only when dependencies change, not on every source edit.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

# ---------- runtime stage -----------------------------------------------------
# A small image containing production dependencies and compiled output only.
FROM node:24-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# Run as the unprivileged `node` user that the official image provides.
USER node

EXPOSE 3000

# `dist/main.js` is what `npm run start:prod` executes too.
CMD ["node", "dist/main.js"]
