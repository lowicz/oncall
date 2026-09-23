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
   pliki `deploy/systemd/`. Gdy katalog jest checkoutem git, robi zamiast tego
   `git fetch --tags` i `git checkout` tagu.
3. Buduje nowy `.env` - patrz [niżej](#jak-zmienia-się-env).
4. Pobiera obrazy `ghcr.io/lowicz/oncall-api` i `ghcr.io/lowicz/oncall-web` w
   tej wersji. Jeśli wydania nie ma, skrypt kończy się tutaj i niczego nie
   zmienia; restart nie czeka też potem na pobieranie.
5. Robi [kopię zapasową](#kopia-zapasowa-i-cofnięcie) każdego pliku, który
   zmieni, i zapisuje nowe pliki. Plik identyczny z wydaniem zostaje
   nietknięty.
6. Restartuje jednostkę - patrz [Restart jednostki](#restart-jednostki).

Katalogu `tls/`, drop-inu jednostki ani wolumenów skrypt nie dotyka. Ponowne
uruchomienie z tym samym numerem nie zmienia żadnego pliku i tylko restartuje
jednostkę.

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

Cofnięcie to ten sam skrypt z poprzednim numerem. Skrypt wypisuje go na
początku każdego przebiegu (`On-call in ~/oncall: 1.2.3 -> 1.2.4`), a
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
[Aktualizacja i cofnięcie](wydania.md#aktualizacja-i-cofnięcie).

## Restart jednostki

Jednostka `oncall.service` uruchamia `deploy/systemd/oncall-stack.sh` z
katalogu wdrożenia, więc nowy skrypt stosu działa od razu po zapisaniu. Plik
samej jednostki jest kopią w `~/.config/systemd/user/`: jeśli wydanie go
zmieniło, skrypt nadpisuje tę kopię i wykonuje
`systemctl --user daemon-reload`.

Drop-in `oncall.service.d/checkout.conf` (katalog i ewentualne
`ONCALL_COMPOSE_FILES`) zostaje bez zmian. Dlatego skrypt nie uruchamia
ponownie `install-user-unit.sh`: bez argumentów zapisałby drop-in od nowa i
zgubił listę pominiętych nakładek.

Na końcu `systemctl --user restart oncall` robi `down`, a potem `up -d` z
nowymi plikami i nowym `ONCALL_VERSION`. Migracje wykonują się przy starcie
`api`. Skrypt kończy się listą kontenerów z obrazami; numer wydania pokazuje
też sama aplikacja (patrz [Wydania i wersje](wydania.md#która-wersja-działa-na-hoście)).
Gdy restart się nie uda, szczegóły są w `journalctl --user -u oncall`.

## Starsze wydania

Wydania sprzed katalogu `deploy/systemd/` go nie mają. W zwykłym katalogu
skrypt zostawia wtedy lokalne pliki jednostki (`... has no
deploy/systemd/...; keeping the local one`). Checkoutu git nie da się cofnąć
przed ten katalog bez usunięcia skryptu, który uruchamia jednostka, więc skrypt
odmawia i niczego nie zmienia.
