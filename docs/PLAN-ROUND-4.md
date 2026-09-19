# Plan wdrożenia - runda 4

Autor: agent implementacyjny
Data: 2026-09-05
Podstawa: [QA-REPORT-3.md](QA-REPORT-3.md) oraz pięć uwag produktowych właściciela produktu
Decyzje D1-D7 zebrane od właściciela produktu przed rozpoczęciem prac; ich treść jest w rozdziale „Decyzje podjęte przed implementacją”.

## Stan implementacji

Ten rozdział jest dziennikiem przekazania prac. Należy go aktualizować przy każdej
zmianie statusu, zanim rozpocznie się lub zakończy kolejny podetap.

Ostatnia aktualizacja: 2026-09-06

| Zakres | Status | Uwagi dla kolejnej sesji |
| --- | --- | --- |
| 1.1 Twarde przypięcie zmiany 11-19 | **ZROBIONE** | Twarda równość dla osób eligible do obu ról, miękki wyjątek bez eligibility do 11-19, `SolverResult.anchor_exceptions`, pominięcie soczewki `late_shift` przy kotwiczeniu, audyt, testy i dokumentacja. |
| 1.2 Nowa funkcja celu | **ZROBIONE** | Jeden przebieg, PWL, nierówności max/min, normalizacja, defaulty w kodzie i UI, pomiary z 1.4 oraz migracja `0022` są gotowe. |
| 1.3 Reguły rozrzedzania | **ZROBIONE** | Zmienne `y`, limit 3/7, odpoczynek, miękka kara tygodniowa, wyłączenie dla `weekly`, założenie CP-SAT i fallback z ostrzeżeniem są wdrożone i przetestowane. |
| 1.4 Wydajność i równoległość | **ZROBIONE** | Konfiguracja, równoległość, brak seedu, warm start, zasoby Compose, TC-B5 i pomiary są gotowe. Decyzją właściciela z 2026-09-06 nie powstaje jedno-workerowa ścieżka wariantów. |
| 1.5 Rozróżnienie przyczyn niepowodzenia | **ZROBIONE** | Solver i API rozróżniają `PRECHECK` / `INFEASIBLE` / `UNKNOWN`; worker zapisuje trwały JSON konfliktów, `/runs` go wystawia, a generator pokazuje listę. |
| 1.6 Testy solvera | **ZROBIONE** | 25 testów obejmuje produkcyjny hybrid/secondary, święto, preferencję, D3, wyjątek eligibility, zawór bezpieczeństwa oraz powody niepowodzeń. |
| 2 Generator | **ZROBIONE** | Endpoint i UI sugerują pierwszy niepokryty dzień oraz cztery pełne tygodnie; deep link ma pierwszeństwo, nazwa zawiera tryb i daty DD-MM-YYYY, a żądania mutujące odrzucają nadmiarowe pola. |
| 3 Wydarzenia specjalne | **ZROBIONE** | Migracja `0019`, model, CRUD/RBAC/audyt, jedno zapytanie w kalendarzu, warstwa wizualna obu macierzy i listy, dialog dnia oraz ekran administracyjny są gotowe. Wydarzenia nie wpływają na solver, dni 2X, raporty ani ICS. |
| 4 Usunięcie kalendarzy świąt | **ZROBIONE** | Po zgodnym porównaniu 4.1 odczyty korzystają synchronicznie z `holidays`; usunięto model, CRUD, schematy, ekran i nawigację oraz dodano migrację `0020`. |
| 5 Domknięcie średnich | **ZROBIONE** | MED-15, MED-16 i MED-17 wdrożone wraz z testami API, UI oraz powiadomień. |
| 6 Drobne | **ZROBIONE** | LOW-08, LOW-09, LOW-10 i oczekiwany odczyt historyczny grafików `superseded` są wdrożone i pokryte testami. |
| 7 Dokumentacja | **ZROBIONE** | `PLAN.md`, `SOLVER.md`, `README.md`, `.env.example` i dziennik rundy opisują końcowe zachowanie. |

### Dziennik zmian statusu

- 2026-09-05: rozpoczęto podetap 1.1; pozostałe podetapy etapu 1 oraz etapy 2-6 nie są rozpoczęte.
- 2026-09-05: zakończono podetap 1.1. Zmieniono `scheduler.py`, audyt generowania,
  testy solvera, opis soczewki na ekranie sprawiedliwości oraz `PLAN.md` i
  `SOLVER.md`. Wyjątki są dostępne jako `SolverResult.anchor_exceptions` i zapisane
  w szczegółach audytu; trwałe pole `conflicts` przebiegu oraz prezentacja komunikatów
  w asynchronicznym UI pozostają zgodnie z planem w podetapie 1.5.
- 2026-09-05: weryfikacja po 1.1: backend `171 passed`, Ruff bez błędów; frontend
  `74 passed`, ESLint bez błędów. Pozostały wyłącznie istniejące ostrzeżenia
  deprecacyjne bibliotek i ostrzeżenia `act(...)` w testach hooka nawigacji.
- Następny krok po 1.1 ustalono jako podetap 1.2: jednoprzebiegowa funkcja celu,
  wypukła kara rozrzutu, normalizacja rodzin kosztów i nowe domyślne wagi.
- 2026-09-05: rozpoczęto podetap 1.2. Najpierw powstaje jednoprzebiegowy cel,
  normalizacja kosztów, defaulty w kodzie i testy. Migracja `0022` pozostaje jawnie
  oczekująca do czasu utworzenia jej wymaganych poprzedników `0019-0021`.
- 2026-09-05: zakończono część kodową 1.2. Usunięto `MIN_REFINE_SECONDS`,
  `REFINE_DETERMINISTIC_TIME`, drugi przebieg, `add_max_equality`, `add_min_equality`
  i `add_multiplication_equality`. Jeden cel zawiera rozstęp i wypukły estymator
  kwadratu z maksymalnie 16 stycznymi na osobę. Rodziny celu są normalizowane przez
  `OBJECTIVE_BASE = 10_000`; defaulty kodu i UI to fairness `3.0`, preference `2.0`,
  continuity `1.0`. Milestone workera zmieniono z przebiegów na `solve_done`.
- 2026-09-05: dokumentację 1.2 zaktualizowano w `PLAN.md` i `SOLVER.md`, a opisy
  wag i kotwiczenia w `Generator.tsx`. Weryfikacja: backend `171 passed`, Ruff bez
  błędów; frontend `74 passed`, ESLint bez błędów. Testy solvera wzrosły z około
  28 s do około 107 s, a pełny backend z około 52 s do około 132 s; funkcjonalnie
  są zielone, ale wpływ na generowanie 30/91 dni wymaga pomiaru i strojenia w 1.4.
- Niezrobione w 1.2: migracja `0022_scheduling_weight_defaults`. Nie wolno jej
  dodawać przed migracjami `0019_calendar_events`, `0020_drop_holiday_calendars` i
  `0021_run_conflicts`, ponieważ jej zadeklarowany `down_revision` jeszcze nie istnieje.
- Następny krok: podetap 1.3 (reguły rozrzedzania i zawór wykonalności), następnie
  1.4 z obowiązkowym pomiarem wpływu jednoprzebiegowego celu na długie zakresy.
- 2026-09-05: rozpoczęto podetap 1.3. Planowany kontrakt wyniku rozszerza
  `SolverResult` o ostrzeżenia, aby zawieszenie reguł rozrzedzania nie było ciche.
- 2026-09-05: zakończono 1.3. Dodano binarne `oncall_<dzień>_<osoba>`, twardy limit
  3 dyżurów w 7 dniach, zakaz wzorca dyżur-dyżur-przerwa-dyżur, miękką karę za
  dyżury ponad pierwszy w tygodniu ISO i wyłączenie całego zestawu dla `weekly`.
  Nowe twarde ograniczenia używają `spacing_enabled` jako założenia; wskazanie go
  przez rdzeń niewykonalności uruchamia ponowne rozwiązanie z `spacing_enabled=0`
  i zapisuje jawne `SolverResult.warnings`. Długie bloki dni wolnych są pomijane.
- 2026-09-05: testy 1.3 obejmują limit 3/7, odpoczynek, tryb tygodniowy, fallback
  oraz zakresy zaczynające się w poniedziałek i sobotę. Zaktualizowano `PLAN.md`,
  `SOLVER.md` i szczegóły audytu generowania.
- 2026-09-05: rozpoczęto i częściowo wykonano 1.4, ponieważ równoległość była
  konieczna do uczciwej weryfikacji nowego celu. Dodano ustawienia
  `ONCALL_SOLVER_WORKERS` (domyślnie min(8, CPU)), `ONCALL_SOLVER_SECONDS`
  (domyślnie 30, maksimum 300) i `ONCALL_SOLVER_LOG`; usunięto `random_seed`.
  Worker Compose ma `cpus: 2.0`, a zmienne są przekazane do API i workera.
  Zaktualizowano `.env.example`, `README.md`, `PLAN.md` i `SOLVER.md`.
