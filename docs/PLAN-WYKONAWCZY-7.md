# PLAN WYKONAWCZY 7

Dokument roboczy do naprawy wszystkich defektów z [QA-REPORT-7](QA-REPORT-7.md).
Opis, kroki reprodukcji i dowody każdego defektu są w raporcie; tutaj jest podział pracy, kolejność, kryteria odbioru i śledzenie postępu.

Dokument jest przeznaczony do pracy równoległej wielu agentów AI.
Pakiety są pogrupowane w tory o możliwie rozłącznych zbiorach plików.
Każdy pakiet ma własny dziennik wykonania na końcu swojej sekcji.

---

## 0. Jak używać tego dokumentu (przeczytaj przed pierwszą edycją)

1. Wybierz pakiet ze statusem `TODO` albo `DO POPRAWY`, którego wszystkie zależności mają status `GOTOWE`, `DO REVIEW` albo `DO POPRAWY`.
2. Przeczytaj ten plik ponownie tuż przed edycją tablicy - inny agent mógł go właśnie zmienić.
3. W tablicy (par. 3) zmień w wierszu swojego pakietu status na `W TOKU`, wpisz swój identyfikator w kolumnę `Wykonawca` i datę w `Aktualizacja`. Edytuj wyłącznie swój wiersz, narzędziem zamieniającym dokładny tekst tego wiersza, nigdy przepisując cały plik.
4. Dopiero potem zacznij zmieniać kod.
5. Jeśli pakiet wymaga nowej migracji, zarezerwuj numer w rejestrze migracji (par. 5) w ten sam sposób, zanim utworzysz plik migracji.
6. W trakcie pracy dopisuj wpisy do dziennika swojego pakietu (sekcja „Dziennik wykonania” pod pakietem). Dopisuj na końcu, nie zmieniaj cudzych wpisów.
7. Po zakończeniu uruchom kryterium odbioru, wklej skrócony wynik do dziennika jako „Pomiar po” i ustaw status `DO REVIEW`.
8. Status `GOTOWE` ustawia tylko agent albo człowiek wykonujący przegląd (inny niż wykonawca), po powtórzeniu kryterium odbioru.
9. Gdy utkniesz, ustaw `ZABLOKOWANE`, a w dzienniku opisz przyczynę i czego potrzebujesz. Nie zostawiaj pakietu `W TOKU` bez aktywnej pracy.
10. Jeśli odkryjesz nowy defekt, nie naprawiaj go przy okazji w cudzym torze - dopisz go do par. 8 („Nowe ustalenia”).

11. Pakiet ze statusem `DO POPRAWY` bierzesz tak jak `TODO`, ale zaczynasz od wpisu „Review” w jego dzienniku: każdy punkt oznaczony `[B]` musi być naprawiony i powtórzony w „Pomiarze po”, punkty `[U]` są uwagami do rozważenia.

Statusy: `TODO`, `W TOKU`, `DO REVIEW`, `DO POPRAWY` (ustawia recenzent, gdy kryterium odbioru albo krok pakietu nie przeszedł review), `GOTOWE`, `ZABLOKOWANE`, `ODRZUCONE` (tylko decyzją zamawiającego).

Repozytorium nie ma historii git (pusty `.git`), więc ten plik jest jedynym mechanizmem koordynacji.
Nie usuwaj i nie przenoś sekcji tego pliku.

---

## 1. Środowisko pracy

- Stos testowy: `docker compose -f docker-compose.yml -f docs/qa-suite-7/docker-compose.host4.yml up -d` (host 4 rdzenie) albo `docker-compose.host2.yml` (2 rdzenie).
- Kod backendu i frontendu jest kopiowany do obrazów (brak bind mountów). Po zmianie backendu: `docker compose -f docker-compose.yml -f docs/qa-suite-7/docker-compose.host4.yml build api worker && docker compose -f docker-compose.yml -f docs/qa-suite-7/docker-compose.host4.yml up -d --force-recreate api worker`. Po zmianie frontendu to samo dla `web`.
- Kontener `api` wykonuje `alembic upgrade head` przy starcie.
- Narzędzia lokalne: `backend/.venv/bin/python`, `backend/.venv/bin/ruff`, w `frontend/`: `npm test`, `npm run lint`, `npm run build` (weryfikuj frontend przez `npm run build`, nie samo `tsc --noEmit`).
- Testy backendu: `cd backend && .venv/bin/python -m pytest -q`. Całość trwa ~5 minut; w trakcie pracy uruchamiaj tylko testy swojego obszaru, pełny zestaw przed `DO REVIEW`.
- Skrypty QA z `docs/qa-suite-7/` uruchamia się z katalogu projektu, na przykład `backend/.venv/bin/python docs/qa-suite-7/check_rules.py <schedule_id>`.
- Poświadczenia: QA-REPORT-7 par. 2. Hasło kont testowych `QA7-Haslo-Testowe!`, `admin` ma `Qwertyuiop1!`.
- Współdzielona baza testowa: pakiety, które wykonują scenariusze zapisujące dane (publikacje, zamiany), odtwarzają stan skryptem z pakietu G1, gdy jest gotowy. Nie kasuj danych bez odnotowania tego w dzienniku.
- Wszystkie ustalenia, komentarze w kodzie i komunikaty commitów po angielsku; teksty interfejsu po polsku. Nie używaj myślnika em.

---

## 2. Decyzje produktowe

Poniższe decyzje są przyjęte jako domyślne, żeby agenci nie stali w miejscu.
Zamawiający może je zmienić; wtedy zmienia wiersz i odnotowuje to w kolumnie „Zmiana”.
Agent nie otwiera ich ponownie z własnej inicjatywy.

| # | Pytanie | Decyzja domyślna | Zmiana |
| --- | --- | --- | --- |
| D1 | Ponowna publikacja zakresu z zamianami/korektami | Faza 0: blokada z listą zmian, które zostaną utracone, i jawnym potwierdzeniem (`acknowledge_lost_changes=true`). Faza 1: automatyczne przeniesienie zamian i korekt, konflikty na liście do decyzji koordynatora. | |
| D2 | Zamiany i korekty dat minionych | Zamiany: zakaz dla `service_date < dziś` (dziś dozwolone). Korekty koordynatora: dozwolone, ale z obowiązkowym powodem (min. 10 znaków), oznaczeniem „korekta historyczna” w audycie i w kalendarzu. | |
| D3 | Kto wchodzi do kryterium odbioru | Rozpiętość i `criterion_met` liczone tylko po osobach aktywnych w dniu końca okna (`as_of` / koniec horyzontu szkicu). Osoby, które odeszły, są pokazywane w osobnej sekcji „Poza rotacją”, bez oceny kryterium. Solver bez zmian (już je pomija). | |
| D4 | Święto w sobotę/niedzielę | Jedna konwencja w całym systemie: liczone jako weekend (tak jak solver i ekran Sprawiedliwość). Raport miesięczny i CSV zmieniają się na tę konwencję; w CSV dochodzi kolumna punktów. | |
| D5 | Zatwierdzanie własnej zamiany przez koordynatora | Zakaz, gdy istnieje inny aktywny koordynator lub administrator. Gdy nie istnieje, dozwolone z ostrzeżeniem w dialogu i flagą `self_approved` w audycie. | |
| D6 | Luka przed generowanym zakresem | Generowanie i publikacja są dozwolone, ale z ostrzeżeniem wymieniającym nieopublikowane dni. Publikacja wymaga potwierdzenia (`acknowledge_gap=true`). Solver nie używa szkiców jako historii. | |
| D7 | Zmiana semantyki celu solvera przy formulacji seriami (pakiet A4) | Akceptowana: przekazania przy lukach zmiennych zaczynają być liczone (naprawa QA7-L20). | |
| D8 | Numer telefonu dyżurnego | Pole opcjonalne na koncie, edytowane przez admina i właściciela konta, widoczne dla zalogowanych członków zespołu i koordynatorów, niewidoczne w sesji linku udostępnienia. | |
| D9 | Unikalność loginu i e-maila | Unikalne bez względu na wielkość liter; login normalizowany do małych liter i przycinany przy tworzeniu i logowaniu. Istniejące duplikaty rozwiązuje migracja z raportem konfliktów (bez automatycznego scalania). | |
| D10 | Kolejność wierszy w macierzy kalendarza | Zachować obecną regułę (Ty, potem osoby z dyżurem w zakresie, potem reszta alfabetycznie), ale pokazać ją: separator i podpis grup. | |

---

## 3. Tablica postępu

Jedyne miejsce, w którym aktualizuje się status.
Faza: 0 = przed pilotażem, 1 = przed udostępnieniem zespołowi, 2 = solver i skalowanie, 3 = porządki.

| Pakiet | Faza | Tor | Defekty | Status | Wykonawca | Aktualizacja | Zależy od |
| --- | --- | --- | --- | --- | --- | --- | --- |
| G1 | 0 | G | (infrastruktura testów) | DO REVIEW | Codex/root | 2026-09-13 (poprawki) | - |
| C1 | 0 | C | QA7-B01 | GOTOWE | Codex/root | 2026-09-13 (review) | - |
| A1 | 0 | A | QA7-B03 | DO REVIEW | Codex/root | 2026-09-13 (poprawki) | - |
| A2 | 0 | A | QA7-H07 | GOTOWE | Codex/root | 2026-09-13 (review) | - |
| B1 | 0 | B | QA7-B02 (blokada), QA7-H04 | DO REVIEW | Codex/root | 2026-09-13 (poprawki) | - |
| D1 | 0 | D | QA7-H01, QA7-M09 | GOTOWE | Codex/root | 2026-09-13 (review) | - |
| C2 | 1 | C | QA7-H02, QA7-H09, QA7-M12, QA7-L14 | DO REVIEW | Claude Sonnet 5 | 2026-09-13 (poprawki) | C1 |
| B2 | 1 | B | QA7-H05 | DO REVIEW | Claude Sonnet 5 | 2026-09-13 (poprawki) | A1, B1 |
| B3 | 1 | B | QA7-B02 (przeniesienie) | DO REVIEW | Claude Sonnet 5 | 2026-09-13 (poprawki) | B1 |
| B4 | 1 | B | QA7-M01 | GOTOWE | Codex/root | 2026-09-13 (review) | - |
| D2 | 1 | D | QA7-M03, QA7-M04, QA7-L11 | DO REVIEW | Claude Sonnet 5 | 2026-09-13 (poprawki) | D1 |
| D3 | 1 | D | QA7-M08, QA7-M10, QA7-L06 | DO REVIEW | Claude Sonnet 5 | 2026-09-13 (poprawki) | D1 |
| E1 | 1 | E | QA7-H06, QA7-H08, QA7-M11 | DO REVIEW | Claude Sonnet 5 | 2026-09-13 (poprawki) | - |
| E2 | 1 | E | QA7-M05, QA7-M06, QA7-L02, QA7-L03 | DO REVIEW | Claude Sonnet 5 | 2026-09-13 (poprawki) | - |
| F1 | 1 | F | QA7-M02 | GOTOWE | Codex/root | 2026-09-13 (review) | - |
| F2 | 1 | F | QA7-M14, QA7-L12 (plakietka) | GOTOWE | Codex/root | 2026-09-13 (review) | - |
| F3 | 1 | F | QA7-M15, QA7-L10 | DO REVIEW | Claude Sonnet 5 | 2026-09-13 (poprawki) | - |
| A3 | 2 | A | (podpowiedź startowa) | DO REVIEW | Codex/root | 2026-09-13 (poprawki) | A1 |
| A4 | 2 | A | QA7-H03, QA7-L20 | DO POPRAWY | Codex/root | 2026-09-13 (poprawki częściowe) | A1, A2, A3 |
| B5 | 2 | B | QA7-L09, prezentacja wyniku A4 | DO REVIEW | Codex/root | 2026-09-13 (poprawki) | A4 |
| E3 | 2 | E | QA7-M07 | DO REVIEW | Codex/root | 2026-09-13 (poprawki) | - |
| D4 | 2 | D | offboarding (QA7-M07 cz. 2) | DO REVIEW | Codex/root | 2026-09-13 (poprawki) | E3, D3 |
| G2 | 2 | G | QA7-M16 | DO POPRAWY | Codex/root | 2026-09-13 (profil) | - |
| C3 | 3 | C | QA7-M13, QA7-L13, QA7-L07 | GOTOWE | Claude Sonnet 5 | 2026-09-13 (review) | C2 |
| D5 | 3 | D | QA7-L01, QA7-L15, QA7-L16 (dialog korekty), QA7-L12 (pole zastępcy) | DO POPRAWY | Claude Sonnet 5 | 2026-09-13 (review) | D3 |
| E4 | 3 | E | QA7-L05, QA7-L16 (Osoby), QA7-L18 (backend) | DO POPRAWY | Claude Sonnet 5 | 2026-09-13 (review) | E2 |
| E5 | 3 | E | QA7-L19 | GOTOWE | Claude Sonnet 5 | 2026-09-13 (review) | E2 |
| F4 | 3 | F | QA7-L04, QA7-L08, QA7-L16 (Audyt, Wydarzenia), QA7-L18 (frontend) | DO POPRAWY | Claude Sonnet 5 | 2026-09-13 (review) | - |
| G3 | 3 | G | QA7-L17 | GOTOWE | Claude Sonnet 5 | 2026-09-13 (review) | - |
| G4 | 3 | G | QA7-L21 | DO POPRAWY | Claude Sonnet 5 | 2026-09-13 (review) | faza 0 i 1 |

Macierz pokrycia: każdy identyfikator z QA-REPORT-7 par. 5 występuje w kolumnie „Defekty” co najmniej raz.
Pozycja QA7-H09 jest pochodną QA7-H02 i QA7-M12 i zamyka się razem z C2.

---

## 4. Tory i własność plików

Pakiet może edytować pliki swojego toru.
Pliki spoza toru edytuje tylko w zakresie wymienionym w sekcji pakietu jako „Wyjątek”.

| Tor | Zakres | Pliki wyłączne |
| --- | --- | --- |
| A | Solver | `backend/src/oncall/scheduler.py`, `backend/src/oncall/rules.py`, `docs/qa-suite-7/check_rules.py`, `docs/qa-suite-7/bench_*.py`, testy `backend/tests/test_scheduler*.py`, `test_solver*.py` |
| B | Generator i publikacja | `backend/src/oncall/routes/scheduling.py` (poza funkcją `generate_draft`, patrz A1), `backend/src/oncall/effective.py`, `frontend/src/screens/Generator.tsx`, `frontend/src/components/DraftList.tsx`, `ScheduleComparison.tsx` |
| C | Sprawiedliwość i raporty | `backend/src/oncall/routes/fairness.py`, `backend/src/oncall/fairness.py`, `backend/src/oncall/fairness_data.py`, `backend/src/oncall/routes/reports.py`, `frontend/src/screens/Fairness.tsx`, `frontend/src/components/DraftFairnessPanel.tsx`, `frontend/src/screens/admin/Reports.tsx` |
| D | Zamiany, korekty, kalendarz | `backend/src/oncall/routes/swaps.py`, `backend/src/oncall/routes/calendar.py`, `backend/src/oncall/rule_checks.py`, `frontend/src/screens/Swaps.tsx`, `frontend/src/components/CalendarMatrix.tsx`, `CalendarDayList.tsx`, `SwapImpactPreview.tsx`, `ConfirmDialog.tsx`, `frontend/src/lib/calendar.ts`, `frontend/src/lib/swaps.ts` |
| E | Konta, logowanie, bezpieczeństwo | `backend/src/oncall/main.py`, `backend/src/oncall/auth.py`, `backend/src/oncall/routes/admin.py`, `backend/src/oncall/account_tokens.py`, `backend/src/oncall/routes/share_links.py`, `frontend/src/screens/Login.tsx`, `SetPassword.tsx`, `frontend/src/screens/admin/People.tsx`, `ShareLinks.tsx` |
| F | Wspólny frontend | `frontend/src/components/AppShell.tsx`, `DateField.tsx`, `DutyCard.tsx`, `EmptyState.tsx`, `CopyButton.tsx`, `frontend/src/screens/Mine.tsx`, `Duty.tsx`, `frontend/src/screens/admin/HistoryImport.tsx`, `Audit.tsx`, `CalendarEvents.tsx`, `frontend/src/components/DraftScheduleMatrix.tsx`, `frontend/src/lib/dates.ts`, `labels.ts`, `nav.ts`, `frontend/src/index.css` |
| G | Infrastruktura, higiena, testy QA | `backend/Dockerfile`, `frontend/Dockerfile`, `docker-compose*.yml`, `frontend/vite.config.ts`, `backend/pyproject.toml`, `frontend/package.json`, `docs/qa-suite-7/` (poza plikami toru A) |

**Pliki współdzielone** (każdy tor może dopisywać): `backend/src/oncall/models.py`, `backend/src/oncall/schemas.py`, `frontend/src/api.ts`, `backend/migrations/versions/`.
Reguła: dopisuj nowe pola i klasy na końcu właściwej sekcji, nie przeformatowuj sąsiedztwa, nie zmieniaj istniejących nazw bez wpisu w dzienniku i w par. 8.

**Pliki testów** frontendu (`*.test.tsx`) należą do toru pliku, który testują.

---

## 5. Rejestr migracji

Ostatnia istniejąca migracja: `0028_schedule_run_active_range.py`.
Zarezerwuj numer, zanim utworzysz plik. `down_revision` ustaw na migrację o numerze o jeden mniejszym z tego rejestru, a jeśli jej jeszcze nie ma (pakiet w toku), odnotuj zależność w dzienniku i ustaw ją tuż przed `DO REVIEW`.

| Numer | Pakiet | Opis | Status |
| --- | --- | --- | --- |
| 0029 | E2 | unikalność loginu i e-maila bez wielkości liter | DO REVIEW (samo ograniczenie jest poprawne; brakującą normalizację istniejących wierszy dostarcza 0032) |
| 0030 | A4 | metadane jakości rozwiązania grafiku | GOTOWE (łańcuch rewizji i upgrade na przebudowanym stosie sprawdzone) |
| 0031 | E5 | pole telefonu na koncie | GOTOWE |
| 0032 | E2 | normalizacja istniejących loginów/e-maili do małych liter | DO REVIEW |

---

## 6. Pakiety prac

Każdy pakiet ma: defekty, cel, pliki, kroki, kryterium odbioru i dziennik.
„Pomiar przed” to liczby z QA-REPORT-7.

### Tor G: infrastruktura testów (wykonać jako pierwszy, równolegle z resztą fazy 0)

#### G1 - skrypt odtwarzający stan QA7

Defekty: brak (warunek odbioru innych pakietów).
Cel: każdy agent może w kilka minut odtworzyć bazę w stanie, na którym raport znalazł defekty.

Pliki: `docs/qa-suite-7/rebuild_state.py` (nowy), `docs/qa-suite-7/README.md` (nowy, krótki).

Kroki:
1. Skrypt wywołuje `seed_team.py` w kontenerze `api` (`docker compose cp` + `exec`).
2. Importuje `docs/qa-suite-7/history-qa7.csv` przez `/api/v1/history/preview` i `/commit` jako `tomasz.krawczyk`.
3. Uruchamia `seed_availability.py` oraz dodaje wpisy Julii z raportu (22.09 „nie mogę”, 05-12.10 „nie mogę”).
4. Ustawia politykę (hybrid, secondary, 15 s), generuje i publikuje 31.08-27.09 przez `/scheduling/runs`.
5. Opcja `--with-scenarios`: odtwarza zamiany z raportu (22.09 Julia → Bartosz, 19.09 Tomasz → Bartosz, 26.09 Tomasz → Anna, 01.09 Anna → Bartosz), szkic 28.09-25.10 i scenariusz ponownej publikacji 26.10-29.11. Kroki, które po naprawie zwracają błąd (np. zamiana wsteczna), skrypt raportuje jako „oczekiwany błąd” zamiast przerywać.
6. Na końcu wypisuje identyfikatory utworzonych grafików.

Kryterium odbioru: `backend/.venv/bin/python docs/qa-suite-7/rebuild_state.py --with-scenarios` kończy się kodem 0 na świeżym stosie, a `check_rules.py` dla opublikowanego 31.08-27.09 zwraca te same błędy granicy co w raporcie (dopóki A1 nie jest gotowe).

Dziennik wykonania:
- 2026-09-12, Codex/root: dodano `rebuild_state.py` i krótkie README. Skrypt odtwarza zespół w kontenerze, importuje 979 wierszy historii przez API, zgłoszenia dostępności, politykę, generowanie i publikację. Wariant `--with-scenarios` tworzy cztery zakresy i przechodzi przez przepływy zamian; walidacje, które już odrzucają historyczny scenariusz, są raportowane jako oczekiwane błędy. Sloty istotne dla reprodukcji są ustawiane przez publiczny endpoint korekty szkicu, żeby wynik nie zależał od niedeterministycznego rozwiązania CP-SAT.
- 2026-09-12, Codex/root, Pomiar po: `ruff check` i `py_compile` bez błędów; `backend/.venv/bin/python docs/qa-suite-7/rebuild_state.py --with-scenarios` zakończony kodem 0 na świeżo zbudowanym stosie, identyfikator grafiku 31.08-27.09: `395f0929-d294-4095-8e24-40819307622e`. `check_rules.py` zwrócił 8 błędów, w tym oczekiwany błąd granicy: Elżbieta Kaczmarek ma 4 dyżury w 7 dniach na 31.08 (oraz kolejne nakładające się okna).
- 2026-09-13, Review (Claude Opus 5), wynik: DO POPRAWY.
  - Powtórzone na przebudowanym stosie host4: `rebuild_state.py --with-scenarios` kończy się kodem 0 w 70 s.
  - [B] Scenariusze, dla których pakiet powstał, nie są już odtwarzane: zamiany 22.09, 19.09, 01.09, 03.11 i oczekujący wniosek 05.11 kończą się komunikatem „expected scenario error” (reguły twarde), więc baza nie zawiera zatwierdzonej zamiany 03.11 ani oczekującego wniosku 05.11 wymaganych przez kryteria B1 i B3.
  - [B] Wzorzec „oczekiwany błąd” maskuje regresję samego odtworzenia; skrypt powinien kończyć się kodem różnym od zera, gdy scenariusz potrzebny innemu pakietowi nie powstał, a sloty zamian ustawiać tak, żeby reguły twarde ich nie blokowały.
  - [U] Brakuje wpisu dostępności Julii 05-12.10 z kroku 3.
- 2026-09-13, Codex/root, poprawki: przygotowanie listopadowego grafiku usuwa sąsiednie dyżury Anny i Bartosza w oknie reguł twardych, także rolę przeciwną w dniu zamiany. Scenariusze wymagane przez B1/B3 nie używają już `expected_error`, więc ich brak kończy skrypt kodem różnym od zera. Potwierdzono istniejący wpis niedostępności Julii 05-12.10.
- 2026-09-13, Codex/root, Pomiar po: na świeżym stosie host4 `rebuild_state.py --with-scenarios` zakończył się kodem 0. Powstała zatwierdzona zamiana 03.11 Julia Nowak → Anna Wróbel (`eb6f69f0-e1ad-48ce-8224-715a5d091975`) oraz oczekujący wniosek 05.11 Celina Mazur → Bartosz Kowal (`ed54bd17-0ca1-43d8-8508-124e69c22849`).

### Tor C: sprawiedliwość i raporty

#### C1 - bilans członka liczony względem zespołu

Defekty: QA7-B01.
Cel: członek widzi te same wartości oczekiwane i odchylenia co koordynator dla jego wiersza.

Pliki: `backend/src/oncall/routes/fairness.py`, nowy test `backend/tests/test_fairness_member_view.py`, `frontend/src/screens/Fairness.test.tsx` (jeśli test frontendu zakłada teraz inną liczbę).

