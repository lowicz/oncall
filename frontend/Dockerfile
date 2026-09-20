# Build context is the repository root (see docker-compose.yml): the image
# carries both the application and the documentation, and docs/ lives outside
# frontend/.
FROM node:22-alpine AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# `npm run build` renders these into the production assets before Vite runs;
# /docs is where scripts/build-docs.mjs looks, one level above the app root.
COPY docs/ /docs/
RUN npm run build

FROM nginx:1.27-alpine
COPY frontend/nginx.http.conf /etc/nginx/presets/http.conf
COPY frontend/nginx.https.conf /etc/nginx/presets/https.conf
COPY frontend/docker-entrypoint.d/40-tls.sh /docker-entrypoint.d/40-tls.sh
RUN chmod +x /docker-entrypoint.d/40-tls.sh
COPY --from=build /app/dist /usr/share/nginx/html