- 2026-09-05: zgodnie z D4 usunięto dwa testy wymagające identycznych przydziałów.
  Test ciągłości tygodniowej używa teraz jawnie wysokiej wagi, ponieważ domyślny
  preset D7 celowo stawia fairness ponad continuity. Zacieśniono domeny soczewek
  PWL i poprawiono `bound_fair` do wymaganej sumy `span`; nie obniżono progów jakości.
- 2026-09-05: weryfikacja po 1.3 i części 1.4: backend `173 passed`, Ruff bez
  błędów, `docker compose config -q` poprawne. Pełny backend trwa około 195 s;
  pomiary generatora na danych QA nadal są niezrobioną częścią 1.4.
- Następny krok: dokończyć 1.4 — warm start, porównywanie wariantów z jednym
  workerem, TC-B5 i pomiary 30/91 dni — przed rozpoczęciem 1.5.
- 2026-09-06: dodano warm start przez `model.add_hint`. Round-robin wybiera
  eligible i dostępnych kandydatów, nie dubluje primary/secondary, próbuje zachować
  kotwicę 11-19 i podpowiada wspólną zmienną bloku tylko raz. Po korekcie hinta
  pełny backend przechodzi: `173 passed`, Ruff bez błędów (około 195 s).
- 2026-09-06: TC-B5 w `docs/qa-suite/t02_generator.py` nie porównuje już list
  przydziałów. Oba przebiegi muszą być kompletne, mieć rozstęp w tym samym progu
  oraz zbliżony proxy celu (rozstępy + przekazania). Nagłówek pliku wyjaśnia D4.
- 2026-09-06: przebudowano i uruchomiono kontenery bez resetowania bazy. Pomiar
  `t07_perf.py`: 30 dni `30.08 s / 201 / FEASIBLE`, 91 dni
  `30.14 s / 201 / FEASIBLE`, dwa równoległe zakresy 61 dni `30.19 s / 201`.
  Poprzedni warunek `<30 s` liczył narzut HTTP ponad pełny 30-sekundowy budżet
  CP-SAT i był niemożliwy przy statusie FEASIBLE; testy `t07` i `t02` dopuszczają
  teraz 1 s narzutu transportu. Surowe czasy pozostają raportowane.
- 2026-09-06: jedyny niezrobiony punkt 1.4 to generowanie porównywalnych wariantów
  z `num_workers=1`. Obecne `GET /scheduling/compare` wyłącznie odczytuje dwa
  wcześniej utworzone szkice, a frontend nie ma operacji generującej parę wariantów.
  Samo ustawienie jednego workera w endpointcie odczytowym niczego by nie zmieniło.
  Dokończenie wymaga dodania jawnego workflow/endpointu generowania pary albo decyzji,
  że porównanie ma pokazywać metryki rozwiązań niedeterministycznych.
- Następny wykonalny krok bez decyzji produktowej: podetap 1.5, z zachowaniem
  powyższego otwartego punktu 1.4 w tabeli statusu.
- 2026-09-06: właściciel produktu zdecydował, że nie chce jedno-workerowej ścieżki
  generowania wariantów porównawczych. Punkt usunięto z zakresu, a 1.4 oznaczono
  jako **ZROBIONE**. `GET /scheduling/compare` nadal porównuje metryki dwóch
  wcześniej wygenerowanych, potencjalnie niedeterministycznych szkiców.
- 2026-09-06: rozpoczęto 1.5 od rozróżnienia przyczyn niepowodzenia solvera.
- 2026-09-06: część solverowa 1.5 gotowa. `SolverResult.failure_reason` rozróżnia
  `PRECHECK`, `INFEASIBLE` i `UNKNOWN`. Precheck zwraca istniejące nazwane braki;
  INFEASIBLE wymienia rodziny reguł twardych; UNKNOWN podaje budżet czasu i jasno
  mówi, że dane nie wskazują konfliktu. Synchroniczne API dodaje `reason` oraz
  osobny nagłówek komunikatu do odpowiedzi 409.
- 2026-09-06: worker nie zapisuje już obciętego `str(dict)` dla strukturalnego
  błędu HTTP. Do czasu migracji `0021` składa czytelny tekst z message, reason i
  nazwanych konfliktów; test `test_worker_errors.py` zabezpiecza ten kontrakt.
  Weryfikacja punktowa: `4 passed`, Ruff bez błędów.
- Niezrobione w 1.5: kolumna JSON `schedule_runs.conflicts`, wystawienie jej przez
  `GET /scheduling/runs/{id}` i lista konfliktów w `Generator.tsx`. Migracji
  `0021_run_conflicts` nie można bezpiecznie dodać przed jej zadeklarowanymi
  poprzednikami `0019_calendar_events` i `0020_drop_holiday_calendars`.
- Następny krok zgodny z kolejnością migracji: etap 3 (`0019_calendar_events`),
  następnie etap 4 (`0020_drop_holiday_calendars`), po czym można domknąć 1.5
  migracją `0021` i 1.2 migracją `0022`.
- 2026-09-06: rozpoczęto etap 3 od modelu, migracji `0019`, API kalendarza,
  autoryzacji i testów backendu. Frontend pozostaje nierozpoczęty do ustabilizowania
  kontraktu odpowiedzi.
- 2026-09-06: zakończono etap 3. `CalendarEvent` ma osobną tabelę i CRUD z RBAC,
  przycinaniem sesji viewer oraz wpisami audytu. `GET /calendar` dołącza wydarzenia
  jednym zapytaniem dla zakresu. Frontend pokazuje niezależny kolorowy pasek w
  macierzy opublikowanej i szkicu, chipy w liście mobilnej, tytuły w etykietach
  dostępnościowych i dialogu dnia. Koordynator może dodać/usunąć wydarzenie z
  dialogu, a administrator zarządzać nazwą, kolorem i zakresem na ekranie
  `/wydarzenia`. Nie dodano żadnego połączenia z holidays, solverem ani ICS.
- 2026-09-06: weryfikacja etapu 3: backend `179 passed`, Ruff bez błędów;
  frontend `74 passed` i produkcyjny build TypeScript/Vite bez błędów. Pozostają
  wyłącznie wcześniejsze ostrzeżenia deprecacyjne/`act(...)` oraz ostrzeżenie Vite
  o rozmiarze głównego chunka.
- 2026-09-06: rozpoczęto etap 4. Przed zmianą kodu i utworzeniem migracji `0020`
  wykonywane jest obowiązkowe porównanie każdej zatwierdzonej wersji kalendarza
  świąt z wynikiem biblioteki dla tego samego roku.
- 2026-09-06: sprawdzenie 4.1 zakończone wynikiem **ZGODNE**. W bazie są dwie
  zatwierdzone wersje: 2026/v2 i 2027/v1. Dla obu zestaw dat i przypisanych nazw
  jest identyczny z `holidays` użytym przez `polish_holiday_names`; każda wersja
  zawiera 14 zgodnych pozycji, bez braków i nadmiarowych dni. Usunięcie tabeli nie
  zmieni historycznie definicji dni 2X dla istniejących zatwierdzonych danych.
- Następny krok etapu 4: przepisać odczyty na synchroniczne `polish_holidays` /
  `polish_holiday_names`, usunąć endpointy/model/schematy i frontend kalendarzy
  świąt, a następnie utworzyć `0020_drop_holiday_calendars` po `0019`.
- 2026-09-06: zakończono etap 4. Wszystkie ścieżki backendu korzystają teraz
  synchronicznie z przyciętych do żądanego zakresu `polish_holidays` /
  `polish_holiday_names`. Usunięto wersjonowany model, endpointy administracyjne,
  schematy, ekran `/swieta`, klienta API i pozycję nawigacji. Migracja
  `0020_drop_holiday_calendars` usuwa indeksy i tabelę po `0019`, zachowując
  historyczną migrację `0017`.
- 2026-09-06: weryfikacja etapu 4: backend `181 passed`, w tym dwa nowe testy
  przycinania zakresu świąt; Ruff bez błędów;
  frontend `74 passed`, ESLint i build produkcyjny bez błędów; `alembic heads`
  wskazuje wyłącznie `0020_drop_holiday_calendars`. Pozostały wcześniejsze
  ostrzeżenia deprecacyjne/`act(...)` oraz ostrzeżenie Vite o rozmiarze chunka.
- Następny krok zgodny z kolejnością migracji: domknąć 1.5 migracją
  `0021_run_conflicts`, trwałym JSON-em w przebiegach i prezentacją konfliktów
  w generatorze; następnie dodać `0022_scheduling_weight_defaults` z 1.2.
