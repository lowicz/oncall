# Uruchomienie

Wdrożenie to cztery kontenery: baza `db`, API `api`, proces roboczy `worker` i
serwer `web` (nginx), który podaje aplikację, tę dokumentację pod `/docs/` oraz
przekazuje `/api/` i `/calendar/` do API.

`api` i `worker` działają z jednego obrazu `ghcr.io/lowicz/oncall-api`, `web` z
obrazu `ghcr.io/lowicz/oncall-web`. Obrazy są publikowane dla każdego wydania
i oznaczone jego numerem - patrz [Wydania i wersje](wydania.md).

Plik `docker-compose.yml` działa **bez zmian** zarówno pod Docker Compose, jak i
pod Podman Compose. Nie używa żadnej składni ani zachowania, którego Podman
Compose nie zapewnia.

## Szybki start

```bash
cp .env.example .env
# ustaw ONCALL_VERSION (numer wydania, np. 1.2.3)
# oraz ONCALL_ADMIN_USERNAME i ONCALL_ADMIN_PASSWORD (min. 12 znaków)
docker compose pull
docker compose up -d
```

Pod Podmanem to samo polecenie z innym przedrostkiem:

```bash
podman compose pull
podman compose up -d
```

Aplikacja odpowiada na `http://localhost:8080`, API pod tym samym adresem na
`/api`, a dokumentacja na `http://localhost:8080/docs/`.

Bez `ONCALL_VERSION` w `.env` Compose odmawia startu i wypisuje, czego brakuje.
Każdy host ma w ten sposób zapisane, którą wersję uruchamia.

## Konto administratora

Przy każdym starcie API konto administratora jest zakładane albo
synchronizowane: hasło, nazwa wyświetlana, rola i status. Rotacja hasła wchodzi
w życie po restarcie usługi `api`. Z obiema zmiennymi pustymi krok jest
pomijany.

Migracje bazy wykonują się przy tym samym starcie, przed uruchomieniem API.
Usługa `web` czeka, aż `api` odpowie na `/api/v1/health`, więc po
`docker compose up -d` aplikacja jest dostępna dopiero po zakończeniu migracji.

## Dane demonstracyjne

```bash
docker compose exec -e ONCALL_DEMO_PASSWORD='local-demo-password' api \
  python -m oncall.seed_demo
```

Tworzy konta `admin`, `anna`, `marek`, `ola`, `piotr` i `viewer` z
dwutygodniowym grafikiem. `ONCALL_DEMO_EMAIL_DOMAIN` dopisuje im adresy
`{login}@{domena}`.

Konto `admin` bierze hasło z `ONCALL_ADMIN_PASSWORD`, jeśli zostało już
utworzone przez start API - pozostałe konta dostają hasło z
`ONCALL_DEMO_PASSWORD`.

## Najważniejsze zmienne

Pełna lista z komentarzami jest w `.env.example`.

| Zmienna | Domyślnie | Znaczenie |
| --- | --- | --- |
| `ONCALL_VERSION` | brak - wymagana | wersja obrazów do uruchomienia, patrz [Wydania](wydania.md) |
| `ONCALL_WEB_HTTP_PORT` | `8080` | port HTTP wystawiony na hosta |
| `ONCALL_WEB_HTTPS_PORT` | `8443` | port HTTPS wystawiony na hosta |
| `ONCALL_APP_NAME` | `On-call` | nazwa produktu w interfejsie, e-mailach i nazwach kalendarzy |
| `ONCALL_APP_SUBTITLE` | puste | drugi wiersz pod nazwą w nawigacji i na ekranie logowania; pusty ukrywa wiersz |
| `ONCALL_PUBLIC_BASE_URL` | `http://localhost:8080` | adres w e-mailach, kanałach ICS i linkach |
| `ONCALL_SESSION_COOKIE_SECURE` | `false` | ustaw `true` razem z TLS |
| `ONCALL_API_WORKERS` | puste | liczba procesów API; puste = z limitu CPU, minimum 2 |
| `ONCALL_SOLVER_WORKERS` | `8` | wątki CP-SAT |
| `ONCALL_GENERATION_CONCURRENCY` | `1` | równoległe generowania w procesie roboczym |
| `ONCALL_SMTP_HOST` | puste | puste wyłącza wysyłkę e-maili |
| `ONCALL_LDAP_ENABLED` | `false` | logowanie z katalogu |
| `ONCALL_TLS_ENABLED` | `false` | HTTPS na nginx - patrz [TLS](tls.md) |

Liczba procesów API razy rozmiar puli połączeń musi mieścić się poniżej
`max_connections` PostgreSQL.

Proces roboczy ma w Compose przydział 2 CPU i z niego wynika domyślna liczba
wątków solvera. Zmiana przydziału zmienia tę liczbę automatycznie.

