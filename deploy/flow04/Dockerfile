FROM node:22.22.3-bookworm-slim
WORKDIR /app
RUN npm install --global pnpm@11.9.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts && pnpm rebuild argon2
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN pnpm build
RUN install -d -m 0700 -o node -g node /var/lib/arimms/ticket-evidence
LABEL org.arimms.ticket.archive-aware="1"
USER node
EXPOSE 8082
CMD ["node", "dist/main.js"]