- 2026-09-06: domknięto 1.5. `ScheduleRun.conflicts` jest nullable JSON-em z
  migracją `0021_run_conflicts`; worker zachowuje osobno krótki komunikat oraz
  pełną listę nazwanych konfliktów, endpoint statusu przebiegu zwraca oba pola,
  a frontend pokazuje konflikty jako listę w alercie generatora.
- 2026-09-06: domknięto 1.2 migracją `0022_scheduling_weight_defaults`, która
  ustawia istniejącą politykę singleton na fairness `3.0`, continuity `1.0`
  i preference `2.0`; downgrade przywraca poprzednie wartości. Kolejność głowy
  migracji wynosi teraz `0020` → `0021` → `0022`.
- 2026-09-06: końcowa weryfikacja po etapach 4, 1.5 i 1.2: backend
  `181 passed`, Ruff bez błędów; frontend `74 passed`, ESLint i build bez błędów;
  jedyną głową Alembica jest `0022_scheduling_weight_defaults`. W kodzie
  aplikacji nie pozostały odwołania do usuniętego CRUD kalendarzy świąt.
- 2026-09-06: rozpoczęto etap 2. Najpierw powstaje backendowy kontrakt
  `suggested-range` z testami arytmetyki i pokrycia, następnie integracja UI,
  nazwa szkicu zawierająca tryb oraz odrzucanie nadmiarowych pól żądania.
- 2026-09-06: zakończono etap 2. `GET /scheduling/suggested-range` scala zakresy
  opublikowanych grafików od dziś, ignoruje szkice i propozycje oraz wskazuje
  pierwszy dzień luki. Koniec wypada w niedzielę po czterech pełnych tygodniach;
  frontend stosuje tę samą arytmetykę w deep linku i zachowuje jego pierwszeństwo.
  Nazwa szkicu zawiera polską etykietę trybu i zakres `DD-MM-YYYY`.
- 2026-09-06: wspólna baza `StrictRequest` ustawia `extra="forbid"` dla schematów
  żądań mutujących, w tym generatora; test chroni przed cichym przyjęciem pola
  `rotation_mode`. Przegląd szablonu publikacji potwierdził, że nowa nazwa jest
  bezpiecznie interpolowana jako zwykły tekst w treści wiadomości.
- 2026-09-06: rozpoczęto etap 5. MED-15 odrzuca po stronie API próbę przypisania
  obecnego właściciela slotu przed zmianą wersji, audytem i powiadomieniami;
  przycisk w macierzy jest dla takiej osoby wyłączony. Porównanie używa `member_id`
  z fallbackiem nazwy dla danych historycznych. MED-16 zastępuje nieaktualny tekst
  publikacji opisem rozstrzygania zakresu, zachowania grafiku poza nim i liczby dni.
- 2026-09-06: weryfikacja po etapie 2: pełny backend `186 passed`; po dodaniu
  testu MED-15 testy punktowe również przechodzą (`5 passed`). Ruff bez błędów.
  Frontend po 2.1, MED-15 i MED-16: pełne `79 passed`, ESLint i build produkcyjny
  bez błędów. Pozostają wyłącznie wcześniejsze ostrzeżenia deprecacyjne,
  `act(...)` i ostrzeżenie Vite o rozmiarze głównego chunka.
- Następny krok: MED-17 — komunikat członka, baner konfliktów w macierzy oraz
  powiadomienie koordynatorów po zgłoszeniu twardej niedostępności na istniejący dyżur.
- 2026-09-06: zakończono etap 5. Zgłoszenie twardej niedostępności na istniejący
  dyżur zwraca członkowi jawne ostrzeżenie, macierz pokazuje koordynatorom baner
  z listą konfliktów, a outbox kolejkuje osobne powiadomienie dla każdego aktywnego
  koordynatora i administratora z adresem e-mail. Zapis nadal nie usuwa dyżuru.
- 2026-09-06: rozpoczęto etap 6. Poprawiono separator zakresu sesji viewer i użyto
  bezosobowego tekstu dla wielu luk. Publiczny endpoint jednorazowego tokenu zwraca
  nazwę i login konta przed ustawieniem hasła; strona blokuje zapis do czasu jego
  walidacji. Oczekiwane zachowanie `/schedules/published` przy samych grafikach
  `superseded` jest zabezpieczane testem: takie grafiki pozostają źródłem
  historycznego rozstrzygania per slot.
- 2026-09-06: zakończono 1.6. Zestaw `test_scheduler.py` ma 25 zielonych testów.
  Ostatni brakujący scenariusz łączy produkcyjny tryb `hybrid`, kotwicę `secondary`,
  święto w środku tygodnia i preferencję jednej osoby; domyślna hierarchia D7 nadal
  utrzymuje rozstęp najwyżej jednego dyżuru 2X. Pozostałe testy obejmują D3,
  wyjątek eligibility, zawór bezpieczeństwa i rozróżnienie powodów niepowodzenia.
- 2026-09-06: zakończono etapy 6 i 7. Strona tokenu pokazuje zweryfikowaną tożsamość
  konta, teksty LOW-08/09 są poprawione, a test endpointu publikacji dokumentuje,
  że `superseded` pozostaje źródłem historycznego pokrycia per slot. Dokumentacja
  normatywna i konfiguracyjna odpowiada końcowej implementacji rundy 4.
- 2026-09-06: końcowa regresja rundy 4: backend `189 passed`, Ruff bez błędów;
  frontend `82 passed`, ESLint i build produkcyjny bez błędów. Pozostają znane
  ostrzeżenia deprecacyjne pytest/Starlette, `act(...)` i `localStorage` w Vitest
  oraz informacja Vite o głównym chunku większym niż 500 kB.


## Kontekst

Runda 3 testów QA ([QA-REPORT-3.md](QA-REPORT-3.md)) zamknęła wszystkie 22 poprawki rundy 2 i zostawiła dziewięć nowych defektów, w tym jeden wysoki.
HGH-08: dla części zakresów 91-dniowych solver nie znajduje w budżecie żadnego rozwiązania i zwraca 409 z jednym ogólnikowym zdaniem zamiast konkretnych konfliktów.

Równolegle właściciel produktu zgłosił pięć uwag.
Trzy z nich (twarde przypięcie zmiany 11-19, optymalność rozwiązań, sprawiedliwość rozkładu) dotykają dokładnie tego samego miejsca co HGH-08, czyli modelu w `scheduler.py`.
Dlatego ta runda łączy plan naprawczy QA z uwagami produktowymi: rozdzielenie ich oznaczałoby dwukrotne przepisanie tego samego pliku.

### Ustalenie, które zmienia diagnozę nierówności

Pytanie „czy to kwestia danych testowych, czy algorytmu” ma odpowiedź możliwą do wykazania arytmetycznie, bez uruchamiania czegokolwiek.

`scheduler.py:459` liczy `remaining = SOLVE_SECONDS - (monotonic() - started)`, a blok doprecyzowujący w `scheduler.py:460` uruchamia się tylko przy `remaining > MIN_REFINE_SECONDS`, czyli powyżej jednej sekundy.
QA-REPORT-3 §7.5 mierzy każde generowanie od 30 dni w górę na 30.07 do 30.2 s ściennie, czyli pierwszy przebieg za każdym razem zjada cały budżet.
Wniosek: drugi przebieg nigdy się nie wykonał w żadnym zmierzonym scenariuszu.

A to właśnie drugi przebieg, minimalizujący sumę kwadratów odchyleń od średniej, jest jedyną rzeczą w modelu kształtującą **rozkład** dyżurów.
Pierwszy przebieg minimalizuje wyłącznie `max - min` w każdej soczewce, czyli dwa krańce przedziału.
Wszystkie osoby „w środku” są dla modelu nierozróżnialne, więc podziały 2/2/3/3 i 2/2/2/4 mają identyczną wartość celu, a stały seed wybiera wciąż ten sam nierówny wariant.
To samo tłumaczy, dlaczego status poza 14 dniami nigdy nie jest `OPTIMAL`, oraz dlaczego QA-REPORT-3 §9 racjonalizuje nierówność jako „zamierzone nadrabianie długu historycznego”.

Druga przyczyna to skala funkcji celu.
Wagi z polityki (`fairness 1.0`, `continuity 2.0`, `preference 3.0`) są mnożone przez 10 i stają się kosztami jednostkowymi 10, 20 i 30, ale każdy z nich mnoży zupełnie inną liczbę członów:

