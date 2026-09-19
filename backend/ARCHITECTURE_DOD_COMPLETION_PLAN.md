# Plan wykonawczy domknięcia Architecture Definition of Done

Status: proposed; no implementation started  
Prepared: 2026-09-20  
Source: independent audit of `ARCHITECTURE_ACTION_PLAN.md` and the current tree  
Scope: `backend/src/oncall`, backend tests, architecture documentation and contract gates  
Primary constraint: preserve public behavior and persisted data unless the owner separately approves a reproduced defect fix

## 1. Cel

Ten plan domyka rzeczywiste, a nie deklaratywne Definition of Done z
`ARCHITECTURE_ACTION_PLAN.md`. Kończy cztery luki znalezione w audycie:

1. centralny `oncall/models.py` nadal jest wymagany przez zwykłą pracę nad
   feature'ami;
2. najważniejsze use case'y nadal otrzymują szerokie port bundles i szerokie
   protokoły;
3. HTTP ma jawny Unit of Work, lecz granice transakcji workera, outboxa i
   helpera polityki są rozproszone;
4. data biznesowa jest wstrzykiwalna, ale część odczytów czasu runtime omija
   wspólny `Clock`.

Plan nie powtarza pięciu już spełnionych punktów DoD. Zamiast tego utrzymuje je
jako obowiązkowe bramki regresji: kontrakty, zależności domeny, cross-check
solver/reguły, recovery workera na PostgreSQL i komentarze opisujące bieżący
zamiar.

## 2. Decyzje obowiązujące wszystkich agentów

Te decyzje są rozstrzygnięte. Agent nie powinien otwierać ich ponownie podczas
implementacji.

- `oncall/models.py` zostaje usunięty, a nie zamieniony na kolejny plik
  re-exportujący wszystkie modele.
- Modele ORM będą należeć do modułów infrastruktury właściwych feature'ów.
  Jeden moduł może jedynie rejestrować mappery na potrzeby Alembica i testowego
  `create_all`; nie może re-exportować klas.
- Wszystkie odczyty czasu ściennego w runtime idą przez `domain.clock`.
  `time.monotonic()` dla pomiaru trwania operacji pozostaje osobnym, właściwym
  mechanizmem.
- Commit i rollback wykonuje granica Unit of Work. Adaptery i use case'y tylko
  stage'ują lub flushują zmiany. Skrypty seedujące pozostają samodzielnymi entry
  pointami i mogą jawnie zamykać własne transakcje.
- Worker może potrzebować kilku krótkich transakcji na jedno zadanie: claim,
  zapis draftu, heartbeat i finalizacja. Każda ma jednego nazwanego właściciela;
  provider sieciowy i solver nie działają pod lockiem bazy.
- Port jest definiowany przez konsumenta. Adapter może strukturalnie
  implementować kilka małych protokołów; nie tworzymy wrappera, który tylko
  przekazuje wywołania dalej.
- Nie dodajemy migracji bazy. Nazwy tabel, kolumn, indeksów, constraintów,
  enumów i wartości zapisanych w bazie muszą pozostać identyczne.
- Nie zmieniamy ścieżek HTTP, payloadów, statusów, cookies, CSV, iCalendar,
  komunikatów, kolejności ani wyniku solvera. Znaleziona sprzeczność zatrzymuje
  dany PR i wraca do właściciela jako osobny defect note.
- `ARCHITECTURE_ACTION_PLAN.md` nie może ponownie dostać statusu „complete” na
  podstawie opisu zmian. Status zamyka dopiero niezależny Agent 5 po przejściu
  wszystkich bramek końcowych.

## 3. Docelowe, mierzalne DoD