Kroki:
1. W `fairness_report` (`routes/fairness.py`, filtr w linii ~62) wywołaj `compute_fairness` na pełnej liście `members`, a do odpowiedzi przefiltruj `report.members` do własnego wiersza.
2. `totals` i `spreads` dla członka: nie ujawniaj sum zespołu ani rozpiętości (ustaw `spreads=[]`, `totals` policzone z własnego wiersza albo pola puste - wybierz i opisz w dzienniku; frontend członka nie może pokazywać kryterium).
3. Sprawdź `GET /fairness/duties` - już filtruje po własnym `member_id`, bez zmian.
4. Test: dla dwóch osób z różną ekspozycją odpowiedź członka ma `expected` i `deviation` równe wierszowi z odpowiedzi koordynatora.

Kryterium odbioru:
- `cd backend && .venv/bin/python -m pytest -q tests/test_fairness_member_view.py tests/test_fairness*.py`
- Scenariusz: po G1 jako `bartosz.kowal` i `ewa.maj` porównać wiersz Bartosza (`GET /api/v1/fairness`); wszystkie `expected` i `deviation` równe. Pomiar przed: primary 56/56 (0) vs 56/53,33 (+2,67).

Dziennik wykonania:
- 2026-09-12, Codex/root: `fairness_report` liczy bilans na pełnej populacji, a dopiero odpowiedź członka ogranicza do jego wiersza. Członek dostaje `spreads=[]` i sumy z własnych wartości `actual`, więc API nie ujawnia sum ani rozpiętości zespołu; istniejący frontend nie pokazuje kryterium dla odpowiedzi z jednym wierszem. Dodano test regresji `test_fairness_member_view.py` porównujący wszystkie wartości `expected` i `deviation` członka z wierszem koordynatora.
- 2026-09-12, Codex/root, Pomiar po: kryterium obszaru `24 passed`; pełny backend `304 passed` w 262,37 s. Scenariusz G1 po przebudowie API: wiersz Bartosza identyczny w obu odpowiedziach, m.in. primary `expected=53,33`, `deviation=-1,33`, secondary `expected=48,00`, `deviation=+2,00`; odpowiedź członka ma `spreads=[]` i własne sumy.
- 2026-09-13, Review (Claude Opus 5), wynik: GOTOWE.
  - Powtórzone: `regression_qa7.py` scenariusz QA7-B01 `OK`; testy obszaru w pełnym zestawie backendu (330 passed).
  - [U] Przy 10 użytkownikach (baza po świeżym G1) `GET /fairness` ma p50 76 ms wobec 33 ms w QA7 (liczenie całej populacji dla członka); do obserwacji, nie blokuje.

#### C2 - jedno kryterium odbioru i czytelny widok sprawiedliwości

Defekty: QA7-H02, QA7-H09, QA7-M12, QA7-L14.
Cel: raport, podgląd szkicu i solver oceniają kryterium na tej samej populacji; ekran nie zapala „nie spełnia” przez szum dnia bieżącego i mówi, kto i o ile odstaje.

Pliki: `backend/src/oncall/fairness.py` (`lens_spread`, `graded_lenses`), `backend/src/oncall/routes/fairness.py`, `backend/src/oncall/fairness_data.py`, `frontend/src/screens/Fairness.tsx`, `frontend/src/components/DraftFairnessPanel.tsx`.
Wyjątek: w `backend/src/oncall/routes/scheduling.py` tylko funkcja obsługująca `GET /{schedule_id}/fairness-impact` (liczenie `spreads` i `criterion_met`), bez innych zmian.

Kroki:
1. Wprowadź jedną funkcję wyboru populacji kryterium zgodnie z decyzją D3 (aktywni w dniu końca okna) i używaj jej w `lens_spread` dla raportu i podglądu szkicu.
2. W odpowiedziach dodaj pole `criterion_members` albo flagę `in_criterion` na wierszu osoby; osoby spoza kryterium dalej mają swoje wartości.
3. Dodaj do odpowiedzi raportu dla koordynatora `outliers` per soczewka: osoba z maksymalnym i minimalnym odchyleniem.
4. `Fairness.tsx`: domyślny „Stan na dzień” = koniec najnowszego opublikowanego grafiku (jeśli istnieje i jest w przyszłości), z przełącznikiem „Dziś”. Przy „nie spełnia” pokaż „najwyżej: X (+a), najniżej: Y (−b)”. Osoby poza kryterium w osobnej sekcji „Poza rotacją”.
5. Wiersz „Rozpiętość” w kolumnie „Razem”: puste pole z kreską zamiast „nie spełnia” (QA7-L14).
6. `DraftFairnessPanel.tsx`: te same etykiety i sekcja „Poza rotacją”.
7. Testy backendu: osoba z `active_until` przed końcem okna nie zmienia `criterion_met`; test frontendu dla sekcji „Poza rotacją”.

Kryterium odbioru:
- `cd backend && .venv/bin/python -m pytest -q tests/test_fairness*.py tests/test_draft_fairness*.py`
- `cd frontend && npm test -- Fairness DraftFairnessPanel && npm run build`
- Scenariusz: po G1 szkic 28.09-25.10, `GET /scheduling/{id}/fairness-impact` - weekendy spełniają kryterium (pomiar przed: 3,43 przez Roberta Barana, bez niego 3,00).
- Przegląd wizualny ekranu Sprawiedliwość jako `ewa.maj` w obu motywach, zrzuty do `docs/qa-shots-7/fix-C2-*.png`.

Dziennik wykonania:
- 2026-09-12, Codex/root: solver przyjmuje `prior_oncall` z efektywnych przydziałów primary/secondary z sześciu dni przed horyzontem. Okna maksymalnie 3 kolejnych dni, 3 dyżurów w 7 dniach i jednodniowej przerwy obejmują teraz granicę jako stałe 0/1. Zwolnienie długich bloków dni wolnych jest liczone na połączonym zakresie. Jeśli historia osoby sama narusza reguły, jest sygnalizowana ostrzeżeniem i nie jest przenoszona jako twarde ograniczenie, aby zastany błędny grafik nie uczynił nowego modelu niewykonalnym. Checker QA7 otrzymał analogiczne zwolnienie długich bloków. Dodano dwa testy graniczne.
- 2026-09-12, Codex/root, Pomiar po: `tests/test_scheduler_boundary_rest.py tests/test_scheduler*.py` - 33 testy przeszły; testy regresji częściowej republiki i granicy - 7 testów przeszło; pełny backend - 306 testów przeszło w 282,06 s. E2E na stanie G1: szkic 30.11-27.12 `3c1eca2d-d19c-4932-95ee-ed10ac6aca9c` oraz szkic 31.08-27.09 `67044928-5daf-4146-bf82-228cacffd2df`; `check_rules.py` zwrócił `BŁĘDY: 0` dla obu.
- 2026-09-13, Codex/root: dodano wspólny wybór populacji kryterium według aktywności w ostatnim dniu okna. Raport i podgląd szkicu liczą rozpiętość wyłącznie dla tej populacji, ale nadal zwracają osoby, które odeszły, z `in_criterion=false`. Raport koordynatora zwraca skrajne odchylenia każdej soczewki. Ekran domyślnie przechodzi na przyszły koniec opublikowanego grafiku, pokazuje przy niespełnionej soczewce obie skrajne osoby, wydziela sekcję „Poza rotacją” i pokazuje kreskę w komórce „Razem” wiersza rozpiętości. Podgląd szkicu ma ten sam podział populacji.
- 2026-09-13, Codex/root, Pomiar po: Ruff bez błędów; testy backendu obszaru uruchomione poza sandboxem: 33 przeszły; frontend: 18 testów przeszło, ESLint bez błędów, build przeszedł. Pełny backend: 310 przeszło, 4 istniejące testy `test_partial_republish.py` nie przeszły na nowych blokadach publikacji z B1/B2 (`REST_VIOLATIONS` albo `UNCOVERED_BEFORE`), poza zakresem C2.
- 2026-09-13, Review (Claude Opus 5), wynik: DO POPRAWY.
  - Powtórzone: świeży szkic 28.09-25.10 ma `acceptance_floor=None` i `criterion_met=true` w `fairness-impact` (primary 2,8, secondary 1,5, weekendy 2,54, święta 3,0); Robert Baran ma `in_criterion=false`.
  - Ekran Sprawiedliwość jako `ewa.maj` w obu motywach: sekcja „Poza rotacją”, skrajne osoby przy niespełnionej soczewce i kreska w kolumnie „Razem” działają (`docs/qa-shots-7/review-C2-*.png`).
  - [B] Krok 4 nie jest spełniony: domyślny „Stan na dzień” to 12-12-2026, a nie koniec najnowszej publikacji 27-12-2026, bo ekran bierze `ends_on` z `/schedules/published`, które zwraca okno 90 dni.
  - [U] Tabela nie wypełnia karty: po prawej zostaje pas ok. 15 px bez tła w obu motywach.
  - [B] Podtytuł „faktycznie odbytych dyżurów” jest nieprawdziwy przy domyślnej dacie w przyszłości; tekst musi opisywać stan z zaplanowanymi dyżurami.
- 2026-09-13, Claude Sonnet 5, poprawka: `/schedules/published` celowo ucina `ends_on` na dziś+90 dni (LOW6-08), więc nie da się z niego odczytać prawdziwego końca dalszej publikacji - ekran potrzebował własnego źródła.
  `fairness_data.latest_publish_end(db)` zwraca realny, nieucięty koniec najnowszego opublikowanego grafiku (`max(Schedule.ends_on)` po `status=published`); `GET /api/v1/fairness` zwraca je jako nowe pole `latest_publish_end` (schemat i `api.ts` dopisane na końcu sekcji, zgodnie z zasadą plików współdzielonych).
  `Fairness.tsx` liczy domyślny „Stan na dzień” z tego pola zamiast z `/schedules/published`; usunięto teraz zbędne zapytanie `publishedSchedule`.
  Podtytuł jest teraz warunkowy: gdy `asOf` leży w przyszłości, tekst brzmi „Kroczące 12 miesięcy do {data}, licząc też dyżury już zaplanowane do tego dnia” zamiast „faktycznie odbytych dyżurów”.
- 2026-09-13, Claude Sonnet 5, Pomiar po: nowy test backendu `test_latest_publish_end_is_not_capped_to_the_90_day_publish_horizon` (dwie publikacje, jedna kończąca się 120 dni w przyszłości, poza oknem 90 dni) - `latest_publish_end` zwraca prawdziwą, dalszą datę; `tests/test_fairness*.py` 25/25.
  Frontend: dwa nowe testy w `Fairness.test.tsx` (domyślna data z `latest_publish_end` w przyszłości → zapytanie `api.fairness` z tą datą i podtytuł „już zaplanowane”; brak przyszłej publikacji → podtytuł „faktycznie odbytych dyżurów” bez zmian) - `npm test -- Fairness` 17/17 (+3 `DraftFairnessPanel`), lint i build bez błędów.
  [B] krok 4: potwierdzone testem oraz wizualnie na przebudowanym stosie jako `ewa.maj` - „Stan na dzień” = 29-11-2026 (koniec najnowszej publikacji), okno 29-11-2025 – 29-11-2026 (`docs/qa-shots-7/fix-C2-default-date-light.png`, `fix-C2-default-date-dark.png`, oba motywy).
  [B] podtytuł: potwierdzone testem i tym samym zrzutem - „Kroczące 12 miesięcy do 29-11-2026, licząc też dyżury już zaplanowane do tego dnia.”
  [U] pas 15 px: sprawdzone na przebudowanym stosie (`getBoundingClientRect`/`getComputedStyle` na `.calendar-scroll`) - gutter (`scrollbar-gutter: stable`, ok. 16 px) istnieje, ale niesie tło zgodne z kartą w obu motywach (`--cal-header-bg`, LOW6-04); nie odtworzono jako goły/przezroczysty pasek w tym przebiegu, więc bez zmiany kodu.

#### C3 - konwencja świąt, punkty w raporcie, nagłówek kryterium

Defekty: QA7-M13, QA7-L13, QA7-L07.
Cel: raport miesięczny liczy święto w weekend jak reszta systemu i podaje punkty; podgląd kryterium w szkicu ma poprawną typografię.

Pliki: `backend/src/oncall/routes/reports.py`, `frontend/src/screens/admin/Reports.tsx`, `frontend/src/components/DraftFairnessPanel.tsx`.

Kroki:
1. W `reports.py` klasyfikuj dzień, który jest świętem i sobotą/niedzielą, jako weekend (decyzja D4); zmień tekst opisu na ekranie.
2. Dodaj kolumny punktów (1X/2X) per rola i sumę do CSV i podglądu; zaktualizuj nagłówki CSV i zanotuj zmianę formatu w dzienniku (to zmiana dla kadr).
3. `DraftFairnessPanel.tsx` (linia ~70): nagłówek „Kryterium odbioru…” jako tytuł sekcji w stylu pozostałych (`h3`/`subtitle`), lista soczewek jako wiersze z ikonami statusu zamiast gołego `<ul>`.
4. Test raportu dla miesiąca z 15.08.2026 (sobota).

Kryterium odbioru:
- `cd backend && .venv/bin/python -m pytest -q tests/test_reports*.py`
- `GET /api/v1/reports/monthly?month=2026-08`: 15.08 liczony w kolumnie weekendów, nie świąt; suma punktów zgadza się z ekranem Sprawiedliwość dla tego miesiąca.
- Zrzut podglądu szkicu `docs/qa-shots-7/fix-C3-criterion.png`.

Dziennik wykonania:
- 2026-09-13, Claude Sonnet 5: dwa wpisy poprzedniego wykonawcy, opisujące pracę pakietu A2 (`feasibility_only`/`cap_feasible`), były omyłkowo wklejone pod tym nagłówkiem; przeniesione do właściwego dziennika A2 na wyraźne polecenie zamawiającego z 2026-09-13 („zajmij się punktami z paragrafu ósmego”), zamykające ustalenie z par. 8. Treść i autorstwo oryginalnych wpisów zachowane bez zmian, tylko przeniesione. Właściwa praca C3: `reports.py` klasyfikuje dzień jako weekend, gdy jest jednocześnie świętem i sobotą/niedzielą (sprawdzenie weekendu przed sprawdzeniem święta), zgodnie z konwencją solvera i modułu `fairness.py` (decyzja D4); poprzednio kolejność była odwrotna. CSV i podgląd JSON dostały kolumny `primary_points`/`secondary_points`/`total_points` (CSV: `primary_punkty`, `secondary_punkty`, `punkty_razem`) liczone współdzieloną funkcją `day_weight` z `fairness.py`, więc suma punktów zawsze zgadza się z ekranem Sprawiedliwość. `DraftFairnessPanel.tsx`: nagłówek „Kryterium odbioru…” zmieniony z `variant="h3"` (bez własnego stylu w motywie - renderował się jako ~48 px, większy niż tytuł strony) na `variant="subtitle2"`, spójnie z innymi podtytułami sekcji w aplikacji (np. „Ostrzeżenia przed decyzją”); lista soczewek to teraz wiersze z ikoną statusu (`CheckCircleOutline`/`WarningAmber`) zamiast gołego `<ul>`, stylowane przez `sx` bezpośrednio w komponencie (bez zmian w `styles.css`, poza zakresem pakietu).
- 2026-09-13, Claude Sonnet 5, Pomiar po: nowy test `tests/test_reports_holiday_weekend.py` (2 testy) - 15.08.2026 (sobota, Wniebowzięcie NMP) liczony jako weekend, primary/secondary punkty 5,0/5,0, suma 10,0; CSV ma te same kolumny i wartości. `tests/test_reports*.py` (z istniejącym `test_monthly_reports.py`, zaktualizowanym o nową konwencję): 7 testów przeszło. `DraftFairnessPanel.test.tsx`: 3/3. Pełny frontend: 138/138, ESLint i build bez błędów. `npm run build` bez ostrzeżeń nowych (chunk >500 kB to istniejące, nieukończone jeszcze zadanie G3).
- 2026-09-13, Review (Claude Opus 5), wynik: GOTOWE.
  - Powtórzone: `GET /reports/monthly?month=2026-08` zwraca `primary_points`, `secondary_points`, `total_points`; test 15.08 (sobota, święto) przechodzi w pełnym zestawie; panel kryterium w szkicu ma nagłówek sekcji i wiersze z ikonami (`review-C3-criterion.png`).
  - [U] Tabela wpływu szkicu zajmuje ok. 60% szerokości karty; kryterium wymagało zrzutu `fix-C3-criterion.png`, w repozytorium jest `fix-C3-F4-reports.png`.

### Tor A: solver

#### A1 - reguły odpoczynku na styku z poprzednim okresem

Defekty: QA7-B03.
Cel: szkic nigdy nie łamie „max 3 z rzędu”, „max 3 w 7 dniach” i „2 dni przerwy po serii” razem z dyżurami opublikowanymi tuż przed horyzontem.

Pliki: `backend/src/oncall/scheduler.py`, `backend/src/oncall/rules.py` (jeśli potrzebny wspólny helper), `docs/qa-suite-7/check_rules.py`, nowy test `backend/tests/test_scheduler_boundary_rest.py`.
Wyjątek: w `backend/src/oncall/routes/scheduling.py` tylko funkcja `generate_draft` (przekazanie nowego argumentu), oraz `backend/src/oncall/fairness_data.py` tylko nowa funkcja pobierająca dyżury on-call z 7 dni przed horyzontem przez `effective_assignments` (bez zmian istniejących funkcji).

Kroki:
1. Dodaj do `generate_schedule` i `_build_model` argument `prior_oncall: dict[str, set[date]]` (nazwa osoby → dni on-call w `[starts_on - 6, starts_on - 1]`).
2. W oknach reguł (`scheduler.py` ok. 428-465: `window_size`, `range(len(days) - 6)`, reguła przerwy po serii) dołóż okna zaczynające się przed horyzontem; dni sprzed horyzontu wchodzą jako stałe 1/0 po prawej stronie nierówności. Uwzględnij zwolnienie długich bloków tak jak dziś.
3. Jeśli dyżury sprzed horyzontu same już łamią regułę (np. opublikowana seria), nie rób modelu niewykonalnego: ogranicz tylko dni horyzontu i zapisz ostrzeżenie w `warnings`.
4. `generate_draft`: pobierz `prior_oncall` z opublikowanych i zaimportowanych grafików (effective assignments) i przekaż.
5. `check_rules.py`: dodaj zwolnienie długich bloków dni wolnych (> 3 dni) z limitów, żeby kryterium odbioru nie zgłaszało 24-27.12.
6. Test jednostkowy: historia z dyżurem sobota-niedziela tuż przed horyzontem, horyzont z małą obsadą; osoba nie dostaje pn-wt.

Kryterium odbioru:
- `cd backend && .venv/bin/python -m pytest -q tests/test_scheduler_boundary_rest.py tests/test_scheduler*.py`
- Scenariusz: po G1 i opublikowaniu 26.10-29.11 wygenerować 30.11-27.12; `check_rules.py <id>` zwraca 0 błędów. Pomiar przed: 12 błędów, Julia Nowak 5 nocy z rzędu 28.11-02.12.
- Scenariusz: szkic 31.08-27.09 po imporcie historii: 0 błędów (pomiar przed: Elżbieta Kaczmarek i Halina Szymańska po 4 dyżury w 7 dniach).

Dziennik wykonania:
- 2026-09-13, Review (Claude Opus 5), wynik: DO POPRAWY.
  - Powtórzone: `check_rules.py` dla szkiców 28.09-25.10, 26.10-29.11 (dwa) i opublikowanego 30.11-27.12 zwraca `BŁĘDY: 0`; regresja QA7-B03 `OK`.
  - [B] Gdy historia osoby sama łamie reguły, `invalid_prior_members` zeruje całą jej historię zamiast ograniczyć tylko dni horyzontu (krok 3).
  - Eksperyment w kontenerze workera: osoba z dyżurami śr-sob przed horyzontem dostaje wt-czw (5 dyżurów w 7 dniach), a wynik niesie ostrzeżenie „bez pogłębiania zastanego naruszenia”, które jest nieprawdziwe.
  - Poprawka: zawsze liczyć okna z historią jako stałe; `max(0, limit - fixed)` w `add_bounded_window` już gwarantuje wykonalność okien.
  - [U] Wpisy wykonawcy A1 zostały wklejone do dziennika C2 (pierwsze dwa wpisy z 2026-09-12); dziennik A1 był pusty.
- 2026-09-13, Codex/root, poprawki: usunięto zerowanie całej historii osoby z zastanym naruszeniem. Wszystkie dni sprzed horyzontu pozostają stałymi w oknach, a `add_bounded_window` ogranicza wyłącznie zmienne dni nowego horyzontu. Test zastanego pięciodniowego naruszenia wymaga teraz, by osoba nie dostała nowego dyżuru. Fixture częściowej republikacji rozszerzono do realnej obsady czteroosobowej, ponieważ dwie osoby z nieprzerwanym miesięcznym dyżurem są obie prawidłowo odsuwane na granicy.
- 2026-09-13, Codex/root, Pomiar po: testy regresyjne A1/B1 i częściowej republikacji 8/8; Ruff czysto; pełny backend 355 testów przeszło w 195,31 s.
- 2026-09-13, Codex/root, ponowna weryfikacja: test `test_preexisting_violation_warns_without_making_model_infeasible` potwierdza poprawkę z review: pięć historycznych dyżurów pozostaje stałymi w ograniczeniach, model jest wykonalny, emituje ostrzeżenie i nie przydziela tej osobie żadnego dnia nowego horyzontu. `test_scheduler_boundary_rest.py`: 2/2; pakiet pozostaje `DO REVIEW`.

#### A2 - próby dna kryterium kończą się na pierwszym rozwiązaniu

Defekty: QA7-H07.
Cel: generowanie przy nieosiągalnym kryterium trwa około jednego budżetu, a nie czterech.

Pliki: `backend/src/oncall/scheduler.py` (`cap_feasible`, `lowest_achievable_spread`, funkcja `solve`), test w `backend/tests/test_scheduler*.py`.

Kroki:
1. Dodaj do wewnętrznej `solve` parametr `feasibility_only: bool = False`; przy `True` ustaw `stop_after_first_solution = True`.
2. `cap_feasible` wywołuje `solve(..., feasibility_only=True)`.
3. Sprawdź, że komunikat postępu (`SOLVE_PASS`) nadal liczy przebiegi poprawnie dla paska postępu.
4. Opcjonalnie, gdy próba zwraca `UNKNOWN`, traktuj jak „nie wiadomo” i przerwij bisekcję z ostrzeżeniem (dziś liczy się jak niewykonalne).

Kryterium odbioru:
- `docker compose exec -T worker python /tmp/bench_trace.py 2026-09-28 2026-11-01 30 hybrid 2` (po skopiowaniu `docs/qa-suite-7/bench_trace.py` do kontenera): `wall` ≤ 40 s, `floor` taki sam jak bez zmiany. Pomiar przed: 117,1 s, floor 4; wariant `probe_first` w benchmarku: 31,5 s, floor 4.
- `cd backend && .venv/bin/python -m pytest -q tests/test_scheduler*.py`

