# 洛克农场 · 抖音去水印服务 —— 零依赖，无需 npm install
FROM node:22-alpine

# 时区（日志可读）
ENV TZ=Asia/Shanghai

WORKDIR /app

# 本项目零第三方依赖，只拷源码即可
COPY package.json ./
COPY src ./src

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    MAX_CONCURRENT=8 \
    TTWID_CACHE_FILE=/data/ttwid.json

RUN mkdir -p /data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=6s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