| ID | Warunek końcowy | Dowód maszynowy |
|---|---|---|
| DOD-1 | Kontrakty zewnętrzne bez niezatwierdzonej zmiany | OpenAPI snapshot, pełny pytest, testy HTTP/cookie/CSV/iCal/notification/solver |
| DOD-2 | Domena ma zależności skierowane do wewnątrz i nie importuje frameworków/ORM | allowlist test w `tests/architecture/test_dependencies.py` |
| DOD-3 | Każdy request i każdy atomowy krok workera ma jednego właściciela transakcji | source guard dla `commit`/`rollback`, test request UoW, testy worker UoW i crash points |
| DOD-4 | Wszystkie daty i instants runtime są spójne i wstrzykiwalne | source guard zabraniający `date.today`, `datetime.now` i `utcnow` poza `domain/clock.py` |
| DOD-5 | Solver i evaluator reguł pozostają mechanicznie zgodne | `test_generated_schedule_obeys_rules.py` i fixed-seed fixtures |
| DOD-6 | Brak centralnego registry modeli/schematów w zwykłej pracy feature'owej | brak `src/oncall/models.py`, brak importów `oncall.models`, Alembic metadata bez diffu |
| DOD-7 | Stany, recovery i współbieżność workera są jawne i sprawdzone na PostgreSQL | cały `test_concurrency_postgres.py`, crash-point i abandoned-run tests |
| DOD-8 | Komentarze opisują obecne invariants, nie historię QA | source guard na identyfikatory rund/defektów oraz przegląd człowieka |
| DOD-9 | Nawigacja jest prostsza: brak szerokich bundles i shimów bez zachowania | test struktury portów, brak nazw legacy, dwa ręczne trace'y HTTP → use case → adapter → tabela |

DOD jest binarne. `xfail`, pominięty PostgreSQL, częściowy mypy, zielony test
bez mutacji wykrywającej regresję albo opis „zrobione” w dokumencie nie zamykają
warunku.

## 4. Model pracy agentów

Prace są podzielone na sześć PR-ów. PR-y są merge'owane w podanej kolejności.
Agent zaczyna ze świeżego brancha utworzonego po merge'u poprzednika.

```text
Agent 0: executable DoD gates
             |
Agent 1: complete Clock seam
             |
Agent 2: delete central ORM registry
             |
Agent 3: split consumer-owned ports
             |
Agent 4: centralize worker transactions
             |
Agent 5: independent final audit and closure
```

Sekwencja jest celowa. Są to zmiany przekrojowe z nakładającymi się importami;
równoległe PR-y kosztowałyby więcej konfliktów i mogłyby ukryć regresję podczas
merge'u. Różni agenci zapewniają świeży przegląd kolejnych warstw, ale nie
edytują jednocześnie tego samego drzewa.

Każdy agent przed rozpoczęciem:

1. czyta ten dokument, odpowiednią sekcję pierwotnego planu, ADR-001 i glossary;
2. sprawdza czysty worktree oraz SHA, na którym pracuje;
3. uruchamia testy ukierunkowane na swoją warstwę;
4. identyfikuje test charakterystyczny przed pierwszą zmianą produkcyjną;
5. zachowuje zmiany użytkownika i zmiany z wcześniejszych PR-ów.

## 5. Agent 0 — DoD Gatekeeper

### Misja

Zamienić cztery brakujące kryteria z prose na wykonywalne guardy, zanim kod
produkcyjny zacznie się zmieniać.

### Własność plików

- `backend/tests/architecture/`
- nowy `backend/tests/architecture/test_completion_dod.py`
- ewentualne helpery wyłącznie pod `backend/tests/architecture/`
- `backend/contracts/README.md` tylko dla opisania nowych komend

Nie edytuje `src/` ani snapshotu OpenAPI.

### Zadania

1. Dodać cztery niezależne testy źródłowe:
   - `DOD-3`: niedozwolony `commit`/`rollback` poza ustaloną listą granic;
   - `DOD-4`: bezpośredni czas ścienny poza `domain/clock.py`;
   - `DOD-6`: plik/import `oncall.models`;
   - `DOD-9`: szerokie typy legacy i compatibility aliases.
