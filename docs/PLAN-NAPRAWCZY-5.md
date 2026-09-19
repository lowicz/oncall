# Plan naprawczy po QA-REPORT-5

Dokument roboczy. Jest jednocześnie planem i tablicą postępu, bo pracuje nad nim wielu agentów.
Źródło ustaleń: `docs/QA-REPORT-5.md`. Decyzje właściciela produktu: `.lavish/qa5-decyzje.html`.

---

## 1. Kontekst

Runda 5 testów potwierdziła, że naprawy z rundy 4 działają, ale wykazała dwie niezależne wady
konstrukcyjne, przez które generator nie dowozi obiecanej sprawiedliwości, oraz jedną klasę defektów
na ścieżkach edycyjnych po publikacji.

Trzy fakty, na których stoi cały ten plan:

1. **Solver optymalizuje inne okno niż raport.**
   `fairness_data.history_window()` daje okno zakotwiczone na początku horyzontu, a
   `routes/scheduling.draft_fairness_impact` oraz `/api/v1/fairness` liczą w oknie kroczącym kończącym
   się ostatnim dniem szkicu.
   Dla szkicu 28-dniowego okna różnią się o 28 najstarszych dni historii.
   Ten sam zestaw przydziałów ma rozpiętość `secondary` 4,18 w oknie solvera i 9,00 w oknie raportu.
   Efekt uboczny: 90 sekund solvowania daje wynik nie lepszy niż 1 sekunda.
2. **Kryterium 3 punktów jest przy twardym kotwiczeniu 11–19 nieosiągalne.**
   CP-SAT dowodzi tego w 0,5 s; dno dla tej obsady wynosi 6 punktów.
   Powód jest strukturalny: przy kotwiczeniu liczba zmian 11–19 równa się liczbie dyżurów `secondary`
   w dni robocze, a `secondary` jest bilansowane punktowo (weekend = 2 pkt i zero zmian, środa = 1 pkt
   i jedna zmiana).
   Nie da się wyrównać obu naraz.
3. **Zamiana i korekta koordynatora nie walidują większości reguł twardych.**
   Jedna zatwierdzona zamiana w testach złamała naraz kotwiczenie 11–19 i limit 3 dyżurów w 7 dniach,
   bez żadnego ostrzeżenia.

Cel: generator ma dowozić rozpiętość mieszczącą się w kryterium odbioru w czasie rzędu kilkunastu sekund,
produkt ma pokazywać koordynatorowi tę samą liczbę, którą optymalizuje, i nie może pozwalać cicho łamać
reguł twardych po publikacji.

### Rozstrzygnięcia właściciela produktu

| | Decyzja | Zadania |
| --- | --- | --- |
| **D1** | Przy kotwiczeniu soczewka 11–19 **wypada z rodziny rozpiętości**, ale zostaje w celu słaby człon rozkładu jako rozstrzygacz remisów | Z0, Z2 |
| **D2** | Kryterium odbioru: **3 punkty**, cel 2 punkty, plus **jawny mechanizm odstępstwa** - generator liczy najniższą osiągalną rozpiętość i pokazuje ją, gdy kryterium jest nieosiągalne | Z5, Z6, Z16 |
| **D3** | Reguły twarde po publikacji: **członek blokowany, koordynator ostrzegany** z zapisem w audycie | Z7, Z8, Z9 |
| **D4** | Synchroniczny `POST /scheduling/generate`: **usunąć** | Z15 |

Kierunek D1 jest udokumentowanym powrotem do zachowania sprzed naprawy HGH-04 z rundy 4, z jedną
świadomą różnicą: soczewka nie znika z celu w całości, tylko przestaje o niego walczyć.
Powód tej różnicy jest mierzalny.
Przy równych punktach `secondary` liczba zmian 11–19 nadal może się różnić, bo dyżur weekendowy to
2 punkty i zero zmian, a dyżur w środę 1 punkt i jedna zmiana.
Soczewka weekendów zawęża to tylko częściowo, bo liczy weekendy `primary` i `secondary` łącznie.
Runda 4 zmierzyła przy pełnym usunięciu dryf **+7,4 zmiany w jednym miesiącu**.
Słaby człon rozkładu ma ten dryf ograniczyć, nie przywracając niewykonalności modelu.

---

## 2. Tablica postępu

Statusy: `wolne` / `w toku (<agent>)` / `zrobione` / `zablokowane (<czym>)`.
Agent podejmujący zadanie wpisuje siebie w kolumnie Status **przed** rozpoczęciem pracy.

