# syntax=docker/dockerfile:1

FROM node:20-alpine AS deps
WORKDIR /app

# The project is locked with pnpm, so install from the pnpm lockfile.
RUN npm install --global pnpm@10
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml ./
COPY . .

RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

EXPOSE 3000

CMD ["npm", "run", "start"]
