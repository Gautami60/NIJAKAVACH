FROM node:20-alpine AS builder
WORKDIR /app
RUN npm install -g pnpm@12.16.1
COPY package.json pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/verification-service ./apps/verification-service
RUN pnpm install --frozen-lockfile=false
RUN pnpm --filter @nijakavach/verification-service build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN npm install -g pnpm@12.16.1
COPY --from=builder /app ./
EXPOSE 4007
CMD ["node", "apps/verification-service/dist/main.js"]
