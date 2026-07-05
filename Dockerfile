FROM node:20-alpine

WORKDIR /app

RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY . .

ENV NODE_ENV=production
ENV PORT=3080

EXPOSE 3080

CMD ["pnpm", "start"]
