# Conecta TV — imagem do aplicativo (servidor + interface).
# Uso:  docker build -t conecta-tv . && docker run -p 3000:3000 -e ACESSO_CODIGO=seu-codigo conecta-tv
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# Dependências primeiro: mudar o código não reinstala tudo.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY . .

# Nada de segredo dentro da imagem.
RUN rm -f config.local.json acessos.json

ENV PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