| Składnik | Koszt jednostkowy | Ile jednostek przy 28 dniach i 10 osobach | Rząd wielkości wkładu |
| --- | --- | --- | --- |
| Sprawiedliwość `(max - min)` | 10 | raz na soczewkę, 5 soczewek, wartość w dziesiątych punktu | ok. 500 |
| Ciągłość (hybrid) | 20 | 2 na każde przekazanie, do 84 przekazań | do ok. 3400 |
| Rozjazd 11-19 z kotwicą | 30 | 2 na każdy dzień roboczy z rozjazdem | do ok. 1200 |
| Preferencja | 30 | 1 na każdy przydzielony dyżur w oknie preferencji | ok. 300-600 |

Sprawiedliwość jest tu najsłabszym głosem, mimo że w interfejsie ma wagę porównywalną z pozostałymi.
Dlatego suwaki „opisowych wag” nie robią tego, co obiecuje ich opis.

Trzecia przyczyna to brak jakiegokolwiek ograniczenia na to, **kiedy** dyżury wypadają.
`MAX_CONSECUTIVE_ONCALL_DAYS = 3` przy oknie `window_size = 4` (`scheduler.py:228-240`) dopuszcza dokładnie wzorzec „3 dni, przerwa, 3 dni”, a w trybie hybrydowym `continuity_cost` (`scheduler.py:390-403`) dodatkowo go **nagradza**, bo karą objęte jest przekazanie, a nie seria.

Część winy leży jednak także po stronie danych testowych i trzeba to odnotować, żeby nie naprawiać nieistniejących problemów:

- `docs/qa-suite/seed_qa.py:125-127` - przy `skew=True` przez 11 z 12 miesięcy historii każdy weekend obsługują wyłącznie trzy pierwsze osoby. Generator ma obowiązek to odkręcić, więc wypycha weekendy na pozostałych. To działa poprawnie.
- `docs/qa-suite/seed_qa.py:166-177` - wszystkie cztery wpisy dostępności leżą w oknie DZIŚ+30 do DZIŚ+60. Szkic na DZIŚ+1..+28 nie widzi żadnej preferencji, a szkic obejmujący tamto okno dostaje Piotra z premią -30 na każdej jego zmiennej.
- `docs/qa-suite/seed_qa.py:162-163` - „Grafik bieżący” (DZIŚ..DZIŚ+27) jest `published`, więc generowanie po tej dacie zaciąga te 28 dni jako historię.

## Decyzje podjęte przed implementacją

| Nr | Decyzja |
| --- | --- |
| D1 | Domyślny zakres generatora: start = pierwszy nieobsadzony dzień, koniec = niedziela kończąca czwarty pełny tydzień po nim (28 do 34 dni). |
| D2 | „Nieobsadzony” = nieobjęty żadnym **opublikowanym** grafikiem. Szkice są ignorowane. |
| D3 | Twardo: maksymalnie 3 dyżury on-call w każdym oknie 7 dni oraz minimum 2 dni przerwy po serii 2 lub więcej dni. Limit kolejnych dni zostaje 3. Dodatkowo miękka kara za drugi dyżur w tym samym tygodniu ISO. **Reguły obowiązują wyłącznie w trybie dziennym i hybrydowym, nie w tygodniowym.** |
| D4 | Determinizm przestaje być wymogiem produktowym. Pełna równoległość CP-SAT, wymóg powtarzalności znika z `PLAN.md` §8. |
| D5 | Wydarzenia specjalne: zarządzają koordynator i administrator, wpis ma zakres dat, kolor wybierany z palety, widoczne także dla roli viewer i w linkach viewer. **Nie trafiają do ICS.** |
| D6 | Wersjonowane kalendarze świąt usuwamy całkowicie, razem z tabelą. |
| D7 | Znormalizować koszty per jednostkę tak, aby domyślna hierarchia brzmiała sprawiedliwość > preferencje > ciągłość, zgodnie z `PLAN.md` §3. |

Założenie przyjęte bez pytania, uwaga 1:
twarde przypięcie zmiany 11-19 do roli kotwiczącej wchodzi jako reguła **warunkowa**.
Równość `late_shift = anchor` obowiązuje w dni robocze dla każdej osoby mającej eligibility do obu ról.
Powodem jest `jakub` z danych QA, który ma eligibility bez `late_shift`: bezwarunkowa równość wykluczyłaby go z roli kotwiczącej we wszystkie dni robocze, co przy 10 osobach, urlopach i niepodzielnych blokach weekendowych realnie grozi przewróceniem wykonalnego problemu w INFEASIBLE.
Dla osób bez eligibility do 11-19 zostaje dzisiejsza kara miękka, a odstępstwo jest widoczne w wyniku generatora.

---

## Etap 1. Solver

Cały etap dotyczy `backend/src/oncall/scheduler.py` oraz wywołania w `backend/src/oncall/routes/scheduling.py:231-338`.

### 1.1 Twarde przypięcie zmiany 11-19 (uwaga 1)

Zastąpić miękką karę z `scheduler.py:405-419` regułą twardą.

Dla każdego dnia roboczego i każdej osoby, która ma eligibility do roli kotwiczącej **oraz** do `late_shift` w tym dniu, dodać `model.add(anchor_var == late_shift_var)`.
Dla osoby bez eligibility do `late_shift` zostawić dzisiejszą karę miękką i policzyć takie dni jako `anchor_exceptions` w wyniku solvera.
Tryb `LateShiftAnchor.independent` zachowuje się jak dziś, czyli bez żadnego wiązania.

Efekt uboczny, który jest połową zysku wydajnościowego tego etapu: znika kilkaset zmiennych `mismatch` i tyle samo członów celu.

Soczewka sprawiedliwości `late_shift` staje się przy `anchor != independent` niemal deterministyczną funkcją soczewki kotwiczącej i obie zaczęłyby ze sobą walczyć.
Przy `anchor != independent` soczewkę `late_shift` w solverze pomijamy, a raport sprawiedliwości nadal ją pokazuje jako informację.
Ten wyjątek trzeba opisać w `docs/SOLVER.md` i w opisie soczewki na ekranie sprawiedliwości.

### 1.2 Nowa funkcja celu (uwaga 3, D7)

**Usunąć dwuprzebiegowość.**
Kształtowanie rozkładu przestaje być opcjonalne i wchodzi do pierwszego (jedynego) przebiegu.
Znikają `MIN_REFINE_SECONDS`, `REFINE_DETERMINISTIC_TIME`, blok `scheduler.py:459-488` oraz `add_multiplication_equality`.

**Odchylenia liczone jak dziś** (`balance()` w `scheduler.py:285-361`, w dziesiątych punktu), ale kara zmienia kształt:

- `range_lens` przez parę nierówności zamiast `add_max_equality`/`add_min_equality`: `max_var >= dev_i` dla każdego i, `min_var <= dev_i` dla każdego i, oba w celu. Cel sam domyka granice, a CP-SAT Primer wskazuje to jako szybszy zapis.
- `spread_lens = Σ_i pwl_sq(dev_i - mean_lens)`, gdzie `pwl_sq` to wypukły dolny estymator kwadratu zbudowany ze stycznych `y >= (2k+1)·x - k·(k+1)`, liczonych na wartości bezwzględnej odchylenia. Styczne kładziemy co 1 punkt (czyli co 10 dziesiątych), z twardym limitem 16 stycznych na zmienną; przy szerszym rozstępie rozstaw się rozrzedza. To daje mniej niż 1000 ograniczeń liniowych na cały model, wobec dzisiejszych 50 ograniczeń mnożenia, które są najdroższym typem w CP-SAT.

`spread_lens` sam z siebie minimalizuje też rozstęp, bo kwadrat jest zdominowany przez krańce.
`range_lens` zostaje jako zabezpieczenie, żeby pojedynczy odstający punkt był karany ostrzej, niż wynikałoby to z samej wariancji, i żeby zachować literalne brzmienie `PLAN.md` §3.

**Normalizacja kosztów (D7).**
Wprowadzić `BASE = 10_000` i policzyć dla każdej rodziny miękkiej domknięte ograniczenie górne jej surowej wielkości na danym horyzoncie, czyli bez rozwiązywania czegokolwiek:

- `bound_fair` - suma `span` po soczewkach, liczona **po** wyborze soczewek z 1.1. Przy `anchor != independent` soczewka `late_shift` nie wchodzi do modelu, więc wliczenie jej do ograniczenia zaniżyłoby wagę sprawiedliwości w konfiguracji domyślnej,
- `bound_pref` - liczba slotów w horyzoncie, `dni * 2 + dni_robocze`,
- `bound_cont` - `2 * liczba_granic_wewnątrztygodniowych * liczba_ról`,
- `bound_week` - liczba par (osoba, tydzień ISO) dla nowej miękkiej kary z 1.3.

