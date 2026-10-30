FROM node:20-alpine AS builder
WORKDIR /app
RUN npm install -g pnpm@12.16.1
COPY package.json pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/audit-service ./apps/audit-service
RUN pnpm install --frozen-lockfile=false
RUN pnpm --filter @nijakavach/audit-service build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN npm install -g pnpm@12.16.1
COPY --from=builder /app ./
EXPOSE 4009
CMD ["node", "apps/audit-service/dist/main.js"]
