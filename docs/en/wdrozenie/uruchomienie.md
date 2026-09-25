# Running the stack

The deployment is four containers: the database `db`, the API `api`, the worker
process `worker` and the `web` server (nginx), which serves the application,
this documentation under `/docs/` and forwards `/api/` and `/calendar/` to the
API.

`api` and `worker` run from one image, `ghcr.io/lowicz/oncall-api`; `web` from
the image `ghcr.io/lowicz/oncall-web`. The images are published for every
release and tagged with its number - see [Releases and versions](wydania.md).

The `docker-compose.yml` file works **unchanged** under both Docker Compose and
Podman Compose. It uses no syntax or behaviour that Podman Compose does not
provide.

## Quick start

```bash
cp .env.example .env
# set ONCALL_VERSION (the release number, e.g. 1.2.3)
# and ONCALL_ADMIN_USERNAME and ONCALL_ADMIN_PASSWORD (at least 12 characters);
# anywhere other than your own computer also POSTGRES_PASSWORD and ONCALL_DATABASE_URL
docker compose pull
docker compose up -d
```

Under Podman it is the same command with a different prefix:

```bash
podman compose pull
podman compose up -d
```

The application answers at `http://localhost:8080`, the API at the same address
under `/api`, and the documentation at `http://localhost:8080/docs/`.

Without `ONCALL_VERSION` in `.env` Compose refuses to start and prints what is
missing. This way every host has a record of which version it runs.