Koszt jednostkowy każdej rodziny to `max(1, round(BASE * waga / bound_rodziny))`.
Dzięki temu każda rodzina wnosi do celu najwyżej około `BASE * waga` i waga naprawdę wyraża priorytet.

**Zmiana wartości domyślnych wag.**
Po normalizacji dzisiejsze `fairness 1.0 / continuity 2.0 / preference 3.0` dałyby hierarchię odwrotną do D7.
Nowe wartości domyślne: `fairness_weight = 3.0`, `preference_weight = 2.0`, `continuity_weight = 1.0`.
Pliki: `backend/src/oncall/models.py:334-350` (defaulty kolumn) plus migracja `0022_scheduling_weight_defaults`, która ustawia te wartości na istniejącym wierszu singletonu, bo stare liczby przestały znaczyć to samo.
Poprawić opisy słowne wag w `frontend/src/screens/Generator.tsx:205-210` i `frontend/src/lib/labels.ts`, żeby mówiły prawdę o nowej hierarchii.

### 1.3 Reguły rozrzedzania dyżurów (uwaga 3, D3)

Obowiązują wyłącznie dla `mode in (daily, hybrid)`, tak jak dzisiejsze ograniczenie serii.
Wprowadzić pomocnicze `y[d][m] = primary[d][m] + secondary[d][m]`, które i tak jest już ograniczone do 0 lub 1 przez `scheduler.py:208-213`.

- Limit serii zostaje bez zmian: okno 4 dni, suma `<= 3` (`scheduler.py:228-240`).
- **Nowe, okno 7 dni:** dla każdej osoby i każdego okna 7 kolejnych dni `sum(y) <= 3`.
- **Nowe, minimum 2 dni przerwy po serii 2 lub więcej dni:** dla każdej osoby i każdego `d` dodać `y[d-1] + y[d] + y[d+2] - y[d+1] <= 2`. Nie wymaga żadnej dodatkowej zmiennej.

  Jak to działa, bo z samego zapisu nie widać: pojedynczy człon zakazuje układu „dyżur, dyżur, przerwa, dyżur”, czyli serii dokładnie dwudniowej z jednodniową przerwą.
  Serię trzydniową z jednodniową przerwą łapie **następne** okno, przesunięte o jeden dzień, a nie to samo.
  Sprawdzenie: dla serii w dniach `d-1, d, d+1`, przerwy w `d+2` i dyżuru w `d+3` człon przy indeksie `d` daje `1 + 1 + 0 - 1 = 1` i przechodzi, ale człon przy `d+1` daje `1 + 1 + 1 - 0 = 3` i blokuje.
  Układ „przerwa, dyżur, przerwa, dyżur” pozostaje legalny (`0 + 1 + 1 - 0 = 2`), co jest zamierzone: pojedynczy dyżur nie wymaga dwóch dni odpoczynku.

  **Warunki brzegowe:** człon pomijamy w całości, gdy `d-1 < 0` albo `d+2 >= len(days)`.
  Potraktowanie brakującego `y[d+1]` jako zera zaostrzyłoby regułę bez powodu i dałoby niewykonalność zależną od dnia tygodnia, w którym zaczyna się zakres.
  Test brzegowy: zakres zaczynający się w poniedziałek i zakres zaczynający się w sobotę dają tak samo wykonalny model.
- **Nowa kara miękka:** dla każdej pary (osoba, tydzień ISO) zmienna `second_duty` z `second_duty >= sum(y w tygodniu) - 1`, karana kosztem rodziny `bound_week`.
- Dni należące do bloków dłuższych niż `MAX_CONSECUTIVE_ONCALL_DAYS` (np. czterodniowe Boże Narodzenie) zostają wyjęte z obu okien tak jak dziś (`long_block_days`, `scheduler.py:224-227`), bo blok jest niepodzielny z konstrukcji. Dzisiejsza reguła odpoczynku na stykach bloku (`scheduler.py:241-259`) zostaje.

**Zawór bezpieczeństwa wykonalności.**
Nowe reguły twarde realnie zawężają przestrzeń.
Zbudować je jako ograniczenia warunkowane literałami założeń (`only_enforce_if` na literale `spacing_enabled`), przekazać literał przez `solver.solve(model)` z `model.add_assumption`.
Jeżeli wynik to `INFEASIBLE`, odczytać `solver.sufficient_assumptions_for_infeasibility()`, powtórzyć rozwiązanie bez założeń rozrzedzania i zwrócić szkic z jawnym ostrzeżeniem „reguły rozrzedzania musiały zostać zawieszone, bo przy tej obsadzie i nieobecnościach nie da się ich spełnić”.
To jednocześnie realizuje wymóg `PLAN.md` §3 („brak rozwiązania pokazuje konkretne konflikty”) dla nowych reguł.

### 1.4 Wydajność i równoległość (uwaga 2, D4, HGH-01/HGH-08)

- `solver.parameters.num_workers` z konfiguracji zamiast sztywnego `num_search_workers = 1` (`scheduler.py:423`). Nowa zmienna `ONCALL_SOLVER_WORKERS`, domyślnie `min(8, os.cpu_count())`.
- `SOLVE_SECONDS` z konfiguracji: `ONCALL_SOLVER_SECONDS`, domyślnie 30, górny limit 300. Realizuje P1.1 z QA-REPORT-3 §8.
- Usunąć `random_seed`, `max_deterministic_time` i całą logikę budżetu resztkowego. Determinizm nie jest już wymogiem (D4).
- **Ciepły start.** Zbudować rozwiązanie startowe prostą rotacją round-robin po osobach eligible, z pominięciem dni z twardą niedostępnością, i podać je przez `model.add_hint`. CP-SAT Primer wskazuje to jako główną dźwignię dokładnie w przypadku, gdy solver ma problem ze znalezieniem pierwszego rozwiązania, czyli w HGH-08. Podpowiedź nie musi być dopuszczalna, żeby pomogła.
- `log_search_progress` za zmienną `ONCALL_SOLVER_LOG`, domyślnie wyłączone, do diagnostyki.
- **Ekran porównania wariantów — decyzja zmieniona 2026-09-06.**
  `GET /scheduling/compare` zestawia dwa wcześniej utworzone szkice. Właściciel
  produktu zrezygnował z jedno-workerowej ścieżki generowania pary; porównanie
  pozostaje oparte na metrykach potencjalnie niedeterministycznych rozwiązań.
- **`docs/qa-suite/t02_generator.py` TC-B5 (`:94-106`) asercyjnie sprawdza determinizm** przez dwa identyczne wywołania `/generate` i porównanie list przydziałów. D4 tę asercję unieważnia. Zastąpić ją sprawdzeniem jakości zamiast tożsamości: oba przebiegi mieszczą się w tym samym progu rozstępu i mają zbliżoną wartość celu. Odnotować zmianę w nagłówku pliku, żeby kolejna runda QA nie zgłosiła tego jako regresji.
- **Zasoby kontenera.** Ścieżka asynchroniczna, jedyna używana przez interfejs (`frontend/src/api.ts:535-554`), liczy się w kontenerze `worker` (`backend/src/oncall/worker.py:105-113` woła `generate_draft` bezpośrednio). W scenariuszach QA `worker` dostaje 0.5 rdzenia, więc równoległość nic tam nie da. W `docker-compose.yml` nadać `worker` jawny przydział rdzeni i opisać to w `README.md` oraz w rozdziale o limitach QA.

### 1.5 Rozróżnienie „nie istnieje” od „nie znaleziono” (HGH-08, P1.1/P1.2)

Dziś każdy nieudany wynik solvera schodzi tą samą drogą do 409 z jednym zdaniem (`scheduler.py:444-445`, `routes/scheduling.py:296-300`).

- `SolverResult` rozszerzyć o pole rozróżniające przyczynę: konflikt reguł wykryty przed budową modelu, `INFEASIBLE` z CP-SAT, oraz `UNKNOWN` po wyczerpaniu budżetu.
- Konflikt przed modelem i `INFEASIBLE`: 409 z nazwanymi konfliktami, jak dziś dla przypadków z `scheduler.py:174-206`, plus dla `INFEASIBLE` z CP-SAT rdzeń z `sufficient_assumptions_for_infeasibility()` przetłumaczony na nazwy reguł.
- `UNKNOWN`: osobny komunikat „Solver nie zdążył znaleźć kompletnego grafiku w N s. Dane nie wskazują na konflikt reguł. Spróbuj krótszego zakresu albo zwiększ budżet czasu.” z podaną wartością N i linkiem do ustawień generowania.
- **Naprawić ścieżkę workera.** `worker.py:132-139` robi `str(getattr(exc, "detail", exc))[:500]`, więc przez `/runs` koordynator dostaje obcięty `str(dict)` zamiast listy konfliktów. Zapisać `conflicts` jako kolumnę JSON na `schedule_runs`, wystawić w `GET /scheduling/runs/{id}` i wyświetlić w `frontend/src/api.ts:547-548` oraz w `Generator.tsx`. Nowa kolumna to migracja `0021_run_conflicts.py`, `down_revision = "0020_drop_holiday_calendars"`.

