# Wydania i wersje

Aplikacja jest wydawana jako dwa obrazy kontenerów w GitHub Container
Registry, oznaczone numerem wydania:

| Obraz | Usługi z `docker-compose.yml` | Zawartość |
| --- | --- | --- |
| `ghcr.io/lowicz/oncall-api` | `api`, `worker` | API (FastAPI), migracje bazy, proces roboczy, solver CP-SAT |
| `ghcr.io/lowicz/oncall-web` | `web` | nginx z aplikacją (SPA) i tą dokumentacją pod `/docs/` |

Obrazy są publiczne: `docker compose pull` nie wymaga logowania. Baza `db` to
niezmieniony obraz `postgres:17-alpine`.

## Numer wersji

Źródłem wersji jest **tag git** postaci `vMAJOR.MINOR.PATCH`, np. `v1.2.0`.
Wersja wstępna ma przyrostek: `v1.3.0-rc.1`. Każde wydanie dostaje tagi obrazu:

| Tag git | Tagi obrazu | `latest` |
| --- | --- | --- |
| `v1.2.3` | `1.2.3`, `1.2`, `1`, `latest` | tak |
| `v1.3.0-rc.1` | tylko `1.3.0-rc.1` | nie |

**Opublikowana wersja jest niezmienna.** Tag `1.2.3` wskazuje na zawsze ten sam
obraz; ponowne wydanie pod tym samym numerem jest odrzucane przez pipeline.
Tagi `1.2`, `1` i `latest` przesuwają się na najnowszą pasującą wersję
stabilną - są wygodne, ale nie mówią, co dokładnie działa na hoście.

## Która wersja działa na hoście

`docker-compose.yml` pobiera obrazy z tagiem z `ONCALL_VERSION` w `.env`:

```bash
# .env
ONCALL_VERSION=1.2.3
```

Bez tej zmiennej Compose **odmawia startu** i mówi, czego brakuje. To celowe:
każdy host deklaruje, co uruchamia, a plik `.env` jest zapisem tej decyzji.

Numer wydania, które naprawdę działa, aplikacja pokazuje sama: u dołu listwy
nawigacji, na końcu menu konta pod awatarem, a na telefonie na ekranie
„Więcej”. Nie czyta go z `.env`, tylko z obrazu: pipeline wydania wpisuje tag
do obu obrazów przy budowaniu (`ONCALL_VERSION` w `backend/Dockerfile` i
`frontend/Dockerfile`), a API podaje go w `/api/v1/config`. Dlatego przy
`ONCALL_VERSION=1.2` w `.env` aplikacja pokazuje pełny numer, np. `1.2.3`,
a obraz zbudowany z repozytorium (nakładka deweloperska) pokazuje `dev`.

## Aktualizacja i cofnięcie

Aktualizacja to przejście na tag wydania, zmiana jednej linii i pobranie
obrazów:

```bash
git fetch --tags
git checkout v1.2.4
sed -i 's/^ONCALL_VERSION=.*/ONCALL_VERSION=1.2.4/' .env
docker compose pull
docker compose up -d
```

Po starcie numer wersji w menu konta potwierdza, że działa już nowe wydanie.

Na hoście z jednostką użytkownika systemd (Podman) całą aktualizację, razem z
dopisaniem nowych zmiennych do `.env`, kopią zapasową i restartem, robi
skrypt `deploy/update.sh` - patrz [Aktualizacja wdrożenia](aktualizacja.md).

