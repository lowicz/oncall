# Aktualizacja wdrożenia

Skrypt `deploy/update.sh` przenosi istniejące wdrożenie na wskazane wydanie
jednym poleceniem: pobiera pliki Compose tego wydania, uzupełnia `.env` o nowe
zmienne, pobiera obrazy i restartuje jednostkę użytkownika systemd. Jest
przeznaczony dla hosta, na którym stos działa pod Podmanem jako jednostka
`oncall.service` - patrz [Systemd](systemd.md).

## Polecenie

Jako użytkownik wdrożenia (np. `podman`), wskazane wydanie:

```bash
curl -fsSL https://raw.githubusercontent.com/lowicz/oncall/main/deploy/update.sh |
  sh -s -- 1.2.3
```

Bez numeru skrypt bierze najnowsze wydanie stabilne:

```bash
curl -fsSL https://raw.githubusercontent.com/lowicz/oncall/main/deploy/update.sh |
  sh
```

`sh -s --` przekazuje numer skryptowi czytanemu ze standardowego wejścia; samo
`| sh 1.2.3` potraktowałoby numer jako nazwę pliku. Numer z przedrostkiem `v`
(`v1.2.3`) też działa. Wydanie wstępne, np. `1.3.0-rc.1`, trzeba zawsze podać
jawnie - „najnowsze stabilne” go nie obejmuje.

Skrypt z gałęzi `main` wdraża każde wydanie, także starsze od siebie. Kto woli
najpierw przeczytać to, co uruchomi, pobiera plik i uruchamia go lokalnie:

```bash
curl -fsSLO https://raw.githubusercontent.com/lowicz/oncall/main/deploy/update.sh
sh update.sh 1.2.3
```

W katalogu będącym checkoutem git ten sam plik jest pod
`deploy/update.sh`.

## Założenia

- Katalog wdrożenia to `~/oncall`. Inny wskazuje `--dir /ścieżka` albo
  zmienna `ONCALL_DIR`.
- W katalogu są `docker-compose.yml`, `.env` i `deploy/systemd/oncall-stack.sh`.
- Jednostka `oncall.service` jest zainstalowana skryptem
  `deploy/systemd/install-user-unit.sh`, a jej `WorkingDirectory` to ten sam
  katalog. Skrypt to sprawdza i nie restartuje jednostki, która uruchamia inny
  katalog.
- Na hoście są `podman`, `systemctl` i `curl`, a w checkoutcie git także
  `git`.
- Skrypt uruchamia użytkownik wdrożenia, nie root, zalogowany bezpośrednio
  (`ssh podman@host` albo `machinectl shell podman@`). Po `su` lub `sudo`
  menedżer systemd użytkownika bywa nieosiągalny; skrypt ustawia wtedy sam
  `XDG_RUNTIME_DIR=/run/user/<uid>`, a gdy to nie wystarcza, mówi, jak się
  zalogować.

Skrypt nie zakłada wdrożenia od zera: pierwszy start opisują
[Uruchomienie](uruchomienie.md) i [Systemd](systemd.md).

## Co robi

1. Sprawdza katalog, `.env`, polecenia i zainstalowaną jednostkę.
2. Pobiera z tagu `vX.Y.Z` trzy pliki Compose (`docker-compose.yml`,
   `docker-compose.tls.yml`, `docker-compose.ldap-ca.yml`), `.env.example` i
   pliki `deploy/systemd/` i `deploy/backup/`. Gdy katalog jest checkoutem git, robi zamiast tego
   `git fetch --tags` i `git checkout` tagu.
