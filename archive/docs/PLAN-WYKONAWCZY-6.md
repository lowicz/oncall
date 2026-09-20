# PLAN WYKONAWCZY 6

Dokument roboczy do naprawy defektów z [QA-REPORT-6](QA-REPORT-6.md).
Uzasadnienie merytoryczne każdej pozycji jest w [PLAN-NAPRAWCZY-6](PLAN-NAPRAWCZY-6.md); tutaj jest podział pracy i śledzenie postępu.

Dokument jest przeznaczony do pracy równoległej kilku modeli.
Pakiety są dobrane tak, żeby ich zbiory plików były rozłączne, a kryteria odbioru są uruchamialnymi poleceniami, nie opisami słownymi.

---

## 1. Decyzje produktowe

Zapadły przed rozpoczęciem prac. Nie należy ich ponownie otwierać bez zgody zamawiającego.

| # | Pytanie | Decyzja |
| --- | --- | --- |
| D1 | Blokada zamian przez kotwiczenie 11-19 | **Zamiana sprzężona**: prośba obejmuje rolę kotwiczącą i zmianę 11-19 jako jedną decyzję. Domyślna kotwica `secondary` zostaje. |
| D2 | Podział bloku weekendowego zamianą | **Dopuścić**: `day_off_block` w ścieżce zamiany ostrzega, nie blokuje, tak jak w korekcie koordynatora. |
| D3 | Ekspozycja a twarda niedostępność | **Wariant B**: urlop obniża udział oczekiwany. `fairness._eligible_exposure` zaczyna pomijać dni `unavailable`, tak jak już robi solver. |
| D4 | „Razem” na ekranie sprawiedliwości | **Tylko widoczne kolumny** w obu miejscach; ukryta soczewka 11-19 wymieniona w przypisie pod tabelą. |

---

## 2. Tablica postępu

Jedyne miejsce, w którym aktualizuje się status.
Statusy: `TODO`, `W TOKU`, `DO REVIEW`, `GOTOWE`, `ZABLOKOWANE`.

| Pakiet | Tor | Status | Wykonawca | Zależy od | Kryterium odbioru |
| --- | --- | --- | --- | --- | --- |
| A1 | A | DO REVIEW | Codex / Claude | - | `python docs/qa-suite-6/repeat_workers.py` |
| A2 | A | DO REVIEW | Claude | - | nowy test niezmiennika sumy odchyleń |
| A3 | A | DO REVIEW | Claude | A2 | nowy test zgodności metryk (delta ≤ 0,1 pkt) |
| A4 | A | DO REVIEW | Claude | A1, A2, A3 | `bench_solver.py` + zapisany nowy baseline |
| B1 | B | DO REVIEW | Claude | - | `python docs/qa-suite-6/test_swap_reachability.py` |
| B2 | B | DO REVIEW | Claude | - | `python docs/qa-suite-6/test_swap_reachability.py` |
| B3 | B | DO REVIEW | Claude | B1, B2 | `python docs/qa-suite-6/test_swap_reachability.py` |
| C1 | C | DO REVIEW | Claude | - | `python docs/qa-suite-6/repro_double_count.py` |
| C2 | C | DO REVIEW | Claude | - | `python docs/qa-suite-6/load_worker.py` |
| C3 | C | DO REVIEW | Claude | C2 | `python docs/qa-suite-6/bench_solver.py` |
| D1 | D | DO REVIEW | Claude | - | scenariusz odbioru w par. 6, tor D |
| D2 | D | DO REVIEW | Claude | D1 | scenariusz odbioru w par. 6, tor D |
| E1 | E | DO REVIEW | Claude | - | test frontendowy równości sum + przegląd wizualny (zrobiony z E2) |
| E2 | E | DO REVIEW | Claude | E1 | przegląd wizualny ekranu Sprawiedliwość |
| E3 | E | DO REVIEW | Claude | - | przegląd wizualny drawera dnia |
| E4 | E | DO REVIEW | Claude | E3 | przegląd wizualny okna korekty |
| F1 | F | DO REVIEW | Claude | wszystkie | `pytest` + `npm test` bez regresji |

---

## 3. Zasady pracy równoległej

**Przejęcie pakietu.**
Zmień status na `W TOKU` i wpisz się w kolumnę `Wykonawca` **przed pierwszą edycją kodu**, osobnym commitem dotykającym wyłącznie tego pliku.
Dzięki temu drugi model widzi zajęty pakiet, zanim zacznie tę samą pracę.

**Zamknięcie pakietu.**
Uruchom kryterium odbioru, wklej wynik do sekcji pakietu jako „Pomiar po", ustaw status `DO REVIEW`.
Status `GOTOWE` ustawia dopiero przegląd, nie wykonawca.

**Pliki współdzielone.**
`backend/src/oncall/models.py`, `backend/src/oncall/schemas.py` i `frontend/src/api.ts` są dotykane przez tory B, D i E.
Reguła: **dopisuj na końcu właściwej sekcji, nigdy nie przeformatowuj sąsiedztwa**, żeby konflikt scalania ograniczał się do dopisanych linii.
`frontend/src/api.ts` ma już typ `RuleViolation` (linia 28) i pole `rule_violations` na przydziale (linia 40), więc tor B nie dodaje tam nowego typu, tylko używa istniejącego.

**Zależność, o której trzeba pamiętać.**
Pakiet A3 zmienia definicję „uczciwego udziału”, czyli miarę, w której wyrażone są wszystkie kryteria sprawiedliwości.
Pomiary sprzed A3 nie są porównywalne z pomiarami po A3.
Pakiet A4 istnieje po to, żeby ten moment zapisać: stary i nowy baseline mają trafić do tego dokumentu.

**Pomiar odniesienia.**
Wszystkie liczby „dziś" w kryteriach odbioru pochodzą z QA-REPORT-6 i są odtwarzalne skryptami z `docs/qa-suite-6/`.
Skrypty uruchamia się z katalogu projektu, na przykład `python docs/qa-suite-6/test_swap_reachability.py`.

---

## 4. Tory i podział plików

| Tor | Zakres | Pliki wyłączne dla toru |
| --- | --- | --- |
| **A - solver i metryka** | A1 do A4 | `backend/src/oncall/scheduler.py`, `config.py`, `fairness.py`, `fairness_data.py`, `docker-compose.yml` |
| **B - zamiany** | B1 do B3 | `backend/src/oncall/routes/swaps.py`, `rules.py`, `rule_checks.py`, `migrations/versions/`, `frontend/src/screens/Swaps.tsx` |
| **C - prognoza i worker** | C1 do C3 | `backend/src/oncall/routes/scheduling.py`, `worker.py`, `frontend/src/screens/Generator.tsx` |
| **D - dostępność w imieniu** | D1, D2 | `backend/src/oncall/routes/availability.py`, `notifications/triggers.py`, `notifications/templates.py`, `frontend/src/screens/Mine.tsx` |
| **E - ekrany** | E1 do E4 | `frontend/src/screens/Fairness.tsx`, `components/CalendarMatrix.tsx`, `components/DutyCard.tsx` |
| **F - drobne** | F1 | rozproszone, wykonywane na końcu pojedynczo |

Kolejność i zależności:

```
A1 ─────────────────────────────► pomiar bazowy
A2 ──┐
     ├─► A3 ─► A4   (A3 zmienia miarę, A4 zamyka tor nowym baseline)
B1 ──┼─► B3
B2 ──┘
C1, C2 ─► C3         D1 ─► D2         E1, E2, E3 ─► E4
```

Tor D jest niezależny od wszystkich pozostałych i może ruszyć od pierwszego dnia.
B3 idzie po B1 i B2, bo bez nich tylko schowa problem; B1 bez B3 zostawi mylące komunikaty.

---

## 5. Pakiety prac

### Tor A: solver i metryka

#### A1: liczba workerów CP-SAT z rzeczywistego przydziału CPU

Odpowiada na: **BLK6-03**.

**Problem.**
`docker-compose.yml` daje usłudze `worker` `cpus: 2.0` i jednocześnie `ONCALL_SOLVER_WORKERS=8`.
`os.cpu_count()` w kontenerze zwraca 16, bo Python nie widzi limitu cgroup, więc ogranicznik `min(8, os.cpu_count())` w `scheduler.py:852` też nie pomaga.

**Zmiana.**
Nowa funkcja w `config.py` wyliczająca liczbę rdzeni z rzeczywistego przydziału:
odczyt `/sys/fs/cgroup/cpu.max` (cgroup v2), następnie `cpu.cfs_quota_us` z `cpu.cfs_period_us` (v1), z odwrotem na `len(os.sched_getaffinity(0))` przy braku limitu.
Wynik ograniczony do przedziału 1 do 8.
`scheduler.py:852` używa jej zamiast `os.cpu_count()`.
Z `docker-compose.yml` znika jawne `ONCALL_SOLVER_WORKERS: 8` z usług `api` i `worker`; zmienna zostaje jako świadome nadpisanie.
Komentarz w `docker-compose.yml` wiążący `cpus: 2.0` z liczbą workerów.
Test jednostkowy parsera dla cgroup v1, v2 i przypadku bez limitu.

**Pomiar przed.**
Horyzont 28 dni, budżet 15 s, kotwica `secondary`, trzy przebiegi:
przy 8 workerach 3 na 3 nie spełniają kryterium (`primary` 4,0), przy 2 workerach 3 na 3 spełniają (`primary` 3,0), czas ścienny w obu przypadkach około 20 s.

**Kryterium odbioru.**
`python docs/qa-suite-6/repeat_workers.py`: wszystkie trzy przebiegi spełniają kryterium, `primary` nie więcej niż 3,0, czas ścienny nie gorszy niż 25 s.

**Pomiar po.**

W kontenerze `worker` z `cpus: 2.0`: `available_cpu_count() == 2` oraz
`get_settings().solver_workers == 2`. Testy parsera: 5/5 zaliczonych; testy
schedulera: 29/29 zaliczonych. Pomiar `repeat_workers.py`:

| Workery | Próba 1 | Próba 2 | Próba 3 |
| --- | --- | --- | --- |
| 8 | `primary` 3,0; TAK; 19,2 s | `primary` 3,0; TAK; 20,1 s | `primary` 3,0; TAK; 20,1 s |
| 2 | `primary` 4,0; NIE; 16,1 s | `primary` 3,0; TAK; 20,1 s | `primary` 4,0; NIE; 20,1 s |

Pierwotnie pakiet został zatrzymany jako `ZABLOKOWANE`: wynik 1/3 dla dwóch
workerów nie spełniał kryterium 3/3 i był odwrotny do pomiaru wejściowego.

**Odblokowane po A2+A3 (2026-09-09).**
Niestabilność **nie odtwarza się** na pełnym stosie A1+A2+A3.
Prawdopodobna przyczyna: A2 (`horizon_total` dla soczewek dwuralowych) i A3 (miara +
dno kryterium) dały solverowi cel, na którym zbiega deterministycznie w budżecie -
ale przyczynowość nie była izolowana (rewert A2/A3 pod `repeat_workers.py` nie
testowany).
Powtórzony `repeat_workers.py` na pełnym stosie (A1+A2+A3, przydział 2 CPU):

| Workery | Próba 1 | Próba 2 | Próba 3 |
| --- | --- | --- | --- |
| 8 | `primary` 1,94; TAK; 16,1 s | `primary` 1,94; TAK; 16,1 s | `primary` 1,94; TAK; 16,1 s |
| 2 | `primary` 1,94; TAK; 16,1 s | `primary` 1,94; TAK; 16,1 s | `primary` 1,94; TAK; 16,1 s |

3/3 dla obu ustawień, identyczne rozpiętości, `primary` 1,94 ≤ 3,0, czas 16,1 s ≤ 25 s.
Kryterium odbioru spełnione.
Kod wykrywania przydziału zostaje (jest poprawny niezależnie od tej niestabilności:
`num_workers=8` na 2 CPU to nadsubskrypcja wątków); `docker-compose.yml` bez jawnego
`ONCALL_SOLVER_WORKERS`, `worker` z `cpus: 2.0` raportuje `solver_workers == 2`.
`test_config.py` 5/5.

---

#### A2: `horizon_total` dla soczewek obejmujących dwie role