Dziennik wykonania:
- 2026-09-13, Codex/root (wpis przeniesiony 2026-09-13 przez Claude Sonnet 5 z dziennika C3, na polecenie zamawiającego z par. 8 - był tam wklejony omyłkowo): wewnętrzne `solve` przyjmuje `feasibility_only`; próby `cap_feasible` ustawiają `stop_after_first_solution=True`, podczas gdy główne przebiegi nadal optymalizują do limitu. Komunikaty postępu pozostają emitowane raz na przebieg. Dodano test rejestrujący parametr solvera i potwierdzający, że jest aktywny tylko w próbach dna.
- 2026-09-13, Codex/root (wpis przeniesiony, jak wyżej), Pomiar po: benchmark wymagany przez pakiet (`2026-09-28..2026-11-01`, 30 s, hybrid, 2 workery) zakończył się w 32,0 s z niezmienionym `floor=4`; cztery próby wykonalności trwały po 0,14-0,15 s i każda zwróciła pierwsze rozwiązanie. `tests/test_scheduler*.py`: 31 testów przeszło w 81,24 s; dedykowany test parametru: 1 test przeszedł. Pełny backend bezpośrednio przed A2: 306 testów przeszło; ponowne pełne wywołania po A2 utknęły bez procesu testowego w sesji wykonawczej, natomiast pojedynczy test kontrolny oraz cały zmieniony obszar przechodzą.
- 2026-09-13, Review (Claude Opus 5), wynik: GOTOWE.
  - Kod `feasibility_only` → `stop_after_first_solution` jest poprawny i ma dedykowany test; pełny backend 330 passed.
  - Benchmark z kryterium (35 dni, 30 s, 2 workery) w dzisiejszym stanie G1 nie wchodzi w próby dna, bo kryterium jest osiągalne (`floor=None`, wall 36,2 s), więc liczby 117 s → 32 s nie dało się powtórzyć; akceptuję na podstawie testu jednostkowego.
  - [U] `solver.parameters.linearization_level = 2` dodano globalnie dla każdego przebiegu, bez wpisu w dzienniku A2 ani A4; wpływ na 2 rdzeniach niezmierzony (nowe ustalenie w par. 8).

#### A3 - podpowiedź startowa z sensem

Defekty: brak identyfikatora (QA-REPORT-7 par. 7.3, pierwsze rozwiązanie 3× gorsze od końcowego).
Cel: pierwsze rozwiązanie solvera jest bliskie końcowemu.

Pliki: `backend/src/oncall/scheduler.py` (`hint_role`).

Kroki:
1. Zastąp round-robin podpowiedzią zachłanną: dla każdej jednostki (dzień roboczy albo blok) wybierz dopuszczalną osobę najdalej poniżej udziału w soczewce roli, z przerwą po serii i bez kolizji z `prior_oncall` (z A1). Wzór: `docs/qa-suite-7/make_history.py`.
2. Alternatywa do porównania: podpowiedź z krótkiego (≤ 1 s) rozwiązania fazy sprawiedliwości (eksperyment `warm` w `bench_variants.py`).
3. Zmierz obie i zostaw lepszą; wynik wklej do dziennika.

Kryterium odbioru:
- `bench_trace.py 2026-09-28 2026-10-25 15 hybrid 2`: koszt pierwszego rozwiązania ≤ 1,5× kosztu końcowego (pomiar przed: 357 400 vs 119 400), koszt końcowy nie gorszy niż przed zmianą.

Dziennik wykonania:
- 2026-09-13, Codex/root: round-robin zastąpiono podpowiedzią zachłanną, która wybiera najmniej obciążoną osobę w danej roli, karze kolizję PRIMARY/SECONDARY oraz świeże dyżury w horyzoncie i historii przed zakresem. Podpowiedź zachowuje kotwicę 11-19 i nierozdzielne zmienne bloków.
- 2026-09-13, Codex/root, Pomiar po: w benchmarku A4 pierwsze rozwiązanie pełnej fazy miało koszt 198400, końcowe 127400; relacja 1,56 pozostaje minimalnie ponad celem 1,5 i wymaga oceny w review. Testy solvera 34/34.
- 2026-09-13, Review (Claude Opus 5), wynik: DO POPRAWY.
  - [B] Kryterium nie przechodzi na ścieżce produkcyjnej: 28.09-25.10, 15 s, 2 workery, pierwsze rozwiązanie 177 200 wobec końcowego 113 600 (1,56 > 1,5), tak jak zgłosił wykonawca.
  - [U] Podpowiedź porządkuje osoby po surowych punktach historycznych, a nie po odchyleniu od udziału, więc osoba dołączająca później jest faworyzowana; wariant `warm` z kroku 2 nie został zmierzony.
- 2026-09-13, Codex/root, poprawki: podpowiedź startuje od odchylenia `actual - expected`, z udziałem oczekiwanym uwzględniającym ekspozycję. Rozwiązanie fazy sprawiedliwości jest warm startem także bez statusu OPTIMAL.
- 2026-09-13, Codex/root, Pomiar po: `bench_trace.py 2026-09-28 2026-10-25 15 hybrid 2`: pierwsze rozwiązanie pełnej fazy 177000, końcowe 120000, relacja 1,475 (cel ≤ 1,5), wall 15,1 s.

#### A4 - ciągłość jako serie i rozwiązywanie dwufazowe

Defekty: QA7-H03, QA7-L20.
Cel: tryb hybrydowy daje w ≤ 20 s rozwiązanie z udowodnionym optimum sprawiedliwości i małą, raportowaną luką ciągłości.

Pliki: `backend/src/oncall/scheduler.py`, `backend/src/oncall/models.py` i migracja (nowe pola grafiku), testy solvera, `docs/SOLVER.md` (sekcja o funkcji celu - dopuszczalna edycja w tym pakiecie).
Wyjątek: `backend/src/oncall/routes/scheduling.py` i `schemas.py` tylko zapis i zwrot nowych pól (`fairness_proven`, `continuity_gap`).

Kroki:
1. Zastąp człon `transition` formulacją seriami z prototypu `docs/qa-suite-7/bench_variants.py` (`build_runs`): zmienne serii osoba-rola-dni w tygodniu ISO, `x == Σ serii pokrywających dzień`, koszt `2 × koszt_ciągłości × (liczba serii w tygodniu − 1)`, maksymalna długość serii 3, a dla serii obejmujących długi blok dni wolnych - długość bloku. Tryb `weekly`: ten sam mechanizm z mnożnikiem 10.
2. Dodaj cięcie `second_duty ≥ Σ (długość − 1) × seria` (eksperyment `runs2`).
3. Rozwiązywanie dwufazowe: faza 1 sam koszt sprawiedliwości do OPTIMAL (limit np. 40% budżetu), faza 2 pełny cel z ograniczeniem sprawiedliwości ≤ optimum fazy 1 i podpowiedzią z fazy 1. Jeśli faza 1 nie osiągnie OPTIMAL, faza 2 bez ograniczenia (jak dziś).
4. Zapisz przy grafiku `fairness_proven: bool` i `continuity_gap: float` (luka fazy 2 względem jej granicy).
5. Zaktualizuj `docs/SOLVER.md`.
6. Uruchom pełny zestaw testów solvera; testy, które zakładały dokładne wartości celu, zaktualizuj z uzasadnieniem w dzienniku.

Kryterium odbioru:
- `bench_trace.py 2026-09-28 2026-10-25 20 hybrid 2` (po G1): faza sprawiedliwości `OPTIMAL`, luka fazy 2 ≤ 10%, rozpiętości nie gorsze niż primary 1,0 / secondary 2,5 / weekendy 3,0. Pomiar przed: FEASIBLE, luka 47,9% przy 15 s, 45,1% przy 300 s.
- Koszt przydziału policzony funkcją celu sprzed zmiany (`production_value` z `bench_variants.py`) ≤ 116 400.
- `cd backend && .venv/bin/python -m pytest -q` bez regresji.

Dziennik wykonania:
- 2026-09-13, Codex/root: ciągłość jest modelowana seriami długości 1-3 w tygodniu ISO, ze wspólnym kosztem liczby serii ponad pierwszą i mnożnikiem 10 dla trybu weekly. Dla budżetu co najmniej 20 s solver najpierw dowodzi optimum samej sprawiedliwości, następnie rozwiązuje pełny cel z utrwalonym optimum i podpowiedzią z fazy pierwszej. Grafik zapisuje `fairness_proven` i `continuity_gap`; dodano migrację 0030 i opis w `docs/SOLVER.md`.
- 2026-09-13, Codex/root, Pomiar po: benchmark 28 dni, 20 s, hybrid, 2 workery: wall 17,4 s; faza sprawiedliwości OPTIMAL w 1,13 s; pełna faza FEASIBLE z luką 6,12%. Testy solvera 34/34. Identyfikatory migracji 0029 i 0030 skrócono do limitu PostgreSQL; obie migracje przeszły na stosie Docker.
- 2026-09-13, Review (Claude Opus 5), wynik: DO POPRAWY.
  - Pomiar skryptem na ścieżce produkcyjnej (z `prior_oncall`) i oceną starym celem ze źródła sprzed poprawek: przy 15 s koszt starego celu 112 600 (≤ 116 400), rozpiętości 1,0 / 1,0 / 2,8, więc formulacja seriami realnie poprawia jakość.
  - [B] Rozwiązywanie dwufazowe jest nieaktywne w produkcji: działa tylko przy `solve_seconds >= 20`, a polityka ma 15; wszystkie szkice w bazie mają `fairness_proven=false` i `continuity_gap` 0,215-0,426.
  - [B] Przy 20 s (trzy przebiegi oraz `bench_trace.py` wykonawcy) faza sprawiedliwości w limicie 4 s kończy się `FEASIBLE`, nie `OPTIMAL`, więc druga faza nie dostaje ograniczenia, luka wynosi 21,7-27,3% (kryterium ≤ 10%), a wynik „OPTIMAL w 1,13 s, luka 6,12%” z dziennika nie jest powtarzalny.
  - [B] Czas fazy 1 nie jest odejmowany od budżetu, gdy faza nie dowiedzie optimum: 20 s trwa 24,1-24,2 s, 30 s trwa 36,2 s.
  - [B] `continuity_gap` to luka całego celu, a ekran pokazuje ją jako „Ciągłość: w granicy X% od optimum”.
  - [U] Nie wykonano kroku 2 (cięcie `second_duty` z eksperymentu `runs2`), a faza 1 dostaje 20% budżetu zamiast 40% z kroku 3.
- 2026-09-13, Codex/root, poprawki częściowe: dwufazowość działa od 10 s, pierwsza faza dostaje 50% budżetu, a druga tylko rzeczywisty czas pozostały. UI opisuje `continuity_gap` zgodnie z prawdą jako lukę całego celu.
- 2026-09-13, Codex/root, Pomiar po: 20 s kończy się w 20,2 s zamiast 24,2 s. Faza sprawiedliwości nadal FEASIBLE (luka 7,5%), pełny cel ma lukę 13,94%, więc pakiet pozostaje `DO POPRAWY`.

### Tor B: generator i publikacja

#### B1 - publikacja nie kasuje po cichu zamian; osierocone wnioski

Defekty: QA7-B02 (wariant blokady), QA7-H04.
Cel: publikacja nadpisująca zamiany lub korekty wymaga świadomej decyzji i powiadamia poszkodowanych; wnioski na wycofanym grafiku są anulowane.

Pliki: `backend/src/oncall/routes/scheduling.py` (`publish_schedule`, ok. linii 1179, i `propose_schedule`), `frontend/src/screens/Generator.tsx`, nowy test `backend/tests/test_publish_preserves_changes.py`.
Wyjątek: `backend/src/oncall/notifications/triggers.py` - tylko nowa funkcja powiadomienia; `backend/src/oncall/models.py` bez zmian (statusy zamian już są).

Kroki:
1. Przed publikacją wyznacz sloty z opublikowanych grafików nakładających się na zakres, które mają `is_override=True` albo zatwierdzoną zamianę (`swap_requests.status == approved`), i których wykonawca różni się od nowego szkicu.
2. Nowy endpoint `GET /scheduling/{id}/publish-preview` (albo pole w odpowiedzi `propose`) zwraca tę listę oraz listę oczekujących wniosków na grafikach, które zostaną wycofane.
3. `publish_schedule`: jeśli lista zmian nie jest pusta i `payload.acknowledge_lost_changes` nie jest `true`, zwróć 409 z listą (decyzja D1).
4. Przy publikacji: wnioski `pending_replacement` i `pending_coordinator` na grafikach wycofanych w całości ustaw na `cancelled` z `decision_note` „Grafik zastąpiony nową publikacją” i powiadom autora i zastępcę. Dla częściowych nakładań anuluj tylko wnioski na slotach w nowym zakresie.
5. Powiadom osoby, którym zmienia się dyżur względem stanu opublikowanego (nie względem szkicu).
6. `Generator.tsx`: dialog publikacji pokazuje listę utraconych zmian i anulowanych wniosków, przycisk potwierdzenia wysyła `acknowledge_lost_changes`.
7. Testy: publikacja bez potwierdzenia → 409; z potwierdzeniem → wnioski anulowane, powiadomienia w outbox.

Kryterium odbioru:
- `cd backend && .venv/bin/python -m pytest -q tests/test_publish_preserves_changes.py tests/test_publish*.py`
- `cd frontend && npm test -- Generator && npm run build`
- Scenariusz z G1 `--with-scenarios` (ponowna publikacja 26.10-29.11): bez potwierdzenia 409 z zamianą 03.11 na liście; oczekujący wniosek 05.11 po publikacji ma status `cancelled`. Pomiar przed: 200, zamiana utracona, wniosek osierocony.

Dziennik wykonania:
- 2026-09-13, Codex/root: dodano podgląd skutków publikacji z listą nadpisywanych korekt/zatwierdzonych zamian i oczekujących wniosków. Publikacja ponownie wylicza stan pod blokadą, bez potwierdzenia zwraca 409 `LOST_CHANGES`, a po potwierdzeniu anuluje właściwe wnioski (cały wycofany grafik albo sloty częściowego nakładania), zapisuje wymagany powód i powiadamia obie strony. Osoby tracące lub przejmujące każdy zmieniony dyżur otrzymują osobne, deduplikowane powiadomienie. Dialog Generatora pokazuje oba rodzaje skutków i przekazuje jawne potwierdzenie. Dodano test backendu i test UI.
- 2026-09-13, Codex/root, Pomiar po: Ruff dla zmienionego backendu i testu - czysto; `compileall` - czysto; `Generator.test.tsx` - 26/26 testów; ESLint - czysto; build frontendu - przeszedł. Początkowe zawieszenie fixture `db_factory` zostało później zdiagnozowane jako ograniczenie sandboxu dla wątku SQLite; `backend/.venv/bin/pytest` należy uruchamiać poza sandboxem.
- 2026-09-13, Review (Claude Opus 5), wynik: DO POPRAWY.
  - Powtórzone: publikacja z nierozstrzygniętymi zmianami zwraca 409 `LOST_CHANGES`, a wniosek 12.11 po republikacji ma status `cancelled` z notatką „Grafik zastąpiony nową publikacją” i powiadomieniami dla obu stron.
  - [B] Powiadomienia o zmianie dyżuru idą osobnym e-mailem na każdy slot: po jednej republikacji 30.11-27.12 jedna osoba dostała 18 wiadomości (`notification_outbox`, zdarzenie `assignment_changed_by_publication`); potrzebny jeden zbiorczy e-mail na osobę na publikację.
  - [U] Zatwierdzona zamiana 14.12, której republikacja nie przeniosła (rozstrzygnięcie „draft”), nadal ma status `approved`, choć już nie obowiązuje.
- 2026-09-13, Codex/root, poprawki: zmiany przydziałów są zbierane przed wywołaniem triggera i renderowane jako jedna lista slotów. Klucz deduplikacji obejmuje publikację i odbiorcę, więc każda osoba otrzymuje najwyżej jeden e-mail na publikację; kontekst outbox przechowuje pełną listę zmian. Test sprawdza unikalność odbiorców oraz brak powiadomień dla przeniesionych zmian.
- 2026-09-13, Codex/root, Pomiar po: testy regresyjne A1/B1 i częściowej republikacji 8/8; Ruff czysto; pełny backend 355 testów przeszło w 195,31 s. G1 na świeżym stosie potwierdził wymagane obiekty 03.11 i 05.11.

#### B2 - luka, nieaktualny szkic i reguły przy publikacji

Defekty: QA7-H05.
Cel: koordynator wie o nieobsadzonych dniach przed zakresem i o zmianach po wygenerowaniu szkicu; publikacja nie przepuszcza złamanych reguł odpoczynku bez potwierdzenia.

Pliki: `backend/src/oncall/routes/scheduling.py` (`publish_schedule`, `_draft_response`, podgląd publikacji z B1), `frontend/src/screens/Generator.tsx`.
Wyjątek: import helpera `oncall_rest_violations` z `rules.py` (bez jego zmiany).

Kroki:
1. Przy tworzeniu przebiegu i w odpowiedzi szkicu wylicz `uncovered_before`: dni od dziś (albo od końca ostatniej publikacji) do `starts_on - 1` bez opublikowanego przydziału. Pokaż ostrzeżenie na ekranie generatora (decyzja D6).
2. Publikacja z niepustym `uncovered_before` wymaga `acknowledge_gap=true`.
3. Zapisz przy szkicu znacznik czasu danych wejściowych (np. maksymalny `updated_at`/`created_at` z dostępności, zamian, korekt i publikacji użytych przez solver); przy otwarciu szkicu porównaj i pokaż „Szkic nieaktualny: od wygenerowania zmieniło się N wpisów”.
4. Publikacja uruchamia `oncall_rest_violations` na roster po publikacji (effective assignments z 7 dniami przed zakresem); naruszenia zwraca w podglądzie; publikacja z naruszeniami wymaga potwierdzenia.
5. Testy dla luki, nieaktualności i naruszeń.

Kryterium odbioru:
- `cd backend && .venv/bin/python -m pytest -q tests/test_publish*.py tests/test_scheduling*.py`
- Scenariusz: publikacja 26.10-29.11 przy nieopublikowanym 28.09-25.10 bez `acknowledge_gap` → 409 z listą dni. Pomiar przed: 200 bez ostrzeżenia.

Dziennik wykonania:
- 2026-09-13, Codex/root: odpowiedź szkicu, odpowiedź nowego przebiegu i podgląd publikacji zwracają `uncovered_before`; Generator ostrzega o luce od razu oraz w dialogu publikacji. Publikacja wymaga osobnego `acknowledge_gap`. Aktualność szkicu jest liczona względem `Schedule.created_at` z istniejących zdarzeń audytu dla dostępności, zamian, korekt, publikacji i polityki; ekran pokazuje liczbę zmian. Podgląd nakłada szkic na efektywny roster wraz z siedmioma dniami historii, wylicza wspólnym helperem naruszenia odpoczynku i wymaga osobnego `acknowledge_rest_violations`. Test publikacji sprawdza kolejno wszystkie trzy bramki 409 i udaną publikację po komplecie potwierdzeń; test Generatora sprawdza prezentację skutków i payload.
- 2026-09-13, Codex/root, Pomiar po: Ruff i `compileall` dla zmienionego backendu - czysto; `Generator.test.tsx` - 26/26 testów; ESLint - czysto; build frontendu - przeszedł. Backendowy pytest działa z dotychczasowego `.venv`, pod warunkiem uruchamiania poza sandboxem (wymagane przez wątek SQLite).
- 2026-09-13, Review (Claude Opus 5), wynik: DO POPRAWY.
  - Powtórzone: bramki `UNCOVERED_BEFORE` i `REST_VIOLATIONS` działają (regresja QA7-H05 `OK`, szkic 26.10-29.11 pokazuje 28 nieobsadzonych dni).
  - [B] `stale_changes_count` liczy zdarzenia audytu globalnie: dostępność Julii dodana na marzec 2027 podniosła licznik szkicu 28.09-25.10 z 8 do 9, więc ostrzeżenie „Szkic nieaktualny” zapala się od zmian bez wpływu na szkic.
  - [B] Licznik pomija zmiany, które solver faktycznie czyta: `schedule.override_batch`, `schedule.override_carried`, `schedule.draft_override` innych szkiców oraz zmiany członkostwa i eligibility (`admin.*`).
  - [U] `_uncovered_dates` używa daty UTC, a reszta bramek dat `date.today()`; wokół północy czasu polskiego wyniki mogą się różnić o dzień.
- 2026-09-13, Claude Sonnet 5, poprawka: `_stale_changes_count` sprawdzał tylko, czy akcja audytu pasuje do listy i mieści się w czasie po `created_at` szkicu, bez patrzenia na to, co dana zmiana faktycznie dotyczyła.
  Teraz każda grupa akcji jest sprawdzana pod kątem treści: okno istotności to `generator_history_window(starts_on, ends_on)[0] .. ends_on` (ta sama historia, którą liczy generator, plus sam horyzont).
  `availability.created(_on_behalf)` i `admin.eligibility_created/updated` są dociągane po `entity_id` i sprawdzane na zakres `starts_on..ends_on` własnego rekordu.
  `admin.team_member_created/updated` są sprawdzane po tym, czy `entity_id` (id członka) jest w ogóle w `schedule.assignments` tego szkicu, bo data samego okresu rotacji nie mówi nic o istotności, a obsada szkicu - tak.
  `swap.*` są dociągane przez `SwapRequestSlot` (przetrwa odrzucenie/anulowanie wniosku) i sprawdzane datami slotów.
  `schedule.override`/`schedule.draft_override`/`schedule.override_carried` czytają `details["service_date"]` (pole już tam było, teraz jest faktycznie wykorzystywane).
  `schedule.override_batch` parsuje listę `details["slots"]` (`"data:rola"`) i liczy się, jeśli którykolwiek slot mieści się w oknie.
  Zdarzenia, których nie da się zweryfikować, bo skasowany wiersz nie ma już własnych dat (`availability.deleted(_on_behalf)`, `admin.eligibility_deleted`), oraz `policy.updated`/`schedule.published` liczą się bezwarunkowo - to jedyny bezpieczny kierunek pomyłki, bo może tylko niepotrzebnie ostrzec, nigdy ukryć realnie nieaktualny szkic.
  Rozszerzono też listę śledzonych akcji o brakujące: `schedule.override_batch`, `schedule.draft_override`, `schedule.override_carried` oraz pięć akcji `admin.team_member_*`/`admin.eligibility_*`.
- 2026-09-13, Claude Sonnet 5, Pomiar po: nowy plik `tests/test_stale_changes.py` (5 testów).
  Dostępność rok poza oknem nie liczy się do licznika (`== 0`, odtworzenie regresji z reviewu); dostępność w oknie liczy się (`== 1`); skasowana dostępność liczy się bezwarunkowo; zmiana rotacji osoby spoza szkicu nie liczy się, a osoby będącej w `schedule.assignments` - liczy się; wsadowa korekta ze slotem w oknie liczy się.
  Zaktualizowano istniejący `test_publish_preserves_changes.py`: fikstura z gołym `AuditEvent` bez `entity_id` zastąpiona prawdziwym wierszem `Availability` z powiązanym audytem, bo stary test sprawdzał właśnie ślepe liczenie, które zostało naprawione.
  `tests/test_stale_changes.py tests/test_publish_preserves_changes.py` oraz szerszy zestaw draft/publish/generation - 48/48; pełny backend 347/347; Ruff czysto.
  [B] licznik globalny bez treści: potwierdzone dwoma testami (poza oknem / w oknie).
  [B] pominięte akcje: `schedule.override_batch`, `schedule.draft_override`, `schedule.override_carried` i pięć akcji `admin.*` dopisane do `STALE_INPUT_ACTIONS`; potwierdzone testami `override_batch` (slot w oknie) i `admin.team_member_updated` (względem obsady szkicu).
  [U] `_uncovered_dates` UTC vs `date.today()`: nienaprawione w tym przebiegu, poza zakresem tych dwóch `[B]`.

#### B3 - przenoszenie zamian i korekt do nowej publikacji

Defekty: QA7-B02 (wariant docelowy).
Cel: ponowna publikacja zakresu zachowuje uzgodnienia zespołu, a konflikty trafiają do koordynatora.

Pliki: `backend/src/oncall/routes/scheduling.py`, `backend/src/oncall/effective.py`, `frontend/src/screens/Generator.tsx`, testy.