2. Zakodować obecne braki jako `xfail(strict=True)` z ID DoD. Każdy kolejny
   agent usuwa tylko marker odpowiadający jego naprawie w tym samym PR, w którym
   guard zaczyna przechodzić.
3. Dla DOD-3 dopuścić jawnie `database.py` i entry pointy seedujące. Nie
   dopuszczać workerów, usług notyfikacji, use case'ów ani adapterów.
4. Dla DOD-4 wyłączyć wyłącznie `time.monotonic()` i migracje historyczne.
   SQLAlchemy column defaults w aktualnym runtime również mają korzystać z
   `domain.clock.utc_now`.
5. Dla DOD-9 zabronić co najmniej nazw `SchedulingPorts`, `AdminPorts`,
   `AccessPorts`, `SharingPorts`, `AvailabilityPorts`, `Schedules` i
   `RotationBook`. Dodać limit maksymalnie 8 metod na jeden `Protocol` i 8 pól
   na bundle; mniejsze limity są mile widziane, jeśli wynikają z konsumenta.
6. Udowodnić czułość guardów przez chwilowe mutacje w plikach testowych lub
   produkcyjnych i odwrócić je przed commitem.

### Akceptacja PR-0

- pełny suite pozostaje zielony z dokładnie czterema oczekiwanymi `xfail` DoD;
- każde usunięcie `xfail` na obecnym kodzie powoduje czytelną porażkę;
- Ruff, format, mypy i OpenAPI snapshot przechodzą;
- brak zmian produkcyjnych.

## 6. Agent 1 — Clock Completer

### Misja

Domknąć DOD-4 bez zmiany semantyki: Warsaw dla business day, UTC dla instants,
monotonic clock dla duration.

### Własność plików

- `src/oncall/domain/clock.py`
- `src/oncall/auth.py`
- `src/oncall/account_tokens.py`
- `src/oncall/ical.py`
- `src/oncall/notifications/service.py`
- `src/oncall/infrastructure/sqlalchemy/access.py`
- `src/oncall/models.py` tylko w zakresie defaultów czasu; plik usunie Agent 2
- `src/oncall/seed_admin.py`, `src/oncall/seed_demo.py`
- testy odpowiadające tym ścieżkom

### Zadania

1. Zastąpić wszystkie runtime `datetime.now(UTC)`, `date.today()` i
   `datetime.utcnow()` wywołaniami `utc_now()` albo `business_today()`.
2. Zachować opcjonalny argument `now` wszędzie, gdzie use case już go przyjmuje;
   fallback ma korzystać z Clock, nie ze standardowej biblioteki.
3. Wstrzyknąć `FrozenClock` w testach auth, cookie max-age, token expiry,
   iCalendar DTSTAMP, outbox lease/retry i audit timestamps.
4. Dodać przypadek graniczny 23:30 UTC / 01:30 Europe/Warsaw, tak aby business
   day i instant nie mogły ponownie zostać pomylone.
5. Usunąć `xfail` tylko z guardu DOD-4.

### Akceptacja PR-1

- guard DOD-4 przechodzi bez wyjątków dla kodu runtime;
- testy czasu nie używają realnego zegara;
- `time.monotonic()` w solverze/workerze pozostaje;
- serialized iCalendar, cookies i OpenAPI są niezmienione;
- pełny suite i PostgreSQL suite przechodzą.

## 7. Agent 2 — Persistence Topology

### Misja

Usunąć centralny ORM registry i przypisać każdy mapped row do feature'a, bez
zmiany schematu SQL ani pozostawienia re-export shimów.

### Docelowa mapa