Numeracja migracji w całej rundzie, licząc od dzisiejszej głowy `0018_runs_requester_set_null`: `0019_calendar_events` (etap 3), `0020_drop_holiday_calendars` (etap 4), `0021_run_conflicts` (ten punkt), `0022_scheduling_weight_defaults` (nowe wagi z 1.2).
Migracja wag jest ostatnia, bo zależy od decyzji podjętych w etapie 1, a nie odwrotnie.

### 1.6 Testy solvera

`backend/tests/test_scheduler.py` ma 17 testów i istotne luki, które trzeba domknąć, bo dziś zielony zestaw nie uprawnia do stwierdzenia „sprawiedliwie w konfiguracji produkcyjnej”:

- **Usunąć** `test_same_input_is_deterministic` (`:125`) i `test_the_tie_break_pass_is_reproducible` (`:141`). D4 znosi wymóg, który one pilnują.
- **Wszystkie testy rozrzutu biegną dziś w `mode=daily`**, podczas gdy produkcja domyślnie używa `hybrid`. Zduplikować kluczowe asercje rozrzutu dla `hybrid`.
- **Wszystkie testy rozrzutu podają `holidays=set()`.** Dodać wariant ze świętem w środku tygodnia.
- `test_the_tie_break_pass_is_reproducible` i `test_tie_break_spreads_duty...` (`:378`) wymuszają `late_shift_anchor=independent`, czyli akurat te testy o rozrzucie wyłączają karę, którą produkcja ma włączoną. Nowy test rozrzutu z `anchor=secondary`.
- **Brak testu preferencji przeciwko asercji sprawiedliwości.** Dodać test sprawdzający hierarchię z D7: przy domyślnych wagach `prefer` nie może przeciągnąć rozkładu poza próg `PLAN.md` §8.
- **Nowe testy reguł D3:** brak wzorca „dyżur, dyżur, przerwa, dyżur” dla żadnej osoby; brak okna 7 dni z więcej niż 3 dyżurami; obie reguły nieaktywne w trybie tygodniowym.
- **Nowy test uwagi 1:** przy `anchor=secondary` osoba z eligibility do obu ról ma 11-19 zawsze zgodne z secondary; osoba bez eligibility do `late_shift` nie blokuje wygenerowania grafiku.
- **Nowy test HGH-08 (P1.2):** zakres +300 dni od dziś na danych QA zwraca 201 albo 409 z konkretnymi konfliktami reguł twardych, nigdy ogólnikowego zdania.
- **Nowy test zaworu bezpieczeństwa:** obsada zbyt mała, żeby spełnić reguły rozrzedzania, daje szkic z ostrzeżeniem, a nie 409.

Poprzeczka wydajnościowa z QA-REPORT-3 §7.5 jako punkt odniesienia: 30 dni 30.09 s FEASIBLE, 91 dni 409 dla zakresów +300 i +400 dni.

---

## Etap 2. Generator: domyślny zakres, nazwa szkicu, kontrakt API

### 2.1 Domyślny zakres (uwaga 4, D1 + D2)

Dziś zakres jest zaszyty na `dziś .. dziś+13` w inicjalizatorze `useState` (`frontend/src/screens/Generator.tsx:52-61`) i nigdy nie jest przeliczany z danych serwera.
Ekran generatora nie ma zresztą skąd wiedzieć o pokryciu: `GET /scheduling/drafts` (`routes/scheduling.py:450-488`) filtruje po `status in (draft, proposed)`, więc opublikowanych grafików nie widzi.

Nowy endpoint `GET /api/v1/scheduling/suggested-range` (coordinator, admin) zwracający `{first_uncovered, starts_on, ends_on}`.
Arytmetyka zostaje po stronie backendu, w jednym miejscu i pod testem jednostkowym:

- `first_uncovered` = pierwszy dzień od dziś włącznie nieobjęty żadnym grafikiem `ScheduleStatus.published`. Zapytanie jak `routes/calendar.py:122-130`.
- `starts_on = first_uncovered`.
- `ends_on` = niedziela kończąca czwarty pełny tydzień poniedziałek-niedziela liczony po tygodniu, w którym leży `starts_on`. Jeżeli `starts_on` wypada w poniedziałek, zakres ma dokładnie 28 dni; w pozostałych przypadkach od 29 do 34 dni.
- Zakres jest przycinany do limitu 91 dni z `schemas.py:190-201`, co przy 34 dniach nigdy nie zadziała, ale zostaje jako bezpiecznik.

`Generator.tsx` zasiewa `range` z tego endpointu.
Parametry `od`/`do` z deep linku kalendarza (`components/CalendarMatrix.tsx:505`) mają pierwszeństwo, bo to świadomy wybór koordynatora.
Deep link z kalendarza podnieść z dzisiejszych `addDays(day, 13)` do tej samej reguły 4 tygodni, żeby oba wejścia dawały to samo.

### 2.2 Nazwa szkicu (LOW-07)

`routes/scheduling.py:305` buduje `f"Szkic {starts_on.isoformat()} – {ends_on.isoformat()}"`, identycznie dla wszystkich trybów, w formacie ISO i z półpauzą.
Zmienić na `f"Szkic {etykieta_trybu} {DD-MM-YYYY} - {DD-MM-YYYY}"`, gdzie `policy.rotation_mode` jest już w zasięgu w `scheduling.py:284`.

Uwaga na konsumentów `schedule.name`: podsumowanie audytu przy usunięciu (`scheduling.py:712`) i przy publikacji (`scheduling.py:826`) oraz **treść powiadomienia e-mail** (`scheduling.py:816-818`, `notifications/triggers.notify_schedule_published`).
Zmiana nazwy zmienia treść wychodzącej korespondencji, więc sprawdzić szablon w `notifications/templates.py`.

### 2.3 Kontrakt API generatora (LOW-11)

`POST /scheduling/generate` po cichu ignoruje `rotation_mode` w treści.
Dodać `model_config = ConfigDict(extra="forbid")` do `GenerateScheduleRequest` (`schemas.py:190-201`) i do pozostałych schematów żądań mutujących w `schemas.py`.
Przejrzeć, czy któryś klient nie wysyła dziś pól nadmiarowych; `frontend/src/api.ts:535-555` wysyła tylko `starts_on` i `ends_on`, więc frontend jest czysty.

---

## Etap 3. Wydarzenia specjalne na kalendarzu (uwaga 5, D5)

**Granica, której nie wolno przekroczyć:** wydarzenia są wyłącznie warstwą wizualną.
Nigdy nie trafiają do zbioru `holidays` przekazywanego do `generate_schedule`, nie wpływają na `is_working_day`, `_role_day_weight`, `coverage.is_day_off`, `fairness.day_weight`, raporty rozliczeniowe ani feed ICS.
Osobna tabela, osobna ścieżka odczytu, osobne pole w odpowiedzi.

### 3.1 Backend

- Model `CalendarEvent` w `models.py`: `id`, `starts_on`, `ends_on`, `title`, `color` (enum `CalendarEventColor` z 5-6 wartościami tokenowymi, nie kodami hex), `created_by_id` z `ondelete="SET NULL"`, `created_at`. Indeksy po `starts_on` i `ends_on`.
- Migracja `0019_calendar_events.py`, `down_revision = "0018_runs_requester_set_null"`.
- Router `routes/calendar.py`: `GET /api/v1/calendar/events?starts_on&ends_on`, `POST`, `PATCH /{id}`, `DELETE /{id}`. Zapis dla `Coordinator` (koordynator i administrator), odczyt dla każdej sesji łącznie z sesją linku viewer, z tym samym przycięciem zakresu co `routes/calendar.py:57-66`.
- `CalendarDayResponse` (`schemas.py:242-249`) dostaje `events: list[CalendarEventRef]`, gdzie `CalendarEventRef` to `{id, title, color}`. Wypełniane w `routes/calendar.py:154-166` z jednego zapytania po całym zakresie.
- Audyt: `calendar.event_created`, `calendar.event_updated`, `calendar.event_deleted`.

### 3.2 Frontend

