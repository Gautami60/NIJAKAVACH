FROM node:20-alpine AS builder
WORKDIR /app
RUN npm install -g pnpm@12.16.1
COPY package.json pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/source-registry-service ./apps/source-registry-service
RUN pnpm install --frozen-lockfile=false
RUN pnpm --filter @nijakavach/source-registry-service build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN npm install -g pnpm@12.16.1
COPY --from=builder /app ./
EXPOSE 4003
CMD ["node", "apps/source-registry-service/dist/main.js"]