| Moduł | Klasy |
|---|---|
| `infrastructure/sqlalchemy/access_models.py` | `User`, `AccountToken`, `Session` |
| `infrastructure/sqlalchemy/team_models.py` | `TeamMember`, `Eligibility` |
| `infrastructure/sqlalchemy/scheduling_models.py` | `Schedule`, `ScheduleRun`, `Assignment`, `SchedulingPolicy` |
| `infrastructure/sqlalchemy/notification_models.py` | `NotificationOutbox`, `NotificationChannel`, `NotificationStatus` |
| `infrastructure/sqlalchemy/audit_model.py` | `AuditEvent` |
| istniejące feature modules | `Availability`, `CalendarEvent`, `ShareLink`, `CalendarFeedToken`, `SwapRequest`, `SwapRequestSlot` |

`infrastructure/sqlalchemy/model_registry.py` może importować moduły wyłącznie
dla side effectu rejestracji mapperów. Nie eksportuje klas i jest używany tylko
przez Alembic, test bootstrap i ewentualny app bootstrap wymagający pełnego
metadata.

### Własność plików

- `src/oncall/models.py`
- `src/oncall/infrastructure/sqlalchemy/*model*.py`
- wszystkie import sites `oncall.models` w `src/`, `tests/` i `migrations/`
- `migrations/env.py`
- testy mapperów, metadata i persistence

Nie zmienia portów ani granic transakcji.

### Zadania

1. Przenieść klasy, nie kopiować ich. Każda tabela ma jedną mapped class.
2. Importować enumy bezpośrednio z `domain.vocabulary`; enumy outboxa należą do
   modułu notyfikacji.
3. Rozwiązać relacje między modułami typami forward i nazwami mapperów bez
   import cycle. Rejestr mapperów ładuje wszystkie moduły przed `create_all` i
   autogenerate Alembica.
4. Przepisać wszystkie około 130 import sites, w tym testy. Testy importują
   model feature'a albo vocabulary, nigdy registry.
5. Usunąć `src/oncall/models.py`. Nie zostawiać compatibility module.
6. Na czystej bazie PostgreSQL wykonać `alembic upgrade head`, następnie
   `alembic check`; wynik nie może proponować żadnej migracji.
7. Porównać przed/po: nazwy tabel, kolumny z typami/nullability/defaultami,
   PK/FK, unique/check constraints i indeksy.
8. Usunąć `xfail` tylko z guardu DOD-6.

### Akceptacja PR-2

- `rg 'oncall\.models' src tests migrations` zwraca zero;
- `src/oncall/models.py` nie istnieje;
- `alembic check` na PostgreSQL mówi, że nie ma nowych operacji;
- pełny suite, 22+ testy PostgreSQL, Ruff, format, mypy i OpenAPI przechodzą;
- `git diff migrations/versions` jest pusty.

## 8. Agent 3 — Consumer-owned Ports

### Misja

Domknąć DOD-9: use case widzi wyłącznie capabilities, których używa, a nazwa
portu mówi, dla jakiego konsumenta istnieje.

### Własność plików

- `src/oncall/domain/**/ports.py`
- use case modules pod `src/oncall/domain/`
- `src/oncall/bootstrap/providers.py`
- composition functions w `src/oncall/infrastructure/sqlalchemy/`
- fakes pod `tests/domain/`
- architecture tests portów

Nie zmienia modeli ORM, schematu ani polityki transakcji.

### Zadania

1. Rozbić scheduling według pięciu konsumentów: policy, generation, drafts,
   publication i queries. Nie przekazywać globalnego `SchedulingPorts`.
2. Rozbić `Schedules` na protokoły odpowiadające odczytom draftów, zapisowi
   generacji, korektom/transitions i publikacji.
3. Rozbić `SchedulingJournal` na zdarzenia generacji, draftów i publikacji.
4. Rozbić admin na account administration, membership administration,
   eligibility administration i audit queries; usunąć globalne `AdminPorts` i
   szeroki `RotationBook`.
5. Rozbić access co najmniej na sign-in, account-link/password i own-profile;
   usunąć globalne `AccessPorts`.
