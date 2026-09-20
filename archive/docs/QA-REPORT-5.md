# Raport QA - runda 5

Data wykonania: 06-09-2026.
Zakres: pełny przebieg testów na odtworzonej od zera bazie, ze szczególnym naciskiem na optymalność i wydajność solvera oraz na użyteczność interfejsu (UI, UX, CX).
Podstawa: kod po naprawach zgłoszonych w `QA-REPORT-4.md`, kontenery `api` i `worker` przebudowane przed rozpoczęciem pomiarów.

Poprzednie rundy: `QA-REPORT-3.md`, `QA-REPORT-4.md`.
Ta runda jest niezależna: wszystkie liczby zostały zmierzone od nowa i żaden wcześniejszy wynik nie został przyjęty na wiarę.

---

## 1. Podsumowanie wykonawcze

Naprawy z rundy 4 działają.
`ONCALL_SOLVER_WORKERS` znowu ma wpływ na przebieg wyszukiwania, import historii nie nadpisuje już opublikowanego grafiku, a soczewka 11–19 jest bilansowana także przy kotwiczeniu.

Mimo to solver **nadal nie osiąga celu produktowego**, a przyczyna leży gdzie indziej, niż zakładała runda 4.
Nie jest to problem wydajności wyszukiwania.
Są to dwie niezależne wady konstrukcyjne, obie potwierdzone pomiarem z powtórzeniami:

1. **Solver optymalizuje inną wielkość niż ta, którą pokazuje raport sprawiedliwości.**
   Generator liczy odchylenia w oknie zakotwiczonym na początku horyzontu, a raport i panel wpływu szkicu w oknie kroczącym kończącym się na końcu horyzontu.
   Dla szkicu 28-dniowego te okna różnią się o 28 najstarszych dni historii, które raport po cichu wypuszcza.
   Ten sam szkic ma rozpiętość 2,0 punktu w oknie solvera i 4,0 punktu w oknie raportu w soczewce `primary`, oraz 4,18 wobec 9,00 w soczewce `secondary`.

2. **Kryterium odbioru z `PLAN.md` par. 3 jest przy twardym kotwiczeniu 11–19 matematycznie nieosiągalne.**
   CP-SAT dowodzi niewykonalności rozpiętości 3 punktów w 0,5 sekundy.
   Najmniejsza osiągalna rozpiętość dla tej obsady i tego horyzontu wynosi 6 punktów.
   Po przełączeniu kotwicy na `independent` ta sama instancja schodzi do 2,07 punktu.

Konsekwencja praktyczna została potwierdzona end-to-end w aplikacji.
Koordynator, który przejdzie normalną ścieżką (wygeneruj, przekaż, opublikuj), zostawia cztery z pięciu soczewek poza kryterium odbioru, a rozpiętość weekendów **pogarsza** z 2,0 do 6,0 (rozdział 5.9, z kontrolą na przesunięcie okna).
Budżet 90 sekund prawie nie pomaga: w dwunastu przebiegach przy budżecie 1 s, 10 s, 30 s i 90 s raportowana rozpiętość maksymalna wynosiła 9,0 w jedenastu z nich i 8,0 w jednym, a soczewka weekendów była **lepsza** przy 1 sekundzie (2,0) niż przy każdym dłuższym budżecie (4,0).

Po zastosowaniu obu poprawek naraz ta sama instancja osiąga 3,0 punktu w każdym z trzech przebiegów, czyli spełnia kryterium odbioru, w 90 sekundach na 2 rdzeniach.

Po stronie interfejsu i logiki biznesowej są dwa poważne znaleziska.

Ekran generatora pokazuje szkic z twardą kolizją niedostępności bez żadnego oznaczenia, a jedyny komunikat na ekranie brzmi „Grafik spełnia wszystkie reguły twarde”, co jest nieprawdą.
To dokładnie sytuacja ze zrzutu `docs/blad_oncall.png` i została odtworzona (rozdział 7.1).

Drugie znalezisko jest szersze.
Zamiana i bezpośrednia korekta koordynatora walidują tylko eligibility, twardą niedostępność i rozłączność ról.
Pozostałe reguły twarde z `PLAN.md` par. 3 (3 dyżury w 7 dniach, 3 kolejne noce, dwudniowy odpoczynek, kotwiczenie 11–19, nierozdzielczość bloków weekendowych) mogą zostać złamane po publikacji bez ostrzeżenia.
Zatwierdzona zamiana wykonana w toku testów złamała naraz kotwiczenie 11–19 i limit 3 dyżurów w 7 dniach (rozdział 7.2).

Wydajność nie jest problemem.
Przy 10 równoczesnych użytkownikach i limicie 3 rdzeni odczyty osiągają 342 req/s przy p95 poniżej 102 ms, a ekrany raportowe 87 req/s przy p95 poniżej 291 ms.

**Łącznie: 2 defekty blokujące, 6 wysokich, 11 średnich, 15 niskich.**

---

## 2. Poświadczenia do samodzielnej weryfikacji

Aplikacja: `http://localhost:8080`.
Wszystkie konta poza administratorem mają hasło `OncallQA-2026!`.

| Login | Hasło | Rola | W rotacji od | Eligibility | Uwagi |
| --- | --- | --- | --- | --- | --- |
| `admin` | `Qwertyuiop1!` | administrator | poza rotacją | - | konto zarządzane przez środowisko |
| `ola.zielinska` | `OncallQA-2026!` | koordynator | 01-09-2024 | P, S, 11–19 | koordynator będący jednocześnie członkiem rotacji |
| `halina.koordynator` | `OncallQA-2026!` | koordynator | poza rotacją | - | koordynator bez własnych dyżurów |
| `kontroler.viewer` | `OncallQA-2026!` | viewer | poza rotacją | - | tylko do odczytu |
| `anna.kowalska` | `OncallQA-2026!` | członek | 01-09-2024 | P, S, 11–19 | niedostępna 14-20.09.2026 |
| `marek.wisniewski` | `OncallQA-2026!` | członek | 01-09-2024 | P, S, 11–19 | |
| `piotr.lewandowski` | `OncallQA-2026!` | członek | 01-09-2024 | P, S, 11–19 | niedostępny 01-04.10.2026 i 02-03.11.2026 |
| `katarzyna.dabrowska` | `OncallQA-2026!` | członek | 01-09-2024 | P, S, 11–19 | |
| `tomasz.szymanski` | `OncallQA-2026!` | członek | 01-09-2024 | P, S | bez eligibility do 11–19 |
| `magdalena.wozniak` | `OncallQA-2026!` | członek | 01-09-2024 | P, S, 11–19 | niedostępna 08-09.09.2026 |
| `rafal.kaminski` | `OncallQA-2026!` | członek | 01-09-2024 | S, 11–19 | bez eligibility do `primary` |
| `julia.nowak` | `OncallQA-2026!` | członek | 01-09-2024 | P, S, 11–19 | „wolę nie” 21-27.09.2026 |
| `bartosz.mazur` | `OncallQA-2026!` | członek | **01-04-2026** | P, S, 11–19 | osoba, która dołączyła 19 miesięcy po reszcie |
| `dawid.stary` | `OncallQA-2026!` | członek | poza rotacją | - | konto **wyłączone**, logowanie musi się nie udać |

Dwie osoby są celowo niepełne: `rafal.kaminski` nie może być `primary`, a `tomasz.szymanski` nie może brać zmiany 11–19.
Obie asymetrie są istotne dla wyników rozdziału 5, bo to one napinają soczewki `secondary` i `11–19`.

---

## 3. Dane testowe i punkt wyjścia

Bazę wyczyszczono w całości (`TRUNCATE` wszystkich tabel danych), po czym odtworzono konto administratora, 13 kont testowych i 15-miesięczną historię z pliku `docs/qa-suite-5/history.csv` (1245 wierszy, 01-06-2025 - 06-09-2026).
Historia jest budowana tak, aby po imporcie była względnie sprawiedliwa w każdej soczewce.

Bilans bezpośrednio po imporcie, na dzień 06-09-2026:

| Soczewka | Suma | Najwyższe odchylenie | Najniższe odchylenie | Rozpiętość |
| --- | --- | --- | --- | --- |
| `primary` | 481 pkt | Tomasz Szymański +3,0 | Julia Nowak -4,0 | **7,0** |
| `secondary` | 481 pkt | Julia / Magdalena / Rafał +3,0 | Piotr Lewandowski -4,0 | **7,0** |
| `11–19` | 251 zmian | Anna Kowalska +3,2 | Julia Nowak -2,8 | **6,0** |
| weekendy | 212 dni | Anna / Tomasz +1,5 | pozostali -0,5 | **2,0** |
| święta | 18 dni | Magdalena / Rafał +1,1 | Anna / Marek / Ola -0,9 | **2,0** |

Te liczby odtworzyły się co do jednego miejsca po przecinku względem rozdziału 2 raportu z rundy 4, więc porównania „przed naprawą / po naprawie” są wiarygodne.

Do tego dodano realistyczny zestaw dostępności wprowadzony przez same osoby, z ich własnych kont:
twarda niedostępność Anny (14-20.09), Magdaleny (08-09.09) i Piotra (01-04.10), „wolę nie” Julii (21-27.09) i Tomasza (05-09.10) oraz „chętnie wezmę” Bartosza (26-27.09).

---

## 4. Metoda i narzędzia

