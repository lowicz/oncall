FROM python:3.14-slim

WORKDIR /app
COPY pyproject.toml alembic.ini ./
COPY migrations ./migrations
COPY src ./src
COPY entrypoint.sh ./entrypoint.sh
RUN pip install --no-cache-dir .

CMD ["sh", "./entrypoint.sh"]