6. Usunąć `SharingPorts` oraz alias `AvailabilityPorts`. Istniejące małe porty
   sharing/availability pozostają, jeśli mają produkcyjnego konsumenta.
7. Jeśli use case potrzebuje jednego protokołu, przekazać protokół bez
   jednoelementowego dataclass wrappera.
8. Adaptery implementują protokoły strukturalnie; nie dodawać forwarding
   classes tylko po to, aby każda nazwa miała klasę.
9. Dodać test architektury, że żaden bundle nie przekracza 8 pól, żaden
   `Protocol` 8 metod, a zabronione nazwy nie wróciły.
10. Usunąć `xfail` tylko z guardu DOD-9.

### Akceptacja PR-3

- wszystkie zabronione szerokie nazwy z PR-0 zniknęły;
- każdy use-case module otrzymuje własny port albo małe bezpośrednie protokoły;
- fakes mają mniejszy zakres i nie implementują metod nieużywanych przez dany
  test cluster;
- nie powstał żaden nowy adapter, który tylko przekazuje 1:1 do starego;
- pełny suite, PostgreSQL suite i wszystkie contract/static gates przechodzą.

## 9. Agent 4 — Transaction and Worker Boundary

### Misja

Domknąć DOD-3 i ostatni otwarty fragment workera: jeden jawny właściciel każdej
transakcji, brak commitów w adapterach/usługach, jawne state transitions w queue
repository.

### Własność plików

- `src/oncall/database.py`
- `src/oncall/worker.py`
- `src/oncall/notifications/service.py`
- `src/oncall/policy.py`
- scheduling generation queue adapter i odpowiadające wąskie porty z PR-3
- testy Unit of Work, crash points, queue/recovery i PostgreSQL concurrency

Nie zmienia publicznych modeli ani kontraktów HTTP.

### Zadania

1. Zapewnić jeden reusable boundary helper oparty o
   `SqlAlchemyUnitOfWork(factory)`. Tylko on wykonuje commit/rollback.
2. Zmienić `load_policy`: create-if-missing używa `flush`, nie `commit`.
3. Zastąpić rollback po konflikcie enqueue savepointem (`begin_nested`) albo
   równoważną techniką, która nie kasuje całej transakcji requestu.
4. Przenieść raw ORM `_claim_run` i warunkową finalizację z `worker.py` do
   wąskiego queue/claim adaptera. Zachować `FOR UPDATE SKIP LOCKED` i compare-
   and-set na stanie `running`.
5. Nazwać atomowe kroki generacji: recover, claim, load/solve-and-store,
   heartbeat i finish. Każdy otwiera dokładnie jeden UoW; żaden helper poniżej
   granicy nie wykonuje commitu.
6. Zachować osobną sesję progress reportera i brak równoczesnego użycia jednej
   `AsyncSession` przez dwa taski.
7. Rozdzielić outbox na: transakcyjny claim, provider call bez transakcji oraz
   transakcyjny record outcome. `notifications/service.py` nie wykonuje
   commitu.
8. Udowodnić testami, że lock nie jest trzymany podczas solvera ani provider
   I/O, crash po send nadal może powtórzyć najwyżej jedną wiadomość, a lease i
   stable idempotency key pozostają bez zmian.
9. Dodać mutation checks dla: usuniętego commit boundary, braku `SKIP LOCKED`,
   finalizacji bez status guard i provider call wewnątrz transakcji.
10. Usunąć `xfail` tylko z guardu DOD-3.

### Akceptacja PR-4

- w runtime `.commit()`/`.rollback()` występują wyłącznie w Unit of Work;
  seed entry pointy są jedynym jawnym wyjątkiem;
- worker nie importuje `SessionFactory` do ręcznego zarządzania transakcją;
- `worker.py` nie buduje zapytań SQL do `ScheduleRun`;
- test request UoW i worker session-isolation przechodzą;
- wszystkie crash-point i PostgreSQL concurrency tests przechodzą;
- zewnętrzne polling/auth/notification behavior jest niezmienione.