3. Buduje nowy `.env` - patrz [niżej](#jak-zmienia-się-env).
4. Pobiera obrazy `ghcr.io/lowicz/oncall-api` i `ghcr.io/lowicz/oncall-web` w
   tej wersji, a gdy wydanie wskazuje inne wydanie PostgreSQL niż wdrożenie,
   także jego obraz. Nowe wydanie tej samej wersji głównej (np.
   `postgres:18.6-alpine` po pływającym `postgres:18-alpine` starszych
   wydań) nie przenosi danych: restart uruchamia nowy serwer na tym samym
   wolumenie. Jeśli któregoś obrazu nie ma, skrypt kończy się tutaj i
   niczego nie zmienia; restart nie czeka też potem na pobieranie.
5. Robi zrzut bazy, sprawdzony odtworzeniem, bo restart uruchomi migracje
   wydania, a te nie cofają się same - patrz
   [Kopie zapasowe bazy](kopie-zapasowe.md#przed-aktualizacją). Nieudany zrzut
   kończy aktualizację bez żadnej zmiany. Wydanie z nowszą wersją główną
   PostgreSQL przenosi w tym kroku bazę - patrz
   [Nowa wersja główna PostgreSQL](#nowa-wersja-główna-postgresql).
6. Robi [kopię zapasową](#kopia-zapasowa-i-cofnięcie) każdego pliku, który
   zmieni, i zapisuje nowe pliki. Plik identyczny z wydaniem zostaje
   nietknięty.
7. Restartuje jednostkę - patrz [Restart jednostki](#restart-jednostki).

Katalogu `tls/` ani drop-inów jednostek skrypt nie dotyka, żadnego wolumenu nie
usuwa, a timera kopii nie instaluje (robi to raz `deploy/backup/setup.sh`, o czym skrypt
przypomina na końcu, dopóki timera nie ma). Ponowne
uruchomienie z tym samym numerem nie zmienia żadnego pliku, robi zrzut bazy i
restartuje jednostkę.

## Jak zmienia się .env

- Nowy plik ma układ i komentarze `.env.example` nowego wydania.
- Każda zmienna przypisana w obecnym `.env` zachowuje swoją linię **dosłownie**:
  wartość, także pustą, cudzysłowy, przedrostek `export`, wartość
  wielowierszową. Zmienna przypisana dwa razy zachowuje obie linie.
- Jedyna zmieniana wartość to `ONCALL_VERSION`, ustawiana na wdrażane
  wydanie.
- Zmienna nowa w wydaniu dostaje wartość domyślną i komentarz z
  `.env.example`; skrypt wypisuje jej nazwę (`added ...`), żeby można ją było
  przejrzeć.
- Zmienna, którą `.env.example` pokazuje tylko jako komentarz, np.
  `# ONCALL_LDAP_CA_FILE=./tls/ca.pem`, trafia w miejsce tej linii.
- Zmienne, których `.env.example` nie ma (własne albo usunięte z wydania),
  zostają na końcu pliku pod nagłówkiem
  `# Kept from the previous .env: not in .env.example.`, razem z komentarzem
  bezpośrednio nad nimi. Skrypt wypisuje je jako `kept ...`.
- Własne komentarze przy zmiennych z `.env.example` ustępują komentarzom
  wydania; oryginał zostaje w kopii zapasowej.
- Uprawnienia pliku (np. `0600`) zostają. Plik jest zapisywany przez plik
  tymczasowy i podmieniany w całości.

Przed zapisem skrypt sprawdza, że każda linia przypisania ze starego `.env`
(poza `ONCALL_VERSION`) jest w nowym. Jeśli nie, przerywa bez zmian.

Podgląd nowego `.env` bez żadnej zmiany na hoście:

```bash
curl -fsSL -o /tmp/env.example https://raw.githubusercontent.com/lowicz/oncall/v1.2.3/.env.example
curl -fsSL https://raw.githubusercontent.com/lowicz/oncall/main/deploy/update.sh |
  sh -s -- merge-env ~/oncall/.env /tmp/env.example 1.2.3
```

## Kopia zapasowa i cofnięcie

Przed zmianą skrypt kopiuje każdy zmieniany plik do
`~/oncall/.backup/<data>-<czas>/` (katalog z prawami `0700`): `.env`, pliki
Compose i `deploy/systemd/` z ich ścieżkami, a zainstalowaną jednostkę do
podkatalogu `unit/`. Przebieg, który niczego nie zmienia, nie zostawia
katalogu. Kopie zawierają sekrety z `.env` - stare usuwaj ręcznie.

Cofnięcie to ten sam skrypt z poprzednim numerem (poza powrotem sprzed
[nowej wersji PostgreSQL](#powrót-sprzed-aktualizacji-postgresql)). Skrypt
wypisuje go na początku każdego przebiegu (`On-call in ~/oncall: 1.2.3 -> 1.2.4`), a
podpowiada też, gdy restart się nie uda:

```bash
curl -fsSL https://raw.githubusercontent.com/lowicz/oncall/main/deploy/update.sh |
  sh -s -- 1.2.3
```

Wartości w `.env` zostają, więc zmienia się tylko `ONCALL_VERSION`. Dokładny
poprzedni `.env` przywraca kopia:

```bash
cp -p ~/oncall/.backup/<data>-<czas>/.env ~/oncall/.env
systemctl --user restart oncall
```

Migracje bazy nie cofają się same - patrz
[Aktualizacja i cofnięcie](wydania.md#aktualizacja-i-cofnięcie). Stan bazy
sprzed aktualizacji przywraca zrzut `pre-update-<z>-to-<do>` - patrz
[Odtworzenie bazy](kopie-zapasowe.md#odtworzenie-bazy).

## Restart jednostki

Jednostka `oncall.service` uruchamia `deploy/systemd/oncall-stack.sh` z
katalogu wdrożenia, więc nowy skrypt stosu działa od razu po zapisaniu. Plik
samej jednostki jest kopią w `~/.config/systemd/user/`: jeśli wydanie go
zmieniło, skrypt nadpisuje tę kopię i wykonuje
`systemctl --user daemon-reload`. Tak samo odświeża zainstalowane jednostki
kopii zapasowych (`oncall-backup.*`).

Drop-in `oncall.service.d/checkout.conf` (katalog i ewentualne
`ONCALL_COMPOSE_FILES`) zostaje bez zmian. Dlatego skrypt nie uruchamia
ponownie `install-user-unit.sh`: bez argumentów zapisałby drop-in od nowa i
zgubił listę pominiętych nakładek.

Na końcu `systemctl --user restart oncall` robi `down`, a potem `up -d` z
nowymi plikami i nowym `ONCALL_VERSION`. Migracje wykonują się przy starcie
`api`. Skrypt kończy się listą kontenerów z obrazami; numer wydania pokazuje
też sama aplikacja (patrz [Wydania i wersje](wydania.md#która-wersja-działa-na-hoście)).
Gdy restart się nie uda, szczegóły są w `journalctl --user -u oncall` (gdy
użytkownik nie może czytać dziennika, patrz
[Sprawdzenie](kopie-zapasowe.md#sprawdzenie)).

Migracja, która przenosi do bazy regułę dotąd pilnowaną tylko przez aplikację
(na przykład zakres dat albo zakaz nakładania okresów), nie zatrzymuje startu z
powodu starszych wierszy, które tę regułę łamią. Wypisuje wtedy w logu `api`
ostrzeżenie `WARNI [alembic.runtime.migration]` z nazwą reguły i wierszem, który
ją łamie, a aplikacja działa i pilnuje reguły jak dotąd. Ostrzeżenia pokazuje
`podman compose logs api 2>&1 | grep WARNI` w katalogu wdrożenia. Po
poprawieniu wierszy regułę kończy polecenie SQL podane w ostrzeżeniu.

## Nowa wersja główna PostgreSQL

Katalog danych PostgreSQL należy do wersji głównej, która go zapisała: obraz
PostgreSQL 18 odmawia startu na danych wersji 17. Wydanie, które w
`docker-compose.yml` przenosi usługę `db` na nowszą wersję główną, przenosi
więc też dane, i robi to `update.sh` bez żadnego dodatkowego polecenia.
Pierwsze takie wydanie przenosi bazę z PostgreSQL 17 na 18.

Skrypt rozpoznaje je po obrazie `postgres:<wersja>` w `docker-compose.yml`
wdrożenia i wydania. Zamiast zwykłego zrzutu (krok 5) uruchamia wtedy
`deploy/backup/oncall-backup.sh upgrade-postgres` z wydania, które:

1. zatrzymuje `api`, `worker` i `web`, żeby zrzut objął każdą zmianę;
2. robi zrzut `pre-postgres-upgrade-from-17`, sprawdzony odtworzeniem jak
   każda kopia, i zostawia go w katalogu kopii;
3. zatrzymuje starą bazę i usuwa jej kontener, bo kontener nowej bazy
   dostaje tę samą nazwę; pod podman-compose razem z nim znikają zatrzymane
   kontenery `api`, `worker` i `web`, które go wymagają (nie trzymają danych,
   a restart tworzy je na nowo); potem uruchamia usługę `db` z pliku Compose
   wydania na nowym wolumenie `oncall-postgres-18` (każda wersja główna ma
   własny wolumen, nazwany jej numerem);
4. odtwarza zrzut do nowej bazy, sprawdza, że wróciła każda tabela i ta sama
   rewizja schematu, i wykonuje `ANALYZE`, żeby planista od razu miał
   statystyki.

Obraz nowej wersji skrypt pobiera wcześniej, razem z obrazami aplikacji. Pliki
wydania instaluje dopiero po udanym przeniesieniu, a restart jednostki
uruchamia `api`, które stosuje migracje wydania już na nowej wersji.
Aplikacja jest niedostępna od zatrzymania `api` do końca restartu; przy bazie
tej wielkości to kilkadziesiąt sekund. Stary wolumen `oncall-db` nie jest ani
zapisywany, ani usuwany.

Nowy klaster jest zakładany z ustawieniami z `docker-compose.yml`
(`POSTGRES_INITDB_ARGS`):

- **sumy kontrolne stron** (`--data-checksums`): uszkodzona strona na dysku
  kończy się błędem zamiast cicho zwróconych złych danych, które nocny zrzut
  przeniósłby do kopii;
- **polskie sortowanie jako kolacja bazy** (`--locale-provider=icu
  --icu-locale=pl-PL`): każde `ORDER BY` po tekście układa nazwy tak, jak
  czyta je polski użytkownik (`Adam, ala, Ewa, Łukasz, Śliwa, Żaneta`), a nie
  według kodów znaków (`Adam, Ewa, ala, Łukasz, Śliwa, Żaneta`).

Obie rzeczy dotyczą tylko klastra zakładanego od zera: nowego wdrożenia i bazy
przeniesionej na nową wersję. Sprawdzenie w katalogu wdrożenia (oczekiwane
`on` oraz `i | pl-PL`):

```bash
podman compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "show data_checksums" \
  -c "select datlocprovider, datlocale from pg_database
      where datname = current_database()"'
```

Gdy nowa wersja działa dobrze, stary wolumen można usunąć. Skrypt podaje jego
pełną nazwę, z przedrostkiem projektu Compose, np.:

```bash
podman volume rm oncall_oncall-db
```

Zrzut `pre-postgres-upgrade-from-17` zostaje w katalogu kopii, dopóki nie
wypchną go nowsze kopie.

Kolacja ICU zależy od wersji biblioteki ICU w obrazie. Gdy aktualizacja obrazu
ją zmieni, PostgreSQL ostrzega w logu `db` o niezgodnej wersji kolacji
(`collation version mismatch`). Indeksy tekstowe przebudowuje się wtedy w
chwili małego ruchu, a potem zapisuje nową wersję:

```bash
podman compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "reindex database" \
  -c "alter database \"$POSTGRES_DB\" refresh collation version"'
```

### Gdy przeniesienie się nie uda

Błąd w trakcie przeniesienia usuwa kontener i wolumen, które ono utworzyło, a
`update.sh` restartuje jednostkę: stos wraca na poprzednie wydanie i
PostgreSQL 17 na nietkniętym wolumenie, a żaden plik się nie zmienia. Skrypt
kończy się komunikatem `moving the database to PostgreSQL 18 failed`, a
przyczyna jest wypisana nad nim. Po jej usunięciu wystarczy uruchomić
aktualizację ponownie.

Pusty wolumen nowej bazy, który zostawiło przeniesienie przerwane przed
startem PostgreSQL (tak kończyły się 1.7.1 i 1.7.2 pod podman-compose), skrypt
wykorzystuje. Jeśli ten wolumen już istnieje i coś zawiera (po przeniesieniu
przerwanym np. zabiciem procesu albo po powrocie opisanym niżej), skrypt go
nie nadpisuje i odmawia, podając jego nazwę. Po sprawdzeniu, że nie ma w nim
niczego potrzebnego, usuń go (`podman volume rm <nazwa>`) i uruchom
aktualizację ponownie.

### Powrót sprzed aktualizacji PostgreSQL

`update.sh` nie przenosi bazy na starszą wersję główną: wydanie z PostgreSQL
17 na wdrożeniu z 18 kończy się komunikatem `does not move a database to an
older major version` bez żadnej zmiany. Stare wydanie wystartowałoby na starym
wolumenie z danymi sprzed aktualizacji, bez wszystkiego, co zapisano później.

Gdy mimo to trzeba wrócić, świadomie tracąc zmiany od aktualizacji, a stary
wolumen jeszcze istnieje:

1. zrób zrzut obecnego stanu, żeby dało się go odzyskać;
2. przywróć `.env` i pliki Compose poprzedniego wydania z kopii aktualizacji
   (w checkoutcie git: `git checkout --detach v<poprzednie>` i `.env` z tej
   samej kopii);
3. zrestartuj jednostkę - PostgreSQL 17 startuje na swoim starym wolumenie.

```bash
cd ~/oncall
./deploy/backup/oncall-backup.sh dump --label before-going-back
cp -p .backup/<data>-<czas>/.env .backup/<data>-<czas>/docker-compose*.yml .
systemctl --user restart oncall
```

Wolumen `oncall-postgres-18` zostaje; przed kolejną aktualizacją trzeba go
usunąć, jak wyżej.

## Starsze wydania

Wydania sprzed katalogu `deploy/systemd/` go nie mają. W zwykłym katalogu
skrypt zostawia wtedy lokalne pliki jednostki (`... has no
deploy/systemd/...; keeping the local one`). Checkoutu git nie da się cofnąć
przed ten katalog bez usunięcia skryptu, który uruchamia jednostka, więc skrypt
odmawia i niczego nie zmienia.

W wydaniach sprzed przekazania `ONCALL_SOLVER_WORKERS` do kontenera `worker`
`.env.example` miał `ONCALL_SOLVER_WORKERS=8`, a ta wartość nie docierała do
generatora: liczba wątków CP-SAT wynikała z liczby procesorów. Skrypt zachowuje
tę linię, więc po aktualizacji wartość naprawdę działa i na hoście z 2
procesorami CP-SAT uruchamia 8 wątków zamiast 2. Jeśli `.env` wciąż ma
`ONCALL_SOLVER_WORKERS=8` ze starego `.env.example`, a liczba wątków nie była
wybrana świadomie, wyczyść wartość (`ONCALL_SOLVER_WORKERS=`) i uruchom
ponownie jednostkę (`systemctl --user restart oncall`).