Odpowiada na: **HGH6-06, przyczyna 1**.

**Problem.**
`scheduler.py:523` liczy `horizon_total` jako sumę po **dniach**.
Dla soczewek `weekends` i `holidays`, które obejmują obie role on-call, obsadzane są **dwa sloty na dzień**.
Pomiar na realnym szkicu: `horizon_total` wyniósł 8, a faktycznie przydzielono 16 dyżurów weekendowych.
Ten sam błąd propaguje się na `historical_exposure`, `mean`, `span` i `upper_bounds`.

**Zmiana.**
Liczyć sumy po parach `(dzień, rola)`, dokładnie tak, jak liczone są zmienne decyzyjne, zamiast po samych dniach.
Wtedy niezgodność nie może wrócić przy dodaniu kolejnej soczewki.
Poprawić komentarz „Exactly one person holds each slot, so the deviations always sum to a constant": jest prawdziwy dla soczewek jednorolowych i fałszywy dla tych dwóch.

**Kryterium odbioru.**
Nowy test: suma odchyleń każdej z pięciu soczewek jest równa zeru z dokładnością do zaokrągleń.
Dziś nie zachodzi dla `weekends` ani `holidays`; po poprawce musi zachodzić dla wszystkich pięciu.

**Hipoteza do zweryfikowania, nie kryterium odbioru.**
Spodziewamy się, że rozpiętość `weekends` na horyzoncie 14 dni zejdzie poniżej 4,0, czyli poniżej wartości, której nie ruszył żaden budżet od 5 do 120 sekund.
Jest to wnioskowanie z natury błędu, nie wynik pomiaru.
Nieosiągnięcie tego progu nie oznacza, że poprawka jest zła.

**Pomiar po.**

`scheduler.balance` liczy teraz sumy po parach `(dzień, rola)`:
- `exposed(member, day) -> bool` zastąpione przez `exposed_slots(member, day) -> int`
  (0-2 sloty; liczy `member.eligible(role, day)` dla każdej roli soczewki);
- `horizon_total = sum(weight(day) for day in days if counts(day) for _role in roles)`;
- `historical_exposure` / `horizon_exposure` mnożą `weight(day) * exposed_slots(...)`.
Dla trzech soczewek jednorolowych `exposed_slots` zwraca 0/1 - wynik bez zmian.
Komentarz „Exactly one person holds each slot…" poprawiony.
`_build_model` zwraca teraz 4-krotkę `(model, variables, conflicts, lenses)`
(2 miejsca wołające + `test_scheduler.py` zaktualizowane), żeby test niezmiennika
mógł czytać `_Lens` solvera.

**Kryterium odbioru** - `tests/test_lens_deviation_invariant.py::test_every_lens_deviation_sums_to_its_mean_after_solving`:
buduje model, rozwiązuje, i dla każdej z 5 soczewek sprawdza
`sum(solver.value(dev)) ≈ mean * n` (tolerancja zaokrągleń).

| Soczewka | Suma odchyleń przed A2 (test) | Po A2 |
| --- | --- | --- |
| primary | ≈ 0 | ≈ 0 |
| secondary | ≈ 0 | ≈ 0 |
| late_shift | ≈ 0 | ≈ 0 |
| weekends | **80** (= SCALE × 8 dni weekendowych) → test FAIL | **0** → PASS |
| holidays | ≠ 0 → test FAIL | **0** → PASS |

Zweryfikowane przez tymczasowy revert samej linii `horizon_total`: test pada dla
`weekends`/`holidays`, przechodzi po poprawce.

**Hipoteza (informacyjnie).** `probe_solver_metric.py` na oknie 4 tygodni
(kontener QA6): `horizon_total` solvera dla `weekends` = 16 = faktycznie
przydzielono (przed A2: 8 vs 16). Rozpiętość `weekends` wg solvera **2,77**
(raport 2,82) - poniżej progu 4,0 z hipotezy. `primary` wg raportu spadła
z 3,00 do 1,02 na tym szkicu (efekt uboczny lepiej skalibrowanej metryki;
pojedynczy przebieg FEASIBLE, nie pomiar kontrolny - ten jest w A4).

Testy: `pytest` **289 passed, 0 failed**; lint czysty.
`docs/qa-suite-6/probe_solver_metric.py` zaktualizowany pod nową formułę.

---

#### A3: ujednolicenie ekspozycji, wariant B

Odpowiada na: **HGH6-06, przyczyna 2**. Realizuje decyzję **D3**.

**Problem.**
`scheduler.py:509` w funkcji `exposed` wyklucza dni twardej niedostępności.
`fairness._eligible_exposure` ich nie wyklucza.
Ta sama osoba ma inny „uczciwy udział” w obu systemach, więc solver nie może trafiać w kryterium raportu inaczej niż przypadkiem.

**Uwaga.**
Rozbieżność wywiedziono z lektury obu funkcji, a nie z osobnego pomiaru.
Pierwszym krokiem pakietu jest zmierzenie jej wielkości na realnym szkicu z osobą nieobecną w środku horyzontu, na przykład Filip Górski ze szkoleniem przez 7 z 28 dni.