Skrypty rundy 5 są w `docs/qa-suite-5/`.
Kluczowa różnica względem rundy 4: **żaden pomiar solvera nie modyfikuje kodu produkcyjnego**.
`bench5.py` i `analyze5.py` wołają nietkniętą funkcję `generate_schedule` z prawdziwymi danymi z bazy i oceniają wynik tą samą metryką, którą widzi koordynator (`routes/scheduling.draft_fairness_impact`).
Tylko `variant5.py` podmienia źródło i robi to w jednym, jawnie opisanym miejscu.

Sprzęt: host 16 rdzeni.
Kontener `worker` ma twardy limit 2,0 CPU (`cpu.max = 200000 100000`), więc wszystkie pomiary solvera prowadzono w nim, w profilu docelowym.
Do testów obciążeniowych kontener `api` ograniczono do 3 rdzeni (`docker update --cpus 3`).

Powtórzenia: każde porównanie wariantów solvera wykonano **trzykrotnie na wariant**.
To główna poprawka metodologiczna względem rundy 4, gdzie pojedyncze przebiegi były wskazaną słabością.
Pomiary, które nie są porównaniem wariantów (log wyszukiwania, skalowanie workerów), zrobiono raz i jest to przy nich zaznaczone.

Interfejs testowano przez `chrome-devtools-axi` w Chrome, w obu motywach, przy 1440x900 i 390x844.
Zrzuty są w `docs/qa-shots-5/`.

---

## 5. Solver

### 5.1 BLK5-01: solver optymalizuje inne okno niż raport sprawiedliwości

**Waga: blokująca.**
**Pliki: `backend/src/oncall/fairness_data.py:39`, `backend/src/oncall/routes/scheduling.py:760-763`.**

`history_window(starts_on)` zwraca `(starts_on - 1 - 365, starts_on - 1)`.
Solver bierze tę historię i dokłada do niej cały horyzont, więc jego soczewki mierzą okno o długości `365 + długość horyzontu`.

`draft_fairness_impact` oraz `/api/v1/fairness` liczą inaczej: `projected_start = ends_on - 365`.
To okno **kroczące**, dokładnie zgodne z definicją produktową z `PLAN.md` par. 3 („kroczące okno 12 miesięcy”).

Dla horyzontu 28-dniowego różnica to 28 najstarszych dni historii.
Solver je liczy, raport je wypuszcza.

Pomiar jest arytmetyczny, nie losowy: to ten sam, pojedynczy zestaw przydziałów oceniony w dwóch oknach.

| Soczewka | Rozpiętość w oknie solvera | Rozpiętość w oknie raportu |
| --- | --- | --- |
| `primary` | **2,00** | 4,00 |
| `secondary` | **4,18** | 9,00 |
| `11–19` | **3,63** | 7,00 |
| weekendy | 4,00 | 4,00 |
| święta | 2,00 | 2,00 |

Przykład imienny z tego samego przebiegu.
Anna Kowalska ma w soczewce `secondary` odchylenie -1,58 w oknie solvera i -4,59 w oknie raportu.
Rafał Kamiński odpowiednio +2,42 i +4,41.
Solver uważa, że wyrównał bilans, raport pokazuje 9 punktów rozjazdu.

**Skutek biznesowy.**
Cała optymalizacja sprawiedliwości pracuje na wielkości, której produkt nigdy nie pokazuje.
Suwak „Równy udział” steruje czymś innym niż to, co koordynator ocenia na ekranie.
Kryterium odbioru z `PLAN.md` par. 3 jest weryfikowane na metryce raportu, więc solver nie ma go w celu.

**Dowód, że to jest przyczyna, a nie korelacja.**
Podanie generatorowi historii z okna `[ends_on - 365, starts_on - 1]`, czyli tej, która nadal będzie w oknie kroczącym po zamknięciu horyzontu, i nic więcej, poprawia wynik na metryce raportu w każdej soczewce.
Trzy przebiegi na wariant, 28 dni, tryb hybrydowy, 2 workery, 90 sekund:

| Soczewka | Okno zakotwiczone (dziś) | Okno kroczące (poprawka) |
| --- | --- | --- |
| `primary` | 5,0 / 4,0 / 4,0 | **1,0 / 1,0 / 1,0** |
| `secondary` | 9,0 / 9,0 / 9,0 | **7,0 / 7,0 / 7,0** |
| `11–19` | 6,0 / 6,0 / 5,0 | **4,21 / 4,21 / 4,21** |
| weekendy | 4,0 / 4,0 / 4,0 | **2,0 / 2,0 / 2,0** |
| święta | 2,0 / 2,0 / 2,0 | 2,0 / 2,0 / 2,0 |

Powtarzalność jest bardzo wysoka, więc różnica nie jest szumem CP-SAT.

**Odtworzenie:** `docs/qa-suite-5/window_check.py` i `window_fix.py`.

### 5.2 BLK5-02: kryterium 3 punktów jest nieosiągalne przy twardym kotwiczeniu 11–19

**Waga: blokująca.**
**Plik: `docs/PLAN.md` par. 3, `backend/src/oncall/scheduler.py:540-560`.**

`PLAN.md` par. 3 mówi: „Dla takiego szkicu kryterium odbioru jakości wynosi maksymalnie 3 punkty rozpiętości odchylenia w każdej soczewce; 2 punkty pozostają celem optymalizacyjnym. Granica 3 uwzględnia niepodzielne bloki weekendowe 2X oraz twarde kotwiczenie zmiany 11–19.”

Skompilowanie tego kryterium jako twardego ograniczenia modelu (`maximum - minimum <= 3 * SCALE` na każdą soczewkę) pozwala CP-SAT odpowiedzieć wprost, czy jest ono osiągalne.
Odpowiedź brzmi: nie, i solver dowodzi tego w pół sekundy.

| Horyzont | Kotwica | Limit rozpiętości | Wynik | Czas |
| --- | --- | --- | --- | --- |
| 28 dni | `secondary` | 2 pkt | **INFEASIBLE** | 0,5 s |
| 28 dni | `secondary` | 3 pkt | **INFEASIBLE** | 0,5 s |
| 28 dni | `secondary` | 4 pkt | **INFEASIBLE** | 0,5 s |
| 28 dni | `secondary` | 5 pkt | **INFEASIBLE** | 0,8 s |
| 28 dni | `secondary` | 6 pkt | FEASIBLE | - |
| 35 dni | `secondary` | 3 pkt | **INFEASIBLE** | 0,3 s |
| 35 dni | `secondary` | 4 pkt | **INFEASIBLE** | 0,5 s |
| 28 dni | `independent` | 3 pkt | **FEASIBLE, rozpiętość 2,07** | - |
| 28 dni | `independent` | 4 pkt | FEASIBLE, rozpiętość 3,0 | - |

Dwa wnioski.

Po pierwsze, **dno dla tej obsady i kotwicy `secondary` wynosi 6 punktów**, a nie 3.
Wydłużenie horyzontu do 35 dni nie pomaga, bo razem z dniami rośnie też udział oczekiwany.

Po drugie, **to kotwiczenie 11–19 jest przyczyną**, a nie bloki weekendowe.
Przy kotwicy `independent` ta sama instancja osiąga 2,07 punktu, czyli spełnia nawet cel optymalizacyjny.
`PLAN.md` traktuje kotwiczenie jako powód tolerancji jednego dodatkowego punktu; pomiar pokazuje, że kosztuje ono **cztery punkty**.

Mechanizm jest strukturalny.
Przy kotwiczeniu do `secondary` liczba zmian 11–19 danej osoby jest równa liczbie jej dyżurów `secondary` w dni robocze.
Soczewka `secondary` jest ważona punktowo (1 za dzień roboczy, 2 za weekend), a soczewka `11–19` jest liczona sztukowo.
Nie da się wyrównać obu naraz: dyżur weekendowy daje 2 punkty `secondary` i zero zmian 11–19, a dyżur w środę 1 punkt i jedną zmianę.
Wyrównanie jednej soczewki z definicji rozjeżdża drugą.

### 5.3 Obie poprawki naraz: kryterium zostaje spełnione

Pełny plan czynnikowy 2x2, trzy przebiegi na komórkę, 28 dni, tryb hybrydowy, 2 workery, 90 sekund, waga sprawiedliwości domyślna, bez twardego limitu rozpiętości:

| Okno historii | Kotwica 11–19 | Maksymalna rozpiętość (3 przebiegi) |
| --- | --- | --- |
| zakotwiczone (dziś) | `secondary` (dziś) | 9,0 / 9,0 / 9,0 |
| zakotwiczone | `independent` | 9,0 / 10,0 / 10,0 |
| kroczące | `secondary` | 7,0 / 7,0 / 7,0 |
| **kroczące** | **`independent`** | **3,0 / 3,0 / 3,0** |

Wynik jest nietrywialny.
Sama zmiana kotwicy niczego nie daje, a nawet lekko szkodzi.
Dopiero po naprawie okna zmiana kotwicy przynosi pełny efekt.
Poprawka okna jest warunkiem koniecznym, nie alternatywą.

### 5.4 HGH5-01: budżet czasu nie poprawia wyniku, a jedną soczewkę pogarsza

**Waga: wysoka.**

Ten sam horyzont, ta sama konfiguracja produkcyjna, tylko różny budżet, trzy przebiegi na budżet:

