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

## Aktualizacja i cofnięcie

Aktualizacja to zmiana jednej linii i pobranie obrazów:

```bash
sed -i 's/^ONCALL_VERSION=.*/ONCALL_VERSION=1.2.4/' .env
docker compose pull
docker compose up -d
```

Migracje bazy wykonują się przy starcie usługi `api` (patrz
[Uruchomienie](uruchomienie.md#konto-administratora)).

Cofnięcie do poprzedniej wersji wygląda tak samo, z poprzednim numerem.
Obrazy wcześniejszych wydań pozostają w rejestrze. Migracje bazy nie cofają
się automatycznie - jeśli wydanie zmieniło schemat, sprawdź w jego opisie na
GitHubie, czy cofnięcie wymaga dodatkowych kroków.

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
| `backend` | `ruff check`, `ruff format`, `mypy`, `pytest` na SQLite, zgodność OpenAPI ze snapshotem |
| `backend-postgres` | zestaw współbieżności na prawdziwym PostgreSQL 17 |
| `frontend` | `eslint`, `tsc`, `vitest`, `npm run build` (renderuje dokumentację i sprawdza spis treści, odsyłacze i kotwice), render strony samodzielnej |
| `compose-config` | poprawność `docker-compose.yml` z każdą nakładką i to, że nakładka deweloperska zmienia tylko źródło obrazów |
| `image-build` | oba Dockerfile budują się (bez publikacji) |

Jeden zbiorczy status `ci-ok` jest wymagany do scalenia zmian.

## Aktualizacje zależności

Zależnościami opiekuje się Renovate (aplikacja GitHub od Mend, konfiguracja w
`renovate.json5` w katalogu głównym; repozytorium nie przechowuje przez to
żadnych sekretów). Obejmuje akcje GitHub (przypięte do pełnego SHA z komentarzem
wersji), pakiety npm i Pythona (przez pliki lock), obrazy bazowe kontenerów
oraz wersje narzędzi powtórzone w plikach workflow (uv, Node, Python,
PostgreSQL).

Zasady:

- jeden pull request tygodniowo na ekosystem dla aktualizacji minor i patch,
  otwierany w poniedziałek przed 6:00 czasu warszawskiego,
- nowe wydanie pakietu musi mieć co najmniej trzy dni, zanim zostanie
  zaproponowane - świeżo opublikowana, być może przejęta, wersja nie trafia do
  PR-a tego samego dnia,
- poprawki bezpieczeństwa (alerty GitHub i baza OSV) powstają natychmiast,
  osobno i z etykietą `security`,
- zmiany wersji głównych oraz każda zmiana środowiska uruchomieniowego
  (Python, Node, PostgreSQL) czekają na zaznaczenie w Dependency Dashboard -
  to decyzje, nie rutyna,
- nic nie jest scalane automatycznie; każdy PR przechodzi `ci-ok` i przegląd.

## Dokumentacja na GitHub Pages

Ta dokumentacja jest też publikowana jako samodzielna strona:
`https://lowicz.github.io/oncall/`. Powstaje z **tych samych plików** `docs/*.md`
i tego samego skryptu `frontend/scripts/build-docs.mjs`, tylko w trybie
`--site` (bez linku „Wróć do aplikacji”, z linkiem do repozytorium i stopką z
wersją). Workflow `pages.yml` publikuje ją po każdej zmianie w `docs/` na
gałęzi `main`. Strona nie jest indeksowana przez wyszukiwarki
(`noindex,nofollow`); kopia w obrazie `web` zawsze odpowiada wersji aplikacji,
z którą została zbudowana.