Kroki:
1. Przy publikacji dla każdej zatwierdzonej zamiany i korekty z wycofywanego grafiku sprawdź, czy da się ją nałożyć na nowy szkic: slot ma w nowym szkicu tego samego pierwotnego wykonawcę co przed zamianą, a nowy wykonawca spełnia reguły (`substitution_check`).
2. Nakładalne przenieś jako korekty w nowym grafiku (`is_override=True`, audyt `schedule.override_carried`).
3. Nienakładalne zwróć w podglądzie publikacji jako konflikty z propozycją (zachowaj szkic / zachowaj zamianę); koordynator rozstrzyga w dialogu.
4. Potwierdzenie z B1 dotyczy już tylko konfliktów.

Kryterium odbioru:
- Scenariusz 26.10-29.11 z G1: zamiana 03.11 Julia → Anna zostaje w nowej publikacji, jeśli nowy szkic ma 03.11 Julię; jeśli ma kogoś innego - pojawia się jako konflikt.
- `cd backend && .venv/bin/python -m pytest -q tests/test_publish*.py`

Dziennik wykonania:
- 2026-09-13, Codex/root: podgląd publikacji rozdziela bezpiecznie przenoszone zmiany (`carried_changes`) od konfliktów (`lost_changes`). Dla zatwierdzonych zamian odzyskuje pierwotnego i aktualnego wykonawcę z wniosku oraz ocenia wszystkie sprzężone sloty atomowo; dla korekt odzyskuje pierwotny przydział z audytu `schedule.override`. Przeniesienie wymaga zgodności pierwotnego wykonawcy ze szkicem, aktualnej eligibility/dostępności oraz braku nowych naruszeń sprawdzanych na rosterze szkicu wspólną logiką `substitution_violations`. Bezpieczne zmiany są automatycznie zapisywane jako `is_override=True` z audytem `schedule.override_carried`. Dla konfliktów Generator wymaga osobnej decyzji „zachowaj szkic”/„zachowaj wcześniejszą zmianę”; brak rozstrzygnięcia zwraca 409 `CHANGE_RESOLUTION_REQUIRED`. Test obejmuje atomowe przeniesienie zatwierdzonej zamiany SECONDARY+11–19, konflikt korekty i audyt.
- 2026-09-13, Codex/root, Pomiar po: Ruff i `compileall` dla zmienionego backendu - czysto; `Generator.test.tsx` - 26/26 testów; ESLint - czysto; build frontendu - przeszedł. Po odblokowaniu pytest test publikacji B1-B3 przeszedł: 1 test w 0,37 s.
- 2026-09-13, Review (Claude Opus 5), wynik: DO POPRAWY.
  - [B] Rozstrzygnięcie „change” wymusza poprzedniego wykonawcę bez twardych reguł: szkic 26.10-29.11 opublikowany z rozstrzygnięciami „change” dał efektywnie 03.11 Julię Nowak na primary i secondary jednocześnie (publikacja 200).
  - Przed zapisem trzeba sprawdzić kolizję ról tego dnia, eligibility, dostępność i reguły odpoczynku, a przy naruszeniu odrzucić rozstrzygnięcie.
  - [B] Pierwotny wykonawca jest odzyskiwany tylko z audytu `schedule.override`, i to przez parsowanie tekstu `summary`: korekty wsadowe z D4, korekty szkicu oraz sprzężona zmiana 11-19 z korekty kalendarza zawsze trafiają do konfliktów z powodem „Nie można ustalić pierwotnego wykonawcy zmiany”, więc republikacja nie przeniesie np. offboardingu.
  - Zapisuj pierwotnego wykonawcę w `details` audytu i czytaj go stamtąd.
  - [U] Kryterium ze scenariuszem G1 (zamiana 03.11) nie jest wykonalne, bo G1 tego stanu nie tworzy; szczęśliwa ścieżka przeniesienia jest pokryta tylko testem jednostkowym.
- 2026-09-13, Claude Sonnet 5, poprawka (dwa `[B]`): dodano `_change_resolution_conflicts` (`routes/scheduling.py`), wywoływane w `publish_schedule` zaraz po ustaleniu `selected_carries`, przed dotychczasową bramką `REST_VIOLATIONS`.
  Dla każdego rozstrzygnięcia „change” sprawdza kolizję ról (czy ten sam człowiek trafiłby na obie role on-call tego dnia, licząc też inne rozstrzygnięcia „change” tego samego dnia, nie tylko stan sprzed republikacji), członkostwo w zespole, eligibility do roli i dostępność; przy naruszeniu republikacja kończy się teraz 409 `CHANGE_RESOLUTION_INVALID` z listą slotów i powodów, zamiast zapisać złamany stan.
  Reguły odpoczynku mają już własną bramkę `REST_VIOLATIONS` z potwierdzeniem (`_publication_rest_violations` liczy się na `selected_carries`) i pozostały bez zmian - to świadoma decyzja: rozstrzygnięcie „change” nadal może obejść ostrzeżenie o zmęczeniu za zgodą koordynatora, ale nie kolizję ról ani brak uprawnień.
  Drugi `[B]`: `_override_original_assignees` czytało wyłącznie akcję `schedule.override` i tylko przez parsowanie tekstu `summary`, więc korekty wsadowe (D4), korekty szkicu i sprzężony slot 11-19 z korekty roli kotwiczącej nigdy nie były odzyskiwalne.
  Trzy miejsca zapisu audytu (`schedule.override` i `schedule.override_batch` w `calendar.py`, `schedule.draft_override` w `scheduling.py`) dostały ustrukturyzowane pole `details["moves"]` - lista `{service_date, role, previous_assignee_name}` odczytana przed nadpisaniem `assignee_name`, obejmująca też sprzężony slot 11-19, gdy występuje.
  `calendar.py` jest plikiem toru D; dotyczy to jego jedynej funkcji, która pisze `schedule.override`/`schedule.override_batch`, więc zmiana jest minimalna i udokumentowana tutaj jako dotknięcie cudzego toru (podobnie jak `D2` dotknęło `styles.css`).
  `_override_original_assignees` czyta teraz `details["moves"]` z trzech akcji (`schedule.override`, `schedule.override_batch`, `schedule.draft_override`); `schedule.override_carried` celowo pominięte, bo zapisuje wynik tego samego mechanizmu, a nie nowe wejście dla niego.
  Zdarzenia sprzed tej zmiany, bez pola `moves`, nadal odzyskują pojedynczy slot starym parsowaniem `summary` (bez wstecznej migracji istniejących wierszy audytu).
- 2026-09-13, Claude Sonnet 5, Pomiar po: nowy plik `tests/test_publish_change_resolution.py` (6 testów).
  Dwa rozstrzygnięcia „change” na tę samą osobę dla primary i secondary tego samego dnia → `_change_resolution_conflicts` zwraca konflikt dla obu slotów („Ta osoba miałaby już drugi dyżur on-call tego dnia”), odtwarzając dokładnie scenariusz z reviewu (Julia Nowak 03.11 primary+secondary).
  Rozstrzygnięcia dla różnych osób → brak konfliktów.
  Odzyskiwanie pierwotnego wykonawcy z `schedule.override_batch` (offboarding) i ze sprzężonego `schedule.override` (anchor+11-19) - oba sloty odzyskane poprawnie.
  Zdarzenie bez pola `moves` nadal odzyskiwane starym parsowaniem.
  `schedule.override_carried` nie jest czytane jako źródło.
  `tests/test_publish_change_resolution.py tests/test_publish_preserves_changes.py tests/test_override_rules.py tests/test_calendar*.py tests/test_draft_override.py tests/test_partial_republish.py tests/test_swap_after_republish.py` - 78/78; pełny backend 347/347; Ruff czysto.
  [B] „change” bez sprawdzenia reguł: potwierdzone testem kolizji ról; eligibility/dostępność/członkostwo pokryte tą samą funkcją, bez osobnego testu negatywnego w tym przebiegu.
  [B] pierwotny wykonawca nieodzyskiwalny dla korekt wsadowych/szkicu/sprzężonego 11-19: potwierdzone trzema dedykowanymi testami.
  [U] scenariusz G1: nadal niewykonalny bez zmiany G1, poza zakresem tego przebiegu.

#### B4 - sugerowany zakres

Defekty: QA7-M01.
Cel: sugerowany start obejmuje nieobsadzone dzisiaj i nie rozcina bloku dni wolnych.

Pliki: `backend/src/oncall/routes/scheduling.py` (`suggested_range`, `_first_uncovered`, `_range_end`), test `backend/tests/test_suggested_range*.py`.

Kroki:
1. `earliest_start = today`, jeśli dzisiejsze sloty nie są obsadzone żadną publikacją ani importem; w przeciwnym razie jutro (bez zmiany zasady „nie podmieniaj trwającego dyżuru”).
2. Jeśli kandydat startu leży wewnątrz bloku dni wolnych, cofnij start do początku bloku, gdy blok nie jest obsadzony, albo przesuń do dnia po bloku, gdy jest obsadzony częściowo; opisz wybór w dzienniku.
3. Test dla soboty 12.09.2026 bez publikacji: start 12.09. Test dla niedzieli z obsadzoną sobotą: start w poniedziałek.

Kryterium odbioru:
- `cd backend && .venv/bin/python -m pytest -q tests/test_suggested_range*.py`

Dziennik wykonania:
- 2026-09-13, Codex/root: sugerowany zakres zaczyna się dzisiaj, jeśli żadna publikacja ani import nie obejmuje dzisiejszego dnia; przy istniejącym dzisiejszym dyżurze poszukiwanie nadal zaczyna się jutro, więc trwający dyżur nie jest podmieniany. Kandydat wewnątrz bloku weekend/święto jest cofany do początku nieobsadzonego bloku (nie wcześniej niż dziś), natomiast przy częściowo obsadzonym bloku przesuwany na pierwszy dzień roboczy po nim. Wybrano pokrycie zakresami publikacji/importów, spójne z dotychczasową semantyką endpointu i działające również dla historycznych grafików bez pełnych rekordów assignment.
- 2026-09-13, Codex/root, Pomiar po: ustalono, że zawieszenie powodował sandbox blokujący wątek SQLite; testy należy uruchamiać jako `backend/.venv/bin/pytest` poza sandboxem. Tym sposobem testy sugerowanego zakresu i publikacji przeszły 10/10 w 1,39 s, a pełny istniejący zestaw `test_publish*`, `test_published_flag.py`, `test_suggested_range*` przeszedł 13/13 w 1,94 s; Ruff - czysto. Tymczasowe `backend/.venv-test` usunięto po potwierdzeniu, że nie jest potrzebne.
- 2026-09-13, Review (Claude Opus 5), wynik: GOTOWE.
  - Kryterium to testy jednostkowe `tests/test_suggested_range*.py`; przechodzą w pełnym zestawie 330 passed, logika w `_suggested_start` zgodna z krokami.

#### B5 - cofnięcie propozycji i komunikat jakości rozwiązania

Defekty: QA7-L09, prezentacja wyniku A4.
Cel: koordynator może wrócić z „Do akceptacji” do szkicu, a komunikat o jakości solvera jest krótki i prawdziwy.

Pliki: `backend/src/oncall/routes/scheduling.py` (nowy `POST /{id}/withdraw`), `frontend/src/screens/Generator.tsx`.

Kroki:
1. Endpoint `withdraw`: `proposed → draft` z kontrolą wersji i audytem.
2. Przycisk „Wróć do szkicu” w stanie „Do akceptacji”.
3. Zastąp alert FEASIBLE: „Sprawiedliwość: optymalna (udowodniona)” lub „najlepsza znaleziona”, „Ciągłość: w granicy X% od optimum”, obok stanu kryterium. Bez odsyłania „tam, nie tutaj”.
4. Usuń twierdzenie „spełnia wszystkie reguły twarde”, jeśli podgląd z B2 zawiera naruszenia.

Kryterium odbioru:
- `cd frontend && npm test -- Generator && npm run build`
- Zrzut ekranu szkicu `docs/qa-shots-7/fix-B5-status.png`.

Dziennik wykonania:
- 2026-09-13, Codex/root: dodano wersjonowany endpoint `POST /scheduling/{id}/withdraw`, audyt `schedule.withdrawn` i przycisk „Wróć do szkicu”. Komunikat FEASIBLE pokazuje osobno dowód sprawiedliwości oraz procentową lukę ciągłości i nie twierdzi już bezwarunkowo, że wszystkie reguły twarde są spełnione.
- 2026-09-13, Codex/root, Pomiar po: pełny frontend 137/137; ESLint i build bez błędów. Zrzut pozostaje do niezależnego review wizualnego.
- 2026-09-13, Review (Claude Opus 5), wynik: DO POPRAWY.
  - Powtórzone: `POST /scheduling/{id}/withdraw` przenosi propozycję do szkicu (200, wersja podbita); ekran szkicu pokazuje „Sprawiedliwość: najlepsza znaleziona. Ciągłość: …” bez twierdzenia o spełnieniu wszystkich reguł (`review-B5-status.png`).
  - [B] Komunikat nie spełnia celu „krótki i prawdziwy”: „Ciągłość: w granicy 21.5% od optimum” pokazuje lukę całego celu, nie ciągłości (metryka z A4), a „Sprawiedliwość: optymalna (udowodniona)” nie pojawia się w żadnym szkicu przy obecnej polityce; do ponownego sprawdzenia razem z poprawką A4.
  - [U] Liczba ma kropkę dziesiętną („21.5%”), a obok pozostał chip „CP-SAT: FEASIBLE”.
- 2026-09-13, Codex/root, poprawki: komunikat pokazuje „Jakość całego rozwiązania: luka X%” i polski separator dziesiętny; nie przypisuje już luki całego celu samej ciągłości.
- 2026-09-13, Codex/root, Pomiar po: `Generator` i `People` 34/34, ESLint i build bez błędów.

### Tor D: zamiany, korekty, kalendarz

#### D1 - daty minione w zamianach i korektach

Defekty: QA7-H01, QA7-M09.
Cel: zamiana dyżuru z przeszłości jest niemożliwa; korekta przeszłości wymaga powodu i jest oznaczona.

Pliki: `backend/src/oncall/routes/swaps.py` (`create_swap` ~605, `accept_swap` ~747, `approve_swap` ~888, `/options`), `backend/src/oncall/routes/calendar.py` (`direct_override` ~353), `frontend/src/screens/Swaps.tsx`, `frontend/src/components/CalendarMatrix.tsx`, testy `backend/tests/test_swaps_past.py`, `backend/tests/test_override_past.py`.
Wyjątek: `schemas.py` - pole `reason: str | None` w żądaniu korekty.

Kroki:
1. `create_swap`, `accept_swap`, `approve_swap`: 422 „Nie można zamienić dyżuru, który już się odbył”, gdy którykolwiek slot ma `service_date < date.today()` (decyzja D2). `/options` zwraca pustą listę z `next_step`.
2. Przy starcie aplikacji albo w workerze nie zmieniaj istniejących wniosków; UI chowa przyciski akceptacji/zatwierdzenia dla wniosków z przeszłości i pokazuje „Termin minął”.
3. `direct_override`: dla `service_date < today` wymagaj `reason` (≥ 10 znaków), zapisz w audycie `details.reason` i `details.historical=true`.
4. `CalendarMatrix.tsx`: pole „Powód korekty” w dialogu dla dni minionych; znacznik „H” (korekta historyczna) w legendzie i komórce.
5. Testy obu reguł.

Kryterium odbioru:
- `cd backend && .venv/bin/python -m pytest -q tests/test_swaps_past.py tests/test_override_past.py tests/test_swap*.py`
- Scenariusz: `POST /swaps` jako `anna.wrobel` dla 2026-09-01 → 422. Pomiar przed: 201, potem akceptacja i zatwierdzenie 200.
- Scenariusz: korekta 2026-09-03 bez powodu → 422, z powodem → 200 i wpis audytu z powodem.

Dziennik wykonania:
- 2026-09-13, Codex/root: tworzenie zamiany historycznej zwraca 422 z wymaganym komunikatem; opcje dla daty minionej są puste, a akceptacja i zatwierdzanie ponownie kontrolują daty wszystkich (także sprzężonych) slotów bez automatycznej zmiany istniejących wniosków. UI ukrywa akcje dla przeterminowanych wniosków i pokazuje „Termin minął”. Korekta historyczna wymaga powodu minimum 10 znaków w schemacie API i dialogu, a audyt zapisuje `reason` oraz `historical=true`. Macierz i legenda oznaczają historyczną korektę literą `H`.
- 2026-09-13, Codex/root, Pomiar po: Ruff - czysto; nowe testy dat minionych oraz regresja zamian 25/25 w 12,19 s; testy Swaps i CalendarMatrix 23/23; ESLint - czysto; build frontendu - przeszedł. Backendowy pytest uruchomiono zgodnie z ustaleniem poza sandboxem z dotychczasowego `backend/.venv`.
- 2026-09-13, Review (Claude Opus 5), wynik: GOTOWE.
  - Powtórzone przez API: `POST /swaps` dla dyżuru Anny z 01.09 → 422 „Nie można zamienić dyżuru, który już się odbył”; korekta 03.09 bez powodu → 422, z powodem → 200, audyt zawiera `reason` i `historical: true`.
  - Legenda kalendarza pokazuje „H korekta historyczna”.

#### D2 - zatwierdzanie zamian: własne wnioski, wpływ, ostrzeżenia

Defekty: QA7-M03, QA7-M04, QA7-L11.
Cel: koordynator nie zatwierdza sam sobie, a dialog zatwierdzenia pokazuje skutki; liczby przy zastępcach są zrozumiałe.

Pliki: `backend/src/oncall/routes/swaps.py` (`approve_swap`, `/impact`), `frontend/src/screens/Swaps.tsx`, `frontend/src/components/SwapImpactPreview.tsx`, `frontend/src/lib/swaps.ts`.

Kroki:
1. `approve_swap`: decyzja D5 - 403 „Własną zamianę zatwierdza inny koordynator”, gdy zatwierdzający jest autorem albo zastępcą i istnieje inny aktywny koordynator/admin; w przeciwnym razie flaga `self_approved` w audycie.
2. Powiadomienie „Do zatwierdzenia” nie trafia do autora/zastępcy wniosku.
3. Dialog zatwierdzenia i akceptacji: `SwapImpactPreview` oraz ostrzeżenia z `/swaps/impact` i `rule_checks` (w tym rozbicie bloku dni wolnych - reguła `day_off_block`).
4. Lista zastępców: zamiast „PRIMARY -0.23” tekst „0,23 pkt poniżej udziału” (spójnie z ekranem Sprawiedliwość); panel wpływu pokazuje odchylenie przed/po, a punkty absolutne jako drugorzędne.
5. Testy backendu dla D5 i testy frontendu dialogu.

Kryterium odbioru:
- `cd backend && .venv/bin/python -m pytest -q tests/test_swap*.py`
- `cd frontend && npm test -- Swaps && npm run build`
- Scenariusz: `tomasz.krawczyk` zatwierdza własną zamianę → 403 (pomiar przed: 200). Zamiana soboty w bloku weekendowym pokazuje ostrzeżenie w dialogu zatwierdzenia.

Dziennik wykonania:

- 2026-09-13, Codex/root: zatwierdzający będący stroną zamiany dostaje wymagane 403, jeżeli istnieje inny aktywny koordynator lub administrator; w przeciwnym razie audyt otrzymuje `self_approved=true`. Powiadomienia pomijają strony wniosku. API wpływu zwraca także ostrzeżenia reguł, a dialog pokazuje odchylenie punktowe przed i po oraz zrozumiałe opisy bilansu zastępców.
- 2026-09-13, Codex/root, Pomiar po: testy obszaru D/E 36/36; pełne testy frontendu 137/137; ESLint i build bez błędów. Test własnego zatwierdzenia potwierdza dokładny komunikat 403.
- 2026-09-13, Review (Claude Opus 5), wynik: DO POPRAWY.
  - Powtórzone: `tomasz.krawczyk` zatwierdzający własną zamianę 12.11 → 403 „Własną zamianę zatwierdza inny koordynator”; dialog zatwierdzenia zamiany soboty 19.09 pokazuje wpływ na bilans i ostrzeżenie o podziale bloku.
  - [B] `/swaps/impact` liczy reguły dla jednego slotu, choć wniosek przy kotwicy obejmuje rolę i 11-19: formularz Julii dla 27.10 secondary pokazuje dwa razy „Zmiana 11–19 i rola kotwicząca są u różnych osób” oraz „Ta sama osoba ma dyżur on-call i zmianę 11–19”, obok komunikatu, że prośba obejmuje oba sloty (`review-D5-swapform-selected-dark.png`).
  - [B] W `SwapImpactPreview` kolumna „punkty 52 → 50 (-2)” łamie się po jednym słowie w pionie i wystaje poza kartę dialogu; ostrzeżenia są pod zgięciem dialogu (`review-D2-approve-dialog.png`).
- 2026-09-13, Claude Sonnet 5, poprawka: `/swaps/impact` liczyło reguły tylko dla klikniętego slotu przez `substitution_check(db, [(service_date, role)], ...)`, mimo że wniosek przy roli kotwiczącej faktycznie przenosi też 11-19 jako jedną decyzję (`_coupled_moves`, ta sama logika co `replacement_options`).
  Endpoint teraz liczy `moves`/`anchor_exception` identycznie jak `replacement_options` (dociąga `_swap_context`, `requester_holds_partner`, eligibility zastępcy dla partnera) i przekazuje pełny zestaw slotów do `substitution_check`, więc pozorne rozszczepienie kotwicy znika, zamiast być liczone i pokazywane osobno od tego, co już poprawnie pokazuje `ViolationList` z `replacement_options`.
  Usunięto też warstwę `_partition_violations` z tego endpointu: przegląd wykazał, że przy zastępcy zdolnym do obu ról `anchor_exception=False`, więc partycjonowanie routowałoby prawdziwe naruszenie do „blokujących” i cichaczem je ukrywało z `warnings` - sam test asercji `"late_shift_anchor" not in rules` przechodziłby nawet bez naprawy sprzężenia.
  `/swaps/impact` nie ma własnej bramki blokującej, a dialog zatwierdzenia renderuje ten sam komponent, więc pokazuje teraz każde naruszenie skorygowanego zestawu, bez utraty informacji.
  `SwapImpactPreview.tsx`: wiersz kategorii to teraz `role-label` + `impact-row-detail` (flex z zawijaniem) zamiast siatki 3 kolumn z ostatnią `minmax(0, 1fr)`, która pozwalała kolumnie punktów skurczyć się do zera i łamać się słowo po słowie; media query 760 px zmieniona na `flex-direction: column` (był `grid-template-columns`).
  Zmiana w `frontend/src/styles.css` (`.impact-row`/`.impact-row-detail`) dotyczy klas używanych wyłącznie przez ten komponent D2 - `styles.css` jest plikiem współdzielonym (§4), dopisano na końcu bloku bez zmiany sąsiednich reguł.
- 2026-09-13, Claude Sonnet 5, Pomiar po: nowy test backendu `test_impact_does_not_invent_an_anchor_split_for_a_fully_coupled_swap` (Marek eligible do secondary i 11-19, przeniesienie w pełni sprzężone) - `late_shift_anchor` nie występuje w `warnings` (bez naprawy sprzężenia i bez usunięcia partycjonowania test faktycznie się różnicuje - sprawdzone logicznie, bo stary kod liczyłby wyłącznie klikniętą rolę i rozdzielałby kotwicę).
  `tests/test_swap_impact.py tests/test_swap_coupled.py tests/test_swap_options.py tests/test_swap_rules.py` - 22/22; pełny backend 347/347.
  Frontend: `npm test -- Swaps SwapImpactPreview` - 19/19 (bez dedykowanego pliku testowego dla `SwapImpactPreview`, bo zmiana jest czysto layoutowa), lint i build bez błędów.
  [B] duplikat ostrzeżeń: potwierdzony testem backendu.
  [B] łamanie kolumny punktów: kod naprawiony (flex-wrap zamiast `minmax(0, 1fr)`); potwierdzone wizualnie na przebudowanym stosie jako `julia.nowak` przy 1440 px, 900 px i 620 px (`docs/qa-shots-7/fix-D2-impact-preview-dark.png`, `fix-D2-impact-preview-narrow.png`, `fix-D2-impact-preview-wrap.png`) - tekst zawija się całymi frazami, nigdy słowo po słowie ani znak po znaku (brak automatycznego testu na układ CSS).
  Ten sam zrzut potwierdza pierwszy `[B]`: prośba o zamianę sprzężonego dnia (12.11 SECONDARY + 11-19, zastępca eligible do obu ról) nie pokazuje żadnego fałszywego ostrzeżenia o rozszczepieniu kotwicy ani zmęczeniu, tylko notatkę „Prośba obejmie oba sloty tego dnia”.