| Budżet | Wartość celu | Luka MIP | `primary` | `secondary` | `11–19` | weekendy | Maks. (3 przebiegi) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 s | 245 400 | 54,1% | 5,0 | 9,0 | 4,0 | **2,0** | 9,0 / 9,0 / 9,0 |
| 10 s | 183 800 - 188 200 | 38-40% | 4,0-5,0 | 9,0 | 6,0-7,0 | 4,0 | 9,0 / 9,0 / 9,0 |
| 30 s | 177 200 - 180 800 | 36-37% | 4,0-5,0 | 9,0 | 5,0-7,0 | 4,0 | 9,0 / 9,0 / 9,0 |
| 90 s | 177 200 - 181 200 | 35-37% | 5,0 | 8,0-9,0 | 5,0 | 4,0 | 9,0 / 8,0 / 9,0 |

Wartość celu spada o 26%, a raportowana rozpiętość maksymalna schodzi w najlepszym z dziewięciu przebiegów z 9,0 do 8,0, czyli o jeden punkt, przy dziewięćdziesięciokrotnie dłuższym czasie.
Soczewka weekendów jest przy budżecie 1 sekundy **lepsza** (2,0) niż przy każdym dłuższym (4,0), w każdym z trzech przebiegów.

To jest bezpośrednia konsekwencja BLK5-01.
Solver poświęca 89 dodatkowych sekund na poprawianie liczby, która nie ma przełożenia na ekran.
Domyślne 90 sekund jest dziś prawie czystym kosztem: koordynator czeka półtorej minuty na wynik, który w najlepszym przypadku jest o jeden punkt lepszy od uzyskanego w sekundę, a w soczewce weekendów gorszy.

### 5.5 Weryfikacja napraw z rundy 4

| Defekt rundy 4 | Stan | Dowód |
| --- | --- | --- |
| BLK-01: `add_assumption` wymusza jeden wątek | **naprawione** | `num_workers` zmienia przebieg: przy 1 workerze granica 114 000, przy 8 i 16 workerach 133 800 i 137 800; liczby konfliktów i gałęzi różnią się między konfiguracjami |
| HGH-01: 91 dni kończy się `UNKNOWN` | **poza zakresem, nie naprawione** | `schemas.py:206` odrzuca zakresy powyżej 35 dni, więc przypadek nie jest już wykonalny; nie jest to naprawa jakości, tylko zawężenie zakresu |
| HGH-02: 91 dni psuje bilans | **poza zakresem** | jak wyżej |
| HGH-03: rodzina sprawiedliwości ma nieproporcjonalny wkład | **naprawione częściowo** | kwadraty są normalizowane przez `lens.span`, a koszty liczone od pojedynczej decyzji; suwak nadal jednak nie zmienia wyniku raportowanego (rozdz. 5.6) |
| HGH-04: soczewka 11–19 pomijana przy kotwiczeniu | **naprawione** | `for role in AssignmentRole` w `scheduler.py:481`; dokumentacja i UI nie nadążyły (LOW5-02, LOW5-03) |
| HGH-05: import historii nadpisuje publikację | **naprawione** | preview zwraca „Data dyżuru jest objęta grafikiem opublikowanym” dla dni 21-09 i 22-09-2026 |
| HGH-06: import gubi tożsamość przy innej wielkości liter | **naprawione** | wiersz `rafał kamiński` jest rozpoznawany jako Rafał Kamiński |
| MED-04: dialog korekty bez dostępności i wpływu | **nie naprawione, pogłębione** | rozdz. 7.4 |
| LOW-07: lista zastępców bez kontekstu | **nie naprawione** | rozdz. 7.5 |
| LOW-08: ściana czerwonych `!` w nagłówku macierzy | **nie naprawione** | rozdz. 7.7 |
| import nie waliduje eligibility roli | **nie naprawione** | wiersz `2025-07-14,primary,Rafał Kamiński` przechodzi walidację, mimo że Rafał nie ma eligibility do `primary`; okres członkostwa jest walidowany poprawnie |

### 5.6 Suwak sprawiedliwości nadal nie zmienia wyniku raportowanego

Pomiar 28 dni, tryb hybrydowy, 2 workery, 90 sekund:

| Wagi | Maks. rozpiętość | Przekazania | „wolę nie” użyte |
| --- | --- | --- | --- |
| sprawiedliwość 3, ciągłość 1, preferencje 2 (domyślne) | 9,0 | 26 | 0 |
| sprawiedliwość 100, ciągłość 0, preferencje 0 | 9,0 | 49 | 3 |
| sprawiedliwość 3, ciągłość 0, preferencje 0 | 8,0 | 52 | 3 |
| sprawiedliwość 0,1, ciągłość 1, preferencje 2 | 8,0 | 20 | 0 |

Ustawienie sprawiedliwości na 100 przy zerowych pozostałych wagach nie poprawia rozpiętości ani o punkt względem domyślnych ustawień.
Ustawienie jej na 0,1 nie pogarsza jej wcale.
Wagi działają na sam cel (widać to po liczbie przekazań i użytych preferencji), ale nie na wielkość, którą produkt raportuje.
Po naprawie BLK5-01 ten pomiar należy powtórzyć: część efektu powinna wrócić.

### 5.7 Tryb tygodniowy generuje 12-dniowe serie bez ostrzeżenia w UI

Ten sam horyzont w trybie tygodniowym:

| Miara | Hybrydowy | Dzienny | Tygodniowy |
| --- | --- | --- | --- |
| Rozpiętość `secondary` | 9,0 | 9,0 | **14,0** |
| Rozpiętość `11–19` | 6,0 | 7,0 | **11,0** |
| Najdłuższa seria dyżurów | 3 dni | 3 dni | **12 dni** |
| Okna 7-dniowe z ponad 3 dyżurami | 0 | 0 | **31** |
| Przekazania | 26 | 51 | 4 |

Jest to zgodne z `PLAN.md` par. 3, który wyłącza reguły rozrzedzania w trybie tygodniowym.
Problem jest w interfejsie: opis pola „Tryb rotacji” brzmi „Bazowy blok rotacji. Każda doba i tak pozostaje osobnym przydziałem.” i nie wspomina, że wybór trybu tygodniowego wyłącza limit 3 dyżurów w 7 dniach i dwudniowy odpoczynek.
Koordynator wybiera tryb, nie wiedząc, że rezygnuje z zabezpieczeń operacyjnych.

Zgłoszone jako MED5-08.

### 5.8 Gdzie faktycznie idzie czas solvera

Log CP-SAT (`docs/qa-suite-5/search.log`, 28 dni, 2 workery, 90 s) pokazuje model po presolve: 1195 zmiennych, 233 ograniczenia `kExactlyOne`, 35 `kLinMax`, 432 `kLinear2` i 318 `kLinearN` o 2917 składnikach.

Wszystkie 14 z 15 poprawek dolnej granicy pochodzą z podsolvera `default_lp`.
Solver wykonał 1 229 447 iteracji LP w 90 sekund.
Oznacza to, że granica jest domykana wyłącznie przez relaksację liniową, a ta jest dla członów rozpiętości słaba: przy przydziałach ułamkowych każde odchylenie może zrównać się ze średnią, więc relaksacja wycenia całą rodzinę sprawiedliwości blisko zera i cały koszt trzeba domknąć rozgałęzianiem.

Praktyczny wniosek jest jednak inny niż „solver jest za słaby”.
Skoro dowiedzione dno dla tej instancji wynosi 6 punktów (rozdz. 5.2), a produkcja osiąga 7 punktów po naprawie okna, to **solver jest już o jeden punkt od optimum na wiążącej soczewce**.
Luka MIP rzędu 37% jest myląca: opisuje ona odległość od słabej granicy LP, a nie od osiągalnego wyniku.
Nie ma tu problemu wydajnościowego wartego strojenia, dopóki nie zostaną naprawione BLK5-01 i BLK5-02.

Uwaga metodologiczna: kolumny `conflicts` i `branches` przy 8 i 16 workerach raportowały zera, co jest znanym artefaktem agregacji statystyk w OR-Tools przy wielu wątkach.
Żaden wniosek nie opiera się na tych dwóch liczbach.

### 5.9 Potwierdzenie end-to-end w aplikacji

Wygenerowano szkic 07-09-2026 - 04-10-2026 przez interfejs, przekazano do akceptacji i opublikowano normalną ścieżką koordynatora.

Porównanie „przed i po” wymaga tu ostrożności, bo panel wpływu szkicu **sam liczy oba słupki w różnych oknach**.
`routes/scheduling.py:760-763` ustawia `baseline_start = starts_on - 1 - 365`, a `projected_start = ends_on - 365`.
Część każdej zmiany to więc nie zasługa ani wina szkicu, tylko starzenie się najstarszych 28 dni historii.

Kontrolę wykonano bez żadnego solvowania: ta sama historia, bez szkicu, policzona w oknie projekcji (`drift_check.py`).

| Soczewka | „Przed” tak, jak liczy panel (okno 06-09) | Sama historia w oknie raportu (okno 04-10) | Po publikacji szkicu | Kryterium |
| --- | --- | --- | --- | --- |
| `primary` | 7,0 | 6,0 | **4,0** | 3,0 |
| `secondary` | 7,0 | **10,0** | 8,0 | 3,0 |
| `11–19` | 6,0 | 7,0 | **5,0** | 3,0 |
| weekendy | 2,0 | 2,0 | **6,0** | 3,0 |
| święta | 2,0 | 2,0 | 2,0 | 3,0 |

Kolumna środkowa jest właściwym punktem odniesienia i zmienia wnioski.