## 10. Agent 5 — Independent Closure Auditor

### Misja

Niezależnie potwierdzić całość. Ten agent nie może być autorem PR-1–PR-4 i nie
zaczyna od deklaracji postępu w dokumentach; zaczyna od kodu i testów.

### Własność plików

- testy/guardy wyłącznie, jeśli wykryją brak dowodu;
- `ARCHITECTURE_ACTION_PLAN.md` i ten dokument dopiero po pozytywnym audycie;
- glossary/ADR tylko dla korekty faktycznie nieaktualnego opisu.

Nie naprawia większej luki „przy okazji”. Jeśli znajdzie niespełnione DoD,
zwraca konkretny PR do odpowiedniego agenta.

### Audyt

1. Uruchomić wszystkie komendy z sekcji 12 na finalnym merge commit.
2. Potwierdzić zero `xfail` związanych z DoD i zero nieoczekiwanych skipów poza
   jawnie środowiskowymi testami; PostgreSQL suite uruchomić osobno, nie uznać
   skipów za wynik.
3. Wykonać dwa trace'y bez globalnego search:
   - command: HTTP create/modify → presentation → use case → consumer port →
     adapter → tabela/outbox → UoW;
   - query: HTTP read → presentation → query use case/read port → adapter →
     response mapper.
4. Przejrzeć wszystkie protokoły i bundles ponad ustalony limit; wyjątek wymaga
   uzasadnienia w ADR, nie komentarza „tymczasowo”.
5. Sprawdzić, że mapper registry nie stał się nowym `models.py`: nie ma
   re-exportów i ordinary feature imports go nie używają.
6. Przeszukać bezpośrednie źródła czasu, commity/rollbacki, framework imports w
   domain, legacy nazwy i komentarze historyczne.
7. Porównać OpenAPI JSON strukturalnie z zatwierdzonym snapshotem.
8. W PostgreSQL wykonać migracje od zera oraz `alembic check`.
9. Przejrzeć diff całej serii pod kątem nowych factories/strategies/managers,
   które mają tylko jednego callera i niczego nie izolują. Usunąć je lub
   zwrócić PR autorowi.
10. Dopiero po wszystkim zmienić status dokumentów na complete i dopisać
    końcową tabelę dowodów z SHA oraz wynikami komend.

### Akceptacja PR-5

- dziewięć wierszy DoD ma status PASS i dowód z finalnego SHA;
- nie ma markerów `xfail` DoD;
- nie ma otwartych „leftover”, „compatibility”, „temporary” ani „next slice” w
  kodzie dotyczącym tego planu;
- dokument nie przeczy kodowi;
- worktree po audycie jest czysty.

## 11. Zasady handoff i review

Każdy PR kończy się krótkim plikiem/opisem handoff zawierającym:

- SHA bazowy i końcowy;
- listę zmienionych invariants;
- test charakterystyczny uruchomiony przed zmianą;
- mutation lub negatywną próbę potwierdzającą czułość nowego testu;
- wynik bramek ukierunkowanych i pełnych;
- jawne stwierdzenie „OpenAPI changed: no” oraz „DB schema changed: no”;
- pozostałe ryzyka, bez ogłaszania kolejnej fazy jako zakończonej.

Reviewer nie akceptuje PR, jeżeli:

- test został osłabiony, aby zaakceptować nową strukturę;
- nowy compatibility re-export ukrywa niedokończoną migrację;
- adapter wykonuje commit, bo „tak było łatwiej”;
- test PostgreSQL został zastąpiony SQLite;
- snapshot OpenAPI został zaktualizowany bez osobnej zgody właściciela;
- mechaniczny move jest zmieszany z niezatwierdzoną zmianą zachowania.

## 12. Obowiązkowe komendy końcowe