Pliki Compose (`docker-compose.yml` i nakładki) należą do wydania tak samo
jak obrazy: zakładają te same porty w kontenerach, użytkowników i ścieżki
zapisu (patrz [Uprawnienia kontenerów](uruchomienie.md#uprawnienia-kontenerów)).
Dlatego pochodzą z tego samego tagu git co `ONCALL_VERSION`; obraz z innego
wydania niż plik Compose może nie wystartować.

Migracje bazy wykonują się przy starcie usługi `api` (patrz
[Uruchomienie](uruchomienie.md#konto-administratora)).

Cofnięcie do poprzedniej wersji wygląda tak samo, z poprzednim tagiem i
numerem. Obrazy wcześniejszych wydań pozostają w rejestrze. Migracje bazy nie
cofają się automatycznie - jeśli wydanie zmieniło schemat, sprawdź w jego
opisie na GitHubie, czy cofnięcie wymaga dodatkowych kroków.

## Weryfikacja pochodzenia obrazu

Każdy obraz ma trzy niezależne dowody, że powstał w pipeline tego repozytorium
z konkretnego commitu, bez żadnych kluczy przechowywanych w projekcie:

- **SBOM i provenance BuildKit** dołączone do obrazu w rejestrze,
- **atestację GitHub** (SLSA), sprawdzaną przez `gh`,
- **podpis cosign** (keyless, tożsamość workflow-u z OIDC GitHuba).

```bash
gh attestation verify oci://ghcr.io/lowicz/oncall-api:1.2.3 --owner lowicz

cosign verify ghcr.io/lowicz/oncall-api:1.2.3 \
  --certificate-identity https://github.com/lowicz/oncall/.github/workflows/release.yml@refs/tags/v1.2.3 \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

Te same polecenia dla `oncall-web`. Opis każdego wydania na GitHubie zawiera
skróty (digesty) obu obrazów i gotowe polecenia weryfikacji.

## Jak powstaje wydanie

Wydanie robi osoba utrzymująca repozytorium jednym poleceniem:

```bash
git tag -a v1.2.3 -m "v1.2.3"
git push origin v1.2.3
```

Workflow `release.yml` w GitHub Actions:

1. sprawdza, że nazwa tagu jest poprawnym numerem wersji i że tej wersji nie
   ma jeszcze w rejestrze,
2. uruchamia te same bramki co dla każdej zmiany (lint, typy, testy na SQLite i
   PostgreSQL, budowanie obrazów, sprawdzenie plików Compose i dokumentacji),
3. buduje i publikuje oba obrazy z tagami z tabeli wyżej, dołącza SBOM,
   provenance, atestację i podpis,
4. tworzy wydanie na GitHubie z automatycznym opisem zmian i digestami.

Pipeline używa wyłącznie tokenu GitHub Actions i tożsamości OIDC; repozytorium
nie przechowuje żadnych sekretów. Jeśli wydanie padnie po opublikowaniu obrazu
(np. z powodu chwilowej niedostępności usługi podpisów), uruchom ponownie
**tylko nieudane zadania** tego samego runu - nigdy nie twórz drugiego runu z
tym samym tagiem.

## Co sprawdza CI

Każda zmiana (pull request i gałąź `main`) przechodzi przez `ci.yml`:

| Zadanie | Co sprawdza |
| --- | --- |
| `backend` | zgodność `uv.lock` z `pyproject.toml` (przed instalacją), `ruff check`, `ruff format`, `mypy`, `pytest` na SQLite, zgodność OpenAPI ze snapshotem |
| `backend-postgres` | zestaw współbieżności na prawdziwym PostgreSQL 17 |
| `frontend` | `eslint`, `tsc`, `vitest`, `npm run build` (renderuje dokumentację i sprawdza spis treści, odsyłacze i kotwice), render strony samodzielnej |
| `compose-config` | poprawność `docker-compose.yml` z każdą nakładką, to, że nakładka deweloperska zmienia tylko źródło obrazów, to, że każda usługa działa tylko do odczytu i bez uprawnień jądra, oraz testy skryptu aktualizacji `deploy/update.sh` |
| `workflows` | każda akcja w workflow jest przypięta do pełnego SHA z komentarzem wersji, każdy workflow deklaruje uprawnienia tokenu, a w repozytorium nie ma konfiguracji aktualizacji Dependabota |
| `image-build` | oba Dockerfile budują się (bez publikacji), a żaden obraz nie działa jako root |
| `sonarcloud` | statyczna analiza na SonarCloud (klucz `lowicz_oncall`) z pokryciem testami z zadań `backend` i `frontend`, więc startuje po nich; pomija się bez sekretu `SONAR_TOKEN` |

Zbiorczy status `ci-ok` obejmuje wszystkie zadania z tabeli poza
`sonarcloud`: pull request z forka nie ma dostępu do `SONAR_TOKEN`, a brak
tokenu nie może zaczerwienić `ci-ok`. Wynik SonarCloud to osobny status,
bramka jakości `SonarCloud Code Analysis`, którą zgłasza sam SonarCloud po
skanie. Do scalenia w `main` reguła `main-protected` wymaga `ci-ok`, bramki
jakości SonarCloud i obu skanów z sekcji
[Skanowanie bezpieczeństwa](#skanowanie-bezpieczeństwa); pełna lista jest w
[Ustawieniach repozytorium](#ustawienia-repozytorium).

## Skanowanie bezpieczeństwa

Na bezpieczeństwo kodu i zależności składa się pięć elementów; dwa pierwsze
to workflow bezpieczeństwa działające obok `ci.yml`:

| Narzędzie | Kiedy | Co sprawdza i co blokuje |
| --- | --- | --- |
| CodeQL (`codeql.yml`) | każdy pull request, każdy push do `main`, co tydzień w poniedziałek rano | analiza backendu (Python), frontendu (TypeScript i JavaScript) i samych workflow (GitHub Actions) zapytaniami `security-extended`; wyniki trafiają do Security → Code scanning, a scalenie blokuje reguła wyników skanowania kodu w `main-protected` |
| Dependency Review (`dependency-review.yml`) | każdy pull request | porównuje zależności pull requesta z gałęzią docelową w grafie zależności GitHuba (`backend/uv.lock`, `frontend/package-lock.json`, akcje w workflow); status `dependency-review` jest czerwony, gdy zmiana wnosi zależność, także deweloperską, z podatnością o ważności high lub critical; pull request bez zmian zależności przechodzi |
| SonarCloud (zadanie `sonarcloud` w `ci.yml`) | każdy pull request i push do `main` | jakość kodu, podatności i pokrycie testami; bramka jakości (m.in. 80% pokrycia nowego kodu) zgłasza status `SonarCloud Code Analysis` |
| Dependabot alerts | stale | alerty o znanych podatnościach w zależnościach, w Security → Dependabot; Dependabot nie otwiera pull requestów |
| Renovate | harmonogram, a przy alercie od razu | jedyny bot otwierający pull requesty z aktualizacjami, także poprawkami bezpieczeństwa (patrz [Aktualizacje zależności](#aktualizacje-zależności)) |

Dependabot jest tu wyłącznie źródłem alertów. Repozytorium nie ma pliku
`.github/dependabot.yml` (zadanie `workflows` odrzuca go w CI), a
„Dependabot security updates” w ustawieniach są wyłączone, więc dwa boty nigdy
nie otwierają konkurencyjnych pull requestów z tą samą poprawką.

Alert CodeQL, który okazał się fałszywy, zamyka się w Security → Code
scanning przyciskiem „Dismiss alert” z podanym powodem; nie wyłącza się
zapytań w workflow. Podatność bez dostępnej poprawki, którą trzeba na razie
zaakceptować, dopisuje się do wejścia `allow-ghsas` kroku w
`dependency-review.yml`, z komentarzem, dlaczego i do kiedy.

Pull request z forka nie ma dostępu do `SONAR_TOKEN`, więc nie dostaje
statusu `SonarCloud Code Analysis` i czeka na niego. Taką zmianę osoba
utrzymująca repozytorium przenosi na gałąź w tym repozytorium (np.
`gh pr checkout <numer>`, a potem push pod nową nazwą) i scala ją z pull
requesta otwartego z tej gałęzi.

## Aktualizacje zależności

Zależnościami opiekuje się Renovate (aplikacja GitHub od Mend, konfiguracja w
`renovate.json5` w katalogu głównym; repozytorium nie przechowuje przez to
żadnych sekretów). Obejmuje akcje GitHub (przypięte do pełnego SHA z komentarzem
wersji), pakiety npm i Pythona (przez pliki lock), obrazy bazowe kontenerów
(wskazywane tagiem, bez przypiętego digestu) oraz wersje narzędzi powtórzone w
plikach workflow (uv, Node, Python, PostgreSQL).

Zasady:

- jeden pull request tygodniowo na ekosystem dla aktualizacji minor i patch,
  otwierany w poniedziałek przed 6:00 czasu warszawskiego,
- nowe wydanie pakietu musi mieć co najmniej trzy dni, zanim zostanie
  zaproponowane - świeżo opublikowana, być może przejęta, wersja nie trafia do
  PR-a tego samego dnia,
- poprawki bezpieczeństwa (alerty GitHub i baza OSV) powstają natychmiast,
  osobno i z etykietą `security`,
- zmiany wersji głównych oraz każda zmiana środowiska uruchomieniowego
  (Python, Node, PostgreSQL) czekają na zatwierdzenie w Dependency Dashboard -
  to decyzje, nie rutyna,
- nic nie jest scalane automatycznie; każdy PR przechodzi `ci-ok` i przegląd.

Taką aktualizację zatwierdza się w issue **Dependency Dashboard**: w sekcji
„Pending Approval” zaznacza się pole przy tej aktualizacji. Renovate przy
najbliższym przebiegu, bez względu na harmonogram, sam otwiera pull request
z odświeżonymi plikami lock. Nie zaczyna się jej od ręcznej zmiany wersji na
gałęzi - pominęłoby to grupowanie plików, które zmieniają się razem, i
odświeżenie plików lock. Zmiany w kodzie, których aktualizacja wymaga,
dopisuje się jako commity do PR-a otwartego przez Renovate. Renovate przestaje
wtedy aktualizować tę gałąź, a wymuszony rebase (pole w Dependency Dashboard
albo w opisie PR-a) odtworzyłby ją od nowa, bez tych commitów.

Wersję, która występuje w kilku plikach, Renovate czyta we wszystkich z
jednego źródła wydań, więc każdy z tych plików dostaje tę samą wersję w tym
samym PR-ze:

| Grupa | Pliki | Źródło wersji |
| --- | --- | --- |
| Node.js | `NODE_VERSION` w `ci.yml`, `node-version` w `pages.yml`, `frontend/Dockerfile` | wydania Node.js |
| Python | `requires-python` w `backend/pyproject.toml`, `PYTHON_VERSION` w `ci.yml`, `backend/Dockerfile` | wydania python.org |
| PostgreSQL | `docker-compose.yml`, `docker-compose.contract.yml`, usługa bazy w `ci.yml` | Docker Hub, wszędzie ten sam tag |
| uv | `required-version` w `backend/pyproject.toml`, `UV_VERSION` w `ci.yml`, `backend/Dockerfile` | wydania uv na GitHubie |

Gdyby obraz Node albo Pythona był osobną zależnością z Docker Hub, miałby inną
datę wydania: Docker Hub datuje tag taki jak `22-alpine` ostatnim
opublikowaniem obrazu, a zatwierdzona aktualizacja obejmuje tylko te pliki,
których wersja ma już trzy dni. Obraz mógłby wtedy zostać na starej wersji,
gdy CI testowałoby już nową. Obrazy nie są też przypięte do digestu: listy
wydań Node.js i Pythona digestów nie znają, więc Renovate nie przesunąłby go
razem z tagiem, a Docker użyłby digestu starego obrazu mimo nowego tagu. Bez
digestu `docker compose pull` pobiera też dla bazy najnowsze wydanie
poprawkowe jej tagu. Dokładne digesty obrazów bazowych każdego wydania
zapisuje jego provenance.

Przed scaleniem aktualizacji środowiska uruchomieniowego przeszukaj gałąź
PR-a starą wersją (np. `git grep -n '17-alpine\|PostgreSQL 17'`). Zostać może
tylko opis w dokumentacji lub w `AGENTS.md` - popraw go w tym samym PR-ze -
albo nowe miejsce z wersją, które trzeba dopisać do reguły tej grupy w
`renovate.json5`.

Backend deklaruje tylko tę wersję Pythona, którą testuje CI i zawiera obraz
(`requires-python` w `backend/pyproject.toml`); granicę przesuwa zatwierdzona
aktualizacja grupy „Python”. Narzędzia ruff i mypy nie mają własnego wpisu z
wersją: ruff bierze ją z `requires-python`, mypy z interpretera, który go
uruchamia.
Wersja uv jest jedna: uv w innej wersji niż `required-version` odmawia pracy z
projektem, więc `backend/uv.lock` powstaje zawsze tą samą wersją.

## Ustawienia repozytorium

Część zasad z tej strony to ustawienia GitHuba, a nie pliki repozytorium.
Żaden plik w repozytorium ich nie ustawia ani nie zmienia: raz, ręcznie,
ustawia je osoba z uprawnieniami administratora repozytorium, a pull request
zmieniający workflow nie wystarczy, żeby zaczęły obowiązywać.

| Ustawienie | Wartość |
| --- | --- |
| Settings → Rules → Rulesets → `main-protected` | gałąź domyślna; zakaz usuwania i wymuszonego pusha; „Require status checks to pass” z „Require branches to be up to date before merging” i statusami z tabeli niżej; „Require code scanning results” z narzędziem CodeQL, „Security alerts”: High or higher, „Alerts”: Errors |
| Settings → Pages → Source | GitHub Actions |
| Settings → Advanced Security → Dependency graph | włączony (w publicznym repozytorium zawsze): z niego korzystają Dependency Review i alerty Dependabota |
| Settings → Advanced Security → Dependabot alerts | włączone: źródło alertów bezpieczeństwa, z którego korzysta też Renovate |
| Settings → Advanced Security → Dependabot security updates | wyłączone: poprawki bezpieczeństwa otwiera Renovate |
| Settings → Advanced Security → Code scanning → CodeQL analysis | konfiguracja zaawansowana z `codeql.yml`; „Default setup” nieskonfigurowany, bo przy włączonym GitHub odrzuca wyniki z workflow |

Statusy wymagane przez „Require status checks to pass”:

| Status | Źródło („Add checks”) | Skąd pochodzi |
| --- | --- | --- |
| `ci-ok` | GitHub Actions | zbiorcze zadanie `ci.yml` |
| `dependency-review` | GitHub Actions | `dependency-review.yml` |
| `SonarCloud Code Analysis` | SonarQube Cloud (aplikacja SonarCloud) | bramka jakości po zadaniu `sonarcloud` |

Wyników CodeQL nie dodaje się jako statusu: pilnuje ich reguła „Require code
scanning results”, która czeka na analizę CodeQL dla ostatniego commitu pull
requesta i blokuje scalenie przy nowym alercie bezpieczeństwa o ważności
high lub critical albo alercie klasy error.

Status nazywa się dokładnie `ci-ok`, bo pod tą nazwą zgłasza go
każdy pull request. Pod nazwą `ci / ci-ok` ten sam status pojawia się tylko w
przebiegu `release.yml`, który wywołuje `ci.yml` jako zadanie `ci`. Pull
request nigdy jej nie zgłasza, więc reguła, która jej wymaga, blokuje każde
scalenie. Ustawienie: w regule `main-protected` zaznacz „Require status checks
to pass”, przez „Add checks” dodaj trzy statusy z tabeli, każdy z jego
źródłem (jeśli jest tam `ci / ci-ok`, usuń go), zaznacz „Require code
scanning results”, dodaj CodeQL z progami z tabeli wyżej i zapisz zmiany.
Statusy `dependency-review` i `SonarCloud Code Analysis` pojawiają się na
liście „Add checks”, gdy zgłosił je już choć jeden pull request.
Sprawdzenie:

```bash
gh api repos/lowicz/oncall/rules/branches/main \
  --jq '.[] | select(.type == "required_status_checks") | .parameters.required_status_checks[].context'
# ci-ok
# dependency-review
# SonarCloud Code Analysis
gh api repos/lowicz/oncall/rules/branches/main \
  --jq '.[] | select(.type == "code_scanning") | .parameters.code_scanning_tools'
# [{"alerts_threshold":"errors","security_alerts_threshold":"high_or_higher","tool":"CodeQL"}]
gh api -i repos/lowicz/oncall/vulnerability-alerts | head -1
# HTTP/2.0 204 No Content   (alerty Dependabota włączone; 404 znaczy wyłączone)
gh api repos/lowicz/oncall/automated-security-fixes --jq .enabled
# false
gh api repos/lowicz/oncall/code-scanning/default-setup --jq .state
# not-configured
```

## Dokumentacja na GitHub Pages

Ta dokumentacja jest też publikowana jako samodzielna strona:
`https://lowicz.github.io/oncall/`. Powstaje z **tych samych plików** `docs/*.md`
i tego samego skryptu `frontend/scripts/build-docs.mjs`, tylko w trybie
`--site` (bez linku „Wróć do aplikacji”, z linkiem do repozytorium i stopką z
wersją). Workflow `pages.yml` publikuje ją po każdej zmianie w `docs/` na
gałęzi `main`. Strona nie jest indeksowana przez wyszukiwarki
(`noindex,nofollow`); kopia w obrazie `web` zawsze odpowiada wersji aplikacji,
z którą została zbudowana.