Szkic **poprawia** trzy soczewki względem tego, co stałoby się bez niego: `primary` z 6,0 do 4,0, `secondary` z 10,0 do 8,0 i `11–19` z 7,0 do 5,0.
Szkic **realnie pogarsza** jedną soczewkę: weekendy z 2,0 do 6,0, i tu drift nie ma z tym nic wspólnego, bo w oknie raportu historia weekendowa nadal ma rozpiętość 2,0.
Po publikacji cztery z pięciu soczewek nie spełniają kryterium 3 punktów.

Sama kolumna środkowa jest przy okazji niezależnym potwierdzeniem BLK5-01.
Przesunięcie okna o 28 dni, bez dodania ani jednego dyżuru, zmienia rozpiętość `secondary` z 7,0 na 10,0.
To dokładnie ta część historii, którą solver ma w celu, a raport ją wypuszcza.

Zrzut: `docs/qa-shots-5/07-sprawiedliwosc-po-publikacji.png`.

Widoczny efekt uboczny pogorszenia weekendów: Julia Nowak dostała `primary` w dwa kolejne weekendy (12-13 i 19-20 września).
Reguły twarde tego nie zakazują, ale dla członka zespołu jest to najbardziej odczuwalna forma nierówności.

---

## 6. Defekty blokujące i wysokie: lista

| ID | Waga | Tytuł | Rozdział |
| --- | --- | --- | --- |
| BLK5-01 | blokujący | Solver optymalizuje inne okno niż raport sprawiedliwości | 5.1 |
| BLK5-02 | blokujący | Kryterium 3 punktów nieosiągalne przy twardym kotwiczeniu 11–19 | 5.2 |
| HGH5-01 | wysoki | Budżet 90 s nie poprawia wyniku, a soczewkę weekendów pogarsza | 5.4 |
| HGH5-02 | wysoki | Szkic z twardą kolizją niedostępności bez oznaczenia; ekran twierdzi, że reguły są spełnione | 7.1 |
| HGH5-03 | wysoki | Zamiana i korekta łamią reguły twarde odpoczynku i kotwiczenia 11–19 bez ostrzeżenia | 7.2 |
| HGH5-04 | wysoki | Synchroniczny `POST /scheduling/generate` zawsze kończy się 504 i zostawia osierocone szkice | 7.3 |
| HGH5-05 | wysoki | Panel wpływu szkicu nie pokazuje rozpiętości ani kryterium odbioru | 7.6 |
| HGH5-06 | wysoki | Ostrzeżenie o zawieszeniu reguł rozrzedzania nie dociera do koordynatora | 7.8 |

---

## 7. Interfejs: UI, UX, CX

### 7.1 HGH5-02: szkic z twardą kolizją niedostępności jest pokazywany jako poprawny

**To jest odpowiedź na `docs/blad_oncall.png`.**

Zrzut przekazany przez zgłaszającego pokazuje Piotra Lewandowskiego z przydziałem `P` w dniach, w których ma jednocześnie znacznik `N` („nie mogę”).
Sprawdzono, czy generator łamie regułę twardą.
**Nie łamie.**
Przyczyna jest inna i jest defektem interfejsu.

Odtworzenie krok po kroku:

1. Jako `ola.zielinska` wygeneruj szkic na 02-11-2026 - 29-11-2026.
   Solver przydziela Piotrowi `primary` między innymi 02 i 03 listopada.
2. Jako `piotr.lewandowski` zgłoś „nie mogę” na 02-03.11.2026.
3. Wróć na `http://localhost:8080/generator?szkic=<id>` jako koordynator.

Wynik: komórki Piotra w tych dniach pokazują `P` nad `N`.
Odpowiedź `GET /api/v1/scheduling/{id}` zwraca `warnings: []`.
Na całym ekranie nie ma żadnego ostrzeżenia.
Jedyny komunikat brzmi:

> „Grafik spełnia wszystkie reguły twarde, ale solver nie zdążył potwierdzić, że jest optymalny”

co jest w tym stanie **nieprawdą**.

Backend zachowuje się poprawnie: `POST /propose` zwraca 409 z komunikatem „Szkic zawiera osoby z twardą niedostępnością; wygeneruj grafik ponownie” i listą konfliktów.
Publikacja jest bezpieczna.
Problemem jest to, że koordynator dowiaduje się o kolizji dopiero po kliknięciu „Przekaż do akceptacji”, a do tego momentu ekran aktywnie zapewnia go, że wszystko jest w porządku.

Opublikowana macierz (`components/CalendarMatrix.tsx:339-349`) ma dokładnie taki baner: „1 osoba ma dyżur w dniu zgłoszonej niedostępności”.
Macierz szkicu (`components/DraftScheduleMatrix.tsx`) nie ma odpowiednika.
`PLAN.md` par. 6 wymaga wprost, żeby filtry i widoki nie ukrywały aktywnych konfliktów bez czytelnego komunikatu.

Dodatkowo komunikat 409 sugeruje jedyne wyjście „wygeneruj grafik ponownie”, choć pojedynczą komórkę można naprawić ręczną korektą szkicu bez utraty reszty pracy.

Zrzut: `docs/qa-shots-5/03-szkic-P-plus-N-bez-ostrzezenia.png`.

### 7.2 HGH5-03: zamiana i korekta łamią reguły twarde po publikacji

Polityka zespołu brzmi „11–19: Ta sama osoba co SECONDARY”, a generator traktuje ją jako regułę twardą dla osób eligible do obu ról (`scheduler.py:545-552`).

Odtworzenie:

1. Jako `julia.nowak` otwórz Zamiany.
   Lista „Mój dyżur” pokazuje `pon 28-09-2026 · 11–19` i `pon 28-09-2026 · SECONDARY` jako dwa niezależne, wymienialne sloty.
2. Wybierz sam `SECONDARY`, zastępca Magdalena Woźniak, wyślij prośbę.
3. Jako `magdalena.wozniak` zaakceptuj.
4. Jako `ola.zielinska` zatwierdź.

Wynik w kalendarzu na 28-09-2026:

```
primary      Piotr Lewandowski
secondary    Magdalena Woźniak   (override)
late_shift   Julia Nowak
```

Kotwica jest zerwana.
Obie osoby są eligible do `secondary` i `11–19`, więc jest to naruszenie reguły opisanej w `PLAN.md` par. 3 jako twarda.
Na żadnym z trzech kroków (prośba, akceptacja zastępcy, zatwierdzenie koordynatora) nie pojawia się ostrzeżenie, a podgląd wpływu na bilans pokazuje wyłącznie soczewkę `secondary` i milczy o `11–19`.

**Ta sama zamiana złamała drugą regułę twardą.**
Skrypt `verify_rules.py` uruchomiony na opublikowanym grafiku po zatwierdzeniu zamiany zwraca:

```
Grafik hybrydowy 07-09-2026 - 04-10-2026 status=published solver=FEASIBLE
naruszenia: 1
 - B5 Magdalena Woźniak: 4 dyżurów w oknie od 2026-09-22
```

Magdalena miała już dyżury 22, 23 i 24 września, czyli maksimum dopuszczone regułą „najwyżej 3 dyżury w dowolnych 7 kolejnych dniach”.
Zamiana dołożyła jej 28 września, które nadal mieści się w tym samym oknie siedmiodniowym.
Reguła jest złamana, a nikt nie został o tym poinformowany.

**Przyczyna jest systemowa.**
`routes/swaps.py` waliduje tylko trzy rzeczy: eligibility zastępcy (wiersz 354), jego twardą niedostępność (wiersz 360) oraz rozłączność `primary` i `secondary`.
Nie sprawdza limitu 3 dyżurów w 7 dniach, limitu 3 kolejnych nocy, dwudniowego odpoczynku po serii, kotwiczenia 11–19 ani nierozdzielczości bloków weekendowych.
`routes/calendar.py:314` (bezpośrednia korekta koordynatora) waliduje dokładnie tyle samo, plus zakaz zmiany 11–19 w dni wolne.

Oznacza to, że **każda reguła twarda poza eligibility, niedostępnością i rozłącznością ról może zostać złamana po publikacji, przez normalną ścieżkę produktu, bez ostrzeżenia i bez śladu**.
Generator pilnuje ich rygorystycznie, po czym zamiana albo korekta może je unieważnić w dwóch kliknięciach.
`PLAN.md` par. 3 nie przewiduje takiego rozróżnienia: te reguły są tam wymienione jako twarde bez zastrzeżeń.

Opublikowana macierz ma baner tylko dla jednego typu kolizji („N osób ma dyżur w dniu zgłoszonej niedostępności”), więc naruszenie odpoczynku nie jest widoczne również po fakcie.

### 7.3 HGH5-04: `POST /api/v1/scheduling/generate` zawsze kończy się 504

Endpoint synchroniczny nadal istnieje i jest dostępny dla koordynatora.
`ONCALL_SOLVER_SECONDS` wynosi 90, a `proxy_read_timeout` w `frontend/nginx.http.conf:8` i `nginx.https.conf:24` też 90 sekund.
Budżet solvera jest równy limitowi bramy, więc każde wywołanie, które zużyje pełny budżet, kończy się `504 Gateway Time-out`.

Zmierzono dwa równoległe wywołania: oba zwróciły 504 po dokładnie 90,0 sekundy.

Gorsza część: praca nie przepada, tylko zostaje bez właściciela.
W bazie powstały dwa szkice `Szkic hybrydowy 04-01-2027 - 31-01-2027`, o identycznej nazwie, trybie, liczbie przydziałów i dacie utworzenia.
Na liście „Szkice w toku” nie da się ich odróżnić.
Zrzut: `docs/qa-shots-5/04-blad-precheck.png`.

