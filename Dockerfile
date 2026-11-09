# 프록시 뒤라면 호스팅에 맞게 TRUST_PROXY=<프록시 단계 수> 를 설정한다 (예: 1)
# SnowHaven 게임 서버 (WebSocket 릴레이). 클라이언트(정적 파일)는 별도로 배포한다.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY src/net/protocol.ts ./src/net/protocol.ts
COPY tsconfig.json ./tsconfig.json
RUN chown -R node:node /app
USER node
ENV PORT=8787
EXPOSE 8787
CMD ["node_modules/.bin/tsx", "server/index.ts"]