Uruchamiane z `backend/`, chyba że zaznaczono inaczej:

```bash
./.venv/bin/pytest -q
./.venv/bin/ruff check src tests scripts
./.venv/bin/ruff format --check src tests scripts
./.venv/bin/mypy
./.venv/bin/python scripts/openapi_snapshot.py
```

PostgreSQL contract database, uruchamiane osobno. Jest to wyłącznie disposable
container z `tmpfs`; należy go odtworzyć, aby migracje zaczynały na pustej
bazie. Najpierw sprawdzamy Alembic, dopiero potem suite współbieżności, którego
fixture tworzy tabele bez Alembica:

```bash
docker compose -f ../docker-compose.contract.yml down
docker compose -f ../docker-compose.contract.yml up -d --wait
ONCALL_DATABASE_URL='postgresql+asyncpg://oncall_contract:oncall_contract@127.0.0.1:55432/oncall_contract' \
  ./.venv/bin/alembic upgrade head
ONCALL_DATABASE_URL='postgresql+asyncpg://oncall_contract:oncall_contract@127.0.0.1:55432/oncall_contract' \
  ./.venv/bin/alembic check
ONCALL_TEST_POSTGRES_URL='postgresql+asyncpg://oncall_contract:oncall_contract@127.0.0.1:55432/oncall_contract' \
  ./.venv/bin/pytest -q tests/test_concurrency_postgres.py
```

Kontrole źródłowe, których dokładna logika ma być utrwalona przez Agent 0:

```bash
rg 'from oncall\.models|import oncall\.models' src tests migrations
rg '\.(commit|rollback)\(' src/oncall
rg 'date\.today|datetime\.now|datetime\.utcnow' src/oncall
rg 'SchedulingPorts|AdminPorts|AccessPorts|SharingPorts|AvailabilityPorts|class Schedules|class RotationBook' src tests
```

Oczekiwany wynik końcowy ostatnich czterech kontroli to zero, poza precyzyjnie
udokumentowanymi wyjątkami: implementacja `SystemClock`, Unit of Work oraz
samodzielne entry pointy seedujące.

## 13. Ryzyka i reakcje

| Ryzyko | Sygnał | Reakcja |
|---|---|---|
| Niezaładowany mapper po podziale modeli | błąd `failed to locate a name`, brak tabeli w metadata | jeden registry side-effect dla bootstrap/Alembic; test konfiguracji wszystkich mapperów |
| Przypadkowa zmiana schematu | `alembic check` proponuje operacje | zatrzymać PR, porównać metadata; bez nowej migracji |
| Utrata atomiczności po usunięciu commitu | audit/outbox zapisany bez business change lub odwrotnie | rollback/recorded-refusal tests przed refaktorem i po nim |
| Lock trzymany przez solver/provider | drugi worker czeka zamiast użyć `SKIP LOCKED` | test dwóch workerów z kontrolowanym overlapem na PostgreSQL |
| Nadmierne rozdrobnienie portów | wiele wrapperów 1:1 i konstruktorów bez alternatyw | przekazywać pojedynczy Protocol bez wrappera; usuwać indirection-only classes |
| Clock zmienia serializowany czas | różny cookie max-age/DTSTAMP/retry boundary | FrozenClock i golden output dla dokładnego instant |
| Testy przechodzą, bo nie dotykają zmienionej gałęzi | mutacja nie powoduje porażki | obowiązkowy negatywny test lub mutation check w handoff |

## 14. Warunek zamknięcia

Plan jest wykonany dopiero wtedy, gdy Agent 5 na jednym finalnym SHA potwierdzi
wszystkie dziewięć DOD, PostgreSQL suite nie jest pominięty, OpenAPI i schema
są niezmienione, a cztery guardy dodane przez Agenta 0 przechodzą bez `xfail` i
bez wyjątków tymczasowych. Sam merge wszystkich PR-ów nie jest dowodem
ukończenia.