Interfejs nie używa tego endpointu (korzysta z `/scheduling/runs` i odpytywania), więc jest to defekt powierzchni API, a nie ścieżki użytkownika.
Nie zmienia to jednak faktu, że produkt wystawia operację, która nie może się udać.

Sprawdzono też, czy blokuje ona API: nie blokuje.
W trakcie dwóch równoległych wywołań `/api/v1/auth/me` odpowiadało w 0,0-0,1 s.

### 7.4 MED5-04: korekta koordynatora oferuje akcję, która musi się nie udać

Dialog dnia w opublikowanej macierzy prawidłowo pokazuje na górze „Nie mogę - Szkolenie zagraniczne”, i prawidłowo pokazuje prywatny powód tylko koordynatorowi.
Mimo to przycisk „Zmień obsadę…” jest aktywny.

Ścieżka: Dyżury, komórka Anny Kowalskiej na 16-09-2026, rola PRIMARY, „Zmień obsadę…”, potwierdzenie.
Dopiero w oknie potwierdzenia pojawia się błąd z backendu: „Osoba jest niedostępna”.

Macierz szkicu robi to poprawnie: `DraftScheduleMatrix.tsx:248` blokuje przycisk, gdy wybrana osoba ma `unavailable`.
Opublikowana macierz nie ma tego zabezpieczenia, więc koordynator wykonuje cztery interakcje po to, żeby dostać odmowę.

Zrzut: `docs/qa-shots-5/09-korekta-niedostepny.png`.

Osobno, i mocniej: dialog nie ma żadnego wyboru zastępcy.
Model interakcji jest taki, że trzeba kliknąć komórkę **osoby, którą chce się przydzielić**, a nie osoby, która ma dyżur.
Nagłówek dialogu pokazuje wtedy jedną osobę, a lista pod nim obsadę dnia, czyli inne osoby, bez wyjaśnienia relacji między nimi.
Gdy klikniesz komórkę osoby, która już ma ten dyżur, przycisk jest wyszarzony bez podania przyczyny.
Dialog nie pokazuje też bilansu kandydata ani prognozy wpływu, choć oba są dostępne w innych miejscach aplikacji.

### 7.5 MED5-09: wybór zastępcy w zamianie bez kontekstu

Lista „Zastępca” to sama lista nazwisk w kolejności alfabetycznej:

```
Anna Kowalska, Bartosz Mazur, Katarzyna Dąbrowska, Magdalena Woźniak,
Marek Wiśniewski, Ola Zielińska, Rafał Kamiński, Tomasz Szymański
```

Brakuje przy każdej pozycji trzech rzeczy, które decydują o wyborze: dostępności w tym dniu, aktualnego bilansu w danej soczewce oraz informacji, czy ta osoba już ma tego dnia inny dyżur.
Sekcja „Wpływ na bilans” pojawia się dopiero **po** wybraniu konkretnej osoby, więc porównanie dwóch kandydatów wymaga wybrania każdego z osobna i zapamiętania liczb.
Osoby już obsadzone w tej roli są poprawnie wykluczone z listy.

To jest LOW-07 z rundy 4, podniesione do średniego, bo dotyczy najczęstszej operacji członka zespołu.

### 7.6 HGH5-05: panel wpływu szkicu nie pokazuje liczby, która decyduje o odbiorze

`components/DraftFairnessPanel.tsx` pokazuje dla każdej osoby saldo przed i po oraz opis słowny („bliżej równowagi o 0,11”, „dalej od równowagi o 0,66”).
To jest dobre i zgodne z `PLAN.md` par. 6.

Brakuje jednak **rozpiętości na soczewkę** i porównania jej z kryterium odbioru.
Koordynator patrzy na dziesięć wierszy po pięć liczb i nie ma jak stwierdzić, że soczewka `secondary` ma rozpiętość 9 punktów przy kryterium 3.
Jedyna liczba, która rozstrzyga, czy szkic nadaje się do publikacji, nie jest nigdzie pokazana.

To samo dotyczy ekranu Sprawiedliwość: pokazuje wiersz „Razem”, ale nie rozpiętość i nie kryterium.

### 7.7 Pozostałe obserwacje z ekranu Dyżury

**LOW5-05: ściana czerwonych `!`.**
Domyślny zakres macierzy to 30 dni od dziś, a opublikowany grafik pokrywał w chwili testu jeden z nich.
W nagłówku 29 z 30 kolumn dostaje czerwony wykrzyknik „brak obsady”, co czyta się jak awaria systemu, a nie jak normalny stan „grafik jeszcze nie powstał”.
Ta sama informacja jest już podana raz, tekstem, w banerze nad macierzą.
Zrzut: `docs/qa-shots-5/01-dyzury-koordynator.png`.
Rozsądniejszy domyślny zakres to zakres faktycznie pokryty, a nie stałe 30 dni.

**MED5-01: `[OPUBLIKOWANY]` dla danych z samego importu.**
`main.py:494` buduje odpowiedź `/schedules/published` przez `effective_assignments`, które celowo uwzględnia zaimportowaną historię (status `superseded`).
`screens/Duty.tsx:16` uznaje niepuste `id` za dowód publikacji.
W efekcie po samym imporcie historii, bez ani jednej publikacji, ekran główny pokazuje `[OPUBLIKOWANY]` i zdanie „To jest opublikowana wersja harmonogramu. Kliknij komórkę macierzy, żeby zmienić obsadę”.
Na tym samym ekranie baner mówi „29 dni pozostaje poza opublikowanym zakresem”.
Dwa sprzeczne komunikaty o tym samym stanie.
Koordynator dostaje zaproszenie do edycji dni, które nigdy nie zostały opublikowane.

### 7.8 HGH5-06: ostrzeżenia generatora nie docierają do koordynatora

Sprawdzono ścieżkę awaryjną, której runda 4 nie przetestowała: model bez reguł rozrzedzania.
Ustawiono niedostępność siedmiu z dziesięciu osób na cały marzec 2027 i wygenerowano szkic 01-03-2027 - 28-03-2027.

Wynik: `completed` po 54 sekundach, `solver_status: OPTIMAL`, kompletny szkic.
Anna Kowalska dostała 21 dyżurów w 28 dni, Julia 18, Marek 17.
Fallback zadziałał poprawnie.

Problem jest w komunikacji.
Ostrzeżenie solvera („Reguły rozrzedzania musiały zostać zawieszone, bo przy tej obsadzie i nieobecnościach nie da się ich spełnić.”, `scheduler.py:732`) trafia wyłącznie do rekordu zadania i do audytu.
`_schedule_response` (`routes/scheduling.py:216-223`) buduje pole `warnings` od zera z `_override_rest_warnings`, więc koordynator zamiast tego widzi:

> „Korekta tworzy więcej niż 3 dyżury on-call w okresie 7 dni.”
> „Korekta nie zostawia 2 dni przerwy po serii dyżurów.”

Rzeczownik jest błędny: nikt nie wykonał żadnej korekty, to jest wynik generatora.
Komunikaty nie podają też, kogo dotyczą ani ilu dni.
Interfejs pokazuje `runProgress.conflicts` tylko wtedy, gdy `generate.error` jest ustawione (`screens/Generator.tsx:352`), czyli wyłącznie przy niepowodzeniu.
Udane generowanie z zawieszonymi regułami nie mówi o tym nic.

`SOLVER.md` twierdzi w wierszu 43-44, że solver „zwraca kompletny szkic z jawnym ostrzeżeniem”.
Na poziomie API to prawda, na poziomie ekranu koordynatora nie.

### 7.9 Stan `PRECHECK` jest poprawny, ale komunikat myli przyczynę

Zablokowano dostępność wszystkich dziesięciu osób na 05-04-2027 - 11-04-2027 i uruchomiono generowanie.
Zadanie kończy się `failed` po 6 sekundach, nie tworzy szkicu i podaje nazwane konflikty per dzień i rola.
To jest dokładnie takie zachowanie, jakiego wymaga `SOLVER.md`.

Dwie uwagi do treści:

- Komunikat brzmi „brak eligible osoby dla primary”, podczas gdy eligibility jest w porządku, a przyczyną jest zgłoszona niedostępność.
  Koordynator pójdzie sprawdzać ustawienia eligibility i niczego tam nie znajdzie.
  Zgłoszone jako MED5-07.
- Lista ma 17 pozycji dla zakresu 7-dniowego, po jednej na każdy dzień i rolę.
  Dla zakresu 35-dniowego byłoby ich do 105.
  Warto grupować po zakresach dat.
- W treści przecieka identyfikator techniczny `late_shift`, choć w całym pozostałym interfejsie ta rola nazywa się `11–19`.
  Zgłoszone jako LOW5-07.

Zrzut: `docs/qa-shots-5/05-precheck-komunikat.png`.

### 7.10 MED5-02 i MED5-03: panel „Ustawienia generowania”

Panel zawiera tryb rotacji, powiązanie 11–19 i trzy wagi (0-100) z jednozdaniowymi opisami.
Baner poprawnie mówi, że wagi nie mogą wyłączyć eligibility, niedostępności ani wymaganego pokrycia.

Trzy braki względem `PLAN.md` par. 6 i względem komunikatów samej aplikacji:

**MED5-02: nie ma pola budżetu czasu.**
Komunikat błędu `UNKNOWN` z `scheduler.py:742` mówi: „Spróbuj krótszego zakresu albo zwiększ budżet czasu w ustawieniach generowania.”
W ustawieniach generowania nie ma takiego pola.
Aplikacja odsyła użytkownika do kontrolki, która nie istnieje.