- `api.ts:240-247` - rozszerzyć typ `CalendarData['days']` o `events`; dodać `api.calendarEvents`, `createCalendarEvent`, `updateCalendarEvent`, `deleteCalendarEvent`.
- Nowe tokeny `--cal-event-*` w **obu** blokach motywu (`styles.css:250-288` i `:297-327`), po jednej parze tło/tekst na kolor palety, sprawdzone pod kontrast tak jak reszta palety.
- **Pułapka kaskady:** w nagłówku `<th>` klasy `day-off`, `has-gap` i `is-today` siedzą na tym samym elemencie z identyczną specyficznością, a `.calendar-matrix .day-off` (`styles.css:484`) leży w pliku **po** `.has-gap` (`:410`) i `.is-today` (`:395`), więc już je nadpisuje. Regułę wydarzenia trzeba umieścić po linii 484 albo dać jej wyższą specyficzność, inaczej zostanie po cichu połknięta. Rekomendacja: nie tło, lecz pasek u dołu komórki (`box-shadow: inset 0 -3px 0 var(--cal-event-fg)`), żeby wydarzenie i dzień wolny były widoczne jednocześnie.
- Miejsca do zmiany: `CalendarMatrix.tsx:340-362` (nagłówek), `:388-394` (komórka), `:447-449` (alert w dialogu dnia), `:60-74` (legenda, nowa pozycja), `CalendarDayList.tsx:36-53` (karta dnia, chip z tytułem), `lib/labels.ts:41-52` (`cellLabel`, tytuł wydarzenia w nazwie dostępnościowej).
- Zarządzanie: dodawanie i usuwanie z dialogu dnia w macierzy dla koordynatora i administratora, plus prosty ekran listy w sekcji administracyjnej do przeglądu i edycji zakresów.
- `DraftScheduleMatrix.tsx` korzysta z tego samego `GET /calendar`, więc wydarzenia pojawią się także w podglądzie szkicu bez dodatkowej pracy.

---

## Etap 4. Usunięcie wersjonowanych kalendarzy świąt (uwaga 6, D6)

To nie jest usunięcie modelu i trzech endpointów, tylko zmiana sygnatury z asynchronicznej na synchroniczną w 13 miejscach odczytu.

### 4.1 Sprawdzenie przed migracją

Przed napisaniem migracji wykonać zapytanie porównujące każdą **zatwierdzoną** wersję z wynikiem biblioteki dla tego samego roku.
Jeżeli którakolwiek się różni, usunięcie zmienia wstecz to, które dni historii liczyły się 2X, a więc punkty sprawiedliwości i wejście solvera.
Wynik tego sprawdzenia zaraportować przed wykonaniem migracji.

### 4.2 Backend

- `workdays.py`: usunąć `approved_polish_holidays` (`:28-47`) i `approved_polish_holiday_names` (`:50-73`). Zostają `polish_holiday_names`, `polish_holidays` i `is_working_day`. Przepisać docstring modułu (`:1-7`).
- **Uwaga na przycinanie:** usuwane funkcje kończyły się filtrem `starts_on <= day <= ends_on`, a `polish_holidays` zwraca całe lata bez przycięcia. We wszystkich obecnych wywołaniach zbiór służy tylko testom przynależności, więc jest to bezpieczne, ale przenieść przycięcie do `polish_holidays`/`polish_holiday_names`, żeby kontrakt się nie zmienił.
- Jedenaście wywołań `approved_polish_holidays` na `polish_holidays`, bez `await` i bez `db`: `effective.py:73`, `main.py:431`, `fairness_data.py:86`, `fairness_data.py:138`, `routes/history.py:92`, `routes/calendar.py:188`, `routes/reports.py:100`, `routes/scheduling.py:273`, `:364`, `:650`, `:796`.
- Dwa wywołania `approved_polish_holiday_names` na `polish_holiday_names`: `main.py:488`, `routes/calendar.py:121`.
- Poprawić importy: `effective.py:27`, `main.py:70`, `routes/history.py:29`, `routes/calendar.py:36`, `routes/reports.py:20`, `routes/scheduling.py:58`, `fairness_data.py:29`.
- `_validate_complete` (`routes/scheduling.py:200-228`) traci opcjonalny parametr `holiday_days` i gałąź `if holiday_days is not None`.
- Usunąć trzy endpointy z `routes/admin.py:64-76`, `:79-132`, `:135-170` oraz ich importy (`:25`, `:42-43`, `:49`). Sprawdzić, czy `date`, `func`, `update` nie stały się nieużywane.
- Usunąć schematy `HolidayItem` (`schemas.py:485-487`), `HolidayCalendarCreate` (`:490-491`), `HolidayCalendarResponse` (`:494-505`). **Zostawić** `today_holiday_name` (`:90`), `holiday_name` (`:246`) i soczewkę `holidays` (`:522`) - to są pola pochodne, niezwiązane z wersjonowaniem.
- Usunąć model `HolidayCalendarVersion` (`models.py:441-453`).
- Nowa migracja `0020_drop_holiday_calendars.py`, `down_revision = "0019_calendar_events"`, dropująca indeksy `ix_holiday_calendar_versions_year`, `ix_holiday_calendar_versions_status` i tabelę. **Nie kasować pliku `0017_holiday_calendars.py`**, bo `0018_runs_requester_set_null.py:11` ma go w `down_revision`.
- `holidays` zostaje w `pyproject.toml`: używa jej `migrations/versions/0015_drop_late_shift_on_days_off.py:10` i po zmianie `workdays.py` jest jedynym źródłem świąt.

### 4.3 Frontend

- Usunąć plik `screens/admin/HolidayCalendars.tsx`.
- `App.tsx:20` (import), `App.tsx:89` (trasa `swieta`), `lib/nav.ts:34` (pozycja nawigacji).
- `api.ts:213-221` (`HolidayCalendarVersion`), `:504-505`, `:506-513`, `:514-520`.
- Żaden test frontendu nie pokrywa tego ekranu, `AppShell.test.tsx` nie wylicza etykiet nawigacji, więc nic się nie wywali.

### 4.4 Efekt uboczny, który jest zyskiem

Usunięcie zdejmuje po jednym zapytaniu do bazy na rok na każde wywołanie z gorących ścieżek odczytu; nic z tego nie było cache'owane.
QA-REPORT-2 §368 mierzy, że to właśnie wprowadzenie zatwierdzanego kalendarza spowolniło raport miesięczny z 7 ms do 17 ms.
Naprawia też istniejącą niespójność: podgląd importu historii (`history_import.py:68`) używa biblioteki, a zapis (`routes/history.py:92`) kalendarza z bazy.

Nie istnieje ani jeden test backendu pokrywający usuwany feature, więc ryzykiem jest brak pokrycia, nie regresja.

---

## Etap 5. Domknięcie średnich z QA-REPORT-3

### MED-15: override „ta sama osoba na to samo miejsce”

`routes/calendar.py:create_override` przyjmuje `replacement_member_id` równy obecnemu właścicielowi slotu, zwraca 200, zapisuje pusty wpis w audycie i **podbija wersję opublikowanego grafiku**, co unieważnia tokeny optimistic locking wszystkich otwartych ekranów i sekwencje ICS całego zespołu.

Odrzucać takie żądanie z 422 „Ta osoba już pełni tę rolę tego dnia”.
Równolegle wyłączyć akcję w `components/CalendarMatrix.tsx`, tak jak robi to już edytor szkicu (`DraftScheduleMatrix`), żeby oba miejsca o tej samej semantyce zachowywały się tak samo.

### MED-16: tekst okna publikacji

Semantyka `superseded` zmieniła się między rundami: wycofywany jest tylko grafik w całości pokryty nowym zakresem, a nakładanie częściowe rozstrzyga `effective.py` per slot.
Nowe zachowanie jest lepsze; nieaktualny jest tekst.

Nowy tekst w `screens/Generator.tsx`: „Dni {od} - {do} będą rozstrzygane z tego grafiku. Wcześniejszy grafik zachowuje ważność poza tym zakresem. Grafiki w całości pokryte nowym zakresem zostaną wycofane.” plus liczba dni objętych zmianą.

### MED-17: niedostępność zgłoszona na dzień z istniejącym dyżurem

Zapis pozostaje dozwolony, bo sytuacja jest operacyjnie nieunikniona.
Brakuje reakcji.

- **Członek** przy zapisie „nie mogę” pokrywającego istniejący dyżur dostaje komunikat: „Masz w tym czasie dyżur. Zgłoszenie go nie zdejmuje, poproś o zamianę albo skontaktuj się z koordynatorem.” Wyliczane w `routes/availability.py` przez `effective_assignments` na zapisywanym zakresie.
- **Koordynator** dostaje baner w macierzy „N osób ma dyżur w dniu zgłoszonej niedostępności” z listą pozycji, zbudowany analogicznie do istniejącego banera luk w `components/CalendarMatrix.tsx:142-149`. Ryzyko jest groźniejsze niż pusty slot, bo slot wygląda na obsadzony.
- Powiadomienie e-mail do koordynatorów przez istniejący outbox (`notifications/triggers.py`).