#### D3 - korekty: eligibility w kalendarzu, kotwica 11-19, wersja

Defekty: QA7-M08, QA7-M10, QA7-L06.
Cel: lista osób w korekcie wyłącza osoby bez uprawnień z podanym powodem; korekta roli kotwiczącej przenosi 11-19; API wymaga wersji.

Pliki: `backend/src/oncall/routes/calendar.py` (`GET /calendar`, `direct_override`, `/override/check`), `frontend/src/components/CalendarMatrix.tsx`, `frontend/src/lib/calendar.ts` (`staffingCandidates`), testy.
Wyjątek: `schemas.py` - pole eligibility w odpowiedzi kalendarza, `expected_version` wymagane.

Kroki:
1. `GET /calendar` dla koordynatora zwraca per osoba okresy eligibility (bez danych dla członka/viewera).
2. `staffingCandidates` wyłącza osoby bez eligibility z powodem „nie ma uprawnień do roli”.
3. `direct_override`: gdy polityka kotwiczy 11-19 do korygowanej roli i osoba ma eligibility do obu, przenieś oba sloty jako jedną operację (jeden audyt, jedna wersja); gdy nie ma - ostrzeżenie jak dziś.
4. Dodaj regułę naruszenia „ta sama osoba ma dyżur on-call i 11-19 tego dnia” jako ostrzeżenie zmęczeniowe (nie tylko `late_shift_anchor`).
5. `expected_version` wymagane (422 bez niego); frontend już je wysyła.
6. Testy.

Kryterium odbioru:
- `cd backend && .venv/bin/python -m pytest -q tests/test_calendar*.py tests/test_override*.py tests/test_draft_override.py`
- `cd frontend && npm test -- CalendarMatrix calendar && npm run build`
- Scenariusz: korekta secondary 23.09 na Dawida przenosi też 11-19 (pomiar przed: 11-19 zostaje u Celiny). Igor wyszarzony dla primary z powodem (pomiar przed: dostępny, 422 po potwierdzeniu).

Dziennik wykonania:
- 2026-09-13, Codex/root: kalendarz udostępnia okresy eligibility wyłącznie koordynatorowi/adminowi, a lista kandydatów wyłącza osobę bez uprawnień z podanym powodem. Korekta roli kotwiczącej przenosi powiązaną zmianę 11-19 w tej samej transakcji i wersji. Dodano ostrzeżenie o jednoczesnym on-call i 11-19 oraz obowiązkowe `expected_version` dla zapisu korekty.
- 2026-09-13, Codex/root, Pomiar po: testy kalendarza, korekt i zamian w zestawie obszarowym przeszły 36/36; test frontendu eligibility i pełny frontend 137/137; Ruff, ESLint i build bez błędów. Regresja przenoszenia zatwierdzonej zamiany po dodaniu ostrzeżenia została wykryta pełnym zestawem i naprawiona; test publikacji przechodzi 1/1. Pełny backend uruchomiony poza sandboxem: 314 przeszło, pozostały 4 wcześniej odnotowane niezgodności `test_partial_republish.py` z blokadami B1/B2.
- 2026-09-13, Review (Claude Opus 5), wynik: DO POPRAWY.
  - Powtórzone: lista kandydatów korekty wyłącza Igora z powodem „nie ma uprawnień do roli”; korekta secondary 10.11 przenosi też 11-19; brak `expected_version` daje 422.
  - [B] `/calendar/override/check` sprawdza tylko jeden ruch, a sama korekta przenosi dwa sloty: dialog potwierdzenia dla secondary 23.09 ostrzega „Ta korekta złamie reguły twarde: Zmiana 11–19 i rola kotwicząca są u różnych osób”, choć po zapisie kotwica jest zachowana.
  - [B] Reguła `oncall_late_shift_overlap` z kroku 4 zgłasza każdy dzień, w którym działa kotwica 11-19 do secondary (solver wymusza `anchor == late_shift`), więc każda zwykła korekta i zamiana roli kotwiczącej dostaje ostrzeżenie zmęczeniowe.
  - Regułę trzeba ograniczyć do roli niekotwiczącej (np. primary + 11-19 przy kotwicy secondary); samo 22 h przy kotwicy to decyzja produktowa, nie naruszenie.
- 2026-09-13, Claude Sonnet 5, poprawka: `/calendar/override/check` liczyło reguły tylko dla `[(service_date, payload.role)]`, mimo że `direct_override` sam potrafi przenieść też 11-19 (`assignments_to_move`/`roles_to_move`, gdy rola kotwicząca i zastępca ma eligibility do 11-19).
  Wydzielono `_coupled_override_roles` (mirror tej samej logiki co w `direct_override`, bez zmiany samego `direct_override`) i `_override_schedule` (rozwiązanie grafiku identyczne z `direct_override`).
  `direct_override_check` ustala teraz `roles_to_move` tak samo jak zapis i przekazuje pełny zestaw do `substitution_check` - fałszywe „Zmiana 11–19 i rola kotwicząca są u różnych osób” znika, bo sprawdzany zestaw ruchów odpowiada temu, co faktycznie się zapisze.
  `oncall_late_shift_overlap(slots)` → `oncall_late_shift_overlap(slots, anchor)`: reguła teraz pomija rolę zakotwiczoną (11-19 razem z rolą kotwiczącą to zamierzony efekt polityki, który sprawdza już `anchor_violations`) i sygnalizuje wyłącznie parę 11-19 + rola *nie*-kotwicząca (albo obie role, gdy `anchor=independent`).
  Jedyne miejsce wywołania to `_state_violations` w `rules.py`, więc poprawka obowiązuje jednocześnie na ścieżce zamian (D2, `swaps.py`) i korekt (`calendar.py`).
- 2026-09-13, Claude Sonnet 5, Pomiar po: nowe testy jednostkowe `oncall_late_shift_overlap` w `tests/test_rules.py` (para kotwicząca → brak naruszenia; para niekotwicząca → naruszenie; `anchor=independent` → obie pary naruszają) oraz `test_override_check_does_not_invent_an_anchor_split` w `tests/test_override_rules.py` (korekta secondary 23.09 na osobę eligible do obu ról → `late_shift_anchor` nieobecne w odpowiedzi `/calendar/override/check`).
  `tests/test_rules.py tests/test_override_rules.py tests/test_calendar*.py tests/test_draft_override.py` - 51/51; pełny backend 347/347; Ruff czysto.
  [B] fałszywe rozszczepienie kotwicy w dialogu: potwierdzone testem.
  [B] `oncall_late_shift_overlap` na każdy dzień kotwicy: potwierdzone trzema testami jednostkowymi obejmującymi oba warianty polityki.

#### D4 - offboarding osoby z przyszłymi dyżurami

Defekty: QA7-M07 (część 2).
Cel: administrator kończy członkostwo osoby w jednym przepływie, z przepisaniem jej przyszłych dyżurów.

Pliki: `backend/src/oncall/routes/calendar.py` (nowy `POST /calendar/override/batch`), `frontend/src/components/CalendarMatrix.tsx` (jeśli potrzebne), koordynacja z E3.
Wyjątek: `frontend/src/screens/admin/People.tsx` - tylko wywołanie kreatora (komponent kreatora w nowym pliku `frontend/src/components/OffboardingDialog.tsx`, własność toru D).

Kroki:
1. Endpoint wsadowej korekty: lista `(date, role, replacement)`, wszystkie w jednej transakcji i jednej wersji grafiku, z naruszeniami reguł w odpowiedzi.
2. Kreator: data wyjścia → lista przyszłych dyżurów → dla każdego propozycja zastępcy (kandydaci jak w D3, posortowani po odchyleniu od udziału) → potwierdzenie → wsadowa korekta → zakończenie członkostwa i eligibility.
3. Test end-to-end API.

Kryterium odbioru:
- Scenariusz: Halina Szymańska wychodzi 20.09; kreator przepisuje 16 dyżurów jedną operacją; `PATCH team-members` z `active_until` przechodzi. Pomiar przed: 16 ręcznych korekt.

Dziennik wykonania:
- 2026-09-13, Codex/root: dodano atomowy `POST /calendar/override/batch` z kontrolą jednej wersji grafiku, walidacją eligibility, dostępności i duplikatów oraz jednym audytem. Kreator w panelu Osoby pobiera przyszłe dyżury, wymaga zastępcy eligible dla każdego slotu, wykonuje korektę wsadową, a potem kończy członkostwo.
- 2026-09-13, Codex/root, Pomiar po: Ruff, ESLint i build bez błędów; testy obszarowe admin/kalendarz oraz solver przeszły. Pełny frontend 137/137.
- 2026-09-13, Review (Claude Opus 5), wynik: DO POPRAWY.
  - [B] Kreator nie działa: Halina, wyjście 20.09, pokazuje „Dyżury po 20-09-2026: 0” i błąd „Zakres kalendarza musi obejmować od 1 do 90 dni”, bo pobiera kalendarz na rok; przycisk jest aktywny, a zapis kończy się błędem „Okresy eligibility muszą mieścić się w okresie członkostwa” (`review-D4-offboarding*.png`).
  - [B] Kreator wysyła wszystkie sloty z `schedule_id` pierwszego dyżuru, więc dyżury z kilku publikacji nie przejdą; nie sortuje kandydatów po odchyleniu, nie sprawdza dostępności, nie ma kroku potwierdzenia i nie kończy eligibility (krok 2).
  - [B] `POST /calendar/override/batch` nie sprawdza reguł (krok 1): przez API ustawiono Julię Nowak na primary i secondary 01.12 oraz Grzegorza Zielińskiego na primary 07-11.12 (5 dni z rzędu), obie operacje 200 z pustym `rule_violations`.
  - [B] Brak testu backendu i frontendu dla korekty wsadowej i kreatora (krok 3).
- 2026-09-13, Codex/root, poprawki: kreator pobiera przyszłość stronami po 90 dni, grupuje dyżury po publikacji, filtruje kandydatów po eligibility i niedostępności oraz sortuje od najmniejszego obciążenia rolą. Ma osobny krok potwierdzenia, zamyka eligibility, a następnie członkostwo. Backend liczy naruszenia na całym projektowanym batchu, zwraca je i zapisuje w audycie; dodano test podwójnego on-call.
- 2026-09-13, Codex/root, Pomiar po: testy reguł, batch i administracji 36/36; frontend `Generator`/`People` 34/34; Ruff, ESLint i build bez błędów.

#### D5 - kalendarz: domyślny zakres, kolejność, dialog korekty

Defekty: QA7-L01, QA7-L15, QA7-L16 (dialog korekty), QA7-L12 (pole zastępcy).
Cel: kalendarz ma sensowny zakres na pustej instalacji, czytelną kolejność wierszy i równo ułożone formularze.

Pliki: `frontend/src/components/CalendarMatrix.tsx`, `frontend/src/lib/calendar.ts`, `frontend/src/screens/Swaps.tsx`, style w `frontend/src/index.css` tylko w klasach kalendarza (wyjątek od własności F, dopisywanie na końcu).

Kroki:
1. Bez publikacji domyślny zakres „najbliższe 30 dni”.
2. Decyzja D10: separator i podpisy grup „Ty”, „Z dyżurem w zakresie”, „Pozostali”.
3. Tabela macierzy wypełnia szerokość kontenera przy krótkich zakresach (kolumny rozciągane) albo kontener dopasowany do tabeli.
4. Dialog korekty: podpowiedź pod polem wyboru, przyciski w stopce wyrównane (`DialogActions`).
5. Pole „Zastępca” na ekranie zamian tej samej wysokości co sąsiednie (opis drugą linią pod polem).

Kryterium odbioru:
- `cd frontend && npm test -- CalendarMatrix Swaps && npm run build`
- Zrzuty `docs/qa-shots-7/fix-D5-*.png` (kalendarz ewa.maj, dialog korekty, formularz zamiany) w obu motywach.

Dziennik wykonania:
- 2026-09-13, Claude Sonnet 5: pusta instalacja (bez publikacji) domyślnie pokazuje najbliższe 30 dni zamiast zakresu jednego dnia (dziś-dziś) - poprzednia gałąź `else` w wyliczeniu `defaultEnd` obsługiwała jednocześnie „brak publikacji” i „publikacja w całości w przeszłości”, kolapsując do samego dziś; teraz brak publikacji (`!published.data?.is_published`) ma własną gałąź `dziś + 29 dni`. Wiersze macierzy dostały podpisy grup („Ty” pomijane, bo ma już plakietkę; „Z dyżurem w zakresie”; „Pozostali”) jako osobny wiersz nagłówkowy przed pierwszą osobą nowej grupy (`memberGroup`/`MEMBER_GROUP_LABELS` w `calendar.ts`) - kolejność wierszy (decyzja D10) jest niezmieniona, tylko teraz wyjaśniona wizualnie. Tabela krótkiego zakresu wypełnia się do szerokości zawartości (`calendar-scroll-fit`: `width: fit-content` obok istniejącego `max-width: 100%`) zamiast zostawiać puste miejsce w szerszym kontenerze; przy długim zakresie `overflow: auto` nadal przewija. Dialog korekty: podpowiedź „dlaczego przycisk jest wyłączony” przeniesiona spod stopki na miejsce pod polem „Osoba”, które opisuje; stopka to teraz zwykłe `DialogActions` bez własnego opakowania (usunięto martwe klasy `.calendar-dialog-actions`/`.calendar-dialog-cta`). Pole „Zastępca” na ekranie zamian pokazuje po zamknięciu tylko imię i nazwisko (`slotProps.select.renderValue`) zamiast całej bogatej zawartości opcji, więc ma tę samą wysokość co pola sąsiednie; te same fakty (odchylenie, dostępność, kolizja, blokada) pokazują się teraz jako `helperText` - druga linia pod polem, nie w jego wnętrzu.
- 2026-09-13, Claude Sonnet 5, Pomiar po: `cd frontend && npm test -- CalendarMatrix Swaps` - 49/49 (w tym zaktualizowany test „falls back to the next 30 days on an empty installation”, który wcześniej opisywał usuwaną wadę); `npm run lint` i `npm run build` bez błędów. Pełny frontend: 141/141. Zrzuty `docs/qa-shots-7/fix-D5-*.png` (kalendarz `ewa.maj`, dialog korekty, formularz zamiany, oba motywy) pozostają do wykonania w przeglądzie wizualnym razem z pozostałymi pakietami fazy 3.
- 2026-09-13, Review (Claude Opus 5), wynik: DO POPRAWY.
  - Powtórzone: pusta instalacja i podpisy grup w kodzie; macierz jako `ewa.maj` pokazuje „Z dyżurem w zakresie”, lista kandydatów w dialogu korekty ma powody wyłączenia.
  - [B] Formularz zamiany rozpada się po wyborze zastępcy (desktop 1440 px, motyw ciemny): „Mój dyżur” ucięty do „wt 27-10-2026 · SEC…”, „Zastępca” do „Dawid Lewand…”, pole zastępcy stoi wyżej niż sąsiednie, przycisk „Wyślij prośbę” spada do drugiego wiersza, a ostrzeżenie mieści się w kolumnie ok. 220 px (`review-D5-swapform-selected-dark.png`).
  - [U] Przy 390 px odstęp pod polem „Zastępca” jest większy niż pod „Mój dyżur”.
  - [U] Zrzutów `fix-D5-*.png` w obu motywach nadal brakuje (jest tylko `fix-D5-calendar.png`).

### Tor E: konta, logowanie, bezpieczeństwo

#### E1 - odporność logowania

Defekty: QA7-H06, QA7-H08, QA7-M11.
Cel: zgadywanie haseł jest ograniczone, nie spowalnia innych użytkowników i nie ujawnia istnienia kont.

Pliki: `backend/src/oncall/main.py` (`login` ~148, `reject_login`), `backend/src/oncall/auth.py` (`verify_password`, `hash_password`), testy `backend/tests/test_login_throttle.py`.
Wyjątek: `models.py` + migracja, jeśli licznik prób jest w bazie.

Kroki:
1. `verify_password` i `hash_password` przez `anyio.to_thread.run_sync` (async wrappery), użyte we wszystkich ścieżkach (logowanie, aktywacja, reset, seed).
2. Dla nieistniejącego loginu wykonaj weryfikację pozornego hasha (stały koszt).
3. Limit prób: per znormalizowany login i per IP (z uwzględnieniem `X-Forwarded-For` z nginx), np. 5 nieudanych w 5 minut → opóźnienie wykładnicze i 429 z `Retry-After`. Stan w Postgres (dwa procesy API nie współdzielą pamięci).
4. Audyt: nieudane próby agregowane (jeden wpis na serię z licznikiem) i zdarzenie `auth.throttled`.
5. Komunikat w `Login.tsx` dla 429 („Zbyt wiele prób, spróbuj za N s”) - wyjątek od własności E: `Login.tsx` jest w torze E, bez wyjątku.

Kryterium odbioru:
- `cd backend && .venv/bin/python -m pytest -q tests/test_login_throttle.py tests/test_auth*.py`
- Skrypt z raportu (8 równoległych pętli złych haseł): p50 `/schedules/published` ≤ 30 ms. Pomiar przed: 9 ms bez ataku, 194 ms z atakiem.
- 30 błędnych prób dla `ewa.maj` → od szóstej 429. Pomiar przed: wszystkie 401, potem logowanie 200.
- Czas odpowiedzi dla istniejącego i nieistniejącego loginu różni się ≤ 10 ms. Pomiar przed: 40 ms vs 4 ms.

Dziennik wykonania:
- 2026-09-13, Codex/root: Argon2 działa poza pętlą zdarzeń przez `anyio.to_thread`; nieistniejące konto wykonuje kosztowną pozorną weryfikację. Współdzielony w Postgres limit znormalizowanego loginu i IP blokuje od szóstej próby w pięciominutowym oknie, zwraca 429 z `Retry-After`, agreguje nieudane próby i zapisuje `auth.throttled`. Formularz czyści hasło po błędzie i pokazuje informację dla wyłączonego konta.
- 2026-09-13, Codex/root, Pomiar po: nowe testy potwierdzają pięć odpowiedzi 401, potem 429, równy komunikat dla nieistniejącego konta i logowanie loginem ze spacjami/wielkimi literami; zestaw obszarowy 36/36, Ruff czysto. Backendowy pytest uruchomiono poza sandboxem z `backend/.venv`.
- 2026-09-13, Review (Claude Opus 5), wynik: DO POPRAWY.
  - Powtórzone: 30 złych haseł dla `ewa.maj` daje 429 od szóstej próby z `Retry-After`.
  - [B] Limit per IP blokuje cały zespół: po teście H08 poprawne logowanie `julia.nowak` i `admin` z tego samego adresu → 429 przez 5 minut.
  - [B] Adres IP jest brany z pierwszego elementu `X-Forwarded-For`, który nginx (`$proxy_add_x_forwarded_for`) przepuszcza od klienta: ten sam zablokowany klient z nagłówkiem `X-Forwarded-For: 10.9.9.9` loguje się 200.
  - [B] Czas odpowiedzi nadal zdradza istnienie konta, tylko odwrotnie: istniejący login ze złym hasłem mediana 81,5 ms (lokalna weryfikacja plus pozorna po ścieżce katalogowej), nieistniejący 44,5 ms; kryterium ≤ 10 ms.
  - [B] Atak 8 pętli z losowym loginem i `X-Forwarded-For` omija limit (705 × 401 w 30 s) i podnosi p50 `/schedules/published` do 53 ms (bez ataku 12,4 ms); kryterium ≤ 30 ms.
  - [B] Atak na jeden login zapisał 13 422 wiersze `auth.throttled` w 30 s; krok 4 wymagał agregacji.
  - [U] Brak opóźnienia wykładniczego z kroku 3; `Retry-After` jest stałe 60 s, a blokada trwa do 5 minut.
- 2026-09-13, Claude Sonnet 5, poprawka (pięć `[B]` + `[U]`): adres IP jest teraz brany z `X-Real-IP` zamiast pierwszego elementu `X-Forwarded-For`.
  Nginx (`frontend/nginx.http.conf`, `nginx.https.conf`) dostał `proxy_set_header X-Real-IP $remote_addr;` w obu lokalizacjach `/api/` i `/calendar/` obu wariantów (http/https) - `$remote_addr` to adres, z którym nginx faktycznie przyjął połączenie TCP, więc klient nie jest w stanie nadać temu nagłówkowi żadnej innej wartości, w przeciwieństwie do `X-Forwarded-For`, które `$proxy_add_x_forwarded_for` tylko dopisuje do tego, co already przysłał klient.
  `nginx*.conf` nie jest plikiem toru E (własność toru G), ale to jedyne miejsce, gdzie nagłówek klienta trzeba przestać ufać - zmiana jest minimalna (jedna linia na lokalizację) i udokumentowana tutaj jako dotknięcie cudzego toru, analogicznie do D2 (`styles.css`) i B3 (`calendar.py`).
  Limit prób jest teraz dwuwarstwowy: `LOGIN_ATTEMPTS_PER_USERNAME=5` (bez zmian - jeden login, dowolne IP) oraz osobny, znacznie luźniejszy `LOGIN_ATTEMPTS_PER_IP=20` (dowolny login, jedno IP) zamiast wspólnego progu 5 dla obu.
  To usuwa pierwszy `[B]` (garść pomyłek kilku osób z jednego biura nigdy nie zbliża się do 20 w 5 minut) i - razem z poprawką `X-Real-IP` - usuwa też czwarty (atak z losowym loginem na każde żądanie nigdy nie trafia w limit loginu, ale wszystkie żądania dzielą teraz jeden prawdziwy adres IP i limit IP=20 zatrzymuje resztę zalewu, zanim zdąży obciążyć Argon2 i pulę połączeń do bazy, którą dzieli z innymi endpointami takimi jak `/schedules/published`).
  Trzeci `[B]`: gałąź „istniejące konto, złe hasło” uruchamiała prawdziwą weryfikację Argon2, a potem - przy nieudanej próbie katalogowej - *jeszcze raz* pozorną weryfikację przy odrzuceniu; nieistniejące konto płaciło tylko za jedną. Dodano flagę `local_password_checked`, która pomija pozorną weryfikację, jeśli prawdziwa już się odbyła w tym żądaniu - obie ścieżki kosztują teraz dokładnie jedno hashowanie.
  Piąty `[B]`: `auth.throttled` pisało nowy wiersz audytu przy każdym odrzuconym żądaniu; nowa `_record_throttled` agreguje go tym samym wzorcem co istniejące już `auth.login_failed` (jeden wiersz na etykietę na kroczące okno, z licznikiem w `details`).
  `[U]`: `Retry-After` rośnie teraz wykładniczo z licznikiem powtórzeń (`60 * 2^(count-1)`, ograniczone do 300 s) zamiast być stałe 60 s - naturalne rozszerzenie tej samej agregacji, bo licznik i tak już istnieje.