**MED5-03: brak przykładu i brak informacji, że liczy się relacja.**
`PLAN.md` par. 6 wymaga wprost: „Interfejs objaśnia skutek każdej wagi prostym przykładem, pokazuje że znaczenie ma relacja między wagami”.
Panel nie robi ani jednego, ani drugiego.
Wartości domyślne nie są też opisane jako zbalansowany preset.

**LOW5-11: kolejność pól nie odpowiada hierarchii.**
Pola idą w kolejności: Równy udział (3), Ciągłość rotacji (1), Preferencje zespołu (2).
Deklarowana hierarchia to sprawiedliwość, preferencje, ciągłość.
Przy układzie trójkolumnowym „Równy udział” ląduje samotnie na końcu pierwszego wiersza, a dwie pozostałe wagi w drugim.

Zdanie „Wartość 0 wyłącza tylko wskazaną preferencję” jest nieścisłe dla wagi „Równy udział”, która nie jest preferencją.

Zrzut: `docs/qa-shots-5/02-ustawienia-generowania.png`.

### 7.11 MED5-10: pasek postępu generowania stoi w miejscu

Worker ustawia postęp na 10 (start), 30 (`model_built`), 90 (`solve_done`) i 100.
Etap, który zajmuje 99% czasu, to jeden płaski krok na 30%.
Przez około 90 sekund pasek się nie rusza.

Brakuje dwóch rzeczy, które kosztują niewiele: licznika czasu, który upłynął, oraz podania budżetu („do 90 sekund”).
Tekst „Solver pracuje poza procesem API. Możesz korzystać z pozostałych ekranów.” jest dobry i dokładnie odpowiada zachowaniu zmierzonemu w rozdz. 7.3.

Zrzut: `docs/qa-shots-5/06-postep-generowania.png`.

### 7.12 MED5-11: przeładowanie strony w trakcie generowania gubi postęp

`SOLVER.md` w wierszach 149-150 obiecuje, że „interfejs odpytuje postęp i może odzyskać wynik niezależnie od czasu wykonania”.
Obietnica jest spełniona w połowie.

Odtworzenie: uruchom generowanie na 01-02-2027 - 28-02-2027, odczekaj 15 sekund, przeładuj `/generator`.

Po przeładowaniu ekran nie pokazuje żadnego śladu trwającego zadania.
Pasek postępu znika, pola dat wracają do sugerowanego zakresu (05-10-2026 - 01-11-2026), a przycisk „Utwórz szkic” jest znowu aktywny.
W bazie zadanie ma w tym czasie `status = running, progress = 30`.

Wynik ostatecznie nie przepada: po zakończeniu szkic pojawia się na liście „Szkice w toku” i można go otworzyć.
Ale przez pozostałe około 75 sekund koordynator nie ma żadnej informacji, że cokolwiek się dzieje, i najbardziej naturalną reakcją jest uruchomienie generowania jeszcze raz, co daje dwa równoległe zadania i dwa nierozróżnialne szkice, dokładnie jak w LOW5-09.

Naprawa jest tania: identyfikator trwającego zadania wystarczy trzymać po stronie serwera (`/scheduling/runs` z filtrem po statusie) albo w `localStorage`, i wznowić odpytywanie po zamontowaniu ekranu.

### 7.13 MED5-05: ekran sprawiedliwości myli „brak roli” z „bilansem zero”

Rafał Kamiński nie ma eligibility do `primary`, a Tomasz Szymański do `11–19`.
Ekran Sprawiedliwość pokazuje im w tych kolumnach `0 / 0`, pasek postępu i podpis „zgodnie z udziałem”.
Czyta się to jak informacja, że ta osoba ma idealnie wyrównany bilans w tej roli.

`DraftFairnessPanel` robi to poprawnie: przy `eligible_days == 0` wypisuje „nie pełni tej roli”.
Dwa ekrany opisują tę samą sytuację inaczej.

### 7.14 Dostępność i responsywność: bez zastrzeżeń

Skan `axe-core` 4.10.2 (WCAG 2.0 A/AA, 2.1 A/AA, 2.2 AA) na siedmiu ekranach koordynatora, w motywie jasnym i ciemnym: **zero naruszeń w każdym z czternastu przebiegów**.

Semantyka macierzy jest zrobiona dobrze.
Tabela ma `caption` („Grafik dyżurów od 06-09-2026 do 05-10-2026. Osoby w wierszach, dni w kolumnach.”), nagłówki kolumn mają `scope="col"`, komórka osoby `scope="row"`, a każda komórka z treścią jest przyciskiem z pełną etykietą, na przykład:

```
"Rafał Kamiński, niedz 2026-09-06, dzień wolny, stawka 2X, SECONDARY"
"Anna Kowalska, pon 2026-09-14, brak dyżuru, Nie mogę"
```

Kolor nigdzie nie jest jedynym nośnikiem informacji.

Widok mobilny (390x844) nie ma przewijania poziomego, nawigacja zwija się do menu, karty układają się w kolumnę, a macierz przełącza się na widok dzień po dniu.
Wersja mobilna dodaje nawet użyteczną informację, której nie ma na desktopie: „Następnie: Piotr Lewandowski (za 3 dni)”.
Jedyna uwaga: w nagłówku mobilnym znika nazwisko zalogowanej osoby, zostaje sam chip roli (LOW5-10).

Zrzut: `docs/qa-shots-5/10-mobile-dyzury.png`.

---

## 8. Dokumentacja rozjechana z kodem

| ID | Miejsce | Treść dokumentu | Stan kodu |
| --- | --- | --- | --- |
| LOW5-01 | `PLAN.md` par. 8 | „90-dniowy grafik w skonfigurowanym budżecie czasu (domyślnie 30 sekund)” | par. 3 tego samego dokumentu ustala maksimum 35 dni, a `SOLVE_SECONDS` wynosi 90 |
| LOW5-02 | `SOLVER.md` wiersz 91-93, `PLAN.md` par. 3 | „przy kotwiczeniu soczewka 11–19 pozostaje informacyjna”, „solver pomija tę soczewkę w celu” | `scheduler.py:481` bilansuje ją zawsze, to była naprawa HGH-04 |
| LOW5-03 | nagłówek kolumny na ekranie Sprawiedliwość | „zmiany / udział · informacyjnie przy kotwiczeniu” | jak wyżej |
| LOW5-04 | docstring `_build_model` | „the 7-in-14-day and rest-after-run relaxation” | kod realizuje 3 dyżury w 7 dniach (`scheduler.py:310-318`), zgodnie z `PLAN.md` |
| LOW5-08 | `PLAN.md` par. 3 | „maksymalnie 3 punkty rozpiętości odchylenia w każdej soczewce” | nie jest powiedziane, na którym oknie i w którym momencie mierzone; przy oknie kroczącym to nie jest jednoznaczne, co pokazuje BLK5-01 |

---

## 9. Pozostałe defekty niskie

| ID | Opis |
| --- | --- |
| LOW5-05 | 29 z 30 kolumn nagłówka macierzy z czerwonym `!`, duplikat banera (rozdz. 7.7) |
| LOW5-06 | Trzy myślniki em w kodzie frontendu wbrew konwencji reszty aplikacji: `CalendarMatrix.tsx:346`, `admin/CalendarEvents.tsx:49`, `admin/People.tsx:362` |
| LOW5-07 | Identyfikator techniczny `late_shift` w komunikatach PRECHECK zamiast etykiety `11–19` |
| LOW5-09 | Duplikaty szkiców o identycznych metadanych na liście „Szkice w toku”, nie do odróżnienia (skutek HGH5-04) |
| LOW5-10 | Brak nazwiska zalogowanej osoby w nagłówku mobilnym |
| LOW5-11 | Kolejność pól wag niezgodna z deklarowaną hierarchią (rozdz. 7.10) |
| LOW5-12 | Ostrzeżenia „Korekta …” bez nazwisk i dat, mimo że dane są dostępne (rozdz. 7.8) |
| LOW5-13 | Import historii nie waliduje eligibility roli; wiersz `2025-07-14,primary,Rafał Kamiński` przechodzi, choć Rafał nie ma eligibility do `primary`. Okres członkostwa jest walidowany poprawnie |
| LOW5-14 | Pole notatki w API dostępności nazywa się `note`, a w interfejsie „Prywatna notatka”; próba użycia `reason` daje `extra_forbidden` bez podpowiedzi poprawnej nazwy |
| LOW5-15 | Zakres jednodniowy jest przyjmowany bez ostrzeżenia, choć bilansowanie na jednym dniu nie ma sensu |

---

## 10. Wydajność

Sprzęt docelowy według zgłoszenia: 2-4 rdzenie, około 8 GB RAM.
Kontener `api` ograniczono do 3 rdzeni, kontener `worker` ma stały limit 2 rdzeni.
Dziesięciu użytkowników, 30 sekund na scenariusz, sesje przez nginx.

**Scenariusz odczytowy** (`/schedules/published`, `/calendar` 30 dni, `/auth/me`, `/team`):

| Endpoint | n | p50 | p95 | p99 | max |
| --- | --- | --- | --- | --- | --- |
| `/api/v1/auth/me` | 2569 | 14 ms | 56 ms | 78 ms | 256 ms |
| `/api/v1/calendar` (30 dni) | 2569 | 29 ms | 102 ms | 191 ms | 434 ms |
| `/api/v1/schedules/published` | 2569 | 20 ms | 77 ms | 104 ms | 354 ms |
| `/api/v1/team` | 2569 | 17 ms | 62 ms | 101 ms | 317 ms |

