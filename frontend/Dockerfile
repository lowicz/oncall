FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.http.conf /etc/nginx/presets/http.conf
COPY nginx.https.conf /etc/nginx/presets/https.conf
COPY docker-entrypoint.d/40-tls.sh /docker-entrypoint.d/40-tls.sh
RUN chmod +x /docker-entrypoint.d/40-tls.sh
COPY --from=build /app/dist /usr/share/nginx/html