| ID | Zadanie | Zależy od | Status | Dowód ukończenia |
| --- | --- | --- | --- | --- |
| **Z0** | Pomiar wariantu docelowego i wybór `TIE_BREAK_FRACTION` | - | zrobione (opencode) | wpis w par. 3; pomiar `docs/qa-suite-5/tie-break.jsonl`: tie=0 → 3,0/3,0/3,0, tie=0,1 → 3,07, tie=0,25 → 4,0 |
| **Z1** | Okno historii solvera | - | zrobione (opencode) | trzy przebiegi przez `/scheduling/runs`, rozpiętość `primary` na `draft_fairness_impact`: **1,0 / 1,0 / 2,0** (`docs/qa-suite-5/z1_check.py`); 210 testów backendu przechodzi |
| **Z2** | Soczewka 11–19 zdegradowana do rozstrzygacza remisów | Z0 | zrobione (opencode) | `test_late_shift_lens_leaves_the_range_family_only_when_anchored`; 210 testów przechodzi; trzy przebiegi konfiguracji weryfikacyjnej (analyze5.py, 2 workery, 90 s): maks. rozpiętość 4 ocenianych soczewek **3,0 / 3,0 / 3,0**, rozpiętość 11–19 **10,0** (`docs/qa-suite-5/z2-verify.jsonl`). Przy domyślnych 8 workerach jeden przebieg dał weekendy 4,0 - wyszukiwanie bez twardego kryterium nie ma gwarancji; to właśnie domyka Z5 |
| **Z3** | Wspólne okno bazowe w `draft_fairness_impact` | Z1 | zrobione (opencode) | `drift_check.py 2026-09-07 2026-10-04` vs „przed” z panelu (`z3_check.py`): identyczne **6,0 / 10,0 / 7,0 / 2,0 / 2,0**; 210 testów przechodzi |
| **Z4** | Flaga `late_shift_balanced` i ukrycie kolumny 11–19 | Z2 | zrobione (opencode) | `test_late_shift_flag.py` (4 testy: flaga false/true × obie odpowiedzi); nowy `Fairness.test.tsx` (kolumna obecna/nieobecna); 214 testów backendu, 84 frontendu, lint+tsc czysto; e2e: `/api/v1/fairness` zwraca `late_shift_balanced: false` przy `secondary`, `late_shift` per-osoba nadal wypełniane. Przy okazji scalono `_fairness_member_response` z `member_response` i `_policy` z nowym `policy.load_policy` |
| **Z5** | Preflight kryterium i mechanizm odstępstwa | Z2 | zrobione (opencode) | `docs/qa-suite-5/z5_check.py`: gałąź FEASIBLE orzeka kryterium konstrukcyjnie (floor=None), gałąź INFEASIBLE (okno sprzed Z1) podaje **floor=4** zamiast milczeć. Uwaga: spodziewane w planie „6” było dnem wszystkich pięciu soczewek przed D1; po Z2 rodzina oceniana to cztery soczewki i jej dno na tych danych to 4. Przebieg produkcyjny (8 workerów): max ocenianych **3,0** na `draft_fairness_impact`. 210 testów przechodzi |
| **Z6** | Podsumowanie rozpiętości i kryterium w interfejsie | Z3, Z5 | zrobione (opencode) | `test_fairness_criterion.py` (3 testy); `Fairness.test.tsx` + nowy `DraftFairnessPanel.test.tsx` (podsumowanie i odstępstwo); 217 backendu, 89 frontendu, lint+tsc czysto; e2e: impact zwraca `criterion_points: 3, criterion_met: true, floor: null` i rozpiętości przed→po (secondary 10,0 → 3,0), 11–19 nieobecna przy kotwiczeniu |
| **Z7** | Nowy moduł `backend/src/oncall/rules.py` | - | zrobione (opencode) | `test_rules.py` (15 testów: pozytywny+negatywny na regułę, bez bazy); stała `MAX_CONSECUTIVE_ONCALL_DAYS` przeniesiona, solver importuje; `_override_rest_warnings` jest cienkim opakowaniem; wyjątek dla długich bloków świątecznych (`exempt_days`) |
| **Z8** | Wpięcie reguł w ścieżkę zamian (blokada) | Z7 | zrobione (opencode) | `test_swap_rules.py` (3 testy): przypadek regresyjny Magdaleny odrzucany jako `three_in_seven` przy create (łamie też kotwicę, jak w raporcie), czysta zamiana przechodzi, a approve odrzuca po zmianie grafiku między prośbą a zatwierdzeniem |
| **Z9** | Wpięcie reguł w korektę koordynatora (ostrzeżenie) | Z7 | zrobione (opencode) | `test_override_rules.py` (3 testy: check przed faktem, operacja przechodzi z listą naruszeń, audyt zawiera identyfikator reguły); `CalendarMatrix.test.tsx` (ostrzeżenie w oknie potwierdzenia przed kliknięciem, przycisk nadal aktywny); e2e: override z naruszeniem `late_shift_anchor` przeszedł, audyt „świadome naruszenie reguł: late_shift_anchor", `verify_rules.py` → 0 |
| **Z10** | Baner konfliktów niedostępności w macierzy szkicu | - | zrobione (opus) | `test_draft_conflicts_exposed.py` (3 testy: lista na `GET /scheduling/{id}`, pusta bez wpisu, komunikat 409 wskazujący korektę); `Generator.test.tsx` (3 testy: baner, ukryty komunikat o regułach twardych, zablokowany przycisk z przyczyną); e2e `docs/qa-suite-5/z10_check.py`: szkic listopadowy, dwa wpisy „nie mogę" po wygenerowaniu → `unavailability_conflicts` 2 pozycje, propose 409 |
| **Z11** | Ostrzeżenia solvera docierają do koordynatora | Z7 | zrobione (opus) | nowa kolumna `schedules.solver_warnings` (migracja 0024) i typ `ScheduleWarningResponse` z polem `source`; `test_solver_warnings.py` (4 testy: ostrzeżenie solvera osobno, nazwiska i dni w regułach, brak słowa „Korekta", jedno zdanie na osobę i regułę); `Generator.test.tsx` (nagłówki „Ostrzeżenie solvera" / „Złamana reguła twarda"); e2e `docs/qa-suite-5/z11_check.py` (par. 7.8: 7 z 10 niedostępnych na marzec 2027): `OPTIMAL`, 2 ostrzeżenia solvera + 6 regułowych z nazwiskami, zamiast 40+ przed grupowaniem |
| **Z12** | Blokada korekty na osobę z „nie mogę” w macierzy opublikowanej | - | zrobione (opus) | `CalendarMatrix.test.tsx` (2 testy: przycisk „Zmień obsadę…” zablokowany przy `unavailable` i `directOverrideCheck` niewywoływany, przycisk aktywny przy `prefer_not`); ten sam warunek co `DraftScheduleMatrix.tsx`, plus zdanie „tej osoby nie da się tu obsadzić” w oknie dnia |
| **Z13** | Wznowienie postępu generowania po przeładowaniu strony | - | zrobione (opus) | nowy `GET /api/v1/scheduling/runs` (własne uruchomienia, domyślnie `queued`+`running`, z `created_at` i `solve_seconds`); `test_run_resume.py` (3 testy: lista tylko dla swojego koordynatora, zakończone nieoferowane, 403 dla członka); `Generator.test.tsx` (3 testy: wznowienie po montażu, licznik „N s, budżet do 90 s”, brak wznowienia bez zadania); e2e `docs/qa-suite-5/z13_check.py`: nowa sesja bez znajomości id widzi trwające zadanie, po zakończeniu lista jest pusta |
| **Z14** | Nowy domyślny budżet czasu i pole w ustawieniach | Z1, Z2 | zrobione (opus) | wpis w par. 3 (**15 s**, trzy zamiatania w `docs/qa-suite-5/budget-z14*.jsonl`); `SOLVE_SECONDS`, `ONCALL_SOLVER_SECONDS` w `docker-compose.yml` i `.env.example` zsynchronizowane; nowe pole `scheduling_policies.solve_seconds` (migracja 0025) z walidacją 5-300 s, generowanie i pasek postępu czytają politykę, nie środowisko; `test_policy_solve_budget.py` (6 testów: domyślna równa `SOLVE_SECONDS`, odczyt i zapis, trzy wartości poza zakresem → 422, uruchomienie raportuje budżet polityki); `Generator.test.tsx` (2 testy: pole zapisuje 45 s, przycisk nieaktywny bez zmiany) |
| **Z15** | Usunięcie synchronicznego `POST /scheduling/generate` | - | zrobione (opus) | `test_sync_generate_removed.py` (2 testy: ścieżki nie ma w `app.router.routes`, a funkcja nadal produkuje szkic); sześć plików testowych przepiętych z endpointu na nowy pomocnik `conftest.generate_draft_directly`, ta sama droga, którą idzie worker; 248 testów przechodzi |
| **Z16** | Dokumentacja: `PLAN.md`, `SOLVER.md`, docstring | Z0, Z2, Z5, Z14 | zrobione (opus) | `PLAN.md` par. 3 ma teraz zdanie o oknie, o czterech ocenianych soczewkach i o mechanizmie odstępstwa, a par. 8 mówi o 35 dniach i 15 sekundach zamiast o 90 dniach i 30 sekundach; `SOLVER.md`: nowe okno historii generatora, kryterium jako ograniczenie twarde z `acceptance_floor`, `TIE_BREAK_FRACTION` = 0 jako wynik pomiaru, budżet jako pole polityki z uzasadnieniem 15 s, grupowanie i etykiety w `PRECHECK`, ostrzeżenia solvera na ekranie; docstring `_build_model` mówi „3-duties-in-7-days” zgodnie z kodem |
| **Z17** | Drobne z paragrafu 12, po jednym zadaniu na wiersz | - | zrobione (opus) | wszystkie 13 wierszy zamkniętych, szczegóły w par. 16; dwa nowe wiersze dopisane zamiast naprawiania poza zakresem |

### Mapa kolizji plików

Dwa zadania dotykające tego samego pliku **nie mogą** iść równolegle. Kolejność w nawiasie.

| Plik | Zadania |
| --- | --- |
| `backend/src/oncall/scheduler.py` | Z2, potem Z5 |
| `backend/src/oncall/routes/scheduling.py` | Z1, potem Z3, potem Z10, potem Z11, potem Z15 |
| `backend/src/oncall/schemas.py` | Z4, Z6, Z10, Z14 - drobne dopiski w różnych klasach, ale i tak serializować |
| `backend/src/oncall/routes/swaps.py` | Z8 |
| `backend/src/oncall/routes/calendar.py` | Z9 |
| `backend/src/oncall/rules.py` | Z7 (nowy plik, brak kolizji) |
| `frontend/src/components/CalendarMatrix.tsx` | Z9, potem Z12 |
| `frontend/src/components/DraftFairnessPanel.tsx` | Z4, potem Z6 |
| `frontend/src/screens/Fairness.tsx` | Z4, potem Z6 |
| `frontend/src/screens/Generator.tsx` | Z10, Z11, Z13, Z14 - serializować |

Bezkolizyjne pary do pracy równoległej: **Z7 z czymkolwiek**, **Z1 z Z7**, **Z2 z Z8 i Z9**,
**Z13 z Z8**, **Z15 z Z7**.

### Protokół dla agentów

1. **Przed startem** wpisz siebie w kolumnę Status i sprawdź w mapie kolizji, czy Twój plik nie jest
   zajęty. Jeżeli jest, weź inne zadanie.
2. **Nie zmieniaj zakresu.** Jeżeli w trakcie znajdziesz coś poza zadaniem, dopisz to do paragrafu 12
   jako nowy wiersz, nie naprawiaj przy okazji.
3. **Każde zadanie kończy się dowodem**, nie deklaracją. Dowód to nazwa przechodzącego testu albo
   wklejona wartość pomiaru. Wpisz go w kolumnę „Dowód ukończenia”.
4. **Wartości zmierzone wpisuj do paragrafu 3.** Zadania Z2, Z14 i Z16 czytają je stamtąd i bez nich
   są zablokowane.
5. **Nie ruszaj reguł twardych w solverze.** Z2 i Z5 zmieniają wyłącznie funkcję celu i kolejność
   przebiegów. Twarde `model.add(anchor == late_shift)`, ograniczenia rozrzedzania, nierozdzielczość
   bloków i podpowiedzi startowe zostają bez zmian.
6. **Nie zmieniaj `/api/v1/fairness`.** Raport jest tu definicją produktową, to solver się do niej dopasowuje.
7. **Uruchom pełny zestaw testów przed oddaniem**, nie tylko swój. Kolizje w tym kodzie są
   nieoczywiste: zmiana okna historii przenosi się na fairness, na podgląd zamian i na import.

---

## 3. Ustalenia z pomiarów

Puste do czasu wykonania Z0 i Z14. Kolejne zadania czytają wartości stąd, nie z własnych założeń.

| Wartość | Ustalona w | Wynik | Data | Uzasadnienie |
| --- | --- | --- | --- | --- |
| `TIE_BREAK_FRACTION` | Z0 | **0** | 2026-09-06 | Przy 0,1 `secondary` wychodzi na 3,07 w dwóch z trzech przebiegów, przy 0,25 na 3,07–4,0. Zauważalny efekt na 11–19 kosztuje kryterium, a sam efekt jest marginalny (rozpiętość 11–19 spada tylko z 10,0 na 9,0). Zmaterializowało się ryzyko z par. 18: odpowiedzią jest 0, czyli pełne usunięcie soczewki z celu przy kotwiczeniu, zapisane jako świadomy wynik pomiaru. Dane: `docs/qa-suite-5/tie-break.jsonl` |
| Rozpiętość 4 ocenianych soczewek przy wybranej wartości | Z0 | **3,0 / 3,0 / 3,0** | 2026-09-06 | maksimum z `primary`, `secondary`, weekendy, święta na metryce raportu, trzy przebiegi 90 s |
| Rozpiętość 11–19 przy wybranej wartości | Z0 | **10,0** | 2026-09-06 | koszt decyzji D1 |
| Nowy domyślny `SOLVE_SECONDS` | Z14 | **15 s** | 2026-09-06 | Zamiatanie 5/15/30/60/90 s po trzy przebiegi (`docs/qa-suite-5/budget-z14.jsonl`, szkic 28-dniowy, 2 workery) daje maksimum czterech ocenianych soczewek **3,0 w każdym z piętnastu przebiegów** - po Z5 kryterium jest twardym ograniczeniem, więc budżet nie decyduje już o jakości. Ten sam wynik na zakresie maksymalnym, 35 dni (`budget-z14-35d.jsonl`). O wyborze rozstrzyga gałąź trudna, ta która musi dowieść nieosiągalności kryterium i wyznaczyć dno (`budget-z14-floor.jsonl`, marzec 2027, 7 z 10 osób niedostępnych): przy 5 s kończy się `FEASIBLE`, od 15 s w górę `OPTIMAL`, a czas własny to około 25 s niezależnie od budżetu - 90 s nie kupuje niczego. Dno wychodzi 5 punktów przy każdym budżecie. Skutek uboczny: pełny zestaw testów backendu skrócił się z 386 s do 194 s |

Wartości odniesienia z rundy 5, do porównania:

| Konfiguracja | Maks. rozpiętość, 3 przebiegi |
| --- | --- |
| okno zakotwiczone, kotwica `secondary` (dziś) | 9,0 / 9,0 / 9,0 |
| okno zakotwiczone, kotwica `independent` | 9,0 / 10,0 / 10,0 |
| okno kroczące, kotwica `secondary` | 7,0 / 7,0 / 7,0 |
| okno kroczące, kotwica `independent` | 3,0 / 3,0 / 3,0 |

---

## 4. Z0. Pomiar wariantu docelowego

**Blokuje Z2, a przez nie Z4, Z5, Z6 i Z16. Zrobić pierwsze.**

Kombinacja okno kroczące + twarda kotwica `secondary` + soczewka 11–19 zdegradowana do rozstrzygacza
remisów **nie została jeszcze zmierzona**.
Przesłanka z wariantu `independent` (2,0-3,0 na pozostałych soczewkach) jest mocna, ale to nadal
przewidywanie.

`docs/qa-suite-5/variant5.py` podmienia już źródło schedulera w jednym miejscu, więc wystarczy dołożyć
drugą podmianę i puścić po trzy przebiegi dla `TIE_BREAK_FRACTION` w wartościach `0`, `0,1` i `0,25`.
Wartość `0` jest jednocześnie punktem odniesienia, bo odpowiada pełnemu usunięciu soczewki.

Dla każdej wartości zapisać dwie liczby: maksymalną rozpiętość czterech ocenianych soczewek
(`primary`, `secondary`, weekendy, święta) oraz osobno rozpiętość 11–19.

**Definicja ukończenia.** Do paragrafu 3 wpisana `TIE_BREAK_FRACTION` równa największej wartości,
przy której cztery oceniane soczewki nadal mieszczą się w 3 punktach we wszystkich trzech przebiegach,
razem z odpowiadającą jej rozpiętością 11–19.
Jeżeli żadna wartość nie zejdzie na `secondary` do 3 punktów, **zatrzymać się i zgłosić** - wtedy Z2
wymaga przeprojektowania i nie wolno go zaczynać.

---

## 5. Z1. Zsynchronizować okno historii solvera z oknem raportu

**Defekt: BLK5-01. Bez tego reszta planu nie ma sensu.**

`backend/src/oncall/fairness_data.py`

- Dołożyć obok `history_window(starts_on)` (`:39`) funkcję dla generatora:

  ```python
  def generator_history_window(starts_on: date, ends_on: date) -> tuple[date, date]:
      """Historia, która nadal będzie w kroczącym oknie, gdy horyzont się zamknie."""
      return ends_on - timedelta(days=WINDOW_DAYS), starts_on - timedelta(days=1)
  ```

- `solver_history()` (`:125`) przyjmuje dziś tylko `starts_on` i sama woła `history_window`.
  Zmienić na jawne `window_start` i `window_end`, żeby źródło punktów i argument `history_window`
  przekazywany do solvera nie mogły się już nigdy rozjechać.
  To jest istotne: `balance()` w `scheduler.py:400-479` liczy z tego argumentu ekspozycję historyczną,
  więc rozjazd między punktami a oknem wprowadziłby nowy błąd zamiast naprawić stary.

`backend/src/oncall/routes/scheduling.py`

- W `generate_draft` (`:367`) użyć nowego okna w obu miejscach: przy ładowaniu `solver_history`
  i w `history_window=` przekazywanym do `generate_schedule` (okolice `:425`).
- To jedyne miejsce wywołania.
  Worker (`backend/src/oncall/worker.py`) woła tę samą funkcję z `progress_callback`, więc nie ma
  drugiej ścieżki do poprawienia.

`backend/src/oncall/routes/fairness.py` i `/api/v1/fairness` zostają bez zmian.

**Definicja ukończenia.** Trzy kolejne przebiegi 28-dniowego szkicu na danych z `docs/qa-suite-5/`:
rozpiętość `primary` najwyżej 2 punkty na metryce `draft_fairness_impact`.
Wartość referencyjna zmierzona w rundzie 5 po tej poprawce: **1,0**.

---

## 6. Z2. Zdegradować soczewkę 11–19 przy kotwiczeniu

**Defekt: BLK5-02. Decyzja D1. Wymaga wartości z Z0.**

Dziś pętla w `scheduler.py:481-492` buduje soczewkę dla każdej roli bezwarunkowo, a pętla celu
w `:570-596` traktuje każdą soczewkę identycznie: człon rozpiętości `maximum - minimum` plus wypukły
estymator kwadratu odległości od średniej dla każdej osoby.

Zmiana jest w dwóch miejscach i **nie dotyka żadnej reguły twardej**:

1. `_Lens` (`:52-66`) dostaje pole `graded: bool`.
   Dla soczewki `late_shift` przy kotwicy `primary` lub `secondary` jest fałszem, dla wszystkich
   pozostałych prawdą.
   Komentarz „The 11-19 shift stays a lens even when anchored ... (HGH-04)” zastąpić wyjaśnieniem
   z BLK5-02.
2. W pętli celu (`:571-596`) dla soczewki nierankingowanej:
   - **pominąć człon rozpiętości** wraz ze zmiennymi `max_*` i `min_*`, nie tworząc ich wcale, żeby
     nie zostawiać w modelu martwych zmiennych;
   - **zachować człony rozkładu** (`spread_*`), ale zbierać je do osobnej listy `tie_break_terms`,
     wycenianej osobnym, znacznie niższym kosztem:

   ```python
   tie_break_cost = max(1, round(fairness_cost * TIE_BREAK_FRACTION))
   objective.extend(term * tie_break_cost for term in tie_break_terms)
   ```

`TIE_BREAK_FRACTION` bierzemy z paragrafu 3, nie z głowy.
Ścisłe rozstrzyganie remisów w sensie leksykograficznym jest tu nieosiągalne przez skalowanie
współczynników: rodzina ma maksimum rzędu `liczba osób razy span`, więc żeby nigdy nie przebiła jednego
punktu innej soczewki, współczynnik musiałby być ułamkiem mniejszym od jedności.
Podbijanie w zamian wszystkich pozostałych kosztów odtworzyłoby dokładnie problem HGH-03 z rundy 4:
współczynniki w milionach i degradacja relaksacji LP.
Dlatego zamiast gwarancji przyjmujemy zmierzony kompromis.

Reszta obsługi kotwicy zostaje bez zmian: twarde `model.add(anchor == late_shift)` w `:537-566`,
podpowiedzi w `:631-661`, raportowanie `anchor_exceptions` w `:788-806`.

### Testy

- `backend/tests/test_scheduler.py:352-392` `test_late_shift_keeps_its_own_fairness_lens_when_anchored`
  przemianować i przepisać na dwie asercje, bo D1 nie jest pełnym usunięciem.
  Przy `primary` i `secondary` w modelu **nie ma** `max_late_shift` ani `min_late_shift`, ale
  `spread_late_shift_*` **nadal są**.
  Przy `independent` są wszystkie trzy.
  To odróżnia „soczewka wypadła z rodziny rozpiętości” od „soczewki nie ma wcale” i chroni przed
  przypadkowym zsunięciem się do jednego albo drugiego.
- `backend/tests/test_scheduler.py:520-545` - komentarz przy `:535-541` opisuje już nowe zachowanie,
  więc staje się prawdziwy; asercje bez zmian.

**Definicja ukończenia.** Przepisany test przechodzi, a trzy przebiegi produkcyjnej konfiguracji dają
maksymalną rozpiętość czterech ocenianych soczewek zgodną z wartością z paragrafu 3.

---

## 7. Z3. Wspólne okno bazowe w panelu wpływu szkicu

**Defekt: BLK5-01, druga połowa.**

`routes/scheduling.draft_fairness_impact` (`:747-829`) liczy dziś „przed” i „po” w dwóch różnych oknach:

```python
baseline_end    = schedule.starts_on - timedelta(days=1)
baseline_start  = baseline_end - timedelta(days=365)      # okno A
projected_start = projected_end - timedelta(days=365)     # okno B
```

Przez to każde „bliżej równowagi o 0,11” jest częściowo artefaktem starzenia się historii.
Pomiar kontrolny (`docs/qa-suite-5/drift_check.py`) pokazuje skalę: samo przesunięcie okna zmienia
rozpiętość `secondary` z 7,0 na 10,0, bez dodania ani jednego dyżuru.

Poprawka: oba słupki w oknie `[ends_on - 365, ends_on]`, a jedyną różnicą jest obecność przydziałów
szkicu.
Baza wyjściowa to `resolved_duties(db, ends_on - 365, ends_on)`.
`effective_assignments` uwzględnia tylko `published` i `superseded` (`effective.py:32`), więc szkic sam
z siebie do niej nie wejdzie.

**Definicja ukończenia.** `drift_check.py` uruchomiony na tym samym zakresie pokazuje, że „przed”
z panelu równa się historii policzonej w oknie projekcji.

---

## 8. Z4. Flaga `late_shift_balanced` i ukrycie kolumny 11–19

**Decyzja D1, część interfejsowa.**

Kolumna ma zniknąć również członkowi zespołu, a `GET /api/v1/scheduling/policy`
(`routes/scheduling.py:165`) jest za `Coordinator` i jest wołany wyłącznie z ekranu Generator
(`frontend/src/api.ts:554`, klucz `['scheduling-policy']`).
Rozszerzanie RBAC polityki tylko po to, żeby ukryć kolumnę, byłoby wyciekiem konfiguracji do wszystkich.

Zamiast tego dołożyć **jedno pole boolowskie**, opisujące semantykę, a nie ustawienie:

- `schemas.py:571` `FairnessReportResponse` → `late_shift_balanced: bool`
- `schemas.py:578+` `DraftFairnessImpactResponse` → to samo pole
- wypełniane z `policy.late_shift_anchor == LateShiftAnchor.independent`

Pole `late_shift` w `FairnessMemberResponse` (`schemas.py:544`) **zostaje wymagane i nadal wypełniane**.
Dzięki temu nie pęka ani `backend/tests/test_fairness.py:57-87` (asercje na `late_shift.actual`
i na dokładny słownik `totals`), ani `test_fairness_dedup.py:109-112`, ani typ `FairnessMember`
w `frontend/src/api.ts:364`, ani fikstura `frontend/src/screens/Swaps.test.tsx:113-123`.
Zmienia się wyłącznie to, czy interfejs tę liczbę rysuje.

`frontend/src/screens/Fairness.tsx`

- `:79-83` kolumnę `{ key: 'late_shift', label: '11–19', hint: 'zmiany / udział · informacyjnie przy kotwiczeniu' }`
  odfiltrować, gdy `late_shift_balanced` jest fałszem.
  Podpowiedź „informacyjnie przy kotwiczeniu” znika razem z kolumną, co zamyka LOW5-03.
- `:173-198` nagłówek renderuje `SORT_COLUMNS` generycznie, więc odfiltrowanie wystarczy.
- `:216` komórka ciała, `:233-234` i `:240` stopka z `totals.late_shift_count` warunkowo.
- **Pułapka:** stan sortowania (`:95`) może trzymać `'late_shift'` po ukryciu kolumny, a `deviationOf`
  (`:111-115`) sięgnie wtedy po ukryty klucz.
  Przy ukrywaniu zresetować sortowanie do `'name'`.

`frontend/src/components/DraftFairnessPanel.tsx`

- Nagłówki są tu wpisane na sztywno (`:61-67`), nie sterowane tabelą.
  Kolumnę `:64` i komórkę `:79` ukryć pod tym samym warunkiem.

`frontend/src/components/SwapImpactPreview.tsx` (`:13-20`) **zostawić bez zmian**.
Wiersz 11–19 pojawia się tam wyłącznie wtedy, gdy zamiana faktycznie dotyczy slotu 11–19
(`:26-48` pomija niezmienione kategorie), więc jest to informacja o konkretnej operacji, a nie kolumna
bilansu.

Miesięczny raport dla kadr (`routes/reports.py`, kolumna CSV `zmiany_11_19`) **zostaje nietknięty**.
Tam liczba zmian służy do rozliczenia, a nie do oceny sprawiedliwości.

**Definicja ukończenia.** Nowy test backendu: flaga jest fałszem przy `secondary` i prawdą przy
`independent`, w obu odpowiedziach.
Nowy test frontendu ekranu Sprawiedliwość (dziś go nie ma): kolumna jest obecna dla jednej wartości
flagi i nieobecna dla drugiej.

---

## 9. Z5. Preflight kryterium i mechanizm odstępstwa

**Decyzja D2. Wymaga Z2, bo dotyka tego samego pliku.**

Kryterium przestaje być wyłącznie sprawą funkcji celu.
Przed głównym przebiegiem uruchomić krótki preflight z kryterium skompilowanym jako ograniczenie
twarde na każdą ocenianą soczewkę:

```python
model.add(maximum - minimum <= ACCEPTANCE_POINTS * SCALE)
```

- **FEASIBLE** - użyć tego modelu do właściwego przebiegu.
  Kryterium jest wtedy gwarantowane konstrukcyjnie, a nie tylko wynikiem optymalizacji.
- **INFEASIBLE** - odpaść ograniczenie, rozwiązać model normalnie i podać koordynatorowi najniższą
  osiągalną rozpiętość, znalezioną bisekcją w górę po tym samym ograniczeniu.

Koszt jest pomijalny: w rundzie 5 każdy przebieg niewykonalny kończył się w 0,3-0,8 sekundy,
a bisekcja od 3 do 8 to najwyżej trzy takie próby.
Zysk jest podwójny: kryterium przestaje być cicho niespełniane, a komunikat „kryterium 3 punktów jest
nieosiągalne przy tym długu historycznym, najniższa osiągalna rozpiętość to N” jest dokładnie tym,
czego dziś brakuje na ekranie generatora.

**Uwaga do implementacji.** Soczewki solvera i soczewki raportu potrafią się różnić o około jeden punkt
nawet przy zgodnych oknach, bo mianowniki udziału oczekiwanego liczone są inaczej
(`docs/QA-REPORT-5.md` par. 14).
Preflight ma używać progu `ACCEPTANCE_POINTS` w jednostkach solvera i **nie może być jedynym źródłem
prawdy** o spełnieniu kryterium.
Wiążąca pozostaje wartość z `draft_fairness_impact` pokazana w Z6.
Uzgodnienie obu obliczeń to osobne zadanie, poza tym planem.

**Definicja ukończenia.** Obie gałęzie sprawdzone.
Na danych z `docs/qa-suite-5/` po Z1 preflight orzeka FEASIBLE.
Gałąź INFEASIBLE wymusić, uruchamiając generowanie na bazie **bez** Z1, gdzie dno wynosi 6 punktów:
komunikat ma podać 6, a nie milczeć.

---

## 10. Z6. Pokazać rozpiętość i kryterium tam, gdzie zapada decyzja

**Defekt: HGH5-05. Wymaga Z3 i Z5.**

`DraftFairnessPanel` pokazuje dziś dziesięć wierszy po pięć liczb i ani razu nie pokazuje rozpiętości,
czyli jedynej liczby rozstrzygającej, czy szkic nadaje się do publikacji.

- `DraftFairnessImpactResponse` (`schemas.py:578+`) dostaje wyliczoną per soczewkę rozpiętość przed
  i po, wartość kryterium oraz stan spełnienia.
  Liczyć po stronie backendu, żeby próg mieszkał w jednym miejscu razem z `PLAN.md`.
- `components/DraftFairnessPanel.tsx` dostaje wiersz podsumowania nad tabelą: dla każdej soczewki
  `rozpiętość przed → po`, wartość kryterium i widoczny stan **spełnia / nie spełnia**, tekstem,
  nie samym kolorem (`PLAN.md` par. 6).
- To samo podsumowanie na ekranie Sprawiedliwość (`screens/Fairness.tsx`), w wierszu obok „Razem”.
- Soczewka 11–19 przy kotwiczeniu nie pojawia się w podsumowaniu, bo nie ma kryterium.

**Odstępstwo.** Gdy preflight z Z5 orzeknie, że kryterium jest przy tym długu historycznym nieosiągalne,
podsumowanie zamiast samego „nie spełnia” pokazuje najniższą osiągalną rozpiętość i mówi wprost,
że przyczyną jest zastana nierówność, a nie jakość generowania.
Bez tego koordynator dostaje komunikat, z którym nie może nic zrobić.

Banner `FEASIBLE` na ekranie generatora (`Generator.tsx:399-406`) mówi dziś, że rozkład „może być nieco
gorszy niż najlepszy możliwy”, przy zmierzonej luce 37%.
Przeredagować tak, żeby odsyłał do podsumowania rozpiętości zamiast opisywać jakość słowami.
Luki MIP nie pokazywać: par. 5.8 raportu pokazuje, że przy luce 37% rozwiązanie było o jeden punkt od
dowiedzionego dna, bo granica LP dla członów rozpiętości jest z natury słaba.

---

## 11. Z7 do Z9. Reguły twarde na ścieżkach edycyjnych po publikacji

**Defekt: HGH5-03. Decyzja D3. Niezależne od Z0 do Z6, można robić równolegle.**

### Dlaczego to jest przebudowa, a nie łatka

Nie ma dziś wspólnego modułu reguł.
`MAX_CONSECUTIVE_ONCALL_DAYS = 3` żyje wyłącznie w `scheduler.py:125`, a reguły istnieją tylko jako
ograniczenia CP-SAT (`:297-350`), nieużywalne poza modelem.
Jedyna implementacja w Pythonie to `routes/scheduling.py:250` `_override_rest_warnings`, która zwraca
ostrzeżenia (nigdy 4xx) i czyta przydziały **jednego** rekordu `Schedule`.
Ta sama reguła „11–19 tylko w dni robocze” jest dziś napisana cztery razy, z trzema różnymi
komunikatami: `routes/calendar.py:321-327`, `routes/scheduling.py:521`, `routes/history.py:96-104`,
`effective.py:86-89`.

### Z7. Nowy moduł `backend/src/oncall/rules.py`

Czyste funkcje, bez bazy danych, testowalne jednostkowo tak samo jak `fairness.py`:

```python
MAX_CONSECUTIVE_ONCALL_DAYS = 3          # przeniesione ze scheduler.py, importowane z powrotem

@dataclass(frozen=True)
class RuleViolation:
    rule: str            # stabilny identyfikator, np. "three_in_seven"
    message: str         # tekst po polsku, jeden na regułę, w jednym miejscu
    member_name: str
    days: tuple[date, ...]

def oncall_rest_violations(name, oncall_days: set[date]) -> list[RuleViolation]
def anchor_violations(name, slots, anchor: LateShiftAnchor, holidays) -> list[RuleViolation]
def day_off_block_violations(slots, holidays) -> list[RuleViolation]
def late_shift_on_day_off(slots, holidays) -> list[RuleViolation]
```

`scheduler.py` importuje z niego stałą, a `_override_rest_warnings` staje się cienkim opakowaniem na
`oncall_rest_violations`, dzięki czemu ostrzeżenia szkicu i blokady po publikacji przestają móc się
rozjechać.

Moduł **nie rzuca `HTTPException`**.
Zwraca listę naruszeń, a decyzję „409 czy ostrzeżenie” podejmuje wywołujący.
Bez tego nie da się z niego zbudować jednocześnie blokady dla członka i ostrzeżenia dla koordynatora.

**Definicja ukończenia.** Nowy plik testów jednostkowych na wzór `test_fairness.py`, po jednym
przypadku pozytywnym i negatywnym na regułę, bez bazy danych.

### Z8. Wpięcie w ścieżkę zamian: blokada

Żadne z dzisiejszych wywołań nie ma potrzebnego okna.
`swaps.approve_swap` (`:568-575`) ładuje **jeden** wiersz `Assignment`, a `swaps.create_swap` (`:336`)
woła `effective_assignments` z zakresem jednodniowym.

Obie mają zamiast tego wołać `effective.effective_assignments(db, day - 10, day + 10)` - ten sam loader,
którego używa macierz kalendarza (`calendar.py:165`) i który poprawnie rozstrzyga nakładające się
publikacje.
Zakres 10 dni pokrywa okno 3-w-7 z obu stron plus granice bloku świątecznego.
Na tak wczytanym stanie podmienić slot na proponowany i puścić funkcje z `rules.py`.

- `swaps.create_swap` - walidacja wstępna, żeby wniosek nie powstawał, jeśli i tak zostanie odrzucony.
- `swaps.approve_swap` (`:560`) - walidacja rozstrzygająca, bo między prośbą a zatwierdzeniem grafik
  mógł się zmienić.

Obie zwracają `409` z nazwaną przyczyną i wskazaniem dni, których dotyczy.

**Definicja ukończenia.** Przypadek regresyjny wprost z raportu przechodzi: Magdalena Woźniak ma dyżury
22, 23 i 24 września, zamiana wstawia jej 28 września w to samo okno siedmiu dni.
Dziś przechodzi, po zmianie ma zostać odrzucona jako `three_in_seven`.
Wzór testu do skopiowania: `backend/tests/test_notification_triggers.py:30`
`test_swap_lifecycle_enqueues_notifications`, jedyna pełna ścieżka create → accept → approve
w całym zestawie.

### Z9. Wpięcie w korektę koordynatora: ostrzeżenie

`calendar.direct_override` (`:314`) ładuje dziś jeden wiersz (`:357-363`).
Ten sam zakres 10 dni, ta sama symulacja, ta sama lista naruszeń.

Różnica wobec Z8: operacja **przechodzi**, ale zwraca listę naruszeń, interfejs pokazuje ją w oknie
potwierdzenia, a fakt świadomego złamania reguły trafia do audytu przez `audit.record_audit`
(wzór już w `calendar.py`) z identyfikatorem reguły.
Utrzymuje to obietnicę z `PLAN.md` par. 6, że koordynator zmienia dowolny przydział bez approval,
i zachowuje wentyl bezpieczeństwa na sytuacje pilne o drugiej w nocy.

`ConfirmDialog` (`frontend/src/components/ConfirmDialog.tsx`) już przyjmuje `error`, więc dołożenie
listy ostrzeżeń do okna potwierdzenia w `CalendarMatrix.tsx:694-708` jest zmianą lokalną.
Ostrzeżenie ma być widoczne **zanim** koordynator kliknie potwierdzenie, a nie zamiast błędu po nim.
To ta sama wada, którą MED5-04 opisuje przy niedostępności.

`scheduling.override_draft` (`:497`) zostaje przy ostrzeżeniach, nie blokadzie, bo szkic nie jest w mocy.

**Definicja ukończenia.** Test na wzór `test_notification_triggers.py:138`
`test_direct_override_rejects_current_assignee_without_side_effects`: operacja przechodzi, lista
naruszeń jest zwrócona, wpis audytowy zawiera identyfikator reguły.

---

## 12. Z10 do Z13. Ostrzeżenia i blokady na ekranie generatora

**Defekty: HGH5-02, HGH5-06, MED5-04, MED5-11.**

### Z10. Baner konfliktów niedostępności w macierzy szkicu

`components/DraftScheduleMatrix.tsx` nie ma odpowiednika banera z `components/CalendarMatrix.tsx:339-349`
(„N osób ma dyżur w dniu zgłoszonej niedostępności”).
Dołożyć go, korzystając z tego, co backend już umie: `routes/scheduling.py:322`
`_hard_unavailability_conflicts` liczy dokładnie tę listę, tylko nie trafia do `GET /scheduling/{id}`.
Wystawić ją w `DraftScheduleResponse` obok `warnings`.

Dodatkowo:

- ukryć komunikat „Grafik spełnia wszystkie reguły twarde” (`Generator.tsx:399-406`), gdy lista jest
  niepusta, bo dziś ekran twierdzi nieprawdę;
- zablokować „Przekaż do akceptacji” z podaniem przyczyny, zamiast pozwalać kliknąć i zwracać 409;
- w komunikacie 409 przestać sugerować pełną regenerację jako jedyne wyjście, bo pojedynczą komórkę
  można naprawić korektą szkicu.

**Definicja ukończenia.** Odtworzone kroki z `docs/QA-REPORT-5.md` par. 7.1: wygeneruj szkic na listopad,
zgłoś „nie mogę” na dwa dni z przydziałem, wróć na ekran generatora.
Macierz szkicu pokazuje baner konfliktu, komunikat o spełnieniu reguł znika, przycisk jest zablokowany
z podaniem przyczyny.

### Z11. Ostrzeżenia solvera docierają do koordynatora

`SolverResult.warnings` (m.in. „Reguły rozrzedzania musiały zostać zawieszone”, `scheduler.py:732`)
trafiają dziś tylko do rekordu zadania i do audytu, bo `_schedule_response` (`:216-223`) buduje pole
`warnings` od zera z `_override_rest_warnings`.

Zapisać ostrzeżenia solvera przy grafiku i łączyć oba źródła w odpowiedzi, **rozróżnialnie**.
Dzisiejsze teksty zaczynają się od słowa „Korekta”, mimo że nikt żadnej korekty nie wykonał.
Do komunikatów dopisać nazwiska i daty, bo dane są dostępne w `RuleViolation` z Z7.

**Definicja ukończenia.** Scenariusz z par. 7.8 raportu: siedem z dziesięciu osób niedostępnych na cały
marzec 2027, generowanie kończy się `OPTIMAL` z zawieszonymi regułami, a ekran pokazuje ostrzeżenie
solvera z nazwiskami, nie komunikat o „korekcie”.

### Z12. Blokada korekty na osobę z „nie mogę”

`DraftScheduleMatrix.tsx:248` blokuje przycisk dla osoby z `unavailable`.
Opublikowana macierz nie ma tego zabezpieczenia, więc koordynator wykonuje cztery interakcje po to,
żeby dostać 422 „Osoba jest niedostępna”.
Przenieść ten sam warunek do `CalendarMatrix.tsx:681`.

### Z13. Wznowienie postępu po przeładowaniu strony

Po odświeżeniu ekran nie pokazuje trwającego zadania, mimo że w bazie ma ono `status = running`.
Dołożyć `GET /api/v1/scheduling/runs?status=running` (albo filtr po użytkowniku) i wznawiać odpytywanie
przy montowaniu ekranu Generator.
Bez tego naturalną reakcją koordynatora jest uruchomienie generowania drugi raz, co daje dwa
nierozróżnialne szkice (LOW5-09).

Przy okazji, drobne i tanie: pasek postępu stoi na 30% przez cały czas solvowania (`worker.py:139`),
więc dołożyć licznik czasu i podać budżet („do N sekund”).

---

## 13. Z14. Nowy domyślny budżet czasu i pole w ustawieniach

**Defekty: HGH5-01 i MED5-02. Wymaga Z1 i Z2.**

Dziś `SOLVE_SECONDS = 90.0` (`scheduler.py:81`), a pomiar z dwunastu przebiegów pokazuje, że budżety
1 s, 10 s, 30 s i 90 s dają tę samą raportowaną rozpiętość maksymalną (9,0 w jedenastu przypadkach,
8,0 w jednym), przy czym soczewka weekendów wychodzi **lepiej** przy 1 sekundzie.

Po Z1 i Z2 powtórzyć zamiatanie budżetu (`docs/qa-suite-5/analyze5.py`, po trzy przebiegi na budżet:
5 s, 15 s, 30 s, 60 s, 90 s) i ustawić domyślną wartość na najmniejszą, przy której wynik przestaje się
poprawiać.
Zmienić `SOLVE_SECONDS`, domyślną wartość `ONCALL_SOLVER_SECONDS` w `docker-compose.yml` i opis
w `docs/SOLVER.md:14-16`.

Niezależnie od wyniku pomiaru: dołożyć **pole budżetu czasu do panelu „Ustawienia generowania”**
(`frontend/src/screens/Generator.tsx`, obok wag).
Komunikat `UNKNOWN` w `scheduler.py:742` już dziś odsyła użytkownika słowami „zwiększ budżet czasu
w ustawieniach generowania” do kontrolki, która nie istnieje.
Pole idzie do `SchedulingPolicy` obok wag, z walidacją w `schemas.py` w zakresie 5-300 sekund.

**Definicja ukończenia.** Nowa wartość wpisana do paragrafu 3 razem z pomiarem, który ją uzasadnia.

---

## 14. Z15. Usunąć synchroniczny `POST /api/v1/scheduling/generate`

**Defekt: HGH5-04. Decyzja D4.**

Usunąć jako endpoint HTTP (`routes/scheduling.py:367`), zostawić samą funkcję do wywołania przez worker
i testy.
Budżet solvera równa się `proxy_read_timeout` w nginx (90 s w `frontend/nginx.http.conf:8`
i `nginx.https.conf:24`), więc endpoint zawsze kończy się `504`, zostawiając w bazie gotowy, ale
osierocony szkic.
Interfejs go nie używa, korzysta z `/scheduling/runs` (`frontend/src/api.ts:576`).
Testy, które dziś wołają ten endpoint, przepiąć na wywołanie funkcji.

---

## 15. Z16. Dokumentacja

**Defekty: LOW5-01, LOW5-02, LOW5-04, LOW5-08. Wymaga Z0, Z2, Z5 i Z14, bo wpisuje ich wyniki.**

- `docs/PLAN.md` par. 8: „90-dniowy grafik w skonfigurowanym budżecie czasu (domyślnie 30 sekund)”
  jest sprzeczne z par. 3 tego samego dokumentu (maksimum 35 dni) i z kodem.
  Uzgodnić.
- `docs/PLAN.md` par. 3: dopisać, na którym oknie i w którym momencie mierzone jest kryterium odbioru,
  oraz opisać mechanizm odstępstwa.
  Propozycja brzmienia: „Kryterium odbioru wynosi 3 punkty rozpiętości odchylenia, a celem
  optymalizacyjnym są 2 punkty. Mierzy się je w kroczącym oknie dwunastu miesięcy kończącym się
  ostatnim dniem szkicu, na soczewkach `primary`, `secondary`, weekendy i święta. Soczewka 11–19
  podlega kryterium wyłącznie przy kotwicy `independent`; przy kotwiczeniu jej rozkład jest w celu
  jedynie rozstrzygaczem remisów. Gdy zastana nierówność czyni kryterium nieosiągalnym, generator
  podaje najniższą osiągalną rozpiętość zamiast milczącej porażki.”
  Brak zdania o oknie jest formalną przyczyną BLK5-01.
- `docs/SOLVER.md:91-94` doprecyzować: przy kotwiczeniu soczewka 11–19 **nie znika z celu w całości**,
  tylko traci człon rozpiętości i zostaje słabym członem rozkładu, z wartością `TIE_BREAK_FRACTION`
  wybraną pomiarem.
- Docstring `_build_model` (`scheduler.py:150`) mówi „the 7-in-14-day and rest-after-run relaxation”,
  a kod realizuje 3 dyżury w 7 dniach (`:310-320`).
  Poprawić opis.
- `docs/SOLVER.md` zaktualizować o nowe okno historii generatora, nowy domyślny budżet i o to,
  że ostrzeżenia solvera docierają do ekranu.

---

## 16. Z17. Drobne

Każdy wiersz jest osobnym, niezależnym zadaniem. Kolejność od najlepszego stosunku wartości do kosztu.

| Defekt | Zmiana | Status |
| --- | --- | --- |
| MED5-09 | Lista zastępców w zamianie: przy każdym nazwisku dostępność w tym dniu, aktualne saldo w soczewce i znacznik „ma już dyżur tego dnia”. Dziś podgląd wpływu pojawia się dopiero po wyborze, więc porównanie dwóch kandydatów wymaga wybrania każdego osobno. | zrobione (opus): `SwapOptionResponse` niesie `availability` i `on_duty_that_day`, a saldo bierze się z `/swaps/impact`, który ekran i tak pobiera dla każdej opcji. Pierwsza wersja liczyła sprawiedliwość w samym `/swaps/options` i wyniosła ten endpoint z dwóch tanich zapytań do **47,7 ms p50**, na poziom `/api/v1/fairness` (44,7 ms); po przeniesieniu salda na klienta jest **7,1 ms p50**. `test_swap_options.py` (3 testy: znacznik dyżuru tego dnia, miękka preferencja bez możliwości zwrócenia „nie mogę”, brak preferencji i brak salda w odpowiedzi); `Swaps.test.tsx` sprawdza „PRIMARY -1” i „Chętnie wezmę” |
| MED5-05 | Ekran Sprawiedliwość pokazuje `0 / 0 · zgodnie z udziałem` osobie bez eligibility do roli. `DraftFairnessPanel` robi to poprawnie („nie pełni tej roli”, `:34-39`). Ujednolicić na wersję z panelu. | zrobione (opus): `FairnessCell` przyjmuje `eligible` i zwraca to samo zdanie co panel; `Fairness.test.tsx` „says so instead of reporting 0 / 0 as being in line with the fair share” |
| MED5-08 | Opis trybu tygodniowego w „Ustawieniach generowania” nie mówi, że wybór wyłącza limit 3 dyżurów w 7 dniach i dwudniowy odpoczynek. Zmierzone skutki: serie 12-dniowe, 31 okien z ponad 3 dyżurami. Dopisać ostrzeżenie przy opcji. | zrobione (opus): ostrzeżenie pokazuje się pod polem trybu po wybraniu „Tygodniowy”; treść potwierdzona w kodzie (`scheduler.py:337` i `:399` wyłączają obie reguły przy `RotationMode.weekly`) |
| MED5-03 | Panel wag: dopisać prosty przykład skutku każdej wagi i zdanie, że znaczenie ma relacja między wagami, nie wartości bezwzględne (`PLAN.md` par. 6 wymaga tego wprost). Poprawić zdanie „Wartość 0 wyłącza tylko wskazaną preferencję”, bo „Równy udział” nie jest preferencją. | zrobione (opus): każda waga ma jednozdaniowy przykład skutku, wstęp mówi „6 / 4 / 2 działa tak samo jak 3 / 2 / 1”, a zdanie o zerze mówi o członie celu, nie o preferencji |
| MED5-01 | `screens/Duty.tsx:16` uznaje niepuste `id` z `/schedules/published` za dowód publikacji, a `main.py:494` wypełnia je również z zaimportowanej historii (status `superseded`). Rozróżnić oba stany w odpowiedzi, żeby ekran nie twierdził `[OPUBLIKOWANY]` obok banera „29 dni pozostaje poza opublikowanym zakresem”. | zrobione (opus): nowe pole `is_published` (prawdziwa publikacja pokrywa co najmniej jeden widoczny dzień), `id` nadal wypełnione, bo zamiana potrzebuje celu; `test_published_flag.py` (3 testy) |
| MED5-07 | Komunikat PRECHECK „brak eligible osoby dla primary” rozróżnić na brak eligibility i zgłoszoną niedostępność. Grupować po zakresach dat: dla 7 dni jest dziś 17 pozycji, dla 35 dni byłoby do 105. | zrobione (opus): jedna pozycja na parę (rola, przyczyna) z datami zwiniętymi w zakresy przez `scheduler.date_ranges`; przyczyny brzmią „nikt nie ma eligibility do tej roli” i „wszyscy eligible zgłosili niedostępność” |
| LOW5-07 | W komunikatach PRECHECK przecieka identyfikator `late_shift`; użyć etykiety `11–19` z `frontend/src/lib/labels.ts:3-7` po stronie backendu albo mapować w UI. | zrobione (opus): `scheduler.ROLE_LABELS` odzwierciedla `labels.ts`; `grep -n 'late_shift' scheduler.py` nie pokazuje już żadnego identyfikatora w tekście komunikatu |
| LOW5-05 | Domyślny zakres macierzy to sztywne 30 dni, przez co przy jednym pokrytym dniu 29 z 30 kolumn dostaje czerwony wykrzyknik, duplikując baner powyżej. Domyślnie pokazywać zakres faktycznie pokryty. | zrobione (opus): domyślny koniec zakresu to koniec opublikowanego pokrycia (najwyżej 30 dni), a bez publikacji sam dzisiejszy dzień; przycisk „Najbliższe 30 dni” zostaje. Zapytanie o kalendarz czeka na odpowiedź o publikacji, inaczej macierz pobrałaby i narysowała jedną kolumnę, a potem przeskoczyła. `CalendarMatrix.test.tsx` (2 testy, oba sprawdzają **jedno** wywołanie `api.calendar`) |
| LOW5-06 | Trzy myślniki em wbrew konwencji reszty aplikacji: `CalendarMatrix.tsx:346`, `admin/CalendarEvents.tsx:49`, `admin/People.tsx:362`. | zrobione (opus): zamienione na zwykły myślnik; `grep -n '—' frontend/src` daje już tylko `11–19`, które jest półpauzą w nazwie zmiany |
| LOW5-13 | Import historii nie waliduje eligibility roli (wiersz `primary` dla osoby bez tej eligibility przechodzi). Okres członkostwa jest walidowany poprawnie, więc jest gdzie to dopiąć: `routes/history.py:_validate_members`. | zrobione (opus): `_validate_members` sprawdza eligibility roli w dniu dyżuru; `test_history_import_routes.py` (2 testy: odrzucenie z komunikatem „Osoba nie ma eligibility do roli PRIMARY w tym dniu” i przyjęcie roli, którą osoba pełni) |
| LOW5-10 | Brak nazwiska zalogowanej osoby w nagłówku mobilnym. | zrobione (opus): nazwisko i rola w szufladzie nawigacji, jedynym miejscu widocznym poniżej breakpointu (`.topbar-user` ma `display: none`); `AppShell.test.tsx` „names the logged-in person in the drawer” |
| LOW5-11 | Kolejność pól wag (sprawiedliwość, ciągłość, preferencje) niezgodna z deklarowaną hierarchią (sprawiedliwość, preferencje, ciągłość). | zrobione (opus): pola idą teraz w kolejności sprawiedliwość, preferencje, ciągłość |
| LOW5-15 | Zakres jednodniowy jest przyjmowany bez ostrzeżenia, choć bilansowanie na jednym dniu nie ma sensu. | zrobione (opus): ostrzeżenie pod formularzem, gdy data od równa się dacie do |
| NOWE (Z11) | Myślniki em w nagłówkach i tekście dokumentacji. Konwencja zabrania myślnika em, a LOW5-06 objęło tylko frontend. `docs/SOLVER.md:1` poprawione przy okazji Z16, reszta czeka. | zrobione (opus): wiersz był przesadzony - w `docs/PLAN.md` było **9** wystąpień, nie kilkadziesiąt, a `docs/QA-REPORT-*.md` nie miały ani jednego. Dziewięć w `PLAN.md` zamienione na zwykły myślnik. Świadomie **nie ruszone** dwa miejsca: `docs/PLAN-ROUND-4.md` (4 wystąpienia) to zapis zamkniętej rundy, a nie żywy dokument, i nie był w zakresie wiersza; `docs/PLAN-NAPRAWCZY-5.md:637` niesie ten znak wewnątrz wzorca `grep -n '—'`, więc podmiana unieważniłaby dowód z LOW5-06. `grep -rn '—' docs README.md --include=*.md` daje już tylko te dwa |
| NOWE (Z14) | `worker.py:139` ustawia postęp na 30% po `model_built` i na 90% dopiero po `solve_done`, więc pasek stoi przez cały solve. Z13 dołożył licznik sekund i budżet, ale sam pasek nadal kłamie. Rozważyć interpolację postępu po upływie budżetu. | zrobione (opus): **wariant świadomy przebiegów, nie plateau**. Mianownikiem nie jest jeden budżet, tylko suma budżetów wszystkich zapowiedzianych przebiegów: `scheduler.solve` emituje `solve_pass <sekundy>` przy każdym wywołaniu (przebieg z kryterium, awaryjny bez rozrzedzania, oraz bisekcja dna), bo pomiar z par. 3 pokazał, że przy budżecie 15 s gałąź trudna zajmuje około 25 s. Dzięki temu pasek zwalnia, gdy dochodzi kolejny przebieg, zamiast pinować na pierwszym budżecie, i nigdy nie cofa się ani nie sięga 90 przed `solve_done`. `test_worker_progress.py` (5 testów: ruch z upływem czasu, brak dosięgnięcia końca, spowolnienie po drugim przebiegu zamiast pinowania, brak budżetu, oraz integracyjny na `process_schedule_run` z podstawionym generowaniem). E2E `docs/qa-suite-5/z17_progress_check.py`: odczyty **30, 31, …, 60, 100**, monotonicznie, wobec **10 → 30 → 100** przed poprawką. Mianownikiem jest suma **budżetów**, nie faktycznych czasów przebiegów, a przebiegi kończą się wcześniej, niż mogą - dlatego pasek zaniża postęp i kończy skokiem z okolic 60 na 100. To świadomy wybór: zawyżanie byłoby gorsze. Przy okazji poprawiony napis pod paskiem, bo `solve_seconds` to budżet **na jeden przebieg**, a licznik sekund legalnie go przekracza (zmierzone: około 25 s przy budżecie 15 s); „budżet do 15 s” obok licznika pokazującego 30 wyglądałoby jak usterka |

Przy okazji Z4 warto scalić `routes/scheduling.py:274-292` `_fairness_member_response`
z `fairness_data.py:166-178` `member_response`.
To dwie kopie tej samej funkcji, które po dołożeniu flagi rozjechałyby się jeszcze bardziej.

---

## 17. Weryfikacja całości

Baza po rundzie 5 nie jest czysta, zostały w niej dowody HGH5-03 i HGH5-04.
Zacząć od odtworzenia stanu wyjściowego według `docs/QA-REPORT-5.md` par. 13, krok 1 i 2.
`check_fairness.py` musi dać sumy `481 / 481 / 251 / 212 / 18`, inaczej porównania z raportem nie mają
podstawy.

**Testy jednostkowe i integracyjne**

```bash
docker compose exec -T api pytest backend/tests -q
cd frontend && npm run test && npm run lint && npx tsc --noEmit
```

**Jakość generowania** - trzy przebiegi, szkic 28-dniowy, tryb hybrydowy, 2 workery.
`analyze5.py` liczy `max_po` po soczewkach ocenianych (`graded_lenses`), nie po wszystkich pięciu; przed poprawką soczewka 11–19 przy kotwiczeniu (około 10) przykrywała każdą różnicę:

```bash
docker compose exec -T worker python /tmp/analyze5.py \
  '[{"start":"2026-09-07","days":28,"workers":2,"seconds":90,"rep":1},
    {"start":"2026-09-07","days":28,"workers":2,"seconds":90,"rep":2},
    {"start":"2026-09-07","days":28,"workers":2,"seconds":90,"rep":3}]'
```

Kryterium: `max_po` na czterech ocenianych soczewkach najwyżej 3,0 w każdym z trzech przebiegów, wobec
dzisiejszych 9,0.
Rozpiętość 11–19 zapisać osobno jako koszt decyzji D1, bez progu.

**Rozjazd okien** - `docs/qa-suite-5/window_check.py` ma po poprawce pokazywać tę samą rozpiętość
w oknie solvera i w oknie raportu, z dokładnością do około jednego punktu wynikającą z różnych
mianowników udziału oczekiwanego.

**Reguły twarde po publikacji**

```bash
docs/qa-suite-5/verify_rules.py <id opublikowanego grafiku>
```

Po opublikowaniu grafiku, zatwierdzeniu zamiany Julia → Magdalena na 28-09-2026 i po korekcie
koordynatora skrypt ma zwracać `naruszenia: 0`.
Dziś zwraca `B5 Magdalena Woźniak: 4 dyżurów w oknie od 2026-09-22`.

**Regresja interfejsu** - `docs/qa-suite-5/axe_scan.sh / /moje /zamiany /generator /sprawiedliwosc
/raporty /import` musi nadal dawać zero naruszeń w obu motywach.

**Obciążenie** - `t_perf.py odczyt 30 10` i `t_perf.py raporty 30 10` przy
`docker update --cpus 3 oncall-api-1`.
Wartości odniesienia: 342 req/s i 87 req/s, zero błędów.
Z8 i Z9 dokładają odczyt zakresu 20 dni na każdą zamianę i korektę, więc sprawdzić, czy ścieżki zapisu
nie zwolniły.

---

### Wynik weryfikacji, 2026-09-06 (opus)

Stan wyjściowy odtworzony: `check_fairness.py` → `481 / 481 / 251 / 212 / 18`, sprawdzone przed
i po całej rundzie zmian.

| Brama | Kryterium | Wynik |
| --- | --- | --- |
| Testy jednostkowe i integracyjne | wszystkie przechodzą | **256 backendu, 103 frontendu**, `ruff check src tests`, `npm run lint`, `tsc --noEmit` czysto |
| Jakość generowania | `max_po` czterech ocenianych soczewek ≤ 3,0 w trzech przebiegach | **3,0 / 3,0 / 3,0** przy 90 s i **3,0 / 3,0 / 3,0** przy 15 s, czyli przy nowej wartości domyślnej (`docs/qa-suite-5/final-quality.jsonl`), wobec 9,0 przed rundą. Rozpiętość 11–19 jako koszt D1: **10,0 / 10,0 / 10,0** przy 15 s, 10,0-13,0 przy 90 s |
| Rozjazd okien | ta sama rozpiętość w oknie solvera i raportu, z dokładnością około 1 punktu | **rozjazd 0,00 na każdej soczewce**; oba okna to teraz dosłownie `2025-10-04 - 2026-10-04` (`window_check.py`, zaktualizowany do stanu po Z1) |
| Reguły twarde po publikacji | `verify_rules.py` → `naruszenia: 0` po publikacji, zamianie i korekcie | **0** po opublikowaniu grafiku wrześniowego, zatwierdzonej zamianie Julia → Magdalena i korekcie koordynatora. Podstawienie: w wygenerowanym grafiku Julia nie miała dyżuru 28-09-2026, więc zamiana poszła na jej pierwszy dyżur, **14-09-2026 `primary`**; sam przypadek regresyjny z raportu (`B5 Magdalena Woźniak: 4 dyżurów`) jest pokryty jako test jednostkowy w `test_swap_rules.py` z Z8. Przy okazji potwierdzona asymetria z D3: `override/check` ostrzegł przed kliknięciem (`three_in_seven` dla Anny Kowalskiej), operacja i tak by przeszła, a naruszenie trafiłoby do audytu |
| Regresja interfejsu | `axe_scan.sh` na 7 ścieżkach × 2 motywy, zero naruszeń | **0 na 14 przebiegach**. Pierwszy przebieg wykazał `color-contrast` (serious, ×3) na „nie spełnia” w motywie jasnym: domyślny `warning.main` MUI to 3,1:1 na białym. Motyw dostał własny `warning.main` `#a04e00` (5,9:1) |
| Obciążenie | `t_perf.py odczyt 30 10` i `raporty 30 10` przy 3 CPU | **odczyt 301,9 req/s** (dwa przebiegi, 300,8 i 301,9) wobec 342 odniesienia, **raporty 93,4 req/s** wobec 87; zero błędów w obu. Żaden endpoint z tych scenariuszy nie leży na ścieżkach zmienionych w tej rundzie, a ścieżki faktycznie obciążone nowymi zapytaniami zmierzono osobno: `GET /scheduling/{id}` (nowe liczenie konfliktów) p50 **9,6 ms**, `GET /scheduling/runs` (nowa lista plus polityka) p50 **4,1 ms**, przy `GET /fairness` p50 44,2 ms jako punkcie odniesienia |

Bramy powtórzone po zamknięciu Z17 na finalnym kodzie: `check_fairness.py` nadal
`481 / 481 / 251 / 212 / 18`, jakość **3,0 / 3,0 / 3,0** przy domyślnych 15 s
(`final-quality-z17.jsonl`, 11–19: 10,0 / 9,0 / 10,0), `verify_rules.py` → **0**,
`axe_scan.sh` → **0 na 14 przebiegach**, `npm run build` (czyli `tsc -b`, obejmujący pliki
testowe, w przeciwieństwie do `tsc --noEmit`), `npm run test` **106**, `npm run lint`,
`ruff check src tests` i **269 testów backendu** czysto (264 po zamknięciu Z17, 269 po domknięciu dwóch wierszy dopisanych w trakcie).

Osobno zmierzono ścieżki, którym ta runda dołożyła zapytania, bo scenariusze `t_perf.py`
ich nie obejmują: `GET /scheduling/{id}` **9,6 ms p50**, `GET /scheduling/runs` **4,1 ms p50**,
`GET /swaps/options` **7,1 ms p50**, przy `GET /api/v1/fairness` **44,7 ms p50** jako punkcie
odniesienia.

Nie zweryfikowane: repozytorium nie jest repozytorium git (`.git` jest pustym katalogiem), więc nie
ma tu ani historii, ani siatki bezpieczeństwa; `/code-review` i `/no-mistakes` nie mają na czym
działać.

---

## 18. Ryzyka

**Dryf zmian 11–19 po Z2.**
Decyzja D1 świadomie wypuszcza tę liczbę spod ścisłej kontroli i zastępuje ją rozstrzygaczem remisów,
którego siła nie jest gwarancją, tylko zmierzonym kompromisem.
Jeżeli po wdrożeniu dryf okaże się dokuczliwy, dostępne są dwa ruchy bez zmiany architektury:
podnieść `TIE_BREAK_FRACTION` kosztem marginesu na kryterium, albo przełączyć zespół na kotwicę
`independent`, przy której soczewka wraca do pełnych praw i mierzone jest 2,07 punktu.

**`TIE_BREAK_FRACTION` może nie mieć dobrej wartości.**
Możliwe, że każda wartość dająca zauważalny efekt na 11–19 wypycha `secondary` powyżej 3 punktów.
Wtedy odpowiedzią jest 0, czyli pierwotna propozycja z pełnym usunięciem soczewki, i trzeba to zapisać
jako świadomy wynik pomiaru, a nie po cichu zostawić wartość, która nic nie robi.

**Z8 i Z9 mogą zablokować dziś działające scenariusze.**
Reguły nigdy nie były egzekwowane po publikacji, więc istniejące grafiki produkcyjne mogą je już łamać.
Przed wdrożeniem puścić `verify_rules.py` na wszystkich opublikowanych grafikach i policzyć, ilu zamian
dotknęłaby nowa walidacja.
To także argument za wariantem asymetrycznym: koordynator zachowuje możliwość działania.

**Kryterium 3 punktów jest osiągane bez zapasu.**
Zmierzone 3,0 to dokładnie granica.
Przy innej obsadzie albo większym długu historycznym część szkiców nie przejdzie odbioru, a produkt nie
ma dziś czym tego pokazać.
Stąd mechanizm odstępstwa w Z5 i Z6.

**Wszystkie liczby pochodzą z jednej instancji.**
Jedna obsada dziesięcioosobowa, dwie osoby z niepełną eligibility, jedna historia.
Kierunek efektów jest strukturalny i powinien się przenosić, ale konkretne wartości nie są własnością
produktu, tylko tego zestawu danych.