Przepustowość 342,5 req/s, zero błędów.

**Scenariusz raportowy** (`/fairness`, `/reports/monthly`, `/calendar`):

| Endpoint | n | p50 | p95 | p99 | max |
| --- | --- | --- | --- | --- | --- |
| `/api/v1/calendar` (30 dni) | 1253 | 92 ms | 271 ms | 473 ms | 810 ms |
| `/api/v1/fairness` | 1253 | 97 ms | 291 ms | 468 ms | 638 ms |
| `/api/v1/reports/monthly` | 93 | 56 ms | 207 ms | 264 ms | 264 ms |

Przepustowość 86,6 req/s, zero błędów.

Dla porównania te same scenariusze bez limitu CPU dawały 453,6 i 89,9 req/s, więc ograniczenie do 3 rdzeni kosztuje około 25% przepustowości odczytowej i praktycznie nic w scenariuszu raportowym, który jest ograniczony przez bazę, a nie przez CPU aplikacji.

**Import historii**: 1245 wierszy, podgląd 0,12 s, zatwierdzenie 0,12 s.

**Wniosek**: wydajność odczytu i raportowania nie jest problemem na sprzęcie docelowym i nie wymaga pracy.
Jedynym kosztownym elementem jest solver, a jego 90-sekundowy budżet jest dziś, jak pokazuje rozdz. 5.4, wydatkiem bez zwrotu.

---

## 11. Plan naprawczy

Kolejność jest istotna.
N1 jest warunkiem koniecznym dla sensowności N2, N3 i N4.

### N1. Zsynchronizować okno solvera z oknem raportu (BLK5-01)

Generator ma dostawać historię z okna `[ends_on - 365, starts_on - 1]`, czyli tę, która nadal będzie w oknie kroczącym w chwili zamknięcia horyzontu.
Zmiana dotyczy dwóch rzeczy naraz i obie muszą pójść razem:

- źródła punktów historycznych (`solver_history` musi przyjmować koniec horyzontu, nie tylko jego początek);
- argumentu `history_window` przekazywanego do `generate_schedule`, bo `balance()` liczy z niego ekspozycję historyczną i rozjazd tutaj wprowadziłby nowy błąd.

Kryterium akceptacji: dla instancji z rozdz. 3 rozpiętość `primary` po wygenerowaniu 28-dniowego szkicu wynosi najwyżej 2 punkty na metryce `draft_fairness_impact`, w trzech kolejnych przebiegach.
Zmierzona wartość referencyjna po tej poprawce: 1,0.

**Częścią tej samej naprawy musi być okno bazowe panelu wpływu.**
`draft_fairness_impact` liczy dziś „przed” w oknie `[starts_on - 1 - 365, starts_on - 1]`, a „po” w oknie `[ends_on - 365, ends_on]`.
Porównuje więc dwie różne wielkości i przypisuje szkicowi zmianę, której część jest zwykłym starzeniem się historii.
Rozdz. 5.9 pokazuje, jak duże to jest: samo przesunięcie okna zmienia rozpiętość `secondary` z 7,0 na 10,0, bez żadnego szkicu.
Poprawka: liczyć „przed” w tym samym oknie co „po” (`baseline_start = ends_on - 365`), z tą jedyną różnicą, że bez przydziałów szkicu.
Bez tego opisy w stylu „bliżej równowagi o 0,11” pozostaną częściowo artefaktem, nawet po naprawieniu okna solvera.

Po wdrożeniu należy powtórzyć rozdz. 5.6, bo suwak sprawiedliwości powinien odzyskać wpływ.

### N2. Rozstrzygnąć konflikt między kotwiczeniem 11–19 a kryterium odbioru (BLK5-02)

Trzy warianty, w kolejności rekomendacji.

**Wariant A, rekomendowany: kotwica miękka zamiast twardej.**
Zamiast `model.add(anchor == late_shift)` wprowadzić karę za rozjazd, ważoną osobnym suwakiem.
Solver dostaje wtedy wybór między ciągłością obsady 11–19 a sprawiedliwością, zamiast mieć jedną z nich narzuconą.
Zmierzony efekt przy pełnym rozluźnieniu (`independent`) i po N1: rozpiętość 3,0 w trzech przebiegach, czyli kryterium spełnione.

**Wariant B: przeliczyć kryterium na osiągalne.**
Zostawić twardą kotwicę i zapisać w `PLAN.md`, że przy kotwiczeniu kryterium wynosi 6 punktów, a 3 punkty obowiązują tylko przy `independent`.
Wariant tani, ale przyznaje, że produkt nie umie dowieźć obiecanej sprawiedliwości w konfiguracji domyślnej.

**Wariant C: bilansować `secondary` sztukowo w dni robocze.**
Rozdzielić soczewkę `secondary` na część weekendową i roboczą, tak by kotwiczenie nie stawiało punktów przeciwko sztukom.
Największa zmiana modelu i najtrudniejsza do wyjaśnienia użytkownikowi.

Niezależnie od wariantu warto skompilować kryterium jako twarde ograniczenie z możliwością rozluźnienia.
Solver rozstrzyga jego wykonalność w pół sekundy, więc koordynator może dostać natychmiastową odpowiedź „tego kryterium nie da się dziś spełnić, najniższa osiągalna rozpiętość to N”, zamiast czekać 90 sekund na wynik, który go nie spełnia.

### N3. Zmniejszyć domyślny budżet czasu i dodać kontrolkę (HGH5-01, MED5-02)

Do czasu wdrożenia N1 domyślne 90 sekund jest wydatkiem bez zwrotu, a przy budżecie 1 sekundy soczewka weekendów wychodziła lepiej.
Po N1 budżet należy przemierzyć od nowa i ustawić na najmniejszą wartość, przy której wynik przestaje się poprawiać.

Niezależnie: dodać do „Ustawień generowania” pole budżetu czasu, bo komunikat `UNKNOWN` już do niego odsyła.

### N4. Pokazać rozpiętość i kryterium tam, gdzie zapada decyzja (HGH5-05)

Panel „Wpływ szkicu na sprawiedliwość” ma dostać wiersz podsumowania z rozpiętością każdej soczewki przed i po, z jawnym porównaniem do kryterium 3 punktów i widocznym stanem „spełnia / nie spełnia”.
To samo podsumowanie należy dodać na ekranie Sprawiedliwość.
Bez tego koordynator nie ma jak ocenić szkicu, a zespół nie ma jak zauważyć regresji.

### N5. Naprawić ostrzeżenia i blokady w interfejsie (HGH5-02, HGH5-03, HGH5-06, MED5-04)

- Macierz szkicu dostaje ten sam baner konfliktów co macierz opublikowana, a komunikat „Grafik spełnia wszystkie reguły twarde” znika, gdy konflikt istnieje.
- Przycisk „Przekaż do akceptacji” zostaje zablokowany z podaniem przyczyny, zamiast pozwalać kliknąć i zwracać 409.
- Komunikat 409 przestaje sugerować pełną regenerację jako jedyne wyjście.
- Ostrzeżenia solvera (`SolverResult.warnings`) trafiają do `DraftScheduleResponse` obok ostrzeżeń o korektach i są odróżnialne od nich w treści.
- `routes/swaps.py` i `routes/calendar.py` walidują ten sam komplet reguł twardych co generator: limit 3 dyżurów w 7 dniach, limit 3 kolejnych nocy, dwudniowy odpoczynek, kotwiczenie 11–19 i nierozdzielczość bloków weekendowych.
- Naruszenie tych reguł blokuje operację albo wymaga świadomego potwierdzenia z podaniem, która reguła zostaje złamana.
- Zamiana slotu związanego kotwicą 11–19 wymaga potwierdzenia albo obejmuje oba sloty naraz.
- Dialog korekty w opublikowanej macierzy blokuje przydział osoby z „nie mogę”, tak jak robi to macierz szkicu.

### N6. Uporządkować powierzchnię API i dokumentację (HGH5-04, LOW5-01 do LOW5-04, LOW5-08)

- Usunąć synchroniczny `POST /api/v1/scheduling/generate` albo ograniczyć jego budżet tak, żeby mieścił się w limicie bramy z zapasem.
- Zaktualizować `PLAN.md` par. 8 (90 dni, 30 sekund), `SOLVER.md` (soczewka 11–19 przy kotwiczeniu) i docstring `_build_model` (7-in-14).
- Dopisać w `PLAN.md` par. 3, na którym oknie i w którym momencie mierzone jest kryterium odbioru.
- Poprawić nagłówek kolumny 11–19 na ekranie Sprawiedliwość.

### N7. Poprawki drobne

Pozostałe pozycje MED i LOW z rozdziałów 7 i 9.
Najwyższy stosunek wartości do kosztu mają: wznowienie odpytywania postępu po przeładowaniu strony (MED5-11), kontekst przy liście zastępców (MED5-09), rozróżnienie „brak roli” od „bilans zero” (MED5-05), ostrzeżenie o wyłączeniu reguł rozrzedzania w trybie tygodniowym (MED5-08) oraz licznik czasu przy pasku postępu (MED5-10).

---

## 12. Co działa dobrze

Warto to zapisać, bo lista defektów sama z siebie daje fałszywy obraz.