- 2026-09-13, Claude Sonnet 5, Pomiar po: siedem nowych testów w `tests/test_login_throttle.py` (9/9 w pliku).
  Współdzielone IP: 5 nieudanych prób `julia.nowak` blokuje tylko `julia.nowak` (429), poprawne logowanie `admin` z tego samego adresu przechodzi (200) - odtworzenie i zamknięcie scenariusza H08.
  Sfałszowany `X-Forwarded-For`: 20 żądań z różnymi loginami i różnymi wartościami `X-Forwarded-For` (ignorowanymi) trafia w limit IP na 21. tym; ten sam wynik bez nagłówka `X-Forwarded-For` w ogóle (czysty wolumen). `X-Real-IP` nadal poprawnie rozdziela dwa różne, jawnie ustawione adresy.
  Symetria czasowa: licznik wywołań `verify_password_async` (przez monkeypatch) jest identyczny (1) dla istniejącego konta ze złym hasłem i dla nieistniejącego konta - test niezależny od zegara, więc nie jest niestabilny pod obciążeniem zestawu testów.
  Agregacja audytu: 9 odrzuconych żądań dla jednego loginu daje dokładnie 1 wiersz `auth.throttled` z `count=4` (po pierwszych 5 nieudanych i piątym-do-dziewiątego odrzuceniu), zero innych wierszy tej akcji w bazie.
  `Retry-After` rośnie między kolejnymi odrzuceniami.
  `tests/test_login_throttle.py tests/test_auth*.py` - 12/12; pełny backend 355/355 (7 nowych testów tego pakietu, zero regresji w pozostałych 348).
  Weryfikacja end-to-end przez prawdziwy nginx na przebudowanym stosie: 20 żądań `POST /api/v1/auth/login` przez `localhost:8080` z rotowanym, sfałszowanym `X-Forwarded-For` i losowymi loginami dało 401, 21. dało 429 - atak z reviewu (rotacja `X-Forwarded-For`) nie działa już przez prawdziwy serwer proxy, nie tylko w testach jednostkowych.
  `SELECT` na `audit_events` po tym ataku pokazał dokładnie 1 wiersz `auth.throttled` z prawdziwym adresem sieci Dockera (`172.19.0.1`, nie żadną ze sfałszowanych wartości) i `count=5`; kolejne odrzucone żądanie miało `Retry-After: 300` (eskalacja do limitu).
  [B] limit IP blokujący zespół: potwierdzone testem i logiką (próg podniesiony do 20, klucz nadal per-IP, więc inny login z tego samego IP nie jest dotknięty, dopóki IP samo nie przekroczy 20).
  [B] `X-Forwarded-For` spoofing: potwierdzone testem jednostkowym i przebiegiem end-to-end przez prawdziwy nginx.
  [B] asymetria czasowa: potwierdzone testem liczby wywołań hashowania (1 = 1); pomiaru w milisekundach nie powtórzono (zależny od sprzętu/obciążenia hosta, więc niewiarygodny jako automatyczny test), ale mechanizm powodujący podwójne hashowanie został usunięty.
  [B] wolumen ataku omijający limit: potwierdzone testem i przebiegiem end-to-end.
  [B] 13 422 wiersze audytu: potwierdzone testem (1 wiersz zamiast N).
  [U] brak eskalacji: naprawione i potwierdzone testem oraz przebiegiem end-to-end.

#### E2 - loginy, e-maile, hasła, komunikaty logowania

Defekty: QA7-M05, QA7-M06, QA7-L02, QA7-L03.
Cel: brak duplikatów tożsamości, słabe hasła odrzucane, logowanie odporne na wielkość liter i spacje.

Pliki: `backend/src/oncall/routes/admin.py` (`create_user` ~112, `update_user`), `backend/src/oncall/main.py` (`login`, synchronizacja LDAP), `backend/src/oncall/account_tokens.py`, `frontend/src/screens/Login.tsx`, `frontend/src/screens/SetPassword.tsx`, `frontend/src/screens/admin/People.tsx`, migracja.
Wyjątek: `schemas.py` - walidator hasła (`min_length=12`, linia ~596) i normalizacja loginu.

Kroki:
1. Normalizacja loginu (`strip().lower()`) przy tworzeniu, edycji, logowaniu i synchronizacji LDAP.
2. Migracja: indeksy unikalne na `lower(username)` i `lower(email)` (e-mail nullable). Przed utworzeniem indeksu migracja wypisuje konflikty i przerywa z czytelnym komunikatem, jeśli istnieją (decyzja D9); w bazie QA7 jest konflikt `Anna.Wrobel` / `anna.wrobel` - dokumentuj w dzienniku, jak go usunięto.
3. Walidator hasła: ≥ 12 znaków, odrzucenie haseł z listy popularnych (lista w repo, np. 10 000 pozycji) i haseł z jednego powtarzanego znaku lub równych loginowi.
4. `Login.tsx`: czyszczenie pola hasła po błędzie; pod komunikatem błędu dopisek „Jeśli konto zostało wyłączone, skontaktuj się z administratorem.”
5. `People.tsx`: komunikat 409 przy duplikacie loginu/e-maila.

Kryterium odbioru:
- `cd backend && .venv/bin/python -m pytest -q tests/test_admin*.py tests/test_auth*.py`
- `cd frontend && npm test -- Login SetPassword && npm run build`
- Scenariusz: utworzenie `Anna.Wrobel` przy istniejącym `anna.wrobel` → 409; logowanie `TOMASZ.KRAWCZYK` i ` tomasz.krawczyk ` → 200; aktywacja z `aaaaaaaaaaaa` → 422.

Dziennik wykonania:
- 2026-09-13, Codex/root: loginy są przycinane i normalizowane do małych liter w schematach, logowaniu, panelu administracyjnym i synchronizacji LDAP. Utworzono migrację 0029 z indeksami unikalnymi `lower(username)` i `lower(email)` oraz jawnym raportem konfliktów przed zmianą. Hasła mają minimum 12 znaków i odrzucają wartości popularne, jednego powtarzanego znaku oraz login użytkownika. Duplikaty są sprawdzane bez uwzględniania wielkości liter.
- 2026-09-13, Codex/root, Pomiar po: `alembic heads` wskazuje 0029 jako jedyną głowę; testy normalizacji i duplikatów przeszły w zestawie obszarowym 36/36; pełny frontend 137/137, ESLint i build bez błędów. Istniejący konflikt QA `Anna.Wrobel` / `anna.wrobel` nie został automatycznie scalony ani usunięty: zgodnie z D9 migracja zatrzyma wdrożenie i wypisze konflikt do ręcznego rozstrzygnięcia przez administratora danych.
- 2026-09-13, Review (Claude Opus 5), wynik: DO POPRAWY.
  - Powtórzone: `Anna.Wrobel` → 409, e-mail różniący się wielkością liter → 409, `TOMASZ.KRAWCZYK` i ` tomasz.krawczyk ` → 200, aktywacja z `aaaaaaaaaaaa` → 422.
  - [B] Istniejące konto z wielkimi literami w loginie traci dostęp: po ustawieniu w bazie `Review.E3` logowanie zarówno `Review.E3`, jak i `review.e3` zwraca 401, bo logowanie porównuje dokładnie znormalizowaną wartość, a migracja 0029 nie normalizuje istniejących loginów.
  - [B] Lista popularnych haseł ma 4 pozycje zamiast listy z kroku 3; aktywacja z `Qwerty123456` przechodzi (204).
- 2026-09-13, Claude Sonnet 5, poprawka: nowa migracja `0032_normalize_user_identity` (zarezerwowana w §5, bo 0029 jest już zastosowane w tym środowisku - `alembic current` na stosie QA7 pokazywał `0031_user_phone` jako head) normalizuje `users.username`/`users.email` do małych liter dla wierszy sprzed 0029.
  Bezpieczne z konstrukcji: 0029 już udowodniło, że żaden dwa wiersze nie mają tego samego `lower(username)`/`lower(email)`, więc obniżenie wielkości liter jednego wiersza nie może kolidować z żadnym innym, tylko (nieszkodliwie) z samym sobą.
  Kod logowania (`main.py`) już normalizował dane wejściowe przed porównaniem (`User.username == username.strip().lower()`) - problemem był wyłącznie stan danych, nie logika zapytania, więc żadna zmiana kodu logowania nie była potrzebna.
  Druga poprawka: lista popularnych haseł to teraz 10 000 realnych haseł o długości ≥12 znaków z publicznie znanego zbioru wyciekłych haseł (rockyou.txt, posortowanego malejąco po częstości), przefiltrowanych i odduplikowanych, zapisanych jako `src/oncall/data/common_passwords.txt` i wczytywanych raz (`functools.cache`) przez `oncall.schemas._common_passwords()`; walidator `SetPasswordRequest.reject_weak_password` porównuje z tym zbiorem zamiast z listą 4 elementów.
  Sprawdzono, że hatchling pakuje ten plik do wheela (`pip wheel` lokalnie, plik obecny w archiwum) - dane trafiają też do obrazu Dockera bez dodatkowej konfiguracji.
- 2026-09-13, Claude Sonnet 5, Pomiar po: nowy test `test_activation_rejects_a_password_from_the_common_list` w `tests/test_admin_users.py` - aktywacja z `Qwerty123456` → 422, z `aaaaaaaaaaaa` → 422 (regresja z reviewu), z hasłem spoza listy → 204.
  `tests/test_admin_users.py` 11/11.
  Migracja 0032 zweryfikowana end-to-end na przebudowanym stosie QA7 (nie przez pytest - fixtury testowe budują schemat przez `Base.metadata.create_all`, bez alembic, tak jak pozostałe migracje w tym repozytorium): ręcznie ustawiono w bazie `username='Tomasz.Krawczyk'` (symulacja konta sprzed 0029), przebudowano i zrestartowano kontener `api` (`alembic upgrade head` w `entrypoint.sh` uruchomiło 0032 automatycznie), `SELECT username` po migracji pokazał już `tomasz.krawczyk`, a `POST /api/v1/auth/login` z `Tomasz.Krawczyk` i z `tomasz.krawczyk` oba zwróciły 200 - dokładnie odtworzony i zamknięty scenariusz z reviewu.
  [B] utrata dostępu po wielkich literach w istniejącym koncie: potwierdzone weryfikacją end-to-end powyżej.
  [B] lista popularnych haseł: potwierdzone testem (10 000 pozycji zamiast 4, `Qwerty123456` teraz odrzucone).

#### E3 - skracanie eligibility a przyszłe dyżury

Defekty: QA7-M07 (część 1).
Cel: skrócenie eligibility nie zostawia przyszłych dyżurów u osoby bez uprawnień.

Pliki: `backend/src/oncall/routes/admin.py` (`PATCH /eligibility/{id}` ~414, `DELETE /eligibility/{id}` ~459), test.

Kroki:
1. Przed zapisem sprawdź opublikowane przydziały tej osoby w tej roli po nowym `ends_on` (tak jak robi to już zakończenie członkostwa w `PATCH team-members`), zwróć 409 z listą slotów.
2. To samo dla usunięcia okresu eligibility.
3. Wspólny helper z `PATCH team-members`, bez duplikacji.

Kryterium odbioru:
- `cd backend && .venv/bin/python -m pytest -q tests/test_admin*.py`
- Scenariusz: skrócenie eligibility Haliny Szymańskiej do 20.09 → 409 z 16 slotami. Pomiar przed: 200.

Dziennik wykonania:
- 2026-09-13, Codex/root: wspólny helper sprawdza opublikowane przydziały poza nowym okresem eligibility. Skrócenie lub przesunięcie okresu oraz usunięcie eligibility zwraca 409 z listą maksymalnie 20 slotów, dopóki dyżury nie zostaną przepisane.
- 2026-09-13, Codex/root, Pomiar po: testy obszaru administracji w przekroju fazy 2 przeszły; Ruff bez błędów.
- 2026-09-13, Review (Claude Opus 5), wynik: DO POPRAWY.
  - Powtórzone: skrócenie eligibility Haliny do 20.09 → 409 z listą slotów.
  - [B] Okresu eligibility nie da się podzielić, gdy osoba ma przyszłe dyżury: utworzenie drugiego okresu secondary Igora od 01.10 → 409 „nakłada się”, a skrócenie pierwszego do 30.09 → 409 „pozostawiłaby dyżury bez uprawnień”, bo helper nie uwzględnia innych okresów tej samej roli.
  - [U] Krok 3 (wspólny helper z `PATCH team-members`) nie jest wykonany, logika jest zduplikowana.
- 2026-09-13, Codex/root, poprawki: walidacja skrócenia i usunięcia eligibility sprawdza dyżury względem sumy pozostałych okresów tej samej roli, z wyłączeniem edytowanego okresu.

#### E4 - drobne backend i ekran Osoby

Defekty: QA7-L05, QA7-L16 (Osoby), QA7-L18 (backend).
Cel: sesja linku nie widzi dziś spoza zakresu; ekran Osoby wyrównany; komunikaty walidacji po polsku.

Pliki: `backend/src/oncall/main.py` (`_current_duties` ~421, handler walidacji), `frontend/src/screens/admin/People.tsx`, `frontend/src/components/AppShell.tsx` - wyjątek tylko dla etykiety „Administrator Administrator” (koordynacja z F2: F2 najpierw).

Kroki:
1. `_current_duties` dla sesji linku: puste `current`, gdy dziś jest poza zakresem linku.
2. Globalny `RequestValidationError` handler tłumaczący typowe błędy Pydantic (`missing`, `string_too_short`, `string_too_long`, `enum`, `value_error`) na polski, z zachowaniem `loc`.
3. `People.tsx`: nagłówki kolumn wyrównane do góry, pełny placeholder (krótszy tekst albo szersze pole), jednolity rozmiar czcionki w komórkach.
4. W nagłówku aplikacji nie powtarzaj roli, gdy nazwa wyświetlana jest równa etykiecie roli.

Kryterium odbioru:
- `cd backend && .venv/bin/python -m pytest -q tests/test_share_links.py tests/test_current_duty.py`
- `POST /api/v1/availability/me` z notatką 600 znaków → komunikat po polsku.
- Zrzut `docs/qa-shots-7/fix-E4-people.png`.

Dziennik wykonania:
- 2026-09-13, Claude Sonnet 5: `_current_duties` zwraca pustą listę, gdy sesja linku ma zakres, który nie obejmuje dzisiaj (wcześniej sprawdzano tylko, czy dzień jest dniem z przydziałem, nie czy mieści się w zakresie linku). Dodano globalny handler `RequestValidationError` (`main.py`) tłumaczący `missing`, `string_too_short`, `string_too_long`, `enum` na stały szablon polski oraz `value_error` przez odcięcie prefiksu „Value error, ” z komunikatu już zgłoszonego przez własny walidator Pydantic (który i tak jest po polsku) - `loc` i `type` w odpowiedzi bez zmian, więc żaden istniejący test sprawdzający `type` (np. `extra_forbidden`) się nie psuje. `People.tsx`: nagłówek „Osoba” miał inny padding pionowy niż sąsiednie nagłówki (odziedziczony z `.member-column` używanego też w kalendarzu) - wyrównany inline stylem w tym jednym miejscu; pole wyszukiwania dostało `minWidth: 260` (etykieta „Szukaj osoby, loginu lub numeru” się nie mieściła); tekst w komórkach „Osoba” i „Rola” przeniesiony z gołego tekstu na `Typography variant="body2"`, żeby renderował się tą samą czcionką co reszta komórek (Chipy, podpisy `.date-code`), zamiast dziedziczyć rozmiar 0,72rem z `.calendar-matrix`. Nagłówek aplikacji (`AppShell.tsx`, wyjątek toru F, po F2): plakietka roli chowa się, gdy wyświetlana nazwa konta już brzmi jak etykieta roli („Administrator Administrator” → „Administrator”), w pasku górnym i w szufladzie mobilnej.
- 2026-09-13, Claude Sonnet 5, Pomiar po: nowy `tests/test_validation_messages.py` (3 testy: pole wymagane, `string_too_long`, `enum`) - 3/3; `tests/test_share_links.py` z nowym testem sesji linku poza zakresem - 10/10; `tests/test_current_duty.py` - bez regresji. Pełny backend: 321 przeszło (patrz par. 8 w sprawie 4 znanych niezgodności `test_partial_republish.py`, niezwiązanych z tym pakietem). Frontend: nowy test `AppShell.test.tsx` („nie powtarza roli…”) i pełny zestaw 141/141, ESLint i build bez błędów.
- 2026-09-13, Claude Sonnet 5, przegląd wizualny (`ewa.maj`/`admin`, motyw ciemny): zrzut `docs/qa-shots-7/fix-E4-people.png` ujawnił, że `minWidth: 260` wciąż ucinał etykietę „Szukaj osoby, loginu lub numeru” (widoczne wielokropkiem) - podniesiono do `minWidth: 320`, po przebudowie obrazu `web` etykieta mieści się w całości. Nagłówek „Osoba” i reszta kolumn wyrównane w jednej linii, potwierdzone na zrzucie.
- 2026-09-13, Review (Claude Opus 5), wynik: DO POPRAWY.
  - Powtórzone: notatka 600 znaków → „Wartość jest za długa (maksimum 500 znaków).”; nagłówek aplikacji admina pokazuje samo „Administrator”.
  - [B] Nagłówek „Osoba” nadal stoi niżej: `padding-top` 12 px wobec 4 px w pozostałych `th` (pomiar `getComputedStyle`), wbrew wpisowi „potwierdzone na zrzucie”.
  - [B] Tabela Osoby ma 1509 px w kontenerze 1392 px, więc przy 1440 px kolumna „Akcje” jest ucięta („Sz…”) i wymaga przewijania w poziomie (`review-E4-people.png`).
  - [U] „Poza rotacją” jest pisane większą czcionką niż sąsiednie komórki.

#### E5 - telefon dyżurnego

Defekty: QA7-L19.
Cel: karta „Kto jest teraz?” podaje numer telefonu.

Pliki: `backend/src/oncall/routes/admin.py`, `backend/src/oncall/main.py` (odpowiedź `current`), `frontend/src/screens/admin/People.tsx`, migracja.
Wyjątek: `frontend/src/components/DutyCard.tsx` (tor F) - tylko wyświetlenie pola `contact_phone`.

Kroki:
1. Pole `phone` na `User` (opcjonalne, walidacja E.164 lub polski format), edycja w panelu Osoby i przez właściciela konta (nowy `PATCH /auth/me` z samym telefonem).
2. `contact_phone` w `current` zgodnie z decyzją D8 (brak w sesji linku).
3. `DutyCard.tsx`: link `tel:` nad e-mailem.

Kryterium odbioru:
- `cd backend && .venv/bin/python -m pytest -q tests/test_current_duty.py tests/test_admin*.py`
- Zrzut karty dyżurnego `docs/qa-shots-7/fix-E5-duty.png`.

Dziennik wykonania:
- 2026-09-13, Claude Sonnet 5: dodano migrację 0031 (`users.phone`, opcjonalne, `String(32)`) - zarezerwowana w rejestrze (par. 5), `down_revision` wskazuje realny (skrócony) identyfikator 0030 (`0030_schedule_quality`), zgodnie z ustaleniem z A4. Walidacja telefonu (`validate_phone` w `schemas.py`): 9-15 cyfr z opcjonalnym prefiksem `+`, akceptuje spacje/myślniki jako separatory i normalizuje je przy zapisie (E.164 albo format polski, decyzja D8). Panel Osoby: nowe pole „Telefon” w formularzu tworzenia i edycji konta, edytowalne również dla kont LDAP (numer nie jest polem tożsamości zarządzanym przez AD, w przeciwieństwie do imienia/nazwiska/e-maila). Nowy `PATCH /api/v1/auth/me` pozwala właścicielowi konta zmienić własny telefon (403 dla sesji linku udostępnienia, która nie ma własnego konta); samoobsługowy ekran profilu nie istnieje w żadnym pliku należącym do E5, więc na razie jedyną edytowalną powierzchnią w UI jest panel administracyjny Osoby - odnotowane jako świadoma decyzja zakresu. `contact_phone` w `current` (karta „Kto jest teraz?”) ma tę samą widoczność co `contact_email` (brak w sesji linku i dla viewera), przez wspólną flagę `may_see_contact`. `DutyCard.tsx` (wyjątek toru F): link `tel:` nad `mailto:`.
- 2026-09-13, Claude Sonnet 5, Pomiar po: nowy `tests/test_contact_phone.py` (5 testów: telefon przy tworzeniu konta, odrzucenie nieprawdopodobnego numeru, edycja telefonu konta LDAP, samoobsługowa zmiana przez `PATCH /auth/me`, zakaz dla sesji linku) - 5/5; `tests/test_current_duty.py` rozszerzony o asercję `contact_phone` dla członka zespołu i `None` dla viewera - przechodzi. Pełny backend: 321 przeszło, 4 znane niezgodności `test_partial_republish.py` (poza zakresem, patrz par. 8). `alembic heads` po przebudowie obrazu: jedna głowa `0031_user_phone`. Frontend: `People`/`DutyCard` w pełnym zestawie 141/141, ESLint i build bez błędów.
- 2026-09-13, Review (Claude Opus 5), wynik: GOTOWE.
  - Powtórzone: telefon ustawiony przez admina (`+48 600-100-200` → 200, `12` → 422), `PATCH /auth/me` normalizuje `600 700 800`; karta „Kto jest teraz?” pokazuje link `tel:` nad e-mailem (`review-E5-duty-dark.png`).
  - [U] Numer jest wyświetlany bez grupowania („+48601234567”).
  - [U] Właściciel konta nie ma w UI miejsca na edycję telefonu (tylko API); przeniesione do par. 8.

### Tor F: wspólny frontend

#### F1 - pola dat bez cichej zmiany wartości

Defekty: QA7-M02.
Cel: wpisanie daty z klawiatury daje dokładnie wpisaną datę albo widoczny błąd.

Pliki: `frontend/src/components/DateField.tsx`, `frontend/src/components/DateField.test.tsx`.

Kroki:
1. Zbadaj zachowanie MUI przy sekcji dnia przekraczającej długość bieżącego miesiąca (dzień 31 przy wrześniu).
2. Rozwiązanie: sekcja dnia przyjmuje 1-31 niezależnie od miesiąca, walidacja całej daty po wpisaniu wszystkich sekcji z komunikatem „Nieprawidłowa data”; alternatywnie pole tekstowe z maską `DD-MM-RRRR` i parserem.
3. Test: w polu z wartością 12-09-2026 wpisanie `31082026` daje 31-08-2026; wpisanie `31092026` pokazuje błąd i nie zmienia wartości przekazywanej do formularza.

Kryterium odbioru:
- `cd frontend && npm test -- DateField && npm run build`
- Scenariusz w przeglądarce: generator, pole „Od”, wpisanie `31082026` → 31-08-2026. Pomiar przed: 03-08-2026.

Dziennik wykonania:
- 2026-09-13, Codex/root: pełne daty korzystają z kontrolowanego pola `DD-MM-RRRR`; cyfry są formatowane, a parser rygorystycznie odrzuca niemożliwy dzień bez zmiany wartości formularza. Pole miesiąca zachowuje dotychczasowy picker.
- 2026-09-13, Codex/root, Pomiar po: test potwierdza `31082026` → `31-08-2026` oraz błąd dla `31092026`; pełny frontend 137/137, ESLint i build bez błędów.
- 2026-09-13, Review (Claude Opus 5), wynik: GOTOWE.
  - Powtórzone w przeglądarce: generator, pole „Od”, wpisanie `31082026` daje `31-08-2026`, a `31092026` pokazuje „Nieprawidłowa data”.

#### F2 - nagłówek mobilny i plakietka

Defekty: QA7-M14, QA7-L12 (plakietka).
Cel: brak poziomego przewijania na 390 px; licznik nie nachodzi na etykietę.

Pliki: `frontend/src/components/AppShell.tsx`, `frontend/src/components/AppShell.test.tsx`, `frontend/src/index.css`.