## Aktualizacja

```bash
# w .env: ONCALL_VERSION=<nowy numer>
docker compose pull
docker compose up -d
```

Migracje bazy wykonują się przy starcie `api`. Cofnięcie do poprzedniej wersji
to ta sama sekwencja z poprzednim numerem - szczegóły w
[Wydania i wersje](wydania.md#aktualizacja-i-cofnięcie).

## Budowanie z repozytorium (praca deweloperska)

Budowanie obrazów z bieżącego checkoutu to **nakładka** na plik bazowy, tak
samo jak TLS. Plik `docker-compose.dev.yml` podmienia tylko źródło obrazów;
zmienne, healthchecki, wolumeny i porty zostają produkcyjne (CI pilnuje, żeby
nakładka nie zmieniała niczego więcej).

```bash
cp .env.example .env
# ONCALL_VERSION=dev  (plik bazowy wymaga wartości; nakładka i tak buduje lokalnie)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

Żeby nie powtarzać `-f`, wpisz raz do `.env`:

```bash
COMPOSE_FILE=docker-compose.yml:docker-compose.dev.yml
```

i od tej pory `docker compose up --build` buduje z repozytorium. Lokalne obrazy
nazywają się `oncall-api:dev` i `oncall-web:dev`, więc nigdy nie przykryją
pobranego obrazu z rejestru.

## Dokumentacja w obrazie

Obraz `web` zawiera tę dokumentację jako statyczne HTML. Powstaje ona podczas
budowania obrazu:

```
docs/*.md ──► frontend/scripts/build-docs.mjs ──► frontend/public/docs/ ──► dist/docs/
```

Skrypt jest podpięty pod `prebuild` w `frontend/package.json`, więc
`npm run build` zawsze renderuje aktualną dokumentację. Dlatego kontekstem
budowania obrazu `web` jest **katalog główny repozytorium**, a nie `frontend/`:
`docs/` leży poza katalogiem aplikacji.

Ten sam skrypt w trybie `--site` renderuje samodzielną stronę publikowaną na
GitHub Pages - patrz [Wydania i wersje](wydania.md#dokumentacja-na-github-pages).

Poza obrazem:

```bash
cd frontend
npm install
npm run build:docs        # wynik w frontend/public/docs/
npm run build:docs:site   # samodzielna strona w site/ (jak na GitHub Pages)
```

Skrypt jest równocześnie testem dokumentacji: przerywa budowanie, gdy plik
`.md` nie jest wpisany do `docs/toc.json` (albo odwrotnie), gdy odsyłacz
prowadzi poza drzewo dokumentacji i gdy kotwica `#` nie odpowiada żadnemu
nagłówkowi.

## Uruchomienie lokalne bez kontenerów

Backend:

```bash
docker compose up -d db
cd backend
uv sync --extra dev
uv run alembic upgrade head
ONCALL_ADMIN_USERNAME=admin ONCALL_ADMIN_PASSWORD='change-me-now' uv run python -m oncall.seed_admin
uv run uvicorn oncall.main:app --reload
```

(`docker compose up -d db` wymaga `ONCALL_VERSION` w `.env`, choć baza go nie
używa - dowolna wartość wystarczy. uv musi być w wersji z `required-version`
w `backend/pyproject.toml`; w innej odmawia pracy i podaje polecenie, które ją
instaluje.)

Frontend:

```bash
cd frontend
npm install
npm run build:docs   # dokumentacja pod http://localhost:5173/docs/
npm run dev          # http://localhost:5173, /api przekazywane na :8000
```

## Podman

`podman compose` deleguje do zainstalowanego dostawcy Compose i akceptuje te
same pliki bez zmian. Trzy rzeczy warto wiedzieć:

- **Gniazdo API.** Dostawca Compose rozmawia z Podmanem przez gniazdo
  użytkownika. Jeśli polecenie kończy się komunikatem „failed to connect to the
  docker API”, uruchom raz `systemctl --user start podman.socket`.
- **Tryb bezrootowy.** Porty poniżej 1024 wymagają uprawnień; domyślne `8080` i
  `8443` działają bez nich.
- **Brakujące źródło montowania** zachowuje się tak samo jak pod Dockerem:
  nieistniejąca ścieżka hosta zostaje utworzona jako pusty katalog, zamiast
  zatrzymać start. Dlatego plik bazowy nie montuje niczego z hosta, a
  montowania TLS są w osobnej nakładce, która sprawdza każdy plik przy
  starcie - patrz [TLS](tls.md).

Sprawdzenie samych plików, bez uruchamiania:

```bash
docker compose config --quiet
docker compose -f docker-compose.yml -f docker-compose.dev.yml config --quiet
podman compose config --quiet
```
