# SnowHaven: 게임 화면(정적 파일)과 멀티플레이 서버를 한 컨테이너에서 내보낸다.
# 프록시 뒤라면 호스팅에 맞게 TRUST_PROXY=<프록시 단계 수> 를 설정한다 (예: 1)

# 1단계: 클라이언트 빌드 (dist/)
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx vite build

# 2단계: 실행용 (서버 + dist)
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY src/net/protocol.ts ./src/net/protocol.ts
COPY tsconfig.json ./tsconfig.json
COPY --from=build /app/dist ./dist
RUN chown -R node:node /app
USER node
ENV PORT=8787
EXPOSE 8787
CMD ["node_modules/.bin/tsx", "server/index.ts"]
