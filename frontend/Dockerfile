# Build context is the repository root (see docker-compose.yml): the image
# carries both the application and the documentation, and docs/ lives outside
# frontend/.

# The Node major CI tests with (NODE_VERSION in .github/workflows/ci.yml,
# node-version in pages.yml). Renovate's "Node.js" group moves them together
# and reads this line only in the `node:<major>-alpine` form.
FROM node:24-alpine AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# `npm run build` renders these into the production assets before Vite runs;
# /docs is where scripts/build-docs.mjs looks, one level above the app root.
COPY docs/ /docs/
RUN npm run build

# The official nginx build for an unprivileged user: master and workers run as
# uid 101, the pid file and temporary files live in /tmp, and the server
# listens on 8080 (HTTP) and 8443 (HTTPS), since binding below 1024 needs a
# capability the container does not have. Compose runs it with a read-only root
# filesystem; /tmp and /etc/nginx/conf.d are its only writable paths there.
#
# Pinned to one nginx release, `<major>.<minor>.<patch>-alpine`, never a
# floating tag such as `1.31-alpine`: every build of a commit starts from the
# nginx the pull request's CI built, and a new nginx reaches a release only
# through a reviewed Renovate pull request. Renovate reads this line with the
# nginx custom manager in renovate.json5 and moves only the version number;
# frontend/scripts/nginx-base-image.test.mjs fails on any other tag form.
FROM nginxinc/nginx-unprivileged:1.31.6-alpine
# Set by the release workflow to the version tag; `dev` for local builds.
ARG ONCALL_VERSION=dev
ENV ONCALL_VERSION=${ONCALL_VERSION}
# Root only to install the files below: they stay root-owned, so the nginx
# user can read them but never change them.
USER root
COPY frontend/nginx.http.conf /etc/nginx/presets/http.conf
COPY frontend/nginx.https.conf /etc/nginx/presets/https.conf
# Included by both presets at /etc/nginx/security-headers.conf.
COPY frontend/nginx-security-headers.conf /etc/nginx/security-headers.conf
# Included by the proxied locations of both presets at /etc/nginx/proxy.conf.
COPY frontend/nginx-proxy.conf /etc/nginx/proxy.conf
COPY frontend/docker-entrypoint.d/40-tls.sh /docker-entrypoint.d/40-tls.sh
RUN chmod 0755 /docker-entrypoint.d/40-tls.sh
COPY --from=build /app/dist /usr/share/nginx/html
USER 101:101
EXPOSE 8080 8443
