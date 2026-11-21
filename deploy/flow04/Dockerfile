FROM node:22.22.3-bookworm-slim
WORKDIR /app
RUN npm install --global pnpm@11.9.0
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts && pnpm rebuild argon2
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN pnpm build
USER node
EXPOSE 8082
CMD ["node", "dist/main.js"]
