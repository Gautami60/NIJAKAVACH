FROM node:20-alpine AS builder
WORKDIR /app
RUN npm install -g pnpm@12.16.1
COPY package.json pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/discovery-service ./apps/discovery-service
RUN pnpm install --frozen-lockfile=false
RUN pnpm --filter @nijakavach/discovery-service build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN npm install -g pnpm@12.16.1
COPY --from=builder /app ./
EXPOSE 4004
CMD ["node", "apps/discovery-service/dist/main.js"]