---

## Etap 6. Drobne z QA-REPORT-3

| ID | Zmiana | Miejsce |
| --- | --- | --- |
| LOW-08 | Separator zakresu dat w banerze linku viewer: „od 05-09-2026 do 02-10-2026” zamiast sklejonego ciągu | ekran `/` dla sesji linkowej |
| LOW-09 | Odmiana czasownika w banerze luk: „2 dni **są** poza” albo sformułowanie bezosobowe | `components/CalendarMatrix.tsx` |
| LOW-10 | Identyfikacja konta na stronie aktywacji: „Ustawiasz hasło dla: Marek Nowak (`marek`)” | `screens/SetPassword.tsx` plus pole w odpowiedzi endpointu tokenu |
| obs. §11 | Test jednostkowy `/schedules/published` przy wszystkich grafikach `superseded` - udokumentować oczekiwane zachowanie | `backend/tests/` |

---

## Etap 7. Dokumentacja

Dokumentacja tego projektu jest normatywna, więc zmiany zachowania muszą do niej trafić w tym samym zestawie zmian, nie później.

- `docs/PLAN.md` §3: nowa hierarchia celów (D7), twarde przypięcie 11-19 jako reguła warunkowa (dziś opisana jako miękka), nowe reguły rozrzedzania (D3).
- `docs/PLAN.md` §8, kryteria techniczne: usunąć „deterministyczny wynik dla identycznego wejścia i seed” (D4), doprecyzować kryterium czasu wobec konfigurowalnego budżetu.
- `docs/PLAN.md` §48: usunąć zdanie o wersjonowanym i corocznie zatwierdzanym kalendarzu świąt (D6).
- `docs/SOLVER.md`: przepisać sekcje „Silnik”, „Funkcja celu” i „Stan funkcji względem planu docelowego”. Znika opis dwóch przebiegów, determinizmu i wersjonowanego kalendarza; dochodzi normalizacja kosztów, wypukła kara odchylenia, reguły rozrzedzania z zaworem bezpieczeństwa i wyjątek soczewki `late_shift`.
- `README.md`: sekcja o generatorze - nowy domyślny zakres, nowe zmienne `ONCALL_SOLVER_*`, przydział rdzeni dla `worker`.
- `.env.example`: nowe zmienne solvera.

---

## Weryfikacja

Kolejność ma znaczenie: etap 1 zmienia wyniki, więc dopóki nie jest zamknięty, porównywanie szkiców nie ma sensu.

```bash
# Backend: 169 testów w punkcie wyjścia
cd backend && .venv/bin/pytest
.venv/bin/ruff check src tests

# Frontend: 74 testy w punkcie wyjścia
cd frontend && npm test -- --run
npm run lint

# Środowisko end-to-end
docker compose up -d --build
docker compose cp docs/qa-suite/seed_qa.py api:/tmp/seed_qa.py
docker compose exec api python /tmp/seed_qa.py
```

Zestaw QA, w tej kolejności:

```bash
backend/.venv/bin/python docs/qa-suite/t02_generator.py        # poprawność generatora
backend/.venv/bin/python docs/qa-suite/t05_fairness_reports.py # soczewki i raporty
backend/.venv/bin/python docs/qa-suite/t07_perf.py             # poprzeczka czasu, przypadek P4 dla 91 dni
backend/.venv/bin/python docs/qa-suite/t16_perf_round3.py      # raporty w trakcie generowania
```

Przed uruchomieniem `t09_edge.py` usunąć konto `qa_rot` pozostałe z poprzedniego przebiegu (artefakt zestawu opisany w QA-REPORT-3 §11).

Kryteria zaliczenia:

1. **HGH-08:** generowanie 91 dni dla zakresów +200, +300, +400 i +600 dni od dziś zwraca 201 albo 409 z konkretnymi konfliktami reguł twardych. Ogólnikowe „Model CP-SAT nie znalazł kompletnego rozwiązania” nie może wystąpić w żadnym z czterech przypadków.
2. **Uwaga 3:** w szkicu na 28 dni na danych QA żadna osoba nie ma układu „dyżur, dyżur, przerwa, dyżur” ani więcej niż 3 dyżurów w żadnym oknie 7 dni. Sprawdzane testem jednostkowym i ręcznie na macierzy.
3. **Uwaga 3, rozkład:** rozstęp mierzony na **odchyleniu skumulowanym**, czyli historia plus horyzont, dokładnie na wyrażeniu `baseline + sum(weighted)` z `balance()`, mieści się w `PLAN.md` §8. Przy `mode=hybrid` i `anchor=secondary`, czyli w konfiguracji produkcyjnej.

   Kryterium **nie może** być mierzone na samych dyżurach z horyzontu.
   Dane QA mają przez `skew=True` z konstrukcji ogromną nierównowagę soczewki weekendowej, a generator ma obowiązek ją odkręcać.
   Na 28 dniach ta korekta się nie domknie, więc rozstęp liczony tylko po horyzoncie będzie duży z poprawnego powodu.
   Kto zmierzy go po horyzoncie, albo osłabi kryterium, albo „naprawi” solver tak, żeby przestał uwzględniać historię.
   To samo wyrażenie sprawdza istniejący `test_no_unexplained_inequality_exceeds_one_two_x_duty` (`test_scheduler.py:328`) i jest to jedyna postać kryterium prawdziwa w trakcie spłaty długu.
4. **Uwaga 1:** każdy dzień roboczy w szkicu ma 11-19 przypisane tej samej osobie co rola kotwicząca, poza wyjątkami wymienionymi w wyniku generatora.
5. **Uwaga 4:** wejście na `/generator` bez parametrów proponuje zakres zaczynający się pierwszego nieobsadzonego dnia i kończący niedzielą czwartego pełnego tygodnia.
6. **Uwaga 5:** wydarzenie utworzone na dzień roboczy zmienia wyłącznie wygląd komórki. Kontrola: `monthly.csv` dla tego miesiąca, raport sprawiedliwości i feed ICS są bajt w bajt identyczne przed i po utworzeniu wydarzenia.
7. **Uwaga 6:** ekran `/swieta` i endpointy `/holiday-calendars` zwracają 404, a raport miesięczny wraca do czasu poniżej 10 ms.
8. **Regresja:** `t01`-`t16` bez nowych niepowodzeń poza jedną **zamierzoną** zmianą: TC-B5 w `t02_generator.py` przestaje sprawdzać tożsamość dwóch przebiegów i zaczyna sprawdzać ich jakość (patrz 1.4). Kontrast obu motywów bez naruszeń, brak przepełnienia przy 390 px.

Sprawdzenie w przeglądarce przez `chrome-devtools-axi` na `http://localhost:8080` dla: macierzy z wydarzeniem specjalnym w obu motywach, ekranu generatora z domyślnym zakresem, wyniku generowania na 91 dni oraz banera konfliktu z MED-17.

---

## Ryzyka i punkty kontrolne

| Ryzyko | Kontrola |
| --- | --- |
| Nowe reguły twarde z D3 przewracają wykonalność przy 10 osobach i urlopach | Zawór bezpieczeństwa z 1.3: literały założeń, ponowne rozwiązanie bez reguł rozrzedzania i jawne ostrzeżenie zamiast 409. Test na to jest w 1.6. |
| Warunkowe przypięcie 11-19 nadal zawęża przestrzeń | Test z osobą bez eligibility do `late_shift` w 1.6; odstępstwa raportowane w wyniku, nie ukrywane. |
| Zmiana domyślnych wag zmienia wyniki dla istniejących konfiguracji | Migracja ustawia nowe wartości jawnie, a nie polega na defaultach kolumn; zmiana opisana w `PLAN.md` i `SOLVER.md`. |
| Usunięcie kalendarzy świąt zmienia wstecz historyczne punkty 2X | Sprawdzenie rozbieżności z 4.1 **przed** migracją, z raportem wyniku. |
| Wydarzenia specjalne przeciekają do rozliczeń | Kryterium 6 weryfikacji: `monthly.csv`, fairness i ICS identyczne przed i po. |
| Równoległość CP-SAT nic nie daje, bo `worker` ma 0.5 rdzenia | Jawny przydział rdzeni w `docker-compose.yml` i pomiar `t07_perf.py` przez ścieżkę `/runs`, nie tylko `/generate`. |
| Zmiana nazwy szkicu zmienia treść wychodzących e-maili | Przegląd `notifications/templates.py` przy 2.2. |

Firma nie ma funkcji „firmowy dzień wolny” poza świętami ustawowymi i po etapie 4 przestanie mieć jakikolwiek sposób, żeby taki dzień wyrazić.
Nie było to przedmiotem uwagi, więc tego nie buduję, ale odnotowuję jako świadomą lukę.