**Dostępność.** Zero naruszeń axe-core w czternastu przebiegach, na siedmiu ekranach, w obu motywach.
Semantyka macierzy z pełnymi etykietami przycisków jest lepsza niż w większości systemów tej klasy.

**Responsywność.** Widok mobilny nie ma przewijania poziomego, przełącza macierz na sensowną alternatywę i dodaje informację, której nie ma na desktopie.

**Wydajność.** 342 req/s przy 10 użytkownikach i 3 rdzeniach, zero błędów, import 1245 wierszy w 0,12 sekundy.

**RBAC.** 39 z 39 sprawdzeń przeszło.
Koordynator nie widzi ekranów administratora, viewer nie dostaje danych o dostępności, link viewer wygasa po jednorazowej wymianie, sesja po odwołaniu daje 401.

**Walidacja wejścia.** Wszystkie sprawdzone przypadki brzegowe zwracają 422 z sensownym komunikatem po polsku: zakres 92 dni, zakres odwrócony, waga 101, wszystkie wagi zerowe, link viewer na 31 dni, wpis dostępności na 400 dni, zły format miesiąca, zakres kalendarza na 5 lat.

**Stany awaryjne solvera.** `PRECHECK` nie tworzy częściowego szkicu i podaje nazwane konflikty.
Fallback bez reguł rozrzedzania działa i zwraca `OPTIMAL`.
Zabezpieczenie przed publikacją szkicu z twardą kolizją działa.

**Import historii.** Naprawy HGH-05 i HGH-06 z rundy 4 działają.
Import nie nadpisuje publikacji i nie gubi tożsamości przy innej wielkości liter.
Okres członkostwa jest walidowany.

**Raport miesięczny.** Sumy zgadzają się z kalendarzem co do dnia (sierpień 2026: 21 roboczych, 9 weekendowych, 1 świąteczny, razem 31).
Eksport CSV zgodny z widokiem, zero rozbieżności.

**Podgląd wpływu zamiany.** Pokazuje obie strony, kierunek zmiany i opis słowny.
Model interakcji jest dobry, brakuje tylko kontekstu przy wyborze (MED5-09).

**Kopia treści.** Teksty są po polsku, konkretne i unikają żargonu.
Zdanie „Solver pracuje poza procesem API. Możesz korzystać z pozostałych ekranów.” dokładnie odpowiada zmierzonemu zachowaniu.

---

## 13. Jak odtworzyć

```bash
# 1. Kopia zapasowa i czysta baza
docker compose exec -T db pg_dump -U oncall -d oncall > backup.sql
docker compose exec -T db psql -U oncall -d oncall -c "TRUNCATE assignments, availability, \
  audit_events, calendar_events, calendar_feed_tokens, eligibility, notification_outbox, \
  schedule_runs, schedules, scheduling_policies, sessions, share_links, swap_requests, \
  team_members, account_tokens, users CASCADE;"
docker compose exec -T api python -m oncall.seed_admin

# 2. Konta i historia
docker compose cp docs/qa-suite-5/seed_users.py api:/tmp/seed_users.py
docker compose exec -T api python /tmp/seed_users.py
python3 -m venv .venv && .venv/bin/pip install httpx holidays
cd docs/qa-suite-5 && ../../.venv/bin/python import_history.py history.csv
../../.venv/bin/python seed_availability.py
../../.venv/bin/python check_fairness.py     # musi dać sumy 481 / 481 / 251 / 212 / 18

# 3. BLK5-01: to samo rozwiązanie w dwóch oknach
docker compose cp window_check.py api:/tmp/window_check.py
docker compose exec -T api python /tmp/window_check.py \
  '{"start":"2026-09-07","days":28,"workers":4,"seconds":60,"fairness":100,"continuity":0,"preference":0}'

# 4. BLK5-02: dowód niewykonalności kryterium
docker compose cp variant5.py worker:/tmp/variant5.py
docker compose exec -T worker python /tmp/variant5.py \
  '[{"start":"2026-09-07","days":28,"workers":2,"seconds":25,"okno":"kroczace","limit":3},
    {"start":"2026-09-07","days":28,"workers":2,"seconds":25,"okno":"kroczace","limit":6},
    {"start":"2026-09-07","days":28,"workers":2,"seconds":25,"okno":"kroczace","limit":3,"anchor":"independent"}]'

# 5. Kontrola driftu okna: ta sama historia w dwóch oknach, bez solvowania
docker compose cp drift_check.py api:/tmp/drift_check.py
docker compose exec -T api python /tmp/drift_check.py 2026-09-07 2026-10-04

# 6. HGH5-01: budżet bez wpływu
docker compose cp analyze5.py worker:/tmp/analyze5.py
docker compose exec -T worker python /tmp/analyze5.py \
  '[{"start":"2026-09-07","days":28,"workers":2,"seconds":1},
    {"start":"2026-09-07","days":28,"workers":2,"seconds":90}]'

# 7. Obciążenie na sprzęcie docelowym
docker update --cpus 3 oncall-api-1
../../.venv/bin/python t_perf.py odczyt 30 10
../../.venv/bin/python t_perf.py raporty 30 10
```

HGH5-02 (zrzut zgłaszającego) odtwarza się ręcznie, według kroków z rozdziału 7.1.
HGH5-03 odtwarza się według kroków z rozdziału 7.2.
MED5-11 odtwarza się według kroków z rozdziału 7.12.
Naruszenia reguł twardych po zamianie sprawdza `verify_rules.py <id opublikowanego grafiku>`.

---

## 14. Ograniczenia metodologiczne

Ten rozdział mówi, czego **nie** wolno wyczytać z powyższych liczb.

**Jedna instancja.** Wszystkie wnioski o solverze dotyczą jednej obsady (10 osób, dwie z niepełną eligibility) i jednej historii.
Dno 6 punktów z rozdz. 5.2 jest własnością tej instancji, nie produktu.
Kierunek efektów (okno, kotwica) jest natomiast strukturalny i powinien się przenosić.

**Trzy powtórzenia, nie trzydzieści.** Każde porównanie wariantów ma po trzy przebiegi.
Rozrzut był bardzo mały (w wariancie kroczącym identyczny co do setnych), ale trzy próbki nie pozwalają mówić o istotności statystycznej.

**Jeden horyzont dla porównań.** Porównania 2x2 z rozdz. 5.3 zrobiono tylko dla 28 dni, trybu hybrydowego i startu 07-09-2026.
Testy limitów objęły też 35 dni i tryb dzienny, ale nie pełną kratę.

**Poprawka N1 jest zmierzona, nie wdrożona.** `window_fix.py` podaje generatorowi historię z innego okna, ale nie zmienia kodu produkcyjnego.
Wdrożenie wymaga zmiany również w `solver_history`, której nie testowano.

**Dno 6 punktów jest dokładne do około jednego punktu.**
Twardy limit działa na soczewki solvera, a raport liczy własne, z innym mianownikiem udziału oczekiwanego.
W przebiegu dziennym z limitem 6 raport pokazał 7,0, czyli o punkt więcej niż nakazywało ograniczenie.
Liczba, na której opiera się N2, ma więc niepewność rzędu jednego punktu; nie zmienia to jednak wniosku, bo różnica między 6 a 3 jest znacznie większa.

**Kontrola driftu została zrobiona dla jednego zakresu.**
Rozdz. 5.9 izoluje przesunięcie okna tylko dla horyzontu 07-09-2026 - 04-10-2026.
Dla innych zakresów udział driftu w zmianie „przed / po” będzie inny, bo zależy od tego, jak nierówny był akurat wypadający z okna miesiąc.

**Twardy limit rozpiętości nie jest propozycją wdrożenia.** Służył wyłącznie do rozstrzygnięcia, czy kryterium jest osiągalne.
W produkcji `INFEASIBLE` zamiast szkicu byłby gorszy niż szkic z rozpiętością 7.

**Statystyki CP-SAT przy wielu workerach są niewiarygodne.** Kolumny `conflicts` i `branches` przy 8 i 16 workerach raportowały zera.
Żaden wniosek nie opiera się na tych liczbach; wnioski o skalowaniu opierają się na dolnej granicy celu, która jest raportowana poprawnie.

**Host ma 16 rdzeni.** Kontener `worker` był ograniczony do 2, a `api` do 3 podczas testów obciążeniowych, ale pozostałe rdzenie były dostępne dla bazy i nginx.
Na maszynie mającej łącznie 2-4 rdzenie liczby będą gorsze.

**Czas do `OPTIMAL` nie został zmierzony dla instancji produkcyjnej**, bo żaden przebieg w konfiguracji produkcyjnej go nie osiągnął.
`OPTIMAL` uzyskano tylko dla instancji zdegenerowanych: 1 dzień oraz 28 dni z trzema dostępnymi osobami (54 s).

**Nie testowano**: uwierzytelniania LDAP, wysyłki e-mail poza kolejką outbox, przywracania po awarii workera w trakcie solvowania, więcej niż 10 równoczesnych użytkowników, ani zachowania po przekroczeniu 35 dni w bazie sprzed wprowadzenia limitu.

**Baza po testach nie jest czysta.** Zawiera dwa osierocone szkice ze stycznia 2027 (dowód HGH5-04), niedostępności testowe na marzec i kwiecień 2027, zatwierdzoną zamianę z 28-09-2026 (dowód HGH5-03) oraz opublikowany grafik 07-09-2026 - 04-10-2026.
Przed kolejną rundą należy powtórzyć krok 1 z rozdziału 13.