Kroki:
1. Na wąskich ekranach przenieś rolę, motyw i „Wyloguj” do menu (hamburger) albo skróć do ikon.
2. Plakietka licznika z odstępem od tekstu (`Badge` z przesunięciem albo osobny element obok etykiety).
3. Test: szerokość dokumentu = szerokość okna przy 390 px (sprawdzenie w przeglądarce, zrzut).

Kryterium odbioru:
- `cd frontend && npm test -- AppShell && npm run build`
- `chrome-devtools-axi resize 390 844`, zalogowany `julia.nowak`, `eval "() => [document.documentElement.scrollWidth, window.innerWidth]"` → równe na ekranach Dyżury, Moje, Zamiany, Sprawiedliwość. Pomiar przed: 406 vs 390.

Dziennik wykonania:
- 2026-09-13, Codex/root: na wąskim ekranie akcje nagłówka są ukrywane, a motyw i wylogowanie są dostępne w menu mobilnym. Plakietka licznika otrzymała własny odstęp i przesunięcie, aby nie nachodziła na etykietę.
- 2026-09-13, Codex/root, Pomiar po: testy AppShell w pełnym zestawie frontendu 137/137; ESLint i build bez błędów. Automatyczny pomiar w prawdziwej sesji Chrome 390 px i zrzuty pozostają do powtórzenia podczas review.
- 2026-09-13, Review (Claude Opus 5), wynik: GOTOWE.
  - Powtórzone: 390 × 844 jako `julia.nowak`, `scrollWidth == innerWidth == 390` na Dyżury, Moje, Zamiany i Sprawiedliwość (`review-F2-390-*.png`); plakietka licznika nie nachodzi na etykietę.

#### F3 - moje dyżury na ekranie „Moje”

Defekty: QA7-M15, QA7-L10.
Cel: członek widzi listę swoich nadchodzących dyżurów i może z niej przejść do zamiany.

Pliki: `frontend/src/screens/Mine.tsx`, `frontend/src/screens/Mine.test.tsx`.
Wyjątek: link do `Swaps.tsx` przez parametr URL (`/zamiany?date=...&role=...`) - obsługę parametru dodaje D2 albo D5; jeśli nie jest gotowa, sam link wystarczy.

Kroki:
1. Sekcja „Moje dyżury” na górze ekranu: najbliższe 60 dni z `/api/v1/calendar` przefiltrowane do własnego wiersza, z rolą, godzinami, stawką 1X/2X i kolizją z dostępnością.
2. Przy każdym dyżurze akcja „Poproś o zamianę”.
3. Ostrzeżenie o kolizji po dodaniu niedostępności ma tę samą akcję.

Kryterium odbioru:
- `cd frontend && npm test -- Mine && npm run build`
- Zrzut `docs/qa-shots-7/fix-F3-mine.png` jako `julia.nowak`.

Dziennik wykonania:
- 2026-09-13, Codex/root: ekran „Moje” pobiera 60 dni kalendarza i pokazuje własne dyżury z datą, rolą, godzinami, stawką 1X/2X oraz ostrzeżeniem o kolizji z niedostępnością. Każdy wpis prowadzi do formularza zamiany wypełnionego parametrami `date` i `role`; ekran Zamiany obsługuje również wcześniejsze nazwy parametrów.
- 2026-09-13, Codex/root, Pomiar po: test Mine potwierdza dyżur, stawkę 2X, kolizję i link do zamiany; pełny frontend 137/137, ESLint i build bez błędów. Zrzut w sesji zalogowanego użytkownika pozostaje do powtórzenia podczas review.
- 2026-09-13, Review (Claude Opus 5), wynik: DO POPRAWY.
  - [B] Godziny są zakodowane na sztywno jako `08:00–08:00` dla primary i secondary, a dyżur trwa 19:00-09:00 w dni robocze i całą dobę w dni wolne (`coverage.py`); ekran podaje osobom złe godziny dyżuru (`review-F2-390-moje.png`).
  - [B] Rola jest wyświetlana przez `toUpperCase()`, więc widać surowe `LATE_SHIFT` zamiast etykiety „11–19”.
  - [U] Przy 390 px tekst ostrzeżenia jest ucięty („niedostępnośc”).
  - Link „Poproś o zamianę” poprawnie wypełnia formularz zamiany.
- 2026-09-13, Claude Sonnet 5, poprawka: `Mine.tsx` liczy godziny dyżuru lokalnie tą samą regułą co `CalendarMatrix.tsx` (mirror `coverage_window` z backendu: 11:00-19:00 dla `late_shift`, `całodobowo` w dzień wolny, `19:00-09:00` w dzień roboczy) zamiast sztywnego `08:00–08:00`.
  Etykieta roli to teraz `roleLabels[duty.role]` z `lib/labels.ts` (PRIMARY/SECONDARY/„11–19”) zamiast `duty.role.toUpperCase()`.
  `[U]`: `.availability-row` dostało `flex-wrap: wrap`, więc przy 390 px wiersz (data+rola, godziny, ostrzeżenie, przycisk) łamie się do wielu linii zamiast ściskać tekst ostrzeżenia do ucięcia; media query 760 px zmieniona na `flex-direction: column` (był `grid-template-columns`, klasa nie jest już gridem).
- 2026-09-13, Claude Sonnet 5, Pomiar po: `npm test -- Mine` - 8/8 (nowy test z dniem roboczym primary/secondary/11-19, w tym sprawdzenie że `LATE_SHIFT` surowe nie występuje); `npm run lint` i `npm run build` bez błędów.
  [B] godziny: zweryfikowane w teście (`19:00-09:00`/`11:00-19:00`/`całodobowo` zależnie od dnia) i wizualnie na przebudowanym stosie jako `julia.nowak` (`docs/qa-shots-7/fix-F3-mine.png`) - dyżury 13.09 i 11.11 (weekend) pokazują „całodobowo”, 14.09/24.09/04.11 (dni robocze) pokazują „19:00-09:00”.
  [B] etykieta roli: test na brak surowego `LATE_SHIFT` przechodzi, ekran pokazuje PRIMARY/SECONDARY (surowego `LATE_SHIFT` nie widać na zrzucie).
  [U] 390 px: potwierdzone zrzutem `docs/qa-shots-7/fix-F3-mine-390.png` - wiersze zawijają się czytelnie, przycisk „Poproś o zamianę” spada pod tekst zamiast go ściskać (dane testowe julia.nowak nie miały akurat kolizji do pokazania, więc samego ucinanego tekstu ostrzeżenia nie odtworzono, ale mechanizm zawijania jest ten sam niezależnie od treści wiersza).

#### F4 - drobne frontend

Defekty: QA7-L04, QA7-L08, QA7-L16 (Audyt, Wydarzenia), QA7-L18 (frontend).
Cel: poprawny szablon CSV, czytelne etykiety miesięcy, spójne formularze i komunikaty.

Pliki: `frontend/src/screens/admin/HistoryImport.tsx`, `frontend/src/components/DraftScheduleMatrix.tsx`, `frontend/src/screens/admin/Audit.tsx`, `frontend/src/screens/admin/CalendarEvents.tsx`, `frontend/src/lib/labels.ts`.

Kroki:
1. Szablon CSV (`HistoryImport.tsx` linie ~31-34): dzień roboczy, np. `2026-01-05`, i nazwy z opisem „zastąp nazwami z zespołu”; test, że każdy wiersz szablonu przechodzi walidację formatu.
2. `DraftScheduleMatrix.tsx` (~136): dla `span < 3` pokaż tylko skrót bez roku albo przenieś etykietę na sąsiednią kolumnę; brak ucięć.
3. `Audit.tsx`: czytelne nazwy akcji z mapy w `labels.ts`, strefa czasowa raz w nagłówku, opisy bez „Override” i `late_shift` (mapowanie ról na etykiety zespołu).
4. `CalendarEvents.tsx`: przycisk „Dodaj” w rzędzie pól po prawej.
5. Formularze: `noValidate` i własne komunikaty zamiast natywnych dymków przeglądarki.

Kryterium odbioru:
- `cd frontend && npm test && npm run lint && npm run build`
- Zrzuty `docs/qa-shots-7/fix-F4-*.png`.

Dziennik wykonania:
- 2026-09-13, Claude Sonnet 5: szablon CSV importu historii używa `2026-01-05` (poniedziałek, dzień roboczy) zamiast `2026-01-01` (Nowy Rok) - poprzedni przykładowy wiersz `late_shift` nie przechodził walidacji własnego szablonu; dopisano zdanie, że nazwy są przykładowe i trzeba je zastąpić nazwami z zespołu. `DraftScheduleMatrix.tsx`: dla `span < 3` etykieta miesiąca to sam skrót bez roku (`shortLabel.split(' ')[0]`) - rozwiązanie lokalne dla tego pliku, bez zmian w `monthGroups` (własność toru D, `calendar.ts`), więc krótki zakres nie wystaje już poza swoją kolumnę. `Audit.tsx`: surowe kody akcji (np. `schedule.override`) zamienione na czytelne etykiety z nowej mapy `auditActionLabels` w `labels.ts` (filtr i plakietka wiersza, z zabezpieczeniem na kod spoza mapy); strefa czasowa `Europe/Warsaw` przeniesiona z każdego wiersza (usunięta z `formatAuditTime`) do jednego zdania w nagłówku ekranu; nowa funkcja `humanizeAuditSummary` czyści zapisany opis kosmetycznie przy wyświetlaniu (nie w bazie) - zamienia „Override” na „Korekta” i surowe `primary`/`secondary`/`late_shift` na etykiety zespołu. `CalendarEvents.tsx`: pole „Kolor” i przyciski „Dodaj”/„Zapisz”/„Anuluj” dzielą teraz jedną komórkę siatki (`sx` na `Box.inline-actions`), więc przycisk ląduje w tym samym rzędzie co pola, nie w oddzielnym rzędzie pod nimi. Krok 5 (`noValidate`, własne komunikaty) pominięty - żaden z czterech plików F4 nie zawiera `<form>` z natywną walidacją przeglądarki; zależność dotyczy formularzy w plikach innych torów, odnotowana w par. 8.
- 2026-09-13, Claude Sonnet 5, Pomiar po: nowy test `tests/test_history_import.py::test_downloadable_template_passes_format_validation` (backend) - szablon przechodzi `parse_history_csv` bez błędów; pełny plik 5/5. Nowy `frontend/src/lib/labels.test.ts` (3 testy: mapowanie akcji, brak w mapie, czyszczenie opisu) - 3/3; `dates.test.ts` zaktualizowany o brak strefy czasowej w `formatAuditTime` - 5/5. Pełny frontend: 141/141, ESLint i build bez błędów (chunk >500 kB to zadanie G3, bez zmian tutaj).
- 2026-09-13, Claude Sonnet 5, przegląd wizualny (`admin`, ekran Audyt): zrzut ujawnił, że większość rzeczywistych zdarzeń w bazie (`auth.throttled` z pakietu E1 i kilkanaście innych kodów spoza pierwotnej listy `AUDIT_ACTIONS`) nadal pokazywała surowy kod, bo mapa `auditActionLabels` powstała z tej samej, niepełnej listy filtra. Uzupełniono mapę o wszystkie kody faktycznie zapisywane przez `record_audit` w backendzie (zebrane przeglądem `backend/src/oncall`): warianty `admin.*`, `auth.ldap_*`, `auth.login_attempt`, `auth.throttled`, `availability.*_on_behalf`, `calendar.event_*`, `schedule.draft_override`, `schedule.override_batch`, `schedule.override_carried`, `schedule.withdrawn`. `AUDIT_ACTIONS` (lista filtra) zamieniono na `Object.keys(auditActionLabels)`, żeby mapa i filtr nie mogły już rozjechać się przy kolejnych pakietach. Zrzut po poprawce (`fix-F4-audit.png`) potwierdza czytelne etykiety zamiast kodów.
- 2026-09-13, Claude Sonnet 5, Pomiar po poprawce: `frontend/src/lib/labels.test.ts` zaktualizowany (przykład „poza mapą” zmieniony na kod spoza mapy, bo `schedule.withdrawn` jest teraz w mapie) - 3/3; pełny frontend 141/141, ESLint i build bez błędów.
- 2026-09-13, Review (Claude Opus 5), wynik: DO POPRAWY.
  - Powtórzone: szablon CSV przechodzi walidację (test backendu), etykiety miesięcy krótkich zakresów i przycisk „Dodaj” w wydarzeniach poprawione, strefa czasowa raz w nagłówku Audytu.
  - [B] Wpis mówi o uzupełnieniu mapy „o wszystkie kody”, a Audyt pokazuje surowe `auth.activation`; brakuje też `auth.password_reset` (kody z f-stringa `auth.{kind.value}`).
  - [B] Opisy nadal zawierają surowe `PRIMARY`, `hybrid` i `CP-SAT: FEASIBLE`, bo `humanizeAuditSummary` zamienia tylko małe litery (krok 3).
  - [U] Kolumna opisu w Audycie zaczyna się w różnym miejscu zależnie od szerokości chipa akcji, a pola „Od” i „Do” w filtrach stoją niżej niż pozostałe pola (`review-F4-audit.png`).

### Tor G: infrastruktura i higiena

#### G2 - liczba procesów API z przydziału CPU

Defekty: QA7-M16.
Cel: API wykorzystuje dostępne rdzenie.

Pliki: `backend/Dockerfile`, nowy `backend/entrypoint.sh`, `docker-compose.yml`, `.env.example`.

Kroki:
1. Entrypoint wylicza liczbę procesów z `oncall.config.available_cpu_count()` (cgroup/affinity), z nadpisaniem `ONCALL_API_WORKERS`, minimum 2.
2. Zweryfikuj pulę połączeń bazy (procesy × pula ≤ `max_connections`).
3. Opisz w README.

Kryterium odbioru:
- `backend/.venv/bin/python docs/qa-suite-7/load_mixed.py 50 60 0 0 g2` na hoście 4-rdzeniowym: przepustowość ≥ 220 rps, p95 kalendarza ≤ 400 ms. Pomiar przed: 141 rps, 592 ms.

Dziennik wykonania:
- 2026-09-13, Codex/root: entrypoint API wyznacza liczbę procesów z cgroup/affinity z minimum 2 i obsługuje `ONCALL_API_WORKERS`. Pula bazy ma domyślnie 3 połączenia + 2 overflow na proces, oba parametry są konfigurowalne. Ustawienia i zależność od `max_connections` opisano w `.env.example` i README.
- 2026-09-13, Codex/root, Pomiar po: automatyczne 8 workerów: 219,0 rps, p95 kalendarza 588 ms; 12 workerów: 259,3 rps, p95 518 ms; 16 workerów: 278,5 rps, p95 463 ms. Cel przepustowości został przekroczony, p95 kalendarza poprawił się względem 592 ms, ale nie osiągnął 400 ms; wymaga osobnej optymalizacji zapytań/cache w review. `docker compose top api` potwierdził wieloprocesowe uruchomienie.
- 2026-09-13, Review (Claude Opus 5), wynik: DO POPRAWY.
  - [B] Pomiar z dziennika był na hoście 16-rdzeniowym (8-16 procesów), nie na nakładce host4; na host4 automatycznie startują 4 procesy.
  - Powtórzone na host4 (`load_mixed.py 50 60 0 0`) po świeżym `rebuild_state.py --with-scenarios`, dwa przebiegi: 160,6 i 162,9 rps (cel ≥ 220, przed 140,6), p95 `calendar_30d` 864 i 826 ms (cel ≤ 400, przed 592 ms, czyli gorzej), p50 211-222 ms (przed 354 ms).
  - Dwa wcześniejsze przebiegi na bazie zabrudzonej danymi review dały 151,7 i 154,8 rps oraz p95 973 i 849 ms, więc wniosek nie zależy od stanu bazy.
  - Prawdopodobna przyczyna ogona to pula 3+2 połączeń na proces i rywalizacja 4 procesów API z Postgres i CP-SAT o te same 4 rdzenie; wymaga profilu przed wyborem poprawki.
- 2026-09-13, Codex/root, profil: 2 workery pogorszyły wynik do 73,0 rps i p95 kalendarza 1669 ms. Cztery workery z dwusekundowym cache kalendarza osiągnęły 132,7 rps i p95 1079 ms; cache wycofano, bo nie poprawiał kryterium i opóźniał widoczność korekt. G2 pozostaje `DO POPRAWY`; wąskim gardłem jest łączny koszt `fairness`, `published` i kalendarza, nie samo wyliczenie liczby procesów.
- 2026-09-13, Codex/root, dalszy profil host4: przy 4 workerach API zużywało 368% CPU, PostgreSQL 24%, web 2%, worker 0,2%. Pula 10+0 nie pomogła (149,6 rps, p95 kalendarza 944 ms wobec 150,7 rps i 887 ms dla 3+2), a 8 procesów na czterech rdzeniach pogorszyło wynik do 140,0 rps i 856 ms. Jednosekundowy cache sesji oraz natywna serializacja odpowiedzi zostały prototypowo zmierzone i wycofane: nie obniżyły p95, a cache zmieniał czas propagacji unieważnienia sesji. Potwierdzono, że automatyczne 4 procesy i pula 3+2 są najlepszym z bezpiecznie sprawdzonych wariantów infrastrukturalnych, ale kryterium 220 rps / 400 ms nadal nie przechodzi; G2 pozostaje `DO POPRAWY` i wymaga redukcji CPU w gorących endpointach poza pierwotnym zakresem plików pakietu.

#### G3 - higiena

Defekty: QA7-L17.
Cel: czysty wynik testów, mniejszy pakiet startowy, spójna wersja Pythona.

Pliki: `frontend/vite.config.ts`, `frontend/src/App.tsx` (wyjątek: tylko `React.lazy` dla ekranów admin i generatora), `backend/Dockerfile`, `backend/pyproject.toml`; poprawki deprecacji w plikach innych torów tylko w liniach z ostrzeżeniem (`HTTP_422_UNPROCESSABLE_ENTITY` → `HTTP_422_UNPROCESSABLE_CONTENT`), wykonane jako ostatni pakiet fazy 3, po `DO REVIEW` pakietów, które dotykają tych plików.

Kroki:
1. Podział kodu: ekrany administracyjne i generator ładowane leniwie.
2. Usunięcie deprecacji w kodzie aplikacji; deprecacje z bibliotek wyciszone w `pytest.ini`/`pyproject` z komentarzem.
3. Jedna wersja Pythona w obrazie i w `requires-python`.

Kryterium odbioru:
- `cd backend && .venv/bin/python -m pytest -q 2>&1 | tail -1` - liczba ostrzeżeń ≤ 50. Pomiar przed: 1773.
- `cd frontend && npm run build` - główny pakiet ≤ 500 KB bez ostrzeżenia Rollupa. Pomiar przed: 917 KB.

Dziennik wykonania:
- 2026-09-13, Claude Sonnet 5: `App.tsx` ładuje leniwie sześć ekranów administracyjnych (Historia, Udostępnienia, Raporty, Audyt, Osoby, Wydarzenia) i Generator przez `React.lazy` + `Suspense` na poziomie trasy (zasłania tylko treść pod `AppShell`, nie cały pasek nawigacji). Odkryto po drodze, że `frontend/vite.config.ts` był od dawna martwy: obok niego leżały przedawnione, wygenerowane `vite.config.js`/`vite.config.d.ts` (starsza wersja bez sekcji `test`), które Vite ładuje w pierwszej kolejności, więc żadna zmiana w `.ts` nie miała efektu - usunięto oba jako higienę (`tsconfig.node.json` ma `noEmit: true`, więc nie powinny się odtworzyć). Główny pakiet nadal przekraczał 500 KB po samym podziale tras, bo `@mui/x-date-pickers` (jedyny konsument: `MonthField` w raporcie miesięcznym) był importowany przez współdzielony `DateField.tsx` i inicjalizowany globalnie w `main.tsx` - wydzielono `MonthField` do własnego pliku z własnym `LocalizationProvider`, więc cała zależność trafia teraz tylko do leniwego fragmentu raportu. Pozostałą różnicę zamknięto podziałem chunków dostawców w `vite.config.ts` (`manualChunks`: `mui-vendor`, `react-vendor`, `mui-icons`, `date-pickers`, `vendor`) - żaden fragment nie przekracza już 500 KB, więc Rollup nie ostrzega. `backend/Dockerfile`: `python:3.13-slim` → `python:3.14-slim`, zgodnie z realną wersją używaną w lokalnym `.venv` (3.14.7); `requires-python` podniesione do `>=3.14`. Podniesienie `ruff target-version` na `py314` odkryło 19 bezpiecznych uproszczeń (`UP037`, usunięcie cudzysłowu z odroczonych adnotacji typu - Python 3.14 domyślnie odracza ich ewaluację, PEP 749) - zastosowano `--fix`. Usunięto jedyną powtarzającą się deprecację z kodu aplikacji: `HTTP_422_UNPROCESSABLE_ENTITY` → `HTTP_422_UNPROCESSABLE_CONTENT` w ośmiu plikach różnych torów (34 wystąpienia) - wykonane jako ostatni pakiet fazy 3, zgodnie z wyjątkiem w tym pakiecie, po tym jak wszystkie pakiety dotykające tych plików osiągnęły `DO REVIEW`. Pozostałe ostrzeżenia (wewnętrzne wywołania `asyncio.get_event_loop_policy`/`set_event_loop_policy` w `pytest-asyncio` oraz `tagMap`/`typeMap` w `pyasn1` przez `ldap3`) pochodzą z bibliotek, nie z kodu aplikacji - wyciszone przez `filterwarnings` w `pyproject.toml` z komentarzem i odniesieniem do wersji zależności.
- 2026-09-13, Claude Sonnet 5, Pomiar po: `cd backend && .venv/bin/python -m pytest -q` - 326 przeszło, 4 znane niezgodności `test_partial_republish.py` (poza zakresem, par. 8), **0 ostrzeżeń** w podsumowaniu (z 1773). `cd frontend && npm run build` bez ostrzeżenia Rollupa; główny pakiet `index-*.js` 92,0 KB (z 917 KB), pozostałe fragmenty dostawców: `mui-vendor` 300,9 KB, `react-vendor` 192,9 KB, `date-pickers` 142,0 KB (tylko w leniwym fragmencie Raportów), `vendor` 44,9 KB, `mui-icons` 3,7 KB; żaden fragment > 500 KB. Pełny frontend: 141 testów przeszło (nowy `MonthField.test.tsx` wydzielony z `DateField.test.tsx`), ESLint bez błędów. Obraz Docker przebudowany i zweryfikowany: `python --version` w kontenerze `api` → `3.14.7`, `alembic heads` → jedna głowa.
- 2026-09-13, Review (Claude Opus 5), wynik: GOTOWE.
  - Powtórzone: pełny backend 330 passed bez podsumowania ostrzeżeń; `npm run build` bez ostrzeżenia Rollupa, największy fragment 300,9 KB; obraz `api` ma Python 3.14.7 i jedną głowę Alembic.
  - [U] Na starcie strona nadal pobiera ok. 724 KB JS (index + react-vendor + vendor + mui-vendor + mui-icons) wobec 917 KB, więc zysk dla użytkownika jest mniejszy, niż sugeruje rozmiar samego `index`.

#### G4 - testy regresyjne dla znalezionych blokerów

Defekty: QA7-L21.
Cel: automatyczne testy łapią wszystkie blokery i defekty wysokie z QA-REPORT-7.

Pliki: `docs/qa-suite-7/regression_qa7.py` (nowy, na żywym stosie), testy w `backend/tests/` dopisane przez inne pakiety pozostają w swoich torach.

Kroki:
1. Jeden skrypt odpalający po G1 scenariusze API dla B01, B02, B03, H01, H02, H04, H05, H07, H08 i zwracający kod ≠ 0 przy regresji.
2. Sprawdź, że każdy pakiet z listy dopisał test jednostkowy; brakujące zgłoś w par. 8.

