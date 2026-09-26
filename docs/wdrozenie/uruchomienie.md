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
# oraz ONCALL_ADMIN_USERNAME i ONCALL_ADMIN_PASSWORD (min. 12 znaków);
# poza własnym komputerem także POSTGRES_PASSWORD i ONCALL_DATABASE_URL
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

Hasło bazy z `.env.example` jest publicznie znane i służy tylko pracy lokalnej.
Każdy host inny niż własny komputer ustawia przed pierwszym startem własne -
patrz [Hasło bazy danych](#hasło-bazy-danych).

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
| `POSTGRES_PASSWORD` | lokalne, publicznie znane | hasło bazy; poza własnym komputerem unikalne, patrz [Hasło bazy danych](#hasło-bazy-danych) |
| `ONCALL_DATABASE_URL` | adres z lokalnym hasłem | połączenie `api` i `worker` z bazą; to samo hasło co `POSTGRES_PASSWORD` |
| `ONCALL_WEB_HTTP_PORT` | `8080` | port HTTP wystawiony na hosta |
| `ONCALL_WEB_HTTPS_PORT` | `8443` | port HTTPS wystawiony na hosta |
| `ONCALL_APP_NAME` | `On-call` | nazwa produktu w interfejsie, e-mailach i nazwach kalendarzy |
| `ONCALL_APP_SUBTITLE` | puste | drugi wiersz pod nazwą w nawigacji, na ekranie logowania i w nagłówku e-maili; pusty ukrywa wiersz |
| `ONCALL_PUBLIC_BASE_URL` | `http://localhost:8080` | adres w e-mailach, kanałach ICS i linkach |
| `ONCALL_SESSION_COOKIE_SECURE` | `false` | ustaw `true` razem z TLS |
| `ONCALL_API_WORKERS` | puste | liczba procesów API; puste = z limitu CPU, minimum 2 |
| `ONCALL_SOLVER_WORKERS` | `8` | wątki CP-SAT |
| `ONCALL_GENERATION_CONCURRENCY` | `1` | równoległe generowania w procesie roboczym |
| `ONCALL_RETENTION_AUDIT_DAYS` | `365` | po ilu dniach znikają wpisy audytu o operacjach; `0` = bezterminowo, patrz [Retencja danych](#retencja-danych) |
| `ONCALL_RETENTION_LOGIN_AUDIT_DAYS` | `90` | to samo dla zwykłych logowań i nieudanych prób |
| `ONCALL_RETENTION_OUTBOX_DAYS` | `90` | wysłane, nieudane i pominięte e-maile |
| `ONCALL_RETENTION_RUNS_DAYS` | `30` | zakończone uruchomienia generatora |
| `ONCALL_SMTP_HOST` | puste | puste wyłącza wysyłkę e-maili |
| `ONCALL_LDAP_ENABLED` | `false` | logowanie z katalogu - patrz [LDAP / Active Directory](ldap.md) |
| `ONCALL_TLS_ENABLED` | `false` | HTTPS na nginx - patrz [TLS](tls.md) |

Liczba procesów API razy rozmiar puli połączeń musi mieścić się poniżej
`max_connections` PostgreSQL.

Proces roboczy ma w Compose przydział 2 CPU i z niego wynika domyślna liczba
wątków solvera. Zmiana przydziału zmienia tę liczbę automatycznie.

## Retencja danych

Pięć tabel rośnie z każdym użyciem aplikacji i nic poza retencją z nich nie
usuwa: dziennik audytu (`audit_events`), kolejka e-maili z pełną treścią
każdej wiadomości (`notification_outbox`), uruchomienia generatora
(`schedule_runs`), sesje (`sessions`) i jednorazowe linki aktywacyjne oraz
resetu hasła (`account_tokens`). Proces roboczy (`worker`) raz na
`ONCALL_RETENTION_INTERVAL_SECONDS` (domyślnie godzinę) usuwa wiersze starsze
niż skonfigurowany czas, od najstarszych, w paczkach po
`ONCALL_RETENTION_BATCH_SIZE` (domyślnie 1000) wierszy, każda w osobnej
krótkiej transakcji, najwyżej `ONCALL_RETENTION_MAX_BATCHES` (domyślnie 20)
paczek na tabelę w jednym przebiegu. Co zostało, jest po prostu starsze w
następnym przebiegu: baza, która rosła latami, jest sprzątana stopniowo, a
przerwany przebieg niczego nie psuje.

| Dane | Domyślnie | Czego retencja nie rusza |
| --- | --- | --- |
| audyt: operacje (`ONCALL_RETENTION_AUDIT_DAYS`) | 365 dni | wpisów o korektach grafiku (`schedule.override`, `schedule.override_batch`, `schedule.draft_override`) - nigdy, bo czyta je ponowna publikacja |
| audyt: logowania i nieudane próby (`ONCALL_RETENTION_LOGIN_AUDIT_DAYS`) | 90 dni | ostatnich pięciu minut, z których korzysta ogranicznik prób logowania |
| e-maile wysłane, nieudane i pominięte (`ONCALL_RETENTION_OUTBOX_DAYS`) | 90 dni | wiadomości oczekujących i w trakcie wysyłki, niezależnie od wieku |
| zakończone uruchomienia generatora (`ONCALL_RETENTION_RUNS_DAYS`) | 30 dni | uruchomień w kolejce i w toku |
| wygasłe sesje oraz linki aktywacyjne i resetu hasła | dzień po wygaśnięciu, bez ustawienia | sesji i linków jeszcze ważnych |

`0` w dowolnej zmiennej `*_DAYS` wyłącza usuwanie tej kategorii. Retencja
jest włączona domyślnie, także po aktualizacji z wydania, które jej nie miało:
pierwszy przebieg po starcie zaczyna usuwać zaległości. Kto chce zachować
starszy audyt, ustawia `ONCALL_RETENTION_AUDIT_DAYS=0` w `.env` **przed**
aktualizacją albo robi kopię bazy - usuniętych wpisów nie da się odzyskać.
Ekran „Audyt” pokazuje administratorowi obowiązujące czasy, a każdy przebieg
zostawia w logach procesu roboczego rekord `event=retention` z liczbą
usuniętych wierszy, patrz
[Metryki procesu roboczego](../produkt/integracje.md#metryki-procesu-roboczego).

PostgreSQL po usunięciu wierszy używa zwolnionego miejsca ponownie, ale nie
zmniejsza plików na dysku: retencja zatrzymuje wzrost, a nie cofa go. Rozmiar
tabel pokazuje zapytanie:

```bash
docker compose exec db psql -U oncall -d oncall -c "select relname, pg_size_pretty(pg_total_relation_size(oid)) from pg_class where relname in ('audit_events', 'notification_outbox', 'schedule_runs', 'sessions', 'account_tokens')"
```

Miejsce zajęte przez lata bez retencji oddaje jednorazowo, w oknie
serwisowym, `VACUUM FULL audit_events, notification_outbox;` - na czas
przepisania tabele są zablokowane.

## Hasło bazy danych

`.env.example` i `docker-compose.yml` mają domyślne hasło PostgreSQL, takie samo
w każdej kopii repozytorium. Jest publicznie znane i istnieje wyłącznie dla
wygody pracy lokalnej: `docker compose up` na własnym komputerze działa bez
dodatkowej konfiguracji.

**Każde wdrożenie inne niż lokalne** - serwer testowy, przedprodukcyjny,
produkcyjny, każda maszyna współdzielona z innymi - ustawia w `.env` przed
pierwszym startem dwie wartości:

- `POSTGRES_PASSWORD` - unikalne, losowe hasło tego wdrożenia, np. z
  `openssl rand -hex 32`;
- `ONCALL_DATABASE_URL` - adres z tym samym hasłem oraz tym samym
  użytkownikiem i bazą co `POSTGRES_USER` i `POSTGRES_DB`.

```bash
POSTGRES_PASSWORD=<unikalne hasło>
ONCALL_DATABASE_URL=postgresql+asyncpg://oncall:<to samo hasło>@db:5432/oncall
```

`api` i `worker` czytają ten sam `ONCALL_DATABASE_URL`, więc to jedna zmiana w
`.env`. Hasło z `openssl rand -hex` ma tylko cyfry i litery `a-f`; znaki takie
jak `@`, `:`, `/`, `#` czy `%` trzeba w adresie zakodować procentowo (`@` to
`%40`).

**Obraz `postgres` czyta `POSTGRES_PASSWORD` tylko raz**, przy zakładaniu
pustego wolumenu `oncall-db`. Na istniejącej bazie zmiana w `.env` niczego w
PostgreSQL nie zmienia, a `api` i `worker` przestają się łączyć. Hasło działającej
bazy zmienia się najpierw w samej bazie, potem w `.env`:

```bash
docker compose exec db psql -U oncall -d oncall -c '\password oncall'
# w .env: nowe POSTGRES_PASSWORD i to samo hasło w ONCALL_DATABASE_URL
docker compose up -d
```

`psql` pyta o nowe hasło dwa razy i nie zapisuje go w historii powłoki.
`docker compose up -d` odtwarza kontenery, których konfiguracja się zmieniła.

### Granica zaufania

W `docker-compose.yml` usługa `db` nie publikuje żadnego portu: PostgreSQL
słucha na 5432 tylko w sieci Compose tego projektu, w której łączą się z nim
`api` i `worker`. Ani z innych maszyn, ani przez `localhost` na hoście bazy nie
da się osiągnąć. CI pilnuje, żeby ani plik bazowy, ani żadna nakładka z
repozytorium nie dodały jej portu (`.github/scripts/compose-hardening.sh`).

Hasło chroni więc bazę przed tym, co ma dostęp do sieci kontenerów:

- przed innymi kontenerami dołączonymi do sieci Compose, np. reverse proxy
  kierującym ruch na `web:8080`;
- przed przejętą usługą `web`, która jest w tej samej sieci co baza;
- pod Dockerem na Linuksie także przed użytkownikami samego hosta, bo adres
  kontenera w sieci mostkowej jest z hosta osiągalny.

Kto ma dostęp do demona Dockera lub Podmana na hoście, ma pełny dostęp do bazy
niezależnie od hasła. Własna nakładka, która doda usłudze `db` port, przenosi
bazę poza tę granicę: wtedy unikalne hasło jest jej jedyną ochroną, a port
powinien słuchać tylko na `127.0.0.1`.

## Uprawnienia kontenerów

Każda usługa działa z głównym systemem plików **tylko do odczytu**, bez żadnych
uprawnień jądra (`cap_drop: [ALL]`) i z `no-new-privileges`. Zapisuje wyłącznie
do swoich montowań `tmpfs` i wolumenów:

| Usługa | Użytkownik | Zapis | Porty w kontenerze |
| --- | --- | --- | --- |
| `db` | `postgres` (70) | wolumen `oncall-db`, `/var/run/postgresql`, `/tmp` | 5432 |
| `api` | `10001` | `/tmp` | 8000 |
| `worker` | `10001` | `/tmp` | - |
| `web` | `101` (nginx) | `/tmp`, `/etc/nginx/conf.d` | 8080, 8443 |

- **`web` słucha na 8080 i 8443.** Zwykły użytkownik nie otworzy portu poniżej
  1024, więc nginx w kontenerze używa 8080 (HTTP) i 8443 (HTTPS).
  `ONCALL_WEB_HTTP_PORT` i `ONCALL_WEB_HTTPS_PORT` nadal wybierają porty
  hosta. Reverse proxy w tej samej sieci Compose kieruje ruch na `web:8080`.
- **Klucz TLS czyta użytkownik `101`.** Właściciel i prawa klucza - patrz
  [TLS](tls.md#prawa-do-plików).
- **Baza dostaje kilka uprawnień z powrotem.** Skrypt startowy obrazu
  `postgres` rusza jako root, oddaje katalog danych użytkownikowi `postgres` i
  przechodzi na niego, do czego potrzebuje `CHOWN`, `DAC_READ_SEARCH`,
  `FOWNER`, `SETUID` i `SETGID`. Sam serwer bazy działa już bez żadnych.
- **`tmpfs` to pamięć RAM.** Pliki tymczasowe nginx (duże odpowiedzi API) liczą
  się do pamięci kontenera.

CI sprawdza te ustawienia dla pliku bazowego i każdej nakładki
(`.github/scripts/compose-hardening.sh`) i odrzuca obraz, który uruchamiałby
się jako root.

## Aktualizacja

Pliki Compose należą do wydania tak samo jak obrazy: zakładają te same porty,
użytkowników i ścieżki zapisu. Bierz je z tego samego tagu git co
`ONCALL_VERSION`:

```bash
git fetch --tags
git checkout v<nowy numer>
# w .env: ONCALL_VERSION=<nowy numer>
docker compose pull
docker compose up -d
```

Migracje bazy wykonują się przy starcie `api`. Cofnięcie do poprzedniej wersji
to ta sama sekwencja z poprzednim numerem - szczegóły w
[Wydania i wersje](wydania.md#aktualizacja-i-cofnięcie).

Od wydania z retencją danych pierwszy start po aktualizacji zaczyna usuwać
wpisy audytu o operacjach starsze niż rok i logowania starsze niż 90 dni.
Kto chce zachować starszą historię, wyłącza to w `.env` przed aktualizacją,
patrz [Retencja danych](#retencja-danych).

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
same pliki bez zmian. Pięć rzeczy warto wiedzieć:

- **Gniazdo API.** Dostawca Compose rozmawia z Podmanem przez gniazdo
  użytkownika. Jeśli polecenie kończy się komunikatem „failed to connect to the
  docker API”, uruchom raz `systemctl --user start podman.socket`.
- **Tryb bezrootowy.** Porty poniżej 1024 wymagają uprawnień; domyślne `8080` i
  `8443` działają bez nich.
- **Użytkownicy kontenerów mają na hoście inne numery.** Klucz TLS, który
  czyta nginx (`101` w kontenerze), dostaje właściciela przez
  `podman unshare chown` - patrz [TLS](tls.md#prawa-do-plików).
- **Brakujące źródło montowania** zachowuje się tak samo jak pod Dockerem:
  nieistniejąca ścieżka hosta zostaje utworzona jako pusty katalog, zamiast
  zatrzymać start. Dlatego plik bazowy nie montuje niczego z hosta, a
  montowania TLS są w osobnej nakładce, która sprawdza każdy plik przy
  starcie - patrz [TLS](tls.md).
- **Start po restarcie.** Jednostka systemd użytkownika, linger i skrypt
  setupu - patrz [Systemd (Podman Compose)](systemd.md).

Sprawdzenie samych plików, bez uruchamiania:

```bash
docker compose config --quiet
docker compose -f docker-compose.yml -f docker-compose.dev.yml config --quiet
podman compose config --quiet
```
