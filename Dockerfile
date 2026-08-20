FROM node:22

RUN useradd --create-home --shell /bin/bash agent

WORKDIR /app

RUN npm install -g tsx

COPY --chown=agent:agent package*.json tsconfig.json ./
RUN npm ci --production && chown -R agent:agent /app

COPY --chown=agent:agent src ./src
COPY --chown=agent:agent scripts ./scripts

RUN mkdir -p /app/data && chown agent:agent /app/data
USER agent

EXPOSE 8080

CMD ["tsx", "src/index.ts"]
