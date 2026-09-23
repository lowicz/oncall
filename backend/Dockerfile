# Build context: backend/ (docker-compose.dev.yml, .github/workflows/release.yml).
#
# Two stages. The first installs dependencies from uv.lock alone, so two
# builds of the same commit produce the same packages; the earlier
# `pip install .` resolved the version ranges in pyproject.toml afresh on every
# build. The second stage copies the finished virtual environment onto a plain
# Python image and runs as an unprivileged user. No BuildKit-only syntax, so
# `podman compose` builds it too.

# The Python minor CI tests (PYTHON_VERSION in .github/workflows/ci.yml) and
# requires-python allows. Renovate's "Python" group moves the three together
# and reads this line only in the `python:<major>.<minor>-slim` form.
ARG PYTHON_IMAGE=python:3.14-slim

FROM ${PYTHON_IMAGE} AS build
# The uv release pyproject.toml pins ([tool.uv] required-version); `uv sync`
# below refuses to run under any other.
COPY --from=ghcr.io/astral-sh/uv:0.12.18 /uv /bin/uv
WORKDIR /app
# Use the interpreter of this image, never a downloaded one, and leave no
# cache in the layer.
ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PYTHON_DOWNLOADS=never \
    UV_NO_CACHE=1
# Dependencies first, so a source change does not reinstall them.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
COPY migrations ./migrations
COPY alembic.ini entrypoint.sh ./
RUN uv sync --frozen --no-dev

FROM ${PYTHON_IMAGE}
# Set by the release workflow to the version tag; `dev` for local builds.
ARG ONCALL_VERSION=dev
ENV ONCALL_VERSION=${ONCALL_VERSION} \
    PATH=/app/.venv/bin:$PATH \
    PYTHONDONTWRITEBYTECODE=1
# A fixed numeric id, so the user resolves the same way on the host and in
# the image (volume permissions, `docker top`).
RUN groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid 10001 --home-dir /app --shell /usr/sbin/nologin app
WORKDIR /app
COPY --from=build --chown=10001:10001 /app /app
USER 10001:10001
EXPOSE 8000
CMD ["sh", "./entrypoint.sh"]