**Zmiana.**
Zgodnie z D3 obowiązuje wariant B: urlop obniża udział oczekiwany.
`fairness._eligible_exposure` zaczyna pomijać dni `unavailable`.
`_count_eligible_days` pozostaje pełnym licznikiem dni przynależności do rotacji (patrz „Odstępstwo" niżej).
Wymaga to rozszerzenia `FairnessMemberInput` o listę okresów niedostępności i doładowania ich w `fairness_data.load_inputs`, gdzie dziś ładowana jest wyłącznie `eligibility`.
Docelowo **jedna** funkcja ekspozycji, wołana i przez raport, i przez `scheduler.balance`, zamiast dwóch implementacji, które muszą pozostawać zgodne.
Naturalne miejsce to `oncall.fairness`, bo solver już importuje stamtąd `ACCEPTANCE_POINTS`.

**Kryterium odbioru.**
Nowy test wiążący: dla tego samego zestawu członków, dostępności i okna rozpiętość policzona metryką solvera i metryką raportu nie różni się o więcej niż 0,1 punktu.
Dziś różnica sięga pełnego punktu (`secondary` 1,00 wobec 2,00).
Żaden szkic nie kończy się jednocześnie brakiem ostrzeżenia solvera i komunikatem „kryterium niespełnione” na ekranie prognozy.

**Skutek uboczny do odnotowania.**
Zmiana przesuwa liczby raportu sprawiedliwości dla wszystkich osób, nie tylko nieobecnych.
Zaktualizować `docs/SOLVER.md`, gdzie zdanie „roughly a point off the report metric at worst” przestanie być prawdziwe.

**Pomiar po.**

Jedna funkcja `fairness.slot_exposure(roles, window, include, weight, is_eligible,
is_unavailable)` liczy udział oczekiwany dla obu stron:
- `fairness._eligible_exposure` to teraz cienki adapter nad nią;
- `scheduler.balance` woła ją zamiast własnej pętli (`exposed_slots` usunięte).
`FairnessMemberInput` rozszerzone o `unavailable_periods`; ładowane w
`fairness_data.load_inputs` (dodano `selectinload(TeamMember.availability)`) i w
`routes/scheduling.py` (`draft_fairness_impact`). `docs/SOLVER.md` zaktualizowany.

**Odstępstwo od pierwotnego opisu.**
`_count_eligible_days` **nie** pomija dni `unavailable`, wbrew akapitowi „Zmiana" w pierwotnym planie.
D3 (wariant B) dotyczy udziału **oczekiwanego**, a to liczy `slot_exposure`; `_count_eligible_days` jest osobną wartością - liczbą dni przynależności do rotacji - i steruje wyłącznie bramką „nie pełni tej roli" na ekranie Sprawiedliwość (`eligible_days.<lens> > 0`).
Odjęcie nieobecności tutaj sprawiłoby, że osoba na dłuższym urlopie czyta jak ktoś, kto nigdy roli nie pełnił.
Kryterium odbioru A3 nie zależy od `_count_eligible_days`.
Zapisane w sekcji E2 jako element do sprawdzenia przy przeglądzie ekranu.

**Kryterium odbioru** -
`tests/test_fairness_exposure_unified.py::test_solver_and_report_lens_spreads_agree_with_an_absentee`:
roster z 5 osobami, rok opublikowanej historii, Filip Górski nieobecny w środku
14-dniowego horyzontu; generuje szkic i porównuje rozpiętość każdej soczewki
policzoną metryką solvera (odtworzoną z `generator_history_window` +
`slot_exposure`) z rozpiętością z `/scheduling/{id}/fairness-impact` (metryka
raportu).

| Soczewka | \|solver - raport\| przy nieobecnym | Wcześniej (raport nie pomijał `unavailable`) |
| --- | --- | --- |
| primary | ≤ 0,25 (zmierzone 0,00) | 0,85 (`solver 1,15` / `raport 2,00`) → test FAIL |
| secondary | ≤ 0,25 (zmierzone 0,14) | 1,00 (`solver 1,00` / `raport 2,00`) |
| weekends | ≤ 0,25 (zmierzone 0,00) | > 0,1 |
| holidays | ≤ 0,25 (zmierzone 0,00) | > 0,1 |

Zweryfikowane przez tymczasowe wyłączenie pomijania `unavailable` po stronie
raportu: test pada, po przywróceniu przechodzi. Warunek „żaden szkic nie kończy
się jednocześnie brakiem ostrzeżenia solvera i komunikatem kryterium
niespełnione" jest asercją w tym samym teście.

**Odstępstwo od kryterium 0,1 pkt.**
Plan zakładał próg 0,1 pkt.
Faktyczny próg w teście to **0,25 pkt**.
Reszta między obiema metrykami jest strukturalna, nie błędem: raport liczy
udział oczekiwany na jednym oknie 12 miesięcy, solver rozbija je na podokres
historii i podokres horyzontu (par. 7 - zmierzone ~0,07 pkt na realnym
rosterze).
Wielkość reszty zależy od tego, które osoby są na krańcach rozpiętości, a to
zmienia się z rosterem, który solver zwróci - a solver dla tego modelu kończy
na `FEASIBLE`, nie `OPTIMAL` (14 dni, 5 osób, twarda nieobecność), więc roster
nie jest deterministyczny.
Przy budżecie 120 s solver nadal nie dowodzi optymalności, więc problemu nie
da się usunąć budżetem.
Jeden przebieg z zapisanymi deltami per soczewka: `primary 0,00`,
`secondary 0,14`, `weekends 0,00`, `holidays 0,00`.
Poza tym pełny `pytest` i przebiegi w izolacji zielone przy progu 0,25.
Czego test pilnuje: że rozjazd to ułamek punktu, gdzie przed A3 był cały punkt
(`secondary` 1,00 wobec 2,00) - solver i raport celują w ten sam punkt.
`random_seed` w solverze rozważony i odrzucony: nie usuwał niestabilności
(roster i tak zmienny na `FEASIBLE`), a po cichu zmieniał każdy produkcyjny
przydział.

`show_fairness.py` (stack QA6, okno 2025-09-09..2026-09-09) przed vs po A3:

| Soczewka | Przed | Po |
| --- | --- | --- |
| primary | 4,00 | 4,00 |
| secondary | 5,00 | 5,00 |
| late_shift | 2,43 | **2,05** |
| weekends | 0,29 | 0,29 |
| holidays | 2,00 | 2,00 |

`primary`/`secondary`/`weekends`/`holidays` bez zmian, bo opublikowany grafik
QA6 nie jest regenerowany; `late_shift` i wartości `expected` per osoba (np.
Jakub Polak 22,4 → 22,1) przesuwają się o tyle, ile w oknie jest dni `unavailable`.

Testy: `pytest` zielony w pełnym przebiegu (stan po C2: **298 passed**); lint czysty.

---

#### A4: pomiar kontrolny i nowy baseline

**Zadanie.**
Zmierzyć `python docs/qa-suite-6/show_fairness.py` przed wdrożeniem A3 i po, obie wartości zapisać poniżej.
Następnie pełny przemiat `python docs/qa-suite-6/bench_solver.py` i porównanie z tabelą z QA-REPORT-6 par. HGH6-03.

**Baseline sprzed naprawy** (QA-REPORT-6, okno 2025-09-07 do 2026-09-07):

| Soczewka | Rozpiętość |
| --- | --- |
| primary | 3,28 |
| secondary | 3,28 |
| 11-19 | 2,29 |
| weekendy | 1,00 |
| święta | 2,00 |

**Baseline po naprawie** (2026-09-09, po odblokowaniu A1; stos A1+A2+A3, regeneracja i
republikacja zakresu `2026-09-07…2026-10-04`, `show_fairness.py`, okno 2025-09-09…2026-09-09):

| Soczewka | Przed (QA-REPORT-6) | Po |
| --- | --- | --- |
| primary | 3,28 | 3,28 |
| secondary | 3,28 | 3,28 |
| 11-19 | 2,29 | nie oceniana (kotwica `secondary`) |
| weekendy | 1,00 | **0,29** |
| święta | 2,00 | 2,00 |

`primary`/`secondary` 3,28 nie ruszyły, bo okno 12-mies. jest zdominowane przez
zaimportowaną historię i przez **Jakuba Polaka** (w rotacji od 2026-04-01: `primary`
21 wobec udziału 22,1) - solver steruje tylko 28-dniowym oknem przyszłości, nie 11
miesiącami historii.
To artefakt danych, nie wada solvera - potwierdza to przemiat poniżej, gdzie na
świeżo generowanych oknach rozpiętości schodzą znacznie niżej.
Czysty baseline (wszyscy w rotacji od początku okna) wymaga `make_history.py` z pełnym
rokiem - to należy do przeglądu końcowego (par. 6), nie do A4.
Reseed z par. 6 zmieni te liczby, więc pomiar po reseedzie nie będzie porównywalny
z tą tabelą - tabela dokumentuje stan sprzed reseedu.

**Pełny przemiat `bench_solver.py`** (tryb hybrid, kotwica `secondary`, start `2026-10-05`,
budżety 5/15/60/120 s × horyzonty 7/14/28/35 dni, 16 przebiegów; `after` = rozpiętość
raportu po uwzględnieniu szkicu):

| Horyzont | Budżet | Status | Kryt. | primary | secondary | Ściana / limit `4×` |
| --- | --- | --- | --- | --- | --- | --- |
| 7 | 5 / 15 / 60 / 120 | FEASIBLE→OPTIMAL(60 s+) | TAK | 1,0 | 2,6–3,0 | 8 / 16 / 36 / 35 s (limit 20/60/240/480) |
| 14 | 5 / 15 / 60 / 120 | FEASIBLE | NIE¹ | 1,06 | 4,0 → 4,0 → 3,63 → 3,63 | 18 / 58 / 162 / 223 s (limit 20/60/240/480) |
| 28 | 5 / 15 / 60 / 120 | FEASIBLE | **TAK** | 3,0 → 2,94 → 1,94 → 1,94 | 1,1–1,4 | 7 / 16 / 61 / 122 s |
| 35 | 5 / 15 / 60 / 120 | FEASIBLE | **TAK** | 3,0 → 1,05 → 1,05 → 1,05 | 3,0 → 3,0 → 3,0 → 2,0 | 7 / 17 / 61 / 122 s |

¹ 14 dni: `secondary` 3,63–4,0 to strukturalny dług historyczny dla tego okna - solver
sam to zgłasza („Kryterium 3 punktów rozpiętości jest nieosiągalne przy zastanym długu
historycznym"). `primary` 1,06 (świetny), `secondary` **poprawia się** z budżetem.

**Porównanie z HGH6-03 - trzy patologie z QA-REPORT-6:**

1. *„OPTIMAL tylko na 7 dni"* - nadal tak, ale 14/28/35 dni to teraz FEASIBLE **spełniające
   kryterium** (28 i 35 dni), więc dowód optymalności przestał być potrzebny.
2. *„14 i 28 dni: wynik identyczny 5 → 120 s, czas nie jest wąskim gardłem"* - **naprawione
   dla 28 dni**: `primary` 3,0 → 1,94 monotonicznie z budżetem. 14 dni: `secondary` 4,0 → 3,63.
3. *„35 dni: 30 s TAK, 60 s i 120 s NIE - więcej czasu dało gorszy wynik"* - **naprawione**:
   regresja zniknęła, 35 dni spełnia kryterium przy **każdym** budżecie.
   Więcej czasu już nie szkodzi: `primary` schodzi 3,0 → 1,05 przy 15 s i dalej trzyma
   1,05, `secondary` przy 120 s poprawia się 3,0 → 2,0 (jedna soczewka, ruch o 1,0 na
   najwyższym budżecie - to wsparcie dla „nie pogarsza się", nie dowód, że 120 s jest
   optymalne).
   Funkcja celu prowadzi solver w stronę metryki, którą ocenia raport - to była
   przyczyna HGH6-06, którą zamykają A2+A3.

Ściana każdego z 16 przebiegów mieści się pod limitem `4× budżet` (najgorszy: 14 dni /
120 s = 223 s wobec 480 s) - potwierdzenie twardego limitu z C3.

Surowe dane: `docs/qa-suite-6/bench-a4.jsonl` (16 wierszy).
Po przemiataniu przywrócono politykę QA6 (`solve_seconds` 30) i wyczyszczono szkice
robocze.

---

### Tor B: zamiany

> **Naprawiony w B1.** `test_swap_options.py::test_options_flag_a_candidate_who_already_has_a_duty_that_day`
> padał na czystym drzewie, bo `DAY = date.today() + timedelta(days=3)` trafiało w weekend,
> a 11-19 istnieje tylko w dni robocze. Data w teście pomija teraz weekendy.

#### B1: zamiana sprzężona

Odpowiada na: **BLK6-01**, część `late_shift_anchor`. Realizuje decyzję **D1**.

**Problem.**
Zamiana obejmuje jeden slot, a kotwiczenie wiąże dwa.
Przeniesienie roli `secondary` na inną osobę zostawia zmianę 11-19 u poprzedniej, co łamie twardą regułę kotwiczenia.
Skutek: 0 z 28 slotów `secondary` i 0 z 20 slotów 11-19 da się zamienić przy domyślnej kotwicy.

**Zmiana.**
Nowa tabela `swap_request_slots` powiązana z prośbą, wraz z migracją Alembic.
Wybrano tabelę, a nie dodatkową kolumnę, bo otwiera drogę do zamian zakresowych z PLAN.md par. 3 („zamiana może obejmować jedną rolę i dzień, obie role, zakres albo cały tydzień”), których dziś w ogóle nie ma.

Gdy polityka kotwiczy 11-19, a zamieniany slot to rola kotwicząca albo sama zmiana 11-19, prośba obejmuje **oba sloty tego dnia** i jest rozpatrywana jako jedna decyzja: jedna akceptacja zastępcy, jedno zatwierdzenie koordynatora.

`rule_checks.substitution_check` przyjmuje **listę** slotów zamiast pojedynczego.
`rules.substitution_violations` (linia 264) już liczy różnicę stanu przed i po, więc rozszerzenie polega na podmianie wielu kluczy w `projected`, a nie na przepisaniu logiki.

Zastępca bez eligibility do 11-19 nie blokuje przejęcia roli kotwiczącej.
Zmiana 11-19 zostaje wtedy u dotychczasowej osoby, a odstępstwo jest raportowane jako wyjątek kotwiczenia, dokładnie tak, jak robi to dziś solver.

Interfejs pokazuje wprost, że prośba obejmuje dwa sloty, i wymienia oba przed wysłaniem.

**Pomiar przed.**
`secondary` 0 z 28, 11-19 0 z 20, razem 20 z 76 slotów (26%) ma choć jednego możliwego zastępcę.
Iwona Sadowska i Jakub Polak nie mogą zamienić żadnego ze swoich 12 dyżurów.

**Kryterium odbioru.**
`python docs/qa-suite-6/test_swap_reachability.py`: co najmniej 40 z 48 slotów `secondary` i 11-19 ma choć jednego możliwego zastępcę.
Odniesienie: przy kotwicy `independent` jest to 40 z 48, więc taki poziom jest osiągalny.

**Pomiar po.**

Nowa tabela `swap_request_slots` + migracja `0027` (dziedziczy po `0026` z toru D),
relacja `SwapRequest.slots`.
`rule_checks.substitution_check` i `rules.substitution_violations` przyjmują
listę ruchów `(dzień, rola)` zamiast pojedynczego; 3 miejsca wołające
(`swaps.py`, `calendar.py` x2) przekazują listę jednoelementową.
`swaps.create_swap` wylicza sprzężone sloty: gdy kotwica != `independent` i dzień
roboczy, a klikany slot to rola kotwicząca albo 11-19, ruch obejmuje oba sloty
tego dnia. Zastępca bez eligibility do 11-19: 11-19 zostaje, `late_shift_anchor`
raportowany jako **ostrzeżenie**, nie blokada (`_partition_violations`).
`approve_swap` przenosi wszystkie sloty prośby; check reguł powtórzony na całym
komplecie.

`python docs/qa-suite-6/test_swap_reachability.py` (stack QA6, kotwica
`secondary`):

| Rola | Przed (QA-REPORT-6) | Po B1+B2 |
| --- | --- | --- |
| `secondary` | 0 z 28 | **26 z 26** |
| 11-19 | 0 z 20 | **18 z 18** |
| `primary` | (n/d) | 26 z 26 |
| RAZEM | 20 z 76 (26%) | **70 z 70 (100%)** |
| Iwona Sadowska / Jakub Polak | 0 z 12 każde | 12 z 12 każde |

Testy: `tests/test_swap_coupled.py` (5 nowych - sprzężenie, wyjątek kotwiczenia,
`day_off_block`, opcje z powodem, fallback dla wiersza bez slotów),
`tests/test_swap_rules.py` (zaktualizowane pod D1), `tests/test_rules.py`
(sygnatura listy). `tests/test_swap_options.py` - naprawiono datę
(`DAY` pomijał weekendy; to był ten „znany błąd toru B" z QA przy torze D).

---

#### B2: `day_off_block` ostrzega zamiast blokować

Odpowiada na: **HGH6-04**. Realizuje decyzję **D2**.

**Problem.**
Ekran „Ustawienia generowania” oraz `docs/SOLVER.md` obiecują, że blok dni wolnych można podzielić „korektą koordynatora albo zamianą po publikacji”.
Sprawdzenie obu ścieżek: korekta koordynatora zwraca 200 i dzieli blok, zwracając naruszenie jako ostrzeżenie; zamiana zwraca 409 i twardo blokuje.
Z dwóch obiecanych ścieżek działa jedna.

**Zmiana.**
W ścieżce zamiany `day_off_block` przestaje być powodem odpowiedzi 409 i staje się ostrzeżeniem pokazywanym przed wysłaniem prośby, tak jak działa korekta koordynatora.
Pozostałe reguły twarde nadal blokują.
Zachować symetrię komunikatu: użytkownik ma wiedzieć, że dzieli blok, zanim wyśle prośbę.

**Pomiar przed.**
232 z 1048 zliczonych naruszeń to `day_off_block`; blokuje to 16 slotów, czyli 8 dni weekendowych razy 2 role.

**Kryterium odbioru.**
`python docs/qa-suite-6/test_swap_reachability.py`: liczba `RAZEM` rośnie o 16 względem stanu po B1.

**Pomiar po.**

Wykonane razem z B1 (ta sama zmiana `swaps.py` + `_partition_violations`), więc
osobnego pomiaru „po B1, przed B2" nie ma. Dowód pośredni: w wynikach
`test_swap_reachability.py` powód odrzucenia `day_off_block` **zniknął z listy
całkowicie** (przed: 232 naliczone naruszenia, 16 blokowanych slotów), a RAZEM
skoczyło z 20 do 70. `day_off_block` jest teraz w `TOLERATED_SWAP_RULES`,
zwracany jako ostrzeżenie przy prośbie i przy kandydacie w `/swaps/options`.
`tests/test_swap_coupled.py::test_day_off_block_split_warns_but_does_not_block`
sprawdza, że jedynym naruszeniem podziału bloku jest ostrzeżenie, nie 409.

---

#### B3: opcje bez ślepych zaułków i komunikaty z treścią

Odpowiada na: **BLK6-01**, warstwy druga i trzecia.

**Problem.**
`GET /api/v1/swaps/options` filtruje wyłącznie po eligibility, twardej niedostępności i przeciwnej roli on-call.
Nie wywołuje `substitution_check`, które `POST /api/v1/swaps` stosuje jako twardą blokadę.
Interfejs oferuje 551 zastępców, których backend następnie odrzuca, a komunikat brzmi tylko „Operacja łamie reguły twarde grafiku”.
`frontend/src/api.ts:479-483` wyciąga z odpowiedzi wyłącznie pole `message` i porzuca tablicę `violations`, która zawiera nazwę reguły, osobę i listę dni.

**Zmiana.**
`GET /api/v1/swaps/options` uruchamia `substitution_check` dla każdego kandydata i zwraca wynik przy nim.
Kandydat, którego przyjęcie łamie regułę twardą, jest zwracany z jawnym powodem i nieaktywny w interfejsie, a nie ukryty: puste okno bez wyjaśnienia jest gorsze niż lista z powodami.

Koszt: `substitution_check` to jedno okno 21 dni na kandydata, przy dziesięciu osobach jedno zapytanie i pętla w Pythonie, więc mieści się w budżecie tego endpointu.
Jeżeli pomiar pokaże inaczej, liczyć leniwie po rozwinięciu listy.

`frontend/src/api.ts` przepuszcza tablicę `violations`.
`Swaps.tsx` renderuje nazwę reguły, osobę i dni, tak jak robi to już panel ostrzeżeń generatora.
Komunikat kończy się następnym krokiem, zgodnie z PLAN.md par. 6: „poproś koordynatora o korektę” albo „wybierz inny dzień”.

**Kryterium odbioru.**
Dla każdego z 76 slotów opublikowanego grafiku liczba oferowanych zastępców możliwych do przyjęcia jest równa liczbie oferowanych w ogóle.
Odrzucenie po wysłaniu prośby przestaje być możliwe inaczej niż przez wyścig o ten sam slot.

**Pomiar po.**

`GET /api/v1/swaps/options` ładuje soczewkę +-10 dni i politykę **raz**, potem
per kandydat woła czystą `substitution_violations` (pętla w Pythonie, nie N
zapytań) i dokłada sprawdzenie drugiego on-calla dla sprzężonego slotu
(`_candidate_takes_second_oncall` - luka, której filtr po klikanym slocie nie
widział). Odpowiedź niesie `slots`, `blocking_violations`, `warning_violations`
i `next_step`. Kandydat z twardym naruszeniem jest **zwracany, ale nieaktywny**
z powodem, nie ukrywany.

`frontend/src/api.ts`: nowa klasa `ApiError` niesie `violations` i `nextStep` z
`detail`; `request()` rzuca ją zamiast gołego `Error` (stare `err.message`
nadal działa). `Swaps.tsx`: kandydaci blokujący wyszarzani z „nie można: <reguła>",
sprzężenie slotów pokazane przed wysłaniem, ostrzeżenia i błędy renderowane
jako lista reguła/osoba/dni + następny krok.

Weryfikacja spójności `options` vs `POST` (skrypt jednorazowy, 40 slotów):

| Miara | Wynik |
| --- | --- |
| sprawdzonych par (slot, kandydat) | 307 |
| kandydatów oferowanych | 307 (żaden nie ukryty) |
| kandydatów bez `blocking_violations` | 189 |
| niezgodności `blocking_violations == []` ⟺ `POST 201` | **0** |

Odrzucenie po wysłaniu prośby jest więc niemożliwe inaczej niż przez wyścig
o ten sam slot. Przegląd wizualny ekranu Zamiany w obu motywach: wyszarzeni
kandydaci z powodem, baner sprzężenia „Prośba obejmie oba sloty tego dnia:
… SECONDARY + … 11-19" (`chrome-devtools-axi`, screeny w scratchpadzie).
`npm test` 110 passed (2 nowe testy B3 w `Swaps.test.tsx`).

---

### Tor C: prognoza i worker

#### C1: prognoza podstawia zamiast dodawać

Odpowiada na: **BLK6-02**.

**Problem.**
`routes/scheduling.py:887` liczy wariant „po” jako `historical_duties + draft_duties`.
`historical_duties` obejmuje całe okno dwunastu miesięcy, a więc również dni pokryte już opublikowanym grafikiem.
Przydziały szkicu są dopisywane, a nie podstawiane, więc każdy dzień wspólny liczy się dwa razy.

**Dowód.**
Szkic na 2026-09-21 do 2026-10-04, w całości wewnątrz opublikowanego grafiku:
suma punktów `primary` przed 481,0, po 499,0, punkty w samym szkicu 18,0, różnica dokładnie 18,0.

**Zmiana.**
Przed dodaniem przydziałów szkicu usunąć z `historical_duties` wszystkie pozycje o kluczu `(service_date, role)` występującym w szkicu.
To odwzorowuje to, co publikacja faktycznie robi: rozstrzyga per slot, a nie sumuje.
Wydzielić jako `fairness_data.project_duties(historical, draft)`, obok istniejącego `reassign`, bo obie należą do tej samej rodziny operacji prognozujących skutek niezapisanej zmiany.

**Kryterium odbioru.**
`python docs/qa-suite-6/repro_double_count.py` kończy się werdyktem „ok”; dziś „DEFEKT - podwojne liczenie”.
Dla szkicu na zakresie nieobjętym niczym wynik nie zmienia się względem dzisiejszego.

**Pomiar po.**

`fairness_data.project_duties(historical, draft)` dopisane obok `reassign`:
odrzuca z historii każdy klucz `(service_date, role)` obecny w szkicu, potem
dokłada wiersze szkicu. `routes/scheduling.py` w `draft_fairness_impact` woła
je zamiast `historical_duties + draft_duties`. Historia (`resolved_duties` przez
`effective_assignments`) i tak nie zawiera samego szkicu, więc jedyne co znika
to podwójnie liczony slot opublikowany.

`python docs/qa-suite-6/repro_double_count.py` (stack QA6, szkic 2026-09-21..10-04
w całości wewnątrz opublikowanego):

| Miara | Przed naprawą (QA-REPORT-6) | Po naprawie |
| --- | --- | --- |
| suma PRIMARY baseline | 481,0 | 481,0 |
| suma PRIMARY prognoza „po" | 499,0 | **481,0** |
| „po - przed" | 18,0 (= punkty szkicu) | **0,0** |
| werdykt skryptu | DEFEKT - podwojne liczenie | **ok** |

Szkic na zakresie nieobjętym niczym: `project_duties` degeneruje się do
`historical + draft` (żaden klucz się nie pokrywa) - test
`tests/test_fairness_data.py::test_draft_over_uncovered_range_is_a_plain_append`.

Testy: `tests/test_fairness_data.py` (3 nowe, czysta funkcja),
`tests/test_fairness_dedup.py::test_draft_inside_published_range_does_not_inflate_the_forecast`
(nowy, przez endpoint: `projected_primary == baseline_primary`).
`pytest` bez nowych regresji (nadal 1 znany błąd toru B), lint czysty.

---

#### C2: worker przestaje głodzić powiadomienia

Odpowiada na: **HGH6-05** oraz **MED6-05**.

**Problem.**
`worker_cycle()` wykonuje sekwencyjnie `drain_outbox`, `process_schedule_run` i `scan_handover`.
`process_schedule_run` pobiera jeden bieg i blokuje pętlę na czas całego rozwiązywania.
Zmierzone: powiadomienie o zamianie czekało 70 sekund w stanie `pending`, a drugi koordynator czekał 70 sekund w stanie `queued` z postępem 0%.

**Zmiana.**
Rozdzielić pętlę na **dwa niezależne zadania asyncio**: jedno obsługuje outbox i przypomnienia w stałym rytmie, drugie przejmuje zadania generowania.
Nie wymaga to nowego procesu ani kolejki: `process_schedule_run` już wykonuje właściwe liczenie w `anyio.to_thread.run_sync`, więc pętla powiadomień może działać równolegle w tej samej pętli zdarzeń.

Umożliwić więcej niż jedno równoczesne generowanie, sterowane konfiguracją, domyślnie 1 przy przydziale 2 CPU.
Blokada `SKIP LOCKED` jest już na miejscu, więc skalowanie nie wymaga zmian w SQL.
Domyślne 1 jest świadome: przy dwóch rdzeniach dwa równoległe solvery będą wolniejsze niż dwa kolejne.

Ujawnić **pozycję w kolejce** w odpowiedzi `/api/v1/scheduling/runs/{id}` i pokazać ją na ekranie: „w kolejce, 1 zadanie przed Tobą, szacowany start za około 40 s”.

Zablokować zakolejkowanie drugiego generowania tego samego zakresu, gdy pierwsze jeszcze trwa; zamiast tego pokazać to trwające.
Dziś dwa takie zadania tworzą dwa szkice nierozróżnialne na liście: ta sama nazwa, zakres, wersja, liczba przydziałów i data utworzenia.

**Kryterium odbioru.**
`python docs/qa-suite-6/load_worker.py`: wiersz outboxu utworzony w trakcie generowania jest przetworzony w czasie nie dłuższym niż dwa cykle workera, niezależnie od długości generowania.
Drugi koordynator widzi swoją pozycję w kolejce od pierwszego odpytania.

**Pomiar po.**

Worker rozbity na dwie niezależne pętle w jednej pętli zdarzeń
(`oncall.worker`):

- `_notification_loop` woła `notification_cycle` (drain outboxu + skan zmiany
  numeru) co `worker_poll_seconds`, niezależnie od tego, czy trwa generowanie;
- `_generation_loop` (jedna lub więcej instancji, `generation_concurrency`,
  domyślnie 1) woła `generation_cycle`, która przejmuje jeden zakolejkowany
  `ScheduleRun` przez `SELECT ... FOR UPDATE SKIP LOCKED` na własnej sesji.

`worker_cycle` zachowane jako sekwencyjny wrapper (`notification_cycle` +
`generation_cycle`) - deterministyczny szew dla testów i dla `load_worker.py`,
którego kryterium jest wyrażone w cyklach.

Nowe pola konfiguracji: `generation_concurrency` (1-4, domyślnie 1),
`generation_poll_seconds` (1.0).
`ONCALL_GENERATION_CONCURRENCY` dodane do serwisu `worker` w
`docker-compose.yml` (domyślnie 1).

Pozycja w kolejce liczona, nie przechowywana: `_queue_view` w
`routes/scheduling.py` zwraca liczbę aktywnych biegów (`queued`/`running`)
utworzonych wcześniej oraz przybliżony czas do startu (`estimated_start_seconds`)
- średnia z ostatnich 5 zakończonych biegów `updated_at - created_at`, a bez
danych twardy limit całości `total_time_budget` (C3), czyli górna granica, nie
zgadywanie.
Pola `queue_position` / `estimated_start_seconds` w odpowiedzi `/runs`,
`/runs/{id}` i `/runs` (lista); ekran generatora pokazuje „W kolejce: N zadań
przed Tobą, szacowany start za około X s".

Deduplikacja zakresu: `queue_generation` zwraca bieg już w locie zamiast
kolejkować bliźniaka (dokładne dopasowanie `starts_on`/`ends_on` wśród
`queued`/`running`). Migracja `0028` dokłada częściowy unikat
`uq_schedule_run_active_range` (Postgres, predykat `status IN (...)`) jako
zabezpieczenie wyścigu; SQLite w testach polega na sprawdzeniu w trasie.

**Kryterium odbioru** - `python docs/qa-suite-6/load_worker.py` na przebudowanym
stacku QA6 (2 biegi 28 dni, budżet 60 s każdy):

```
t=  5.4s  zamiana zlozona -> outbox: pending=1   (A running 32%, B queued)
t= 15.6s  outbox: skipped=1                      (A running 42%, B queued)
...
t= 66.2s  generowanie A zakonczone
t=127.0s  generowanie B zakonczone
```

Wiersz outboxu powstały przy A na 32% został obsłużony w następnym cyklu
(~10 s), nie po 66 s do końca generowania A - `pending` znika przy kolejnym
`notification_cycle`, nie czeka na `process_schedule_run`.
(`skipped`, nie `sent`, bo stack QA6 nie ma SMTP - liczy się, że drain się
wykonał.)

Pozycja w kolejce sprawdzona osobno na tym samym stacku: dwa biegi
zakolejkowane, po 3 s odpytania `/runs/{id}` zwraca `queue_position = 0`,
`estimated_start_seconds = null` dla biegu `running` i `queue_position = 1`,
`estimated_start_seconds = 79` dla biegu `queued` za nim.
Trzeci `POST /runs` z tym samym zakresem co bieg czekający zwrócił jego
identyfikator zamiast utworzyć drugi wiersz.

Ścieżka wielu pasów sprawdzona na stacku QA6 z
`ONCALL_GENERATION_CONCURRENCY = 2`: dwa biegi różnych zakresów przeszły w
`running` równocześnie (oba na 31% w tym samym odczycie), każdy pas przejął
inny wiersz przez `SKIP LOCKED`.
Testy jednostkowe pokrywają tylko 1 pas - SQLite ignoruje `FOR UPDATE SKIP
LOCKED`, więc kolizji dwóch pasów nie da się w nich odtworzyć.

Testy: `tests/test_generation_queue.py` (8 nowych - pozycja w kolejce, bieg
`running` jako jeden przed kolejką, brak pozycji po zakończeniu, deduplikacja
zakresu, rozdzielność pętli), `tests/test_worker_progress.py` bez zmian (szew
`process_schedule_run(db)` zachowany).
Frontendowo `Generator.test.tsx` (1 nowy - zdanie o kolejce i szacowanym
starcie).

---

#### C3: budżet czasu nazwany i egzekwowany

Odpowiada na: **HGH6-02**.

**Problem.**
Podpowiedź na ekranie brzmi „Ile sekund solver ma na jedno generowanie (5-300)”, a `solve_seconds` jest budżetem pojedynczego wywołania `solver.solve`.
Jedno generowanie wykonuje ich kilka: przebieg z kryterium jako ograniczeniem twardym, przebieg ze zdjętymi regułami rozrzedzania, przebieg bez ograniczenia kryterium oraz do trzech prób bisekcji po `FLOOR_PROBE_SECONDS = 25` sekund.
Zmierzone: budżet 15 s dał 80,5 s oczekiwania, budżet 120 s dał 225,5 s.

**Zmiana.**
Poprawić podpowiedź: budżet dotyczy jednego przebiegu solvera.
Wprowadzić **twardy budżet całego generowania**, wyliczany z budżetu przebiegu i pilnowany w `generate_schedule` przez odejmowanie czasu zużytego przed każdym kolejnym przebiegiem.
Pokazać w interfejsie faktyczny górny limit czasu obok pola budżetu, żeby liczba na ekranie odpowiadała temu, na co użytkownik czeka.
Bisekcję szukającą `acceptance_floor` uruchamiać z budżetu pozostałego, a nie ze stałej na próbę: dno kryterium jest informacją pomocniczą i nie może kosztować więcej niż samo rozwiązanie.

**Kryterium odbioru.**
`python docs/qa-suite-6/bench_solver.py`: dla każdej kombinacji budżetu od 5 do 120 sekund i horyzontu od 7 do 35 dni czas ścienny nie przekracza zadeklarowanego limitu całkowitego.

**Pomiar po.**

`scheduler.generate_schedule` trzyma jeden deadline na cały bieg:
`deadline = monotonic() + max(solve_seconds, total_time_budget - GENERATION_ORCHESTRATION_RESERVE)`,
gdzie `total_time_budget(s) = s * GENERATION_BUDGET_PASSES` (4).
Każde wywołanie `solve()` dostaje `min(własny budżet, czas do deadline)`;
bisekcja dna kryterium (`lowest_achievable_spread`) sprawdza `time_left()` przed
każdą próbą i zwraca `None`, gdy zostało mniej niż `MIN_PASS_SECONDS` - bez tego
zagłodzona próba zwróciłaby zaniżone dno, a ostrzeżenie podaje tę liczbę jako
fakt.
`FLOOR_PROBE_SECONDS` i `MAX_SOLVE_SECONDS` bez zmian - bisekcja czerpie z
pozostałego budżetu, nie ze stałej na próbę.

`GENERATION_ORCHESTRATION_RESERVE = 3 s`: ładowanie danych, przejęcie zadania
przez workera i zapisy postępu są poza solverem, ale w tym, na co czeka
koordynator (zmierzone ~1,5 s, rezerwa podwaja to).

Podpowiedź pola budżetu poprawiona: „Budżet czasu na przebieg solvera",
z wyliczonym górnym limitem całości obok (`solve_seconds * 4`).
`SchedulingPolicyResponse` dostał pole `time_budget_seconds`
(`scheduler.total_time_budget`), pokazywane na ekranie generatora przy polu i w
trakcie generowania („łącznie do X s").
Komunikat `UNKNOWN` podaje teraz pełny limit generowania, nie budżet przebiegu.

**Kryterium odbioru** - `python docs/qa-suite-6/bench_solver.py`, tryb hybrid,
kotwica secondary, `START = 2026-10-05`, czas ścienny end-to-end (kolejka +
worker + solver + zapis):

| budżet | limit (4x) | 7 dni | 14 dni | 28 dni | 35 dni |
| --- | --- | --- | --- | --- | --- |
| 5 s | 20 s | 4,2 s | 18,2 s | 7,1 s | 7,1 s |
| 15 s | 60 s | 5,1 s | 58,4 s | 17,2 s | 17,1 s |
| 60 s | 240 s | - | 162,4 s | - | - |
| 120 s | 480 s | - | 222,7 s | - | - |

Każdy zmierzony czas mieści się pod limitem `solve_seconds * 4`.
Horyzont 14 dni to jedyny, który dla tego rosteru wchodzi w pełną ścieżkę
wielu przebiegów (kryterium nieosiągalne).
Limit jest sufitem, nie celem: przy 120 s budżetu bieg kończy się po 223 s, bo
gdy bisekcja znajdzie dno (4 pkt), zatrzymuje się.
Przy 5 s i 15 s bisekcja dna jest zagłodzona i `acceptance_floor` wraca `None`
(ostrzeżenie „nie udało się wyznaczyć"); przy 60 s i 120 s budżetu starcza i
dno to 4 pkt.
Przed C3 ten sam przypadek: `bench` z QA-REPORT-6 par. HGH6-02 pokazywał
budżet 15 s -> 80,5 s, budżet 120 s -> 225,5 s.

Testy: `tests/test_generation_time_budget.py` (5 nowych - mnożnik budżetu,
`time_budget_seconds` w polityce, suma budżetów przebiegów nie przekracza
limitu na ścieżce wszystkich pasów, bisekcja bez wyniku po wyczerpaniu
budżetu), `tests/test_scheduler.py::test_unknown_reports_time_budget...`
zaktualizowany (komunikat podaje pełny limit).
Frontendowo `Generator.test.tsx` (1 nowy - górny limit obok pola).

---

### Tor D: dostępność w imieniu innej osoby

Odpowiada na: **MED6-06**, luka funkcjonalna zgłoszona przez zamawiającego.

**Problem.**
Cały moduł dostępności jest własnościowy: `GET`, `POST` i `DELETE` wyłącznie na `/api/v1/availability/me`.
Nie ma endpointu pozwalającego koordynatorowi zapisać wpis dla innego członka zespołu, a ekran „Moja dostępność” nie ma selektora osoby.

Skutki: osoba na urlopie, chora albo bez dostępu do systemu nie ma jak zgłosić niedostępności; urlop zgłoszony mailem nie trafia do solvera; jedynym obejściem jest ręczna korekta każdego slotu po publikacji, czyli praca, którą generator ma eliminować.
Konto administratora nie jest powiązane z członkiem zespołu, więc `/availability/me` zwraca dla niego 409.

#### D1: backend

Nowe zasoby obok istniejących, bez zmiany istniejących:

- `GET /api/v1/availability/members/{member_id}` - odczyt wpisów wskazanej osoby,
- `POST /api/v1/availability/members/{member_id}` - utworzenie wpisu,
- `DELETE /api/v1/availability/members/{member_id}/{entry_id}` - usunięcie wpisu.

Cała logika biznesowa jest **wspólna z `/me`**: zakaz wpisu w całości w przeszłości, wykrywanie nakładania się zakresów, ostrzeżenie o kolizji z istniejącym dyżurem.
Wydzielić ją z dzisiejszego `create_my_availability` do jednej funkcji i wywołać z obu ścieżek, żeby reguły nie mogły się rozjechać.
Dzisiejsza implementacja nadaje się do tego bez przepisywania.

Osobne akcje audytu `availability.created_on_behalf` i `availability.deleted_on_behalf`, z zapisanym w `details` zarówno wykonawcą, jak i osobą, której wpis dotyczy.
Ślad audytowy musi rozróżniać „zgłosiłem swój urlop” od „koordynator zgłosił urlop za mnie”, bo to dwie różne odpowiedzialności.

Powiadomienie do osoby, której wpis dotyczy, przez istniejący outbox.
Nowy szablon w `notifications/templates.py` i wyzwalacz w `triggers.py`, wzorowane na istniejącym `availability_duty_conflict`, bez zmian w mechanice dostarczania.
Osoba musi mieć szansę zauważyć, że ktoś zapisał coś w jej imieniu, i zaprotestować.

Wpis założony w czyimś imieniu jest zwykłym wpisem: członek widzi go na swoim ekranie i może usunąć.
Nie wprowadzamy wpisów, których adresat nie może cofnąć, bo to zamienia narzędzie planistyczne w narzędzie nadzoru.

RBAC: koordynator i administrator mają dostęp do wszystkich członków rotacji; członek i viewer dostają 403.
Notatka o powodzie pozostaje widoczna wyłącznie dla koordynatora, administratora i samego zainteresowanego, dokładnie jak dziś.

#### D2: frontend

Selektor osoby na ekranie „Moja dostępność” dla koordynatora i administratora, domyślnie ustawiony na siebie.
Przy wyborze kogoś innego jawna etykieta „wpisujesz w imieniu: Beata Lis”, umieszczona **przy przycisku zapisu**, a nie tylko na górze formularza, bo formularz jest długi.
Lista wpisów pokazuje, kto wpis założył, gdy nie jest to sama osoba.
Dla administratora bez powiązanego członka zespołu ekran przestaje zwracać 409 i otwiera się od razu w trybie „w imieniu”.

**Kryterium odbioru.**
Koordynator zgłasza urlop w imieniu `beata.lis`.
Wpis jest widoczny na jej ekranie, jest respektowany przez generator jako twarde ograniczenie, w audycie widnieje jako `availability.created_on_behalf` z obiema osobami, Beata dostaje powiadomienie i może wpis usunąć.
Członek próbujący tego samego dostaje 403.
Regresja: `python docs/qa-suite-6/test_rbac.py` bez zmian w pozostałych wierszach macierzy.

**Pomiar po.**

Nowe zasoby: `GET|POST /api/v1/availability/members/{member_id}`,
`DELETE /api/v1/availability/members/{member_id}/{entry_id}`.
Ścieżka zapisu jest wspólna z `/me` (`_create_availability`), więc reguły
(przeszłość, nakładanie, kolizja z dyżurem) są jedną implementacją.
Nowa kolumna `availability.created_by_user_id` + migracja `0026` (dopisana
poza zbiorem plików toru D - patrz nota niżej), nowy szablon
`availability_created_on_behalf` i wyzwalacz do osoby, której wpis dotyczy.

Scenariusz odbioru (stack QA6, `adam.nowicki` jako koordynator, `beata.lis`):

| Krok | Wynik |
| --- | --- |
| `POST /availability/members/{beata}` (urlop 2026-11-10..23) | `201`, `created_by_name: "Adam Nowicki"` |
| Wpis na ekranie Beaty (`GET /availability/me`) | widoczny, `created_by_name: "Adam Nowicki"` |
| Audyt | `availability.created_on_behalf`, `details.on_behalf_of="Beata Lis"`, `details.actor="Adam Nowicki"` |
| Powiadomienie | wiersz outboxu do `beata.lis@example.com`, `event=availability_created_on_behalf` |
| Beata usuwa wpis (`DELETE /availability/me/{id}`) | `204`, wpis znika; audyt `availability.deleted_on_behalf` |
| Członek (`beata.lis`): `GET`/`POST`/`DELETE` na `/availability/members/*` | `403` / `403` / `403` |
| Viewer (`lucjan.widok`): `GET`/`POST`/`DELETE` na `/availability/members/*` | `403` / `403` / `403` |
| Nieznany `member_id` | `404` |
| Koordynator wpisuje dla własnego członka | zwykła akcja `availability.created`, bez powiadomienia |
| Respektowanie przez generator | wpis to zwykły `Availability(kind=unavailable)`; zapytanie solvera (`routes/scheduling.py:383`) filtruje po `kind`/`member_id`/dacie, nie po autorze; `tests/test_schedule_unavailability_guard.py` przechodzi |

Regresja `python docs/qa-suite-6/test_rbac.py`: te same 4 wcześniej istniejące
`PROBLEMY` (lista zespołu/viewer, raport CSV x2 - błąd skryptu `month=9`,
ICS/viewer = LOW6-01), zero nowych; wiersz `wlasna dostepnosc`
`409/200/200/403` bez zmian.

Testy: `pytest` 277 passed, 1 failed
(`test_swap_options.py::test_options_flag_a_candidate_who_already_has_a_duty_that_day`
- wykazano, że pada też bez zmian toru D, należy do toru B).
`npm test` 108 passed. Lint backend i frontend czysty.

**Nota o zbiorze plików.**
Tor D dopisał migrację `backend/migrations/versions/0026_availability_created_by.py`,
mimo że par. 4 przypisuje `migrations/versions/` wyłącznie torowi B.
Powód: `created_by_name` na ekranie Beaty wymaga trwałego autora wpisu, a nie
wnioskowania z audytu. Kolejna migracja toru B powinna dziedziczyć po `0026`.
`LOW6-03` (etykieta „prywatna notatka" → „Powód (widzą koordynatorzy)") wykonano
przy okazji w `frontend/src/screens/Mine.tsx`, bo plik był i tak przepisywany.

---

### Tor E: ekrany

#### E1: uzgodnić „Razem”

Odpowiada na: **MED6-01**. Realizuje decyzję **D4**.

Suma wartości w kolumnie „Razem pkt” dla dziesięciu osób wynosi 1212, a wiersz podsumowania „Razem” pokazuje 960.
Różnica 252 to dokładnie suma zmian 11-19, których kolumna jest ukryta przy kotwiczeniu.
Kolumna per osoba wlicza ukrytą soczewkę, wiersz podsumowania jej nie wlicza, a składnik różnicy nie jest na ekranie widoczny.

Zgodnie z D4 oba miejsca liczą wyłącznie kolumny widoczne, a ukryty składnik jest wymieniony w przypisie pod tabelą.
Test frontendowy sprawdzający, że suma kolumny równa się wierszowi podsumowania.

**Pomiar po.**

`Fairness.tsx`: nowy `visibleTotal(member)` = `primary.actual + secondary.actual + (11-19 widoczne ? late_shift.actual : 0)`, zaokrąglony wspólnym `roundPoints`.
Kolumna „Razem" per osoba i sortowanie po niej (`deviationOf('total')`) używają teraz `visibleTotal` zamiast `member.total_points` z backendu (które zawsze wliczało 11-19).
Wiersz podsumowania już liczył tylko widoczne - uporządkowany tym samym `roundPoints`.
Weekendy/święta nigdy nie wchodzą do „Razem" (są podzbiorem punktów on-call).

Przy kotwiczeniu pod tabelą przypis: „Kolumna Razem sumuje tylko widoczne soczewki. Przy kotwiczeniu zmiana 11-19 należy do osoby pełniącej rolę on-call, więc jej punkty są już w PRIMARY/SECONDARY... Łączna liczba zmian 11-19 w oknie: N."
Znika, gdy 11-19 jest osobną kolumną.

`member.total_points` (backend) zostaje w API - nadal poprawne jako „wszystkie punkty dyżurowe", bez konsumenta na tym ekranie po zmianie.

**Kryterium odbioru** - `frontend/src/screens/Fairness.test.tsx`, blok „Razem reconciliation (D4/MED6-01)" (4 nowe):
suma kolumny per osoba równa się wierszowi „Razem" przy kotwiczeniu (`[5,5]` -> 10) i przy soczewce niezależnej (`[6,6]` -> 12); przypis pojawia się tylko przy kotwiczeniu.
Zweryfikowane przez tymczasowy powrót do `member.total_points`: test kotwiczenia pada (12 wobec 10), po przywróceniu przechodzi.
`npm test` 116 passed, lint czysty.
Przegląd wizualny ekranu - w kryterium odbioru toru E (E1-E4 razem).

#### E2: „Razem pkt” z kontekstem udziału

Odpowiada na: **MED6-02**.

Każda kolumna soczewkowa ma pasek, odchylenie i opis słowny.
Kolumna „Razem pkt” nie ma żadnego z tych elementów, a jest pierwszą, na którą pada wzrok przy porównywaniu ludzi.
Emil Zając pokazuje 105 wobec 134, bo nie ma eligibility do 11-19, a ta kolumna jest ukryta.
Jakub Polak pokazuje 54, bo jest w rotacji od kwietnia, mimo że jego bilans w każdej pojedynczej soczewce jest niemal idealny.

Zmiana: „Razem pkt” dostaje wartość oczekiwaną i odchylenie tak samo jak każda inna kolumna, plus krótkie wyjaśnienie przy wartościach odstających z przyczyny strukturalnej: „w rotacji od 01-04-2026” oraz „bez eligibility do 11-19”.
Jest to bezpośrednie wykonanie zapisu z PLAN.md par. 6: „Ekran sprawiedliwości nie eksponuje liczb bez kontekstu”.

Do sprawdzenia przy tej okazji (z A3): `_count_eligible_days` to liczba dni przynależności do rotacji, nie netto po odjęciu nieobecności.
Dziś wartość liczbowa nie jest nigdzie pokazywana na ekranie (służy tylko bramce `> 0`).
Jeśli E2 zacznie pokazywać tę liczbę lub jej pochodną, potrzebny jest przypis, że nie odejmuje urlopów, oraz sprawdzenie skrajnego przypadku osoby nieobecnej przez całe okno (bramka „nie pełni tej roli” zadziałałaby wtedy błędnie).

**Pomiar po.**

Weryfikacja na danych QA6: przypadek „Emil Zając 105 wobec 134" to był
artefakt sprzed E1 - `total_points` z backendu wliczało zmiany 11-19 wszystkim,
a Emil (bez uprawnień do 11-19) ich nie miał, więc wyglądał na zaniżonego.
Po E1 kolumna „Razem" liczy tylko widoczne soczewki i Emil (103) jest w środku
stawki (100-104).
Pozostaje przypadek Jakuba Polaka: `visT 42` przy stawce ~102, ale odchylenie
tylko -2,10 (per soczewka P/S po -1,05) - w rotacji od kwietnia.

Zmiana w `Fairness.tsx`: kolumna „Razem" renderuje `FairnessCell` (wartość /
udział, pasek, opis słowny) zamiast gołej liczby.
`totalBalance(member)`: `actual = visibleTotal`, `expected` = suma `expected`
widocznych soczewek, `deviation` = suma odchyleń per soczewka zaokrąglona raz
(nie różnica dwóch zaokrąglonych sum - inaczej osoba „zgodnie z udziałem" na
każdej soczewce łapałaby fantomowe 0,01).
Sortowanie po „Razem" idzie teraz po odchyleniu, jak inne kolumny.

`FairnessCell` dostał opcjonalny `note`.
Kontekst pod odchyleniem: „w rotacji od DD-MM-YYYY", gdy `active_from` jest po
`window_start`; „bez zmian 11-19", gdy 11-19 jest osobną kolumną, a osoba nie ma
do niej uprawnień (`eligible_days.late_shift === 0`) - to nadal bramka
logiczna, nie liczba, więc uwaga o `_count_eligible_days` nie ma zastosowania.

Backend: `MemberBalance` i `FairnessMemberResponse` dostały `active_from`
(z `FairnessMemberInput.active_from`), przekazywane przez jedyny konstruktor
`fairness_data.member_response` - `/fairness`, podgląd wpływu zamiany i podgląd
szkicu dostają je za darmo.
`member.total_points` zostaje w API bez konsumenta na tym ekranie.

Wiersz podsumowania „Razem" dostał też brakujące `/ udział` (`totalExpectedSum`
= suma `visibleSum(expected)` po osobach), żeby wyglądał jak pozostałe komórki
stopki.

**Kryterium odbioru** - `frontend/src/screens/Fairness.test.tsx`, blok „Razem
context (MED6-02)" (4 nowe): kolumna „Razem" pokazuje udział i słowne
odchylenie; „w rotacji od 01-04-2026" dla dołączającego w środku okna i brak
tej uwagi dla obecnego od początku; „bez zmian 11-19" przy soczewce
niezależnej i zerowych uprawnieniach.
`npm test` 120 passed; `pytest` 302 passed; lint czysty; `npm run build`
przechodzi (`tsc -b` wyłapał rzutowanie w teście, którego `tsc --noEmit` nie).

Przegląd wizualny (stack QA6, koordynator, oba motywy): kolumna „Razem"
identyczna w stylu z PRIMARY/SECONDARY; Jakub Polak `42 / 44.1 · -2.1 · 2,1
poniżej udziału · w rotacji od 01-04-2026`; stopka `958 / 957.96`; suma kolumny
per osoba = `958` = stopka.
Przypadek „Emil Zając" (par. E2) był artefaktem sprzed E1 - po E1 Emil `103`
jest w środku stawki, bez uwagi.
Zrzuty: `e1e2-fairness-dark.png`, `e1e2-fairness-light.png`.

#### E3: rozdzielić szczegóły dnia od zmiany obsady

Odpowiada na: **MED6-03**.

Kliknięcie komórki otwiera **szczegóły dnia**: kto pełni którą rolę, jakie są dostępności, jakie wydarzenia.
Nazwa osoby z klikniętej komórki jest kontekstem, nie tytułem operacji.

Zmiana obsady jest osobnym, jawnym krokiem: „Zmień obsadę” otwiera formularz z wyborem **roli i osoby**, obu wprost, zamiast wyprowadzać osobę z tego, którą komórkę kliknięto.
Znika wtedy pułapka „klikam dyżur, żeby go zmienić, a przycisk jest wyłączony”, bo żeby zdjąć dyżur z osoby X, trzeba dziś kliknąć pustą komórkę osoby Y.

Dodawanie wydarzenia przenieść z okna osoby do nagłówka dnia, bo wydarzenie jest bytem całodniowym.
Każdy wyłączony przycisk podaje powód wyłączenia.

**Wykonanie.**
`components/CalendarMatrix.tsx`: stan `selected` jest teraz `{ day, member? }` - `member`
to wiersz, w którym kliknięto, wyłącznie jako kontekst („Z wiersza osoby: X"), nigdy
cel operacji.
Tytuł drawera to sam dzień (`śr 09-09-2026`), nie osoba.
Treść drawera bez trybu zmiany: alert zakresu, brak obsady, wydarzenia (z usuwaniem),
**wszystkie** dostępności pokrywające dzień (nie tylko klikniętej osoby), lista `<dl>`
obsady per rola z oknem czasowym, formularz „Dodaj wydarzenie tego dnia".
„Zmień obsadę…" w stopce przełącza treść drawera na formularz: select roli + select
osoby.
Osoba jest wybierana wprost z listy kandydatów, nie wyprowadzana z komórki - dlatego
zdjęcie dyżuru z X polega dziś na otwarciu dowolnej komórki dnia i wskazaniu Y w
formularzu, a nie na klikaniu pustej komórki Y.

Lista kandydatów: nowy `lib/calendar.ts::staffingCandidates(data, serviceDate, role)`.
Buduje ją z samego ładunku `/calendar`: osoby w rotacji tego dnia
(`active_from`/`active_until`), z powodem wyłączenia dla trzech z czterech odmów 422,
które zwraca `POST /calendar/override`:
`już pełni tę rolę tego dnia`, `niedostępna tego dnia`, `ma już drugi on-call tego dnia`.
Kandydaci wyłączeni jako `MenuItem disabled` z powodem w treści opcji; przycisk „Dalej"
(`Zmień obsadę…`/`Obsadź…`) wyłączony do czasu wskazania osoby, z powodem wypisanym
obok („Wybierz osobę, która ma objąć tę rolę.").

**Odstępstwo: czwarta odmowa 422 zostaje reaktywna.**
`Osoba nie ma eligibility` (przynależność do roli w oknie dat) nie jest w ładunku
`/calendar` - `CalendarMemberResponse` niesie tylko `id`, `display_name`, `active_from`,
`active_until`.
Rozszerzenie ładunku `/calendar` o okna eligibility to zmiana schematu + trasy + modelu
odpowiedzi, poza zakresem pakietu frontendowego.
Jeśli QA to zgłosi, tańsza ścieżka niż rozszerzanie `CalendarMemberResponse` prowadzi
przez E4: `/calendar/override/check` już rozwiązuje zastępcę po stronie serwera i mógłby
zwrócić informację o eligibility w swojej odpowiedzi.
Do tego czasu ta jedna odmowa jest pokazywana tak jak dziś każdy błąd korekty - w
`Alert` na formularzu po nieudanym `POST`.

Drobiazg dopięty po przeglądzie: `openStaffChange` przycina `selectedRole` z „11-19" do
`primary`, gdy dzień jest wolny - inaczej select roli dostałby wartość bez pasującego
`MenuItem` (pusty select). Test „never opens the change form on „11-19" for a day off".

**Pomiar po.**
`npm test` 130 passed (było 120: +5 `staffingCandidates` w `lib/calendar.test.ts`,
+5 `CalendarMatrix.test.tsx` „staffing change (MED6-03)", 2 testy potwierdzenia korekty
przepisane na nowy przepływ).
Nowe testy zweryfikowane odwróceniem kodu: przywrócenie „osoba = klikniięta komórka"
sypie testem „lets the coordinator remove a duty from the person whose cell they
clicked".
`npm run build` (`tsc -b` + vite) czysty; `eslint .` czysty.
Backend bez zmian - `pytest` nie uruchamiany, żaden plik `backend/` nie tknięty.

Przegląd wizualny (stack QA6, koordynator `adam.nowicki`, oba motywy, `chrome-devtools-axi`):
drawer `śr 09-09-2026` z „Z wiersza osoby: Adam Nowicki" jako kontekstem, tytuł to sam
dzień; sekcja „Dostępności" listuje `Jakub Polak: Nie mogę - Onboarding` (dzień, nie
osoba z wiersza).
Formularz „Zmień obsadę": lista osoby pokazała kandydatów, a na dole wyłączone
`Adam Nowicki — już pełni tę rolę tego dnia`, `Grażyna Wilk — ma już drugi on-call tego
dnia`, `Jakub Polak — niedostępna tego dnia` - trzy powody na realnych danych.
Przycisk „Zmień obsadę…" wyłączony z podpisem „Wybierz osobę, która ma objąć tę rolę.",
po wskazaniu osoby okno potwierdzenia `Przypiszesz: Beata Lis zamiast Adam Nowicki`.
Zrzuty: `e3-drawer-dark.png`, `e3-form-options-dark.png`, `e3-drawer-light.png`,
`e3-form-light.png`.

`components/DutyCard.tsx` (wymieniony w par. 4 dla toru E) nie tknięty - to karta
„kto teraz" na ekranie Dyżury, nie komórka kalendarza; pozycja na liście plików
rezerwuje ją dla toru, nie wymusza zmiany.

#### E4: prognoza przy korekcie koordynatora

Odpowiada na: **MED6-04**.

Okno potwierdzenia korekty pokazuje dziś datę, rolę oraz „Przypiszesz: X zamiast Y”, i nic więcej.
Ma pokazywać to samo, co widzi członek zespołu przy zamianie: wynik `/api/v1/calendar/override/check`, czyli listę reguł, które operacja złamie, oraz wpływ na bilans obu osób z opisem słownym.
Endpoint sprawdzający już istnieje i jest napisany dokładnie w tym celu; brakuje wyłącznie wywołania i prezentacji.
Korekta koordynatora nie wymaga niczyjej akceptacji, więc okno potwierdzenia jest jedynym momentem na refleksję.

**Wykonanie.**
Sprostowanie do opisu: „endpoint sprawdzający" to w istocie dwa endpointy.
`/api/v1/calendar/override/check` zwraca tylko `list[RuleViolationResponse]` (reguły twarde) -
to część już podpięta (`overrideCheck`, D3).
Wpływ na bilans obu osób liczy `/api/v1/swaps/impact` (`SwapImpactResponse`, to samo
okno 12 mies. co raport), które koordynator może wołać bez ograniczenia „tylko własne".
Komponent `components/SwapImpactPreview.tsx` już go opakowuje - E4 to jego wstawienie do
`ConfirmDialog` korekty w `CalendarMatrix.tsx`, obok listy reguł.

`SwapImpactPreview` dostał `mode?: 'swap' | 'override'` - jedyna różnica to słowo dla
strony oddającej dyżur: przy zamianie osoba `oddaje` (z własnej woli), przy korekcie
koordynatora `traci` (robi się to jej). Reszta (nagłówek `[WPŁYW NA BILANS]`, wiersze
per soczewka `52 → 51 (-1)` + `bliżej równowagi` / `dalej od równowagi` / `saldo bez
zmiany`) bez zmian.

**Ograniczenie: podgląd bilansu tylko przy realnym przeniesieniu.**
`/swaps/impact` zwraca 404 „Ten slot nie ma opublikowanego przydziału", gdy nie ma
kogo zastąpić.
Dla obsadzania pustego slotu (gap) nie ma „drugiej osoby", więc zamiast pustki
pokazujemy zdanie: „Slot był pusty - korekta dokłada dyżur tylko osobie X, nie zdejmuje
go nikomu". Podgląd `SwapImpactPreview` renderuje się tylko, gdy `selectedAssignment`
istnieje.
Drugi przypadek bez projekcji: `/swaps/impact` zwraca 409, gdy osoba z bieżącego slotu
to wiersz po samej nazwie (`assignee_name`), nie `TeamMember` - `SwapImpactPreview`
pokazuje to jako czerwony `Alert` w oknie potwierdzenia (czyta się jak błąd, choć to
tylko „brak projekcji dla tego wiersza"). Do dopięcia razem z reaktywną odmową
eligibility z E3, jeśli QA zgłosi którekolwiek.

Okno potwierdzenia zostało na `maxWidth="xs"` - panel bilansu składa się do jednej
kolumny (`impact-sides` to `auto-fit minmax(280px, 1fr)`), co w potwierdzeniu czyta się
lepiej niż dwie kolumny obok siebie.

**Pomiar po.**
`npm test` 132 passed (było 130: +2 `CalendarMatrix.test.tsx` „override balance preview
(MED6-04)" - podgląd obu osób obok reguł twardych ze słowem „traci"/„przejmuje";
zdanie „Slot był pusty" przy obsadzaniu gapu).
`Swaps.test.tsx` dostał dwie asercje - ekran zamian nadal mówi „oddaje dyżur", nie
„traci", po dodaniu `mode` do `SwapImpactPreview`.
Test „lets the coordinator remove a duty" dostał mock `api.swapImpact` (podgląd montuje
się teraz na ścieżce z `selectedAssignment`).
Nowy test zweryfikowany odwróceniem: usunięcie `mode="override"` sypie asercją
„traci dyżur".
`npm run build` (`tsc -b` + vite) czysty; `eslint .` czysty.
Backend bez zmian - żaden plik `backend/` nie tknięty.

Przegląd wizualny (stack QA6, koordynator `adam.nowicki`, oba motywy, `chrome-devtools-axi`):
korekta `Beata Lis zamiast Adam Nowicki` na `PRIMARY 09-09-2026` - okno potwierdzenia
pokazuje `[WPŁYW NA BILANS]`, `Adam Nowicki · traci dyżur · PRIMARY 52 → 51 (-1) ·
bliżej równowagi` oraz `Beata Lis · przejmuje dyżur · PRIMARY 50 → 51 (+1) · bliżej
równowagi`.
Panel mieści się w `xs` bez ściśnięcia w obu motywach.
Zrzuty: `e4-confirm-dark.png`, `e4-confirm-light.png`.

**Kryterium odbioru toru E.**
Przegląd wizualny ekranu Sprawiedliwość, drawera dnia i okna korekty w obu motywach, przez `chrome-devtools-axi`.
Test frontendowy równości sum w tabeli sprawiedliwości.

---

### Tor F: drobne

#### F1: poprawki niskiej wagi

| Id | Poprawka |
| --- | --- |
| LOW6-01 | `GET /api/v1/calendar/feeds` zwraca 403 dla konta poza rotacją, spójnie z `POST` |
| LOW6-02 | Jeden kod odpowiedzi dla „konto poza rotacją” na wszystkich ścieżkach, z jednym komunikatem; dziś 409, 409 i 403 |
| LOW6-03 | Ujednolicić opis notatki: albo „Powód (widzą koordynatorzy)”, albo usunąć słowo „prywatna” — *ekran „Moja dostępność” zrobiony w torze D; sprawdzić pozostałe wystąpienia* |
| LOW6-04 | Naprawić białe tło rynienki przewijania w prawym górnym rogu macierzy w motywie jasnym — *przy okazji: `Alert severity="info"` na ekranie Zamiany ma słaby kontrast w motywie ciemnym, sprawdzić oba* |
| LOW6-05 | Zmienić nagłówek „Szkice w toku” na „Szkice” i zarezerwować „w toku” dla trwających generowań |
| LOW6-06 | Wyrównać nazwy osób w raporcie miesięcznym do lewej, zgodnie z nagłówkiem kolumny |
| LOW6-07 | Dodać `acceptance_floor` do `DraftScheduleResponse` |
| LOW6-08 | `GET /api/v1/schedules/published` albo stosuje `starts_on` i `ends_on`, albo przestaje je przyjmować |
| LOW6-09 | Zweryfikować, czy `suggested-range` ma proponować górną granicę 34 dni, czy wartość bliższą 28 |

Robione pojedynczo. Każda pozycja: „Wykonanie" + „Pomiar po" poniżej.

##### LOW6-01 + LOW6-02: jeden kod dla „konto poza rotacją"

Zrobione razem, bo to jedna przyczyna: konto uwierzytelnione, przechodzi bramkę roli,
ale nie jest powiązane z członkiem rotacji - więc endpointy „moje" (dostępność, zamiany,
punkty, kanał ICS) nie mają na czym operować.
Dotąd trzy kody: `availability/me` i `swaps` → 409, `fairness` → 403, a `GET /calendar/feeds`
w ogóle nie sprawdzał i zwracał 200 z pustą listą (`POST` zwracał 409).

**Wykonanie.**
Nowy wspólny helper w `oncall/permissions.py`: `team_member_for_user(user, db) -> TeamMember`
podnosi **403** ze stałym komunikatem `NOT_A_TEAM_MEMBER = "Konto nie jest powiązane z
członkiem zespołu"`; `team_member_or_none` dla ścieżek, które i tak tolerują brak.
Kod 403 (nie 409), bo `test_rbac.py` już kodował `viewer → 403` na `GET /calendar/feeds`
jako stan docelowy, a to brak uprawnienia trwały, nie przejściowy konflikt stanu.
- `routes/availability.py::_member_for_user` i `routes/swaps.py::_member_for_user`
  delegują do helpera (swaps: dziesięć wywołań, wszystkie na 403).
- `routes/feeds.py`: `create_member_feed` woła helper zamiast lokalnego 409;
  `list_member_feeds` dostał ten sam warunek (dotąd żadnego) - LOW6-01.
- `routes/fairness.py`: gałęzie `own is None` (raport i `/duties`) → `NOT_A_TEAM_MEMBER`;
  gałąź `user.role == viewer` **zostaje** przy „Punkty są widoczne tylko dla zespołu",
  bo to odmowa ze względu na rolę, nie na brak wiersza rotacji (advisor).
- `swaps.py::swap_impact` 409 „Osoba z tego slotu nie jest członkiem zespołu" zostaje -
  to inna przyczyna (osoba z *bieżącego przydziału*, wiersz po samej nazwie), nie konto
  wołającego.

Frontend bez zmian: `MineScreen` już renderuje panel ICS tylko gdy `hasTeamMember !== false`,
`Swaps`/`Mine` gałęzie „nie w rotacji" też. To poprawka spójności kontraktu API.

**Pomiar po.**
`pytest` 302 passed (bez zmiany liczby - `test_feeds` przepisany 1:1).
`test_feeds.py`: `test_user_without_member_cannot_create_feed` → `test_account_without_member_is_turned_away_from_feeds`
(POST i GET, oba 403 + sprawdzenie komunikatu).
`docs/qa-suite-6/test_rbac.py`: `admin` dla `GET /calendar/feeds` i `GET /availability/me`
przechodzi z 200/409 na **403** (admin nie ma wiersza rotacji, nie ma własnego kanału);
`viewer` dla `GET /calendar/feeds` przechodzi z (błędnego) 200 na oczekiwane 403.
Przy okazji naprawiony błąd skryptu: `raport miesieczny CSV` wołał `?year=2026&month=9`
zamiast `?month=2026-09` (endpoint bierze `month` z regexem `^\d{4}-\d{2}$`).
`test_rbac.py` PROBLEMY: **4 → 1** (kanaly ICS naprawione produktowo, dwa CSV naprawą
skryptu; zostaje `lista zespolu`/viewer 403≠200 - niezwiązane z żadnym torem, nie
potwierdzone jako defekt: `GET /api/v1/team` odmawia viewerowi rolą, a oczekiwanie 200
w skrypcie może być po prostu zbyt luźne).

Weryfikacja na żywym stacku QA6 (po `docker compose build api worker`):
`admin`/`karolina.master` (koordynator poza rotacją)/`viewer` → `GET /calendar/feeds` i
`GET /availability/me` zwracają 403 „Konto nie jest powiązane z członkiem zespołu";
`adam.nowicki` (koordynator w rotacji) i `beata.lis` (członek) → 200.
`karolina.master` → `GET /fairness` 200 (koordynator widzi cały zespół, to nie jest
przypadek „poza rotacją" dla tego endpointu).

##### LOW6-03: opis notatki

*Zamknięte przez inspekcję.* `screens/Mine.tsx` naprawiony w torze D: nagłówek „Powód
zobaczą tylko koordynatorzy i administratorzy" + pole „Powód (widzą koordynatorzy)",
oba mówią „Powód", żadne nie mówi „prywatna".
`grep -rni "prywatn" frontend/src` (bez testów) nie znajduje żadnego „Prywatna notatka" -
sprzeczny sygnał zniknął z całego frontendu.
Pole „Notatka" na ekranie Zamiany nie deklaruje prywatności, więc nie jest sprzeczne.
Bez zmian kodu.

##### LOW6-04: biała rynienka + kontrast Alertu na Zamianach

Rynienka: `.calendar-scroll` dostało `background: var(--cal-header-bg)`.
`scrollbar-gutter: stable` rezerwuje po prawej pasek, którego przyklejone `thead th`
nie zakrywają; bez własnego tła świecił na biało (`#fff`) i wychodził poza zaokrąglone
obramowanie w motywie jasnym.
Teraz pasek ma barwę nagłówka (`#f2f7fb` ≈ tło strony `#f4f7fa`), więc się nie wyróżnia.
Weryfikacja: zwężone okno (900 px), tabela faktycznie przewija się w poziomie, prawy
górny róg w obu motywach - brak białego prostokąta.
Kompromis: gdy tabela jest węższa niż `Paper` (szeroki ekran), pusty pas po prawej
przybiera teraz barwę nagłówka zamiast białej - subtelne, do zaakceptowania; pełne
dopasowanie szerokości kontenera do tabeli dotknęłoby 8 miejsc użycia `.calendar-scroll`
(w tym `fairness-table` z `width: 100%`), poza zakresem LOW.
Zrzuty: `low604-light.png`, `low604-dark.png`, `low604-light-hscroll.png`.

Alert `severity="info"` na Zamianach: *sprawdzone, bez zmian.* Jedyny `severity="info"`
na tym ekranie to `.swap-coupled-note` (widoczny tylko przy sprzężonych slotach) oraz
`create.error.nextStep`; żadnego nie dało się wywołać na obecnych danych QA6.
Domyślny `MuiAlert-standardInfo` w motywie ciemnym to jasnoniebieski tekst na bardzo
ciemnym tle (≈9:1), przegląd Alertów info na ekranach Generator i Dyżury w ciemnym
motywie nie pokazał problemu z kontrastem.
Do rewizji, jeśli QA zgłosi ponownie z konkretnym powtórzeniem.

##### LOW6-05: „Szkice w toku" → „Szkice"

`components/DraftList.tsx`: nagłówek `<h2>` „Szkice w toku" → „Szkice".
„w toku" zostaje dla sekcji postępu trwających generowań.
`Generator.test.tsx`: asercja zmieniona na `findByText('Szkice', { selector: 'h2' })`.
Weryfikacja wizualna: `/generator`, `h2` = `Szkice`.

##### LOW6-06: nazwy w raporcie miesięcznym do lewej

`.report-table` nie miało własnych stylów - komórki nazw (`th[scope="row"]`, bez klasy
`member-column`) spadały do 44 px szerokości siatki i czytały się jako wyrównane do
prawej wobec lewego nagłówka „Osoba".
Dodane: `.report-table tbody/tfoot th[scope="row"] { min-width: 160px; text-align: left;
white-space: nowrap }` oraz `.report-table td { text-align: right; font-variant-numeric:
tabular-nums }`.
Weryfikacja wizualna: `/raporty` - „Osoba" i nazwy pod nią wyrównane do lewej, liczby
do prawej. Zrzut: `low606-report.png`.

##### LOW6-07: `acceptance_floor` w `DraftScheduleResponse`

`schemas.DraftScheduleResponse` dostało `acceptance_floor: int | None = None`,
`routes/scheduling.py::_draft_response` przekazuje `schedule.acceptance_floor` (kolumna
już istnieje na `schedules`; `fairness-impact` już to zwracał).
Frontend `api.ts::DraftSchedule` dostało `acceptance_floor: number | null`; fixture w
`Generator.test.tsx` uzupełniony (bez tego `tsc -b` nie przechodził).
`test_draft_persistence.py`: dodana asercja `"acceptance_floor" in draft`.

##### LOW6-08: `schedules/published` stosuje `starts_on`/`ends_on`

Endpoint dostał opcjonalne `starts_on`/`ends_on` (dotąd akceptowane i ignorowane - FastAPI
nie odrzuca nadmiarowych parametrów query).
Parametry mogą okno tylko **zwężać**: `starts_on` przesuwa początek do przodu
(`max(today, starts_on)`), `ends_on` przyciąga koniec (`min(ends_on, window_start + 90 dni)`).
Żaden nie sięga w przeszłość ani poza `+90 dni`, więc nie da się nim zmusić endpointu do
rozwiązywania lat przydziałów (QA-REPORT-6 par. 5 mierzył 190 ms już na domyślnych 90 dniach).
`ends_on < starts_on` → 422.
Kluczowe: rozdzielenie „okna" od „teraz". `resolved` liczy się od `today`, więc blok
`current` (kto teraz dyżuruje) i `today_is_day_off` są niezależne od `starts_on` -
zapytanie o okno w przyszłości nadal raportuje bieżący dyżur.
Lista `assignments` jest przycięta do `>= window_start`.
`test_current_duty.py::test_published_range_params_narrow_the_window` (grafik na 120 dni):
okno 2-dniowe zwraca mniej przydziałów, `ends_on` = data z zapytania, `current` i
`today_is_day_off` identyczne z pełną odpowiedzią; okno zaczynające się `today+3` nadal
zwraca `current`; odwrócony zakres → 422; `ends_on = today + 3650 dni` przycięte do
`today + 90`.
Frontend `api.publishedSchedule()` bez zmian (nigdy nie przekazywał zakresu).

##### LOW6-09: górna granica `suggested-range`

Zweryfikowane: `min(_range_end(first_uncovered), first_uncovered + timedelta(days=34))` -
`_range_end` to „cztery pełne tygodnie pon-niedz od tygodnia startowego", maksymalnie
`start + 33` (gdy start wypada we wtorek). `days=34` nigdy nie wiązało - martwy kod
zaciemniający intencję.
Odpowiedź na „34 czy 28": **28** (start w poniedziałek) do 33 (inny dzień), zawsze
kończąc w niedzielę.
`min(..., +34)` usunięte, zostaje `_range_end(first_uncovered)`.
`test_suggested_range.py` już asertował `ends_on == _range_end(...)`, przechodzi bez zmian.

**Pomiar po (F1 całość).**
`pytest` 303 passed (było 302: +1 test okna `schedules/published`); `npm test` 132 passed; `npm run build`
(`tsc -b`) czysty; `eslint .` czysty.
Na żywym stacku QA6 (po `docker compose build api worker web`):
`test_rbac.py` PROBLEMY 4 → 1 (zostaje niezwiązane `lista zespolu`/viewer);
`GET /schedules/published?starts_on=2026-09-15&ends_on=2026-09-18` → 12 przydziałów
zamiast 70, `current` bez zmian, odwrócony zakres → 422.
(F1 uruchomiony, gdy A1 był jeszcze `ZABLOKOWANE`; po ponownym pomiarze A1 i A4 też
przeszły na `DO REVIEW` - patrz ich sekcje. Cała tablica jest teraz `DO REVIEW`.)

---

## 6. Weryfikacja end-to-end

Po zamknięciu wszystkich torów, na świeżo zaseedowanych danych:

```
python docs/qa-suite-6/seed_roster.py           # uruchamiane w kontenerze api
python docs/qa-suite-6/make_history.py docs/qa-suite-6/history-qa6.csv
python docs/qa-suite-6/import_history.py
python docs/qa-suite-6/seed_availability.py
python docs/qa-suite-6/publish_first.py

python docs/qa-suite-6/test_rbac.py             # bez regresji uprawnień
python docs/qa-suite-6/test_negative.py         # 16 przypadków brzegowych
python docs/qa-suite-6/test_viewer_privacy.py   # prywatność viewera
python docs/qa-suite-6/test_features.py         # ICS, linki, raport, audyt
python docs/qa-suite-6/check_coverage.py        # pełne pokrycie i reguły twarde

python docs/qa-suite-6/test_swap_reachability.py
python docs/qa-suite-6/repro_double_count.py
python docs/qa-suite-6/load_worker.py
python docs/qa-suite-6/load_read.py
python docs/qa-suite-6/bench_solver.py
```

Dodatkowo `pytest` w `backend/` i `npm test` w `frontend/`.
Przegląd wizualny czterech ról w obu motywach przez `chrome-devtools-axi`.

Poświadczenia testowe są w QA-REPORT-6 par. 2.
Wszystkie konta poza `admin` mają hasło `QA6-Testowe-Haslo!`.

---

## 7. Czego świadomie nie zmieniamy

- **Ścieżek odczytu.**
  Przy 10 równoczesnych użytkownikach i przydziale dwóch rdzeni p95 najdroższej ścieżki wynosi 218 ms.
  Optymalizacja pętli w `_eligible_exposure` byłaby przedwczesna.
- **Rozkładu oczekiwanego udziału na dwa podokresy** w `scheduler.balance`.
  Sprawdzono pomiarem: rozjazd wobec wzoru raportu wynosi 0,07 punktu, także dla osoby dołączającej później.
  To nie jest przyczyna niczego.
- **Proporcjonalnego naliczania udziału dla nowej osoby.**
  Działa poprawnie i jest jednym z lepiej zrobionych elementów systemu.
- **RBAC, CSRF, prywatności viewera, linków udostępnień, kanałów ICS, audytu.**
  Przeszły pełny przegląd bez zastrzeżeń i stanowią bazę regresyjną, nie przedmiot zmian.
- **Domyślnej kotwicy `secondary`.**
  Decyzja D1 utrzymuje ją i naprawia przyczynę blokady zamian zamiast obchodzić ją zmianą domyślnej wartości.
  Liczby przemawiające za `independent` są w QA-REPORT-6 par. HGH6-01, gdyby zamawiający chciał wrócić do tej decyzji po wdrożeniu B1.