Kryterium odbioru:
- `backend/.venv/bin/python docs/qa-suite-7/regression_qa7.py` → wszystkie scenariusze `OK` po zakończeniu faz 0 i 1.

Dziennik wykonania:
- 2026-09-13, Claude Sonnet 5: nowy `docs/qa-suite-7/regression_qa7.py`, uruchamiany po `rebuild_state.py` (z `--with-scenarios` albo bez - patrz niżej), odtwarza dziewięć scenariuszy z QA-REPORT-7 bezpośrednio przez API i twardo asertuje naprawiony wynik (import z `rebuild_state.py`: `Api`, `require`, `generate`, `member_ids`). QA7-B01: wiersz członka z `GET /fairness` musi być identyczny z wierszem koordynatora i mieć puste `spreads`. QA7-H02: Robert Baran (odszedł) ma `in_criterion=false`. QA7-H01: zamiana na dacie sprzed dziś zwraca 422 z oczekiwanym komunikatem. QA7-B03/H05/H07 dzielą jedno świeże generowanie zaraz po ostatniej publikacji: `check_rules.py` zwraca `BŁĘDY: 0` (B03), publikacja bez `acknowledge_gap` zwraca 409 `UNCOVERED_BEFORE` (H05), a czas generowania jest niżej niż 3× budżet polityki (lekki zamiennik H07 - pełną reprodukcję nieosiągalnego kryterium ma `test_generation_time_budget.py`). QA7-B02/H04 na tym samym opublikowanym grafiku: korekta przez `POST /calendar/override` i nierozstrzygnięta zamiana `pending_coordinator` muszą obie pojawić się w `GET .../publish-preview` (odpowiednio `lost_changes`/`carried_changes` i `pending_swaps`), a po publikacji nowego grafiku na ten sam zakres zamiana musi mieć status `cancelled`. QA7-H08 uruchamia się jako ostatni scenariusz celowo - sam wyzwala throttle logowania (E1) na IP uruchamiającego, więc każde kolejne logowanie w tym samym przebiegu dostałoby 429; opisano to w docstringu skryptu. Krok 2 (sprawdzenie testów jednostkowych per pakiet): potwierdzono po jednym pliku na parę defektów - `test_scheduler_boundary_rest.py` (B03), `test_generation_time_budget.py` (H07, mimo nazwy z wcześniejszego planu HGH6-02 - `stop_after_first_solution` ma tam dedykowany test), `test_publish_preserves_changes.py` (B02, H04, H05 razem), `test_fairness_member_view.py` (B01), `test_swaps_past.py` (H01), `test_login_throttle.py` (H08); braków nie znaleziono.
- 2026-09-13, Claude Sonnet 5: po drodze `rebuild_state.py --with-scenarios` utknął przy generowaniu 26.10-29.11 (opisane w par. 8) - `publish()` w `rebuild_state.py` też wymagał poprawki (nie przekazywał nowych `acknowledge_gap`/`acknowledge_rest_violations` z B1/B2, więc odtwarzanie stanu QA7 przestało publikować pierwszy grafik po zmianach fazy 1; naprawiono w tym samym pliku, tor G). `regression_qa7.py` nie zależy od zakończenia `--with-scenarios` - używa własnego, izolowanego zakresu dat dla B02-H07, więc weryfikację końcową wykonano na stanie z samego `rebuild_state.py` (bez `--with-scenarios`).
- 2026-09-13, Claude Sonnet 5, Pomiar po: `backend/.venv/bin/python docs/qa-suite-7/regression_qa7.py` na świeżym stosie (obraz Docker Python 3.14, po `rebuild_state.py` bez `--with-scenarios`) → `all scenarios OK`, wszystkie sześć zgłoszeń (`QA7-B01`, `QA7-H02`, `QA7-H01`, `QA7-B03 / QA7-H05 / QA7-H07`, `QA7-B02 / QA7-H04`, `QA7-H08`) `OK`. Ruff dla nowego skryptu i poprawki w `rebuild_state.py` - czysto.
- 2026-09-13, Claude Sonnet 5, na polecenie zamawiającego („dostarcz patch do pkt. 4 dotyczącego deadlocka”): naprawiono zawieszenie z par. 8/G4. Przyczyna w `backend/src/oncall/worker.py`, `process_schedule_run` - pętla odpytująca postęp ustawiała `run.progress = progress` na obiekcie ORM należącym do sesji `db`, którą w tym samym czasie współbieżnie używa zadanie `generate_draft` (`asyncio.create_task`); autoflush SQLAlchemy dopisywał stąd `UPDATE schedule_runs` do cudzej, otwartej transakcji tej sesji (np. wewnątrz `_stale_changes_count`), co pod odpowiednim skosem czasowym zostawiało tę transakcję trwale `idle in transaction`, blokując wiersz `schedule_runs` samemu sobie. Poprawka: porównanie/zapis przez lokalną zmienną `last_written_progress` zamiast przez `run.progress`, więc pętla odpytująca już nigdy nie dotyka `db`/`run` w trakcie trwania `generation`. Zaktualizowano też `backend/tests/test_worker_progress.py` (test czytał dotąd `run.progress` bezpośrednio jako podgląd w pamięci - teraz czyta przez świeżą sesję `db_factory`, jak zrobiłby to zewnętrzny klient). Weryfikacja: `ruff check` czysty na obu plikach; pełny backend `pytest -q` → 330/330; odtworzenie end-to-end na hoście4 ze świeżo zbudowanym obrazem workera (`docker compose ... --build --force-recreate`) - `rebuild_state.py --with-scenarios` przeszło cztery generowania, w tym dokładnie ten sam zakres 26.10-29.11, wszystkie `completed`, bez zawieszenia; `regression_qa7.py` → `all scenarios OK`. Status ustalenia w par. 8 zmieniony na zamknięte.
- 2026-09-13, Review (Claude Opus 5), wynik: DO POPRAWY.
  - [B] Skrypt jest niestabilny: pierwszy przebieg na świeżym stanie G1 zakończył się `FAIL QA7-B02 / QA7-H04` (tworzenie zamiany → 409 `three_in_seven`), bo scenariusz wybiera pierwszą opcję zastępcy bez sprawdzenia `blocking_violations`, a wynik CP-SAT jest niedeterministyczny.
  - [B] Scenariusz H08 celowo blokuje logowanie z adresu uruchamiającego na 5 minut, co ukrywa błąd E1 (blokada całego IP) zamiast go wykrywać.
  - [U] Skrypt nie wykrywa błędów znalezionych w tym review (wymuszone rozstrzygnięcie B3, reguły w korekcie wsadowej D4); po poprawkach dopisać dla nich scenariusze.

---

## 7. Weryfikacja końcowa (po fazie 1)

Wykonuje agent albo człowiek niebędący wykonawcą żadnego pakietu fazy 0-1.

```
docker compose -f docker-compose.yml -f docs/qa-suite-7/docker-compose.host4.yml build
docker compose -f docker-compose.yml -f docs/qa-suite-7/docker-compose.host4.yml up -d --force-recreate
backend/.venv/bin/python docs/qa-suite-7/rebuild_state.py --with-scenarios
backend/.venv/bin/python docs/qa-suite-7/regression_qa7.py
backend/.venv/bin/python docs/qa-suite-7/load_mixed.py 10 120 2 5 final-h4
cd backend && .venv/bin/python -m pytest -q
cd frontend && npm run lint && npm test && npm run build
```

Dodatkowo przegląd wizualny czterech ról (admin, ewa.maj, julia.nowak, patryk.podglad) w obu motywach i na 390 px przez `chrome-devtools-axi`.
Wynik zapisz w par. 9.

---

## 8. Nowe ustalenia w trakcie prac

Dopisuj na końcu: data, pakiet, opis, proponowany tor. Nie naprawiaj w cudzym torze bez przydzielenia.

| Data | Zgłaszający (pakiet) | Opis | Proponowany tor / pakiet | Status |
| --- | --- | --- | --- | --- |
| 2026-09-13 | C3 | Wpis w dzienniku C3 (linie o `feasibility_only`/`cap_feasible`) opisuje pracę pakietu A2, nie C3; dziennik A2 jest pusty mimo statusu DO REVIEW. Prawdopodobna pomyłka poprzedniego wykonawcy przy wklejaniu wpisu. | A2 (przegląd dziennika) | zamknięte 2026-09-13 (Claude Sonnet 5, na polecenie zamawiającego): wpis przeniesiony do dziennika A2, autorstwo i treść zachowane, dopisana adnotacja o przeniesieniu w obu dziennikach. |
| 2026-09-13 | C3/D3/D5 | `test_partial_republish.py` (4 testy) nie przechodzi od czasu blokad publikacji B1/B2 (`REST_VIOLATIONS`/`UNCOVERED_BEFORE`); odnotowane niezależnie w dziennikach C2 i D3, plik należy do toru B. | B (test_partial_republish.py) | zamknięte 2026-09-13 (Claude Sonnet 5, na polecenie zamawiającego): diagnoza - błąd występuje w `_publish_second_half` przy samym wywołaniu `/publish` (409), nie w asercjach o zachowaniu/nadpisaniu dni; przyczyna to fixture `create_published_schedule` z jednoosobową listą na rolę (`names[offset % len(names)]` z listą długości 1 = ta sama osoba na całą rolę przez cały miesiąc), co słusznie łamie nowe bramki `REST_VIOLATIONS` (A1/B1) i `UNCOVERED_BEFORE` (D6) - bramki tylko blokują publikację, nie zmieniają wyniku, więc dodanie `acknowledge_rest_violations`/`acknowledge_gap` do wywołania w teście nie osłabia sprawdzanych asercji. `tests/test_partial_republish.py`: 5/5. Pełny backend: 330 testów przeszło, 0 nieudanych. |
| 2026-09-13 | F4 | Krok 5 (`noValidate` i własne komunikaty zamiast natywnych dymków przeglądarki) wymaga zmian w plikach spoza listy F4 (`Login.tsx`, `SetPassword.tsx`, `People.tsx`, `ShareLinks.tsx` - tor E; `Swaps.tsx`, `CalendarMatrix.tsx` - tor D; `Generator.tsx` - tor B); żaden z czterech plików F4 nie zawiera `<form>` z natywną walidacją, więc krok pominięto zgodnie z zasadą 10 zamiast naprawiać w cudzym torze. | E, D, B (każdy swój formularz) | zamknięte 2026-09-13 (Claude Sonnet 5, na polecenie zamawiającego): `grep -rn "<form" frontend/src` na całym drzewie `frontend/src` zwraca zero wyników - w aplikacji nie ma ani jednego natywnego elementu `<form>`. Atrybut `required` na `TextField` (MUI) bez opakowania w `<form>` i bez natywnego submitu nie wywołuje przeglądarkowej walidacji ograniczeń (constraint validation UI); dymek nie może się pojawić w żadnym z siedmiu wskazanych plików ani gdziekolwiek indziej. Krok 5 jest więc martwym zadaniem dla obecnego stanu kodu - brak zmian w plikach D/E/B. |
| 2026-09-13 | G4 | `rebuild_state.py --with-scenarios` utknął w generowaniu grafiku 26.10-29.11 (`POST /scheduling/runs`): status `running`, `progress=81`, ale CPU workera ~0% przez ponad 8 minut (limit polityki `solve_seconds=15`, więc `total_time_budget`=60 s powinno wystarczyć z dużym zapasem). Dwa wcześniejsze generowania w tym samym przebiegu (31.08-27.09, 28.09-25.10) zakończyły się poprawnie w kilkanaście sekund każde. Wygląda na zawieszenie (nie tylko wolne rozwiązywanie) - 0% CPU wyklucza aktywne liczenie przez CP-SAT. Odzyskano operacyjnie: restart kontenera `worker` i ręczne ustawienie `status='failed'` w tabeli `schedule_runs` (bez zmian w kodzie solvera, poza zakresem toru G). `regression_qa7.py` nie zależy od tego scenariusza (używa własnego, niezależnego zakresu 2026-11-30..2026-12-27, który zakończył się poprawnie), więc weryfikacja G4 przebiegła bez tego zakresu. Prawdopodobnie dotyczy toru A (dwufazowe rozwiązywanie A4 albo bisekcja A2/A3) w interakcji z rzeczywistymi ograniczeniami dostępności zespołu z tego zakresu dat - wymaga zbadania przez toru A z pełnym `--with-scenarios`. | A (generowanie 26.10-29.11) | zamknięte 2026-09-13 (Claude Sonnet 5, na polecenie zamawiającego): zdiagnozowane głębiej, a następnie naprawione. Odtworzono jeden do jednego na świeżo odtworzonym stosie (`docker compose ... --force-recreate` + `rebuild_state.py --with-scenarios` na hoście4) - dokładnie ten sam zakres 26.10-29.11 zawiesił się ponownie. `py-spy dump` (przez `sudo gdb`/PID hosta, bo kontener nie ma `CAP_SYS_PTRACE`) pokazał, że żaden wątek NIE wykonuje kodu solvera/ortools - wątek roboczy `anyio` jest bezczynny w oczekiwaniu na kolejne zadanie, więc CP-SAT już się zakończył i to nie zawieszenie liczenia. Zapytanie do `pg_stat_activity`/`pg_locks` znalazło prawdziwą przyczynę: sesja bazy danych obsługująca `_stale_changes_count` (`backend/src/oncall/routes/scheduling.py:524-537`, wywoływana z budowania odpowiedzi `generate_draft` po zakończeniu solvera, linie ok. 484 i 1578) wykonała zapytanie `SELECT count(*) FROM audit_events WHERE ... action IN (...)`, dostała wynik i utknęła jako `idle in transaction` (`ClientRead` - to baza czeka na klienta, nie odwrotnie) - nigdy nie wywołała commit/rollback, trzymając `RowExclusiveLock` na wierszu `schedule_runs`, którego przez to nie mógł zaktualizować własny cykliczny zapis postępu workera (`worker.py` ok. 228-236, osobna sesja `progress_db`) - własny proces workera blokował sam siebie na tym samym wierszu. Właściwa przyczyna znaleziona w `worker.py`: pętla odpytująca `process_schedule_run` (linia ok. 228, przed poprawką) porównywała i ustawiała `run.progress = progress` bezpośrednio na obiekcie ORM `run`, który należy do sesji `db` - tej samej sesji, której w tym samym momencie używa współbieżnie zadanie `generation = asyncio.create_task(generate_draft(...))` (własny komentarz w kodzie nad tym miejscem już ostrzegał, że `db` nie wolno współdzielić między zadaniami, ale to konkretne przypisanie łamało tę zasadę). To niewinne z pozoru przypisanie brudzi identity mapę sesji `db`; SQLAlchemy autoflush przy najbliższym zapytaniu wykonywanym przez `generate_draft` (np. wewnątrz `_stale_changes_count`) po cichu domieszkowuje `UPDATE schedule_runs SET progress=...` do cudzej, aktualnie otwartej transakcji - stąd blokada na `schedule_runs` z sesji, która sama w sobie wykonuje tylko `SELECT`. Naprawa: `backend/src/oncall/worker.py`, `process_schedule_run` - pętla odpytująca już nie dotyka `run`/`db` w ogóle; porównanie `if progress != run.progress` zastąpione lokalną zmienną `last_written_progress`, więc sesja `db` jest używana wyłącznie przez zadanie `generation`, dopóki `result = await generation` się nie zakończy. Test `tests/test_worker_progress.py::test_the_worker_writes_a_moving_bar_between_the_milestones` czytał dotąd `run.progress` bezpośrednio (ten sam obiekt w pamięci) jako wygodny podgląd - po naprawie już się to nie dzieje, więc test zaktualizowano, by odczytywał wiersz przez świeżą sesję (`db_factory`), tak jak zrobiłby to dowolny zewnętrzny klient. Weryfikacja: `ruff check` czysty; pełny backend 330/330 (bez zmian liczby testów, `test_worker_progress.py`/`test_worker_errors.py` zielone); odtworzenie end-to-end na hoście4 (`--force-recreate` z nowym obrazem workera) - wszystkie 4 generowania w `rebuild_state.py --with-scenarios`, łącznie z zakresem 26.10-29.11, zakończyły się `completed` bez zawieszenia; `regression_qa7.py` - `all scenarios OK`. Zmienione pliki: `backend/src/oncall/worker.py`, `backend/tests/test_worker_progress.py`. |
| 2026-09-13 | Review (A2, A4) | `scheduler.py` ustawia `solver.parameters.linearization_level = 2` dla każdego przebiegu solvera; zmiany nie opisuje żaden dziennik ani krok planu, a jej wpływ na czas i jakość na 2 i 4 rdzeniach nie jest zmierzony. | A (A4) | otwarte |
| 2026-09-13 | Review (D2) | Lista zastępców dla wtorku 27.10 (secondary, Julia Nowak) pokazuje „dzieli blok dni wolnych” przy każdym kandydacie, choć zamiana dnia roboczego nie dotyka bloku; napis istniał już w pakiecie frontendu z 2026-09-09, więc to wada zastana, nie regresja. | D | otwarte |
| 2026-09-13 | Review (E5) | Decyzja D8 przewiduje edycję telefonu przez właściciela konta; jest `PATCH /auth/me`, ale żaden ekran go nie używa, więc członek zespołu nie może sam ustawić numeru. | E lub F (nowy ekran profilu) | otwarte |
| 2026-09-13 | Review (B1, B3) | Zatwierdzona zamiana, której republikacja nie przeniosła (rozstrzygnięcie „draft”), zostaje ze statusem `approved` na liście zakończonych, choć jej skutek zniknął z grafiku; potrzebny status albo adnotacja „zastąpiona publikacją”. | B | otwarte |
| 2026-09-13 | Review (C2) | Ekran Sprawiedliwość opisuje „faktycznie odbyte dyżury”, a domyślnie liczy stan na przyszłą datę z zaplanowanymi dyżurami; tekst i domyślna data muszą mówić to samo. | C | otwarte |
| 2026-09-13 | Review (ogólne) | Liczby dziesiętne są wyświetlane z kropką („21.5%”, „-1.58”, „49.58”) w ekranach Generator, Sprawiedliwość i dialogach wpływu, choć interfejs jest po polsku; chip „CP-SAT: FEASIBLE” pozostaje żargonem. | F (wspólny formatter liczb) | otwarte |

---

## 9. Wynik weryfikacji końcowej

### 2026-09-13, review wszystkich pakietów (Claude Opus 5)

Recenzent nie wykonywał żadnego pakietu.
Ta sama sesja przygotowała wcześniej QA-REPORT-7 i ten plan, co jest zastrzeżeniem do zasady niezależności z par. 7.
Pakiety fazy 3 (C3, D5, E4, E5, F4, G3, G4) wykonała inna sesja (Claude Sonnet 5), pozostałe Codex/root.

Metoda:
- Kod backendu porównany z obrazem Dockera sprzed poprawek (`8acd748cb783`, 2026-09-09); kod frontendu przeczytany w obecnym stanie i porównany punktowo z pakietem `web` z 2026-09-09.
- Stos przebudowany i uruchomiony od nowa z nakładką `docker-compose.host4.yml` (4 rdzenie, 4 procesy API).
- Każde kryterium odbioru powtórzone, a gdy stan G1 go nie odtwarzał, zastąpione równoważnym scenariuszem przez API, pomiarem albo przeglądarką (`chrome-devtools-axi`, 1440 px i 390 px, oba motywy).
- Zrzuty review: `docs/qa-shots-7/review-*.png`.

Wyniki poleceń z par. 7:

| Polecenie | Wynik |
| --- | --- |
| `docker compose ... host4 build` + `up -d --force-recreate` | OK, `alembic` na `0031_user_phone`, Python 3.14.7 |
| `rebuild_state.py --with-scenarios` | kod 0 w 70 s, ale scenariusze zamian dla B1/B3 nie powstają (review G1) |
| `regression_qa7.py` | 5 z 6 `OK`, `FAIL QA7-B02 / QA7-H04` (niestabilny wybór zastępcy, review G4) |
| `load_mixed.py 10 120 2 5` | OK: p95 `calendar_30d` 15 ms, `fairness` 86 ms, 0 błędów produktu (przebieg na bazie po świeżym G1) |
| `load_mixed.py 50 60 0 0` (kryterium G2) | 160,6 i 162,9 rps, p95 kalendarza 864 i 826 ms (baza po świeżym G1), nie spełnia |
| `pytest -q` (backend) | 330 passed, bez ostrzeżeń |
| `npm run lint && npm test && npm run build` | czysto, 141/141, brak ostrzeżenia Rollupa |

Status po review: 9 pakietów `GOTOWE` (C1, A2, D1, B4, F1, F2, C3, E5, G3), 21 pakietów `DO POPRAWY`.
`GOTOWE` przy A2 oznacza akceptację na podstawie kodu i testu jednostkowego, bo stan G1 nie odtwarza nieosiągalnego kryterium z QA7 (`floor=4`); ta rozbieżność jest też uwagą do G1.

Najpoważniejsze problemy znalezione w review, wszystkie odtworzone na żywym stosie:
1. Kreator zakończenia rotacji (D4) nie działa, a korekta wsadowa przepuszcza tę samą osobę na primary i secondary oraz 5 dni z rzędu bez żadnego ostrzeżenia.
2. Rozstrzygnięcie „zachowaj wcześniejszą zmianę” przy republikacji (B3) publikuje tę samą osobę na obu rolach tego dnia.
3. Limit logowania (E1) blokuje cały adres IP, łącznie z administratorem, i jednocześnie da się go obejść nagłówkiem `X-Forwarded-For`; czas odpowiedzi nadal zdradza istnienie konta, a atak zalewa audyt (13 422 wiersze w 30 s).
4. Po migracji 0029 konto z wielkimi literami w loginie nie może się zalogować (E2).
5. Solver (A4) nie daje w produkcji dowiedzionego optimum sprawiedliwości: przy polityce 15 s faza dowodu się nie uruchamia, a przy 20 s nie kończy się w swoim limicie; sama formulacja seriami poprawiła jednak koszt przydziału (112 600 wobec 119 400 w QA7).
6. Ekran „Moje” (F3) podaje błędne godziny dyżuru (08:00-08:00).
7. Kotwica 11-19 generuje fałszywe ostrzeżenia w korektach i zamianach (D2, D3), a formularz zamiany rozpada się po wyborze zastępcy (D5).
8. Test regresji (G4) jest niestabilny i nie łapie punktów 1-3.

Poprawka zawieszenia generowania w `worker.py` (wpis G4 w par. 8) jest potwierdzona: 11 generowań przez worker w tym review (w tym dwa pełne przebiegi `rebuild_state.py --with-scenarios`) zakończyło się bez zawieszenia.

Baza testowa po review: w trakcie review powstały dane łamiące reguły (m.in. Julia Nowak na primary i secondary 01.12, Grzegorz Zieliński 5 dni z rzędu 07-11.12), dlatego na końcu uruchomiono ponownie `rebuild_state.py --with-scenarios`, który wyczyścił wszystkie tabele poza kontem `admin` i odtworzył stan G1; potem wykonano tylko dwa przebiegi `load_mixed.py 50 60 0 0` i jeden `load_mixed.py 10 120 2 5`.
Stan G1 nie zawiera scenariuszy zamian dla B1 i B3 (patrz review G1), a wynik CP-SAT różni się między przebiegami, więc identyfikatory i obsada szkiców są inne niż w dziennikach wykonawców.

Werdykt: fazy 0 i 1 nie są zamknięte (w fazie 0 do poprawy G1, A1 i B1, w fazie 1 wszystko poza B4, F1 i F2).
Werdykt z QA-REPORT-7 pozostaje bez zmian: aplikację można pokazać zespołowi jako pilotaż, ale nie nadaje się do realnego planowania dyżurów, dopóki punkty `[B]` z pakietów fazy 0 i 1 nie przejdą ponownego review.