The database password from `.env.example` is publicly known and serves local
work only. Every host other than your own computer sets its own before the
first start - see [Database password](#database-password).

## Administrator account

On every API start the administrator account is created or synchronised:
password, display name, role and status. A password rotation takes effect
after a restart of the `api` service. With both variables empty the step is
skipped.

Database migrations run at the same start, before the API comes up. The `web`
service waits until `api` answers on `/api/v1/health`, so after
`docker compose up -d` the application becomes available only once the
migrations have finished.

## Demo data

```bash
docker compose exec -e ONCALL_DEMO_PASSWORD='local-demo-password' api \
  python -m oncall.seed_demo
```

Creates the accounts `admin`, `anna`, `marek`, `ola`, `piotr` and `viewer` with
a two-week schedule. `ONCALL_DEMO_EMAIL_DOMAIN` gives them `{login}@{domain}`
addresses.

The `admin` account takes its password from `ONCALL_ADMIN_PASSWORD` if it has
already been created by the API start - the other accounts get the password
from `ONCALL_DEMO_PASSWORD`.

## Key variables

The full list with comments is in `.env.example`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `ONCALL_VERSION` | none - required | the image version to run, see [Releases](wydania.md) |
| `POSTGRES_PASSWORD` | local, publicly known | the database password; unique anywhere other than your own computer, see [Database password](#database-password) |
| `ONCALL_DATABASE_URL` | the address with the local password | the connection of `api` and `worker` to the database; the same password as `POSTGRES_PASSWORD` |
| `ONCALL_WEB_HTTP_PORT` | `8080` | the HTTP port exposed on the host |
| `ONCALL_WEB_HTTPS_PORT` | `8443` | the HTTPS port exposed on the host |
| `ONCALL_APP_NAME` | `On-call` | the product name in the interface, e-mails and calendar names |
| `ONCALL_APP_SUBTITLE` | empty | the second line under the name in the navigation, on the sign-in screen and in the e-mail header; empty hides the line |
| `ONCALL_PUBLIC_BASE_URL` | `http://localhost:8080` | the address in e-mails, ICS feeds and links |
| `ONCALL_SESSION_COOKIE_SECURE` | `false` | set `true` together with TLS |
| `ONCALL_API_WORKERS` | empty | the number of API processes; empty = from the CPU limit, minimum 2 |
| `ONCALL_SOLVER_WORKERS` | `8` | CP-SAT threads |
| `ONCALL_GENERATION_CONCURRENCY` | `1` | parallel generations in the worker process |
| `ONCALL_SMTP_HOST` | empty | empty disables e-mail sending |
| `ONCALL_LDAP_ENABLED` | `false` | directory sign-in - see [LDAP / Active Directory](ldap.md) |
| `ONCALL_TLS_ENABLED` | `false` | HTTPS on nginx - see [TLS](tls.md) |

The number of API processes times the connection pool size must stay below
PostgreSQL's `max_connections`.

In Compose the worker process has an allocation of 2 CPUs, and the default
number of solver threads follows from it. Changing the allocation changes that
number automatically.

## Database password

`.env.example` and `docker-compose.yml` have a default PostgreSQL password, the
same in every copy of the repository. It is publicly known and exists solely
for the convenience of local work: `docker compose up` on your own computer
works without any additional configuration.

**Every deployment other than a local one** - a test server, a pre-production
server, a production server, any machine shared with others - sets two values
in `.env` before the first start:

- `POSTGRES_PASSWORD` - a unique, random password for this deployment, e.g.
  from `openssl rand -hex 32`;
- `ONCALL_DATABASE_URL` - the address with that same password and the same
  user and database as `POSTGRES_USER` and `POSTGRES_DB`.

```bash
POSTGRES_PASSWORD=<unique password>
ONCALL_DATABASE_URL=postgresql+asyncpg://oncall:<the same password>@db:5432/oncall
```

`api` and `worker` read the same `ONCALL_DATABASE_URL`, so it is one change in
`.env`. A password from `openssl rand -hex` has only digits and the letters
`a-f`; characters such as `@`, `:`, `/`, `#` or `%` have to be percent-encoded
in the address (`@` is `%40`).

**The `postgres` image reads `POSTGRES_PASSWORD` only once**, when it
initialises the empty `oncall-db` volume. On an existing database a change in
`.env` changes nothing in PostgreSQL, and `api` and `worker` stop connecting.
The password of a running database is changed first in the database itself,
then in `.env`:

```bash
docker compose exec db psql -U oncall -d oncall -c '\password oncall'
# in .env: the new POSTGRES_PASSWORD and the same password in ONCALL_DATABASE_URL
docker compose up -d
```

`psql` asks for the new password twice and does not store it in the shell
history. `docker compose up -d` recreates the containers whose configuration
has changed.

### Trust boundary

In `docker-compose.yml` the `db` service publishes no port: PostgreSQL listens
on 5432 only in this project's Compose network, where `api` and `worker`
connect to it. The database cannot be reached either from other machines or
through `localhost` on the host. CI makes sure that neither the base file nor
any overlay in the repository adds a port to it
(`.github/scripts/compose-hardening.sh`).

The password therefore protects the database from whatever has access to the
container network:

- from other containers attached to the Compose network, e.g. a reverse proxy
  directing traffic to `web:8080`;
- from a compromised `web` service, which is in the same network as the
  database;
- under Docker on Linux also from users of the host itself, because the
  container's address in the bridge network is reachable from the host.

Whoever has access to the Docker or Podman daemon on the host has full access
to the database regardless of the password. An overlay of your own that adds a
port to the `db` service moves the database outside this boundary: the unique
password is then its only protection, and the port should listen only on
`127.0.0.1`.

## Container privileges

Every service runs with a **read-only** root filesystem, with no kernel
capabilities (`cap_drop: [ALL]`) and with `no-new-privileges`. It writes only
to its own `tmpfs` mounts and volumes:

| Service | User | Writes | Ports in the container |
| --- | --- | --- | --- |
| `db` | `postgres` (70) | the `oncall-db` volume, `/var/run/postgresql`, `/tmp` | 5432 |
| `api` | `10001` | `/tmp` | 8000 |
| `worker` | `10001` | `/tmp` | - |
| `web` | `101` (nginx) | `/tmp`, `/etc/nginx/conf.d` | 8080, 8443 |

- **`web` listens on 8080 and 8443.** An unprivileged user cannot open a port
  below 1024, so nginx in the container uses 8080 (HTTP) and 8443 (HTTPS).
  `ONCALL_WEB_HTTP_PORT` and `ONCALL_WEB_HTTPS_PORT` still choose the host
  ports. A reverse proxy in the same Compose network directs traffic to
  `web:8080`.
- **The TLS key is read by user `101`.** The owner and permissions of the key -
  see [TLS](tls.md#file-permissions).
- **The database gets a few capabilities back.** The `postgres` image's
  entrypoint script starts as root, hands the data directory over to the
  `postgres` user and switches to it, for which it needs `CHOWN`,
  `DAC_READ_SEARCH`, `FOWNER`, `SETUID` and `SETGID`. The database server
  itself then runs with none.
- **`tmpfs` is RAM.** nginx's temporary files (large API responses) count
  towards the container's memory.

CI checks these settings for the base file and every overlay
(`.github/scripts/compose-hardening.sh`) and rejects an image that would run
as root.

## Updating

The Compose files belong to the release just as the images do: they assume the
same ports, users and write paths. Take them from the same git tag as
`ONCALL_VERSION`:

```bash
git fetch --tags
git checkout v<new number>
# in .env: ONCALL_VERSION=<new number>
docker compose pull
docker compose up -d
```

Database migrations run at the start of `api`. Rolling back to the previous
version is the same sequence with the previous number - details in
[Releases and versions](wydania.md#update-and-rollback).

## Building from the repository (development work)

Building the images from the current checkout is an **overlay** on the base
file, just like TLS. The `docker-compose.dev.yml` file replaces only the source
of the images; the variables, healthchecks, volumes and ports stay as in
production (CI makes sure the overlay changes nothing else).

```bash
cp .env.example .env
# ONCALL_VERSION=dev  (the base file requires a value; the overlay builds locally anyway)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

To avoid repeating `-f`, put this into `.env` once:

```bash
COMPOSE_FILE=docker-compose.yml:docker-compose.dev.yml
```

and from then on `docker compose up --build` builds from the repository. The
local images are named `oncall-api:dev` and `oncall-web:dev`, so they never
overwrite an image pulled from the registry.

## Documentation in the image

The `web` image contains this documentation as static HTML. It is produced
while the image is built:

```
docs/*.md ──► frontend/scripts/build-docs.mjs ──► frontend/public/docs/ ──► dist/docs/
```

The script is hooked into `prebuild` in `frontend/package.json`, so
`npm run build` always renders the current documentation. That is why the
build context of the `web` image is the **repository root**, not `frontend/`:
`docs/` lies outside the application directory.

The same script in `--site` mode renders the standalone site published on
GitHub Pages - see [Releases and versions](wydania.md#documentation-on-github-pages).

Outside the image:

```bash
cd frontend
npm install
npm run build:docs        # output in frontend/public/docs/
npm run build:docs:site   # standalone site in site/ (as on GitHub Pages)
```

The script is at the same time a test of the documentation: it aborts the
build when an `.md` file is not listed in `docs/toc.json` (or the other way
round), when a link leads outside the documentation tree, and when a `#`
anchor matches no heading.

## Running locally without containers

Backend:

```bash
docker compose up -d db
cd backend
uv sync --extra dev
uv run alembic upgrade head
ONCALL_ADMIN_USERNAME=admin ONCALL_ADMIN_PASSWORD='change-me-now' uv run python -m oncall.seed_admin
uv run uvicorn oncall.main:app --reload
```

(`docker compose up -d db` requires `ONCALL_VERSION` in `.env`, although the
database does not use it - any value will do. uv must be the version given in
`required-version` in `backend/pyproject.toml`; any other version refuses to
work and prints the command that installs it.)

Frontend:

```bash
cd frontend
npm install
npm run build:docs   # documentation at http://localhost:5173/docs/
npm run dev          # http://localhost:5173, /api forwarded to :8000
```

## Podman

`podman compose` delegates to the installed Compose provider and accepts the
same files unchanged. Five things are worth knowing:

- **The API socket.** The Compose provider talks to Podman through the user
  socket. If the command ends with the message “failed to connect to the
  docker API”, run `systemctl --user start podman.socket` once.
- **Rootless mode.** Ports below 1024 require privileges; the default `8080`
  and `8443` work without them.
- **Container users have different numbers on the host.** The TLS key that
  nginx reads (`101` in the container) gets its owner through
  `podman unshare chown` - see [TLS](tls.md#file-permissions).
- **A missing mount source** behaves the same as under Docker: a non-existent
  host path is created as an empty directory instead of stopping the start.
  That is why the base file mounts nothing from the host, and the TLS mounts
  are in a separate overlay, which checks every file at start - see
  [TLS](tls.md).
- **Start after a reboot.** The systemd user unit, linger and the setup
  script - see [Systemd (Podman Compose)](systemd.md).

Checking the files themselves, without starting anything:

```bash
docker compose config --quiet
docker compose -f docker-compose.yml -f docker-compose.dev.yml config --quiet
podman compose config --quiet
```
