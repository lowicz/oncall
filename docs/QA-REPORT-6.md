# QA-REPORT-6: niezależny przegląd Erste On-call

Data wykonania: 2026-09-07.
Zakres: pełny przegląd funkcjonalny, eksploracyjny, użytecznościowy i wydajnościowy.
Podejście: świeże, bez opierania się na wnioskach z QA-REPORT-1..5.
Wcześniejsze raporty posłużyły wyłącznie do zrozumienia intencji produktu, nie jako lista przypadków testowych.

Środowisko: Docker Compose, PostgreSQL 17, FastAPI, React, OR-Tools CP-SAT.
Host pomiarowy: 16 rdzeni, 62 GB RAM.
Pomiary wydajnościowe wykonano dodatkowo pod docelowym ograniczeniem zasobów, opisanym w paragrafie 7.

---

## 1. Podsumowanie wykonawcze

Aplikacja jest w bardzo dobrym stanie inżynierskim w warstwach, które łatwo zepsuć.
RBAC jest egzekwowany po stronie backendu bez wyjątku, CSRF działa, prywatność danych o dostępności jest szczelna, linki udostępnień są jednorazowe i umierają natychmiast po odwołaniu, kanały ICS pokazują wyłącznie własne dyżury, a ślad audytowy jest kompletny i czytelny.
Nawigacja klawiaturą po macierzy działa, focus jest widoczny, a statusy są przekazywane tekstem, nie samym kolorem.
Walidacja negatywna przeszła wszystkie 16 przygotowanych przypadków brzegowych.

Problemy leżą gdzie indziej i są poważne.

Trzy blokery:

1. **74% dyżurów w opublikowanym grafiku nie da się zamienić**, a interfejs oferuje zastępców, których backend następnie odrzuca komunikatem bez treści.
   Dwie osoby z dziesięciu nie mogą oddać ani jednego ze swoich dwunastu dyżurów.
2. **Prognoza sprawiedliwości szkicu liczy dwa razy** każdy dzień, który pokrywa już opublikowany grafik.
   Ekran, który istnieje po to, żeby koordynator podjął decyzję o publikacji, podaje przy regeneracji fałszywe liczby.
3. **Solver dostaje osiem workerów CP-SAT na przydziale dwóch CPU**, co zmienia szkic spełniający kryterium w szkic go niespełniający, przy identycznym czasie.

Do tego dochodzi rozjazd między metryką, którą solver egzekwuje, a metryką, którą raport ocenia, oraz błędne oznaczenie budżetu czasu jako budżetu „na jedno generowanie", podczas gdy jest to budżet na jeden przebieg z kilku.

Najważniejszy wniosek dla pytania „jak sprawić, żeby solver dawał rozwiązania optymalne szybko":
**zwiększanie budżetu czasu nie jest dźwignią**.
Od 5 do 120 sekund rozpiętości soczewek są identyczne w trzech z czterech badanych horyzontów.
Działają dwie inne dźwignie, obie zmierzone: dopasowanie liczby workerów do przydziału CPU oraz zmiana kotwicy zmiany 11-19 na `independent`.

Luka funkcjonalna zgłoszona przez zamawiającego, czyli wpisywanie niedostępności w imieniu innych osób, jest potwierdzona i opisana w paragrafie 6 oraz w planie naprawczym.

---

## 2. Poświadczenia do samodzielnej weryfikacji

Wszystkie konta poza `admin` mają hasło **`QA6-Testowe-Haslo!`**.
Konto `admin` ma hasło z pliku `.env` (`ONCALL_ADMIN_PASSWORD`), czyli **`Qwertyuiop1!`**; jest ono synchronizowane przy każdym starcie kontenera `api`.
Adres aplikacji: `http://localhost:8080`.

| Login | Osoba | Rola konta | W rotacji od | Uwagi |
| --- | --- | --- | --- | --- |
| `admin` | Administrator | admin | poza rotacją | hasło `Qwertyuiop1!` |
| `adam.nowicki` | Adam Nowicki | koordynator | 2024-01-08 | koordynator będący jednocześnie w rotacji |
| `karolina.master` | Karolina Master | koordynator | poza rotacją | koordynator bez własnych dyżurów |
| `beata.lis` | Beata Lis | członek | 2024-01-08 | urlop 2026-09-14 do 2026-09-27 |
| `cezary.dudek` | Cezary Dudek | członek | 2024-01-08 | niedostępny 2026-09-10 do 2026-09-13 |
| `dorota.pawlak` | Dorota Pawlak | członek | 2024-01-08 | „wolę nie" 2026-09-19 do 2026-09-20 |
| `emil.zajac` | Emil Zając | członek | 2024-01-08 | **bez eligibility do 11-19**, „chętnie wezmę" 2026-09-26/27 |
| `filip.gorski` | Filip Górski | członek | 2024-01-08 | szkolenie 2026-10-05 do 2026-10-11 |
| `grazyna.wilk` | Grażyna Wilk | członek | 2024-01-08 | „wolę nie" 2026-09-28 do 2026-10-02 |
| `hubert.baran` | Hubert Baran | członek | 2024-01-08 | „chętnie wezmę" 2026-10-17/18 |
| `iwona.sadowska` | Iwona Sadowska | członek | 2024-01-08 | **nie może zamienić żadnego ze swoich 12 dyżurów** |
| `jakub.polak` | Jakub Polak | członek | **2026-04-01** | **osoba, która dołączyła 27 miesięcy po reszcie** |
| `lucjan.widok` | Lucjan Widok | viewer | poza rotacją | konto tylko do odczytu |
| `zofia.nowa` | Zofia Nowa | członek | brak członkostwa | konto założone i aktywowane przez prawdziwy link aktywacyjny |
| `marta.nieaktywna` | Marta Nieaktywna | członek | poza rotacją | **konto wyłączone, logowanie zwraca 401** |

Wszystkie 14 aktywnych kont zweryfikowano logowaniem; konto wyłączone poprawnie odrzuca poprawne hasło.

---

## 3. Dane testowe

Dotychczasowe dane testowe zostały usunięte w całości.
Kopia stanu sprzed przebiegu (`backup-before-qa6.sql`) leży w katalogu roboczym sesji, poza repozytorium.

Zbudowano nowy zestaw:

- **10 członków rotacji**, zgodnie z punktem wyjściowym z zamówienia.
- **Historia 998 przydziałów** za okres 2025-09-01 do 2026-09-06, zaimportowana przez prawdziwy endpoint CSV (`/api/v1/history/preview` + `/commit`), a nie wstrzyknięta do bazy.
  Import przeszedł walidację bez jednego błędu, co jest zarazem testem funkcjonalnym ścieżki importu.
- Historia jest **celowo zbudowana niezależnie od solvera**.
  Użyto deterministycznego algorytmu zachłannego, który dla każdego bloku przydziału wybiera osobę najdalej poniżej swojego proporcjonalnego udziału, osobno w każdej soczewce.
  Gdyby historię wygenerował solver, mierzylibyśmy jakość solvera względem jego własnego wyniku.
- **Jakub Polak dołączył 2026-04-01**, czyli 27 miesięcy po reszcie zespołu i 5 miesięcy przed końcem okna dwunastomiesięcznego.
- **Emil Zając nie ma eligibility do zmiany 11-19**, co tworzy realistyczny wyjątek kotwiczenia.

Baseline sprawiedliwości po imporcie, w oknie 2025-09-07 do 2026-09-07:

| Soczewka | Rozpiętość odchyleń |
| --- | --- |
| primary | 3,33 |
| secondary | 3,33 |
| 11-19 | 2,36 |
| weekendy | 1,00 |
| święta | 2,00 |

Kryterium odbioru wynosi 3 punkty, więc baseline stoi dokładnie na granicy.
To dobry warunek testowy: nie jest ani sztucznie idealny, ani beznadziejny.

**Osoba dołączająca później startuje z neutralnym bilansem, zgodnie z obietnicą z PLAN.md par. 3.**
Jakub Polak ma 21 punktów primary przy oczekiwanych 22,1, czyli odchylenie -1,15, a nie deficyt rzędu trzydziestu punktów.
Proporcjonalne naliczanie udziału działa poprawnie i jest to jeden z ważniejszych potwierdzonych mechanizmów w tym przeglądzie.

---

## 4. Co działa poprawnie

Wymieniam to osobno, bo lista defektów poniżej jest długa i bez tego dałaby fałszywy obraz.

**Bezpieczeństwo i uprawnienia.**
Przetestowano macierz 18 operacji na 4 rolach oraz sesję anonimową.
Każda ścieżka bez sesji zwraca 401, każdy zapis bez nagłówka CSRF zwraca 403.
Koordynator nie dostaje się do kont, audytu ani linków udostępnień.
Członek nie dostaje się do polityki, szkiców, importu ani raportu miesięcznego.
Nie znaleziono ani jednego obejścia.

**Prywatność viewera.**
W odpowiedzi `/api/v1/calendar` dla viewera nie ma ani jednego słowa z notatek o niedostępności, ani samych stanów dostępności.
Sprawdzono wprost obecność ciągów „Urlop", „Wyjazd", „Wesele", „Szkolenie", „Remont", `unavailable`, `prefer`.
Legenda macierzy dla viewera również nie zawiera pozycji N, W i C.

**Linki udostępnień.**
Token jest jednorazowy: druga wymiana zwraca 410.
Sesja widzi wyłącznie zakres linku (2026-09-07 do 2026-09-30, nie dalej), nie ma dostępu do bilansu, audytu ani zamian.
Po odwołaniu linku sesja umiera natychmiast, zwracając 401.

**Kanały ICS.**
Kanał członka zawiera wyłącznie jego własne dyżury, 14 zdarzeń, żadnego cudzego nazwiska.
Po odwołaniu adres zwraca 404.

**Reguły twarde solvera na wygenerowanym grafiku.**
Zweryfikowano ręcznie cały opublikowany grafik na 28 dni:
pełne pokrycie wszystkich slotów, brak zmiany 11-19 w dni wolne, rozłączność primary i secondary, nienaruszone bloki weekendowe, maksymalnie 3 kolejne dyżury, maksymalnie 3 dyżury w każdym oknie 7 dni, minimum 2 dni przerwy po serii.
Żadna twarda niedostępność nie została złamana.

**Walidacja negatywna.**
Wszystkie 16 przypadków brzegowych zwróciło oczekiwany kod: override na osobę niedostępną, override 11-19 w sobotę, override na osobę bez eligibility, kolizja primary i secondary, generowanie 36 dni, budżet 4 i 301 sekund, waga 101, dostępność w przeszłości, dostępność nakładająca się, odwrócone daty.

**Dostępność (WCAG).**
Nawigacja strzałkami po macierzy działa, PageDown przeskakuje o tydzień.
Nazwy dostępne komórek są pełne i sensowne, na przykład „Dorota Pawlak, sob 2026-09-19, dzień wolny, stawka 2X, brak dyżuru, Wolę nie".
Obrys focusu ma 3 px i jest widoczny.
Motyw jasny jest czytelny.

**Aktywacja konta.**
Pełna ścieżka od utworzenia konta przez administratora, przez link aktywacyjny, ustawienie hasła, po zalogowanie, działa.
Token aktywacyjny jest jednorazowy: ponowne użycie zwraca 400.

**Wydajność odczytu.**
Opisana w paragrafie 7; nie stwierdzono problemu.

---

## 5. Defekty

### BLK6-01 (bloker): 74% dyżurów nie da się zamienić, a interfejs oferuje zastępców, których backend odrzuca

**Obserwacja.**
Dla każdego z 76 slotów opublikowanego grafiku sprawdzono, ilu z oferowanych przez `/api/v1/swaps/options` zastępców zostanie faktycznie przyjętych przez `POST /api/v1/swaps`.

| Rola | Slotów | Slotów z choć jednym możliwym zastępcą |
| --- | --- | --- |
| primary | 28 | 20 |
| secondary | 28 | **0** |
| 11-19 | 20 | **0** |
| **Razem** | **76** | **20 (26%)** |

Rozkład na osoby:

| Osoba | Dyżurów | Zamienialnych |
| --- | --- | --- |
| Iwona Sadowska | 12 | **0** |
| Jakub Polak | 12 | **0** |
| Grażyna Wilk | 11 | 1 |
| Filip Górski | 5 | 1 |
| Dorota Pawlak | 9 | 3 |
| Hubert Baran | 9 | 3 |
| Cezary Dudek | 5 | 3 |
| Beata Lis | 4 | 2 |
| Adam Nowicki | 8 | 6 |
| Emil Zając | 1 | 1 |

Interfejs oferuje dla tych 76 slotów łącznie 551 zastępców.
Próba przyjęcia każdego z nich dała 1048 naruszeń reguł twardych, bo jedna próba potrafi złamać kilka reguł naraz.
Rozkład naruszeń: `late_shift_anchor` 580, `day_off_block` 232, `three_in_seven` 158, `rest_after_run` 42, `max_consecutive` 36.
Pomiar powtórzono na dwóch kolejnych wersjach opublikowanego grafiku i dał identyczne liczby.

**Przyczyna źródłowa, zmierzona a nie zgadnięta.**
Po zmianie polityki na `late_shift_anchor = independent` i powtórzeniu tego samego pomiaru bez żadnej innej zmiany:

| Kotwica 11-19 | Zamienialne sloty | secondary | 11-19 |
| --- | --- | --- | --- |
| `secondary` (domyślna) | 20/76 (26%) | 0/28 | 0/20 |
| `independent` | 60/76 (79%) | 20/28 | 20/20 |

Domyślna kotwica odpowiada za 40 z 56 zablokowanych slotów.
Mechanizm jest prosty: zamiana obejmuje wyłącznie jeden slot, więc przeniesienie roli `secondary` na inną osobę zostawia zmianę 11-19 u poprzedniej, co łamie twardą regułę kotwiczenia.
Model produktowy („zamiana obejmuje jedną rolę i dzień") jest w bezpośredniej sprzeczności z modelem kotwiczenia („dla osoby eligible do obu ról zgodność jest twarda").

Pozostałe 16 zablokowanych slotów to 8 dni weekendowych razy 2 role, opisane w HGH6-04.

**Druga warstwa defektu: interfejs oferuje to, czego backend nie przyjmie.**
`GET /api/v1/swaps/options` filtruje wyłącznie po eligibility, twardej niedostępności i przeciwnej roli on-call.
Nie wywołuje `substitution_check`, które `POST /api/v1/swaps` stosuje jako twardą blokadę (decyzja D3).
Skutek dla Iwony Sadowskiej: wybiera dyżur, dostaje listę siedmiu kolegów, każdy opisany odchyleniem bilansu, wybiera najbardziej niedociążonego, widzi zieloną plakietkę „poprawia bilans" i pełną prognozę wpływu, wysyła prośbę i dostaje odmowę.
Wszystkich siedmiu zostanie odrzuconych.

**Trzecia warstwa: komunikat nie mówi nic.**
Interfejs pokazuje wyłącznie „Operacja łamie reguły twarde grafiku".
API zwraca komplet danych: nazwę reguły, opis, imię i nazwisko oraz listę dni.
`frontend/src/api.ts:479-483` wyciąga z odpowiedzi tylko pole `message` i porzuca tablicę `violations`.
Jest to sprzeczne z PLAN.md par. 6: „Komunikaty podają wynik, przyczynę i następne działanie".

**Skutek.**
Kryterium UX z PLAN.md par. 7, „jednodniowa zamiana wysłana w 60 sekund", jest nieosiągalne dla trzech czwartych dyżurów, a użytkownik nie ma jak się dowiedzieć dlaczego.
Zrzuty: `docs/qa-shots-6/09-zamiana-wplyw.png`, `docs/qa-shots-6/10-zamiana-blad.png`.

**Reprodukcja.**
Zaloguj się jako `iwona.sadowska`, wejdź w Zamiany, wybierz „czw 24-09-2026 · SECONDARY", wybierz dowolnego zastępcę, wyślij.

---

### BLK6-02 (bloker): prognoza sprawiedliwości szkicu liczy dwa razy dni objęte opublikowanym grafikiem

**Obserwacja.**
`routes/scheduling.py:887` liczy wariant „po" jako `historical_duties + draft_duties`.
`historical_duties` pochodzi z `resolved_duties`, które obejmuje całe okno dwunastu miesięcy kończące się ostatnim dniem szkicu, a więc również dni już pokryte opublikowanym grafikiem.
Przydziały szkicu są **dopisywane**, a nie **podstawiane** w miejsce istniejących.

**Dowód liczbowy.**
Wygenerowano szkic na 2026-09-21 do 2026-10-04, czyli w całości wewnątrz opublikowanego grafiku, co jest udokumentowaną ścieżką regeneracji.

| Wielkość | Wartość |
| --- | --- |
| Suma punktów PRIMARY w oknie, wariant „przed" | 481,0 |
| Suma punktów PRIMARY w oknie, wariant „po" | 499,0 |
| Punkty PRIMARY w samym szkicu | 18,0 |
| Różnica „po" minus „przed" | **18,0** |

Publikacja nie dodaje dyżurów, tylko podmienia obsadę tych samych slotów, więc suma po publikacji musi być równa sumie przed.
Różnica dokładnie równa punktom szkicu dowodzi podwójnego liczenia.

Prognoza dla tego szkicu pokazała rozpiętości primary 4,13 i secondary 6,87 oraz „kryterium niespełnione", podczas gdy realny skutek publikacji byłby zupełnie inny.

**Skutek.**
Jedyny ekran, na którym koordynator ocenia szkic przed przekazaniem do akceptacji, podaje przy każdej regeneracji liczby oderwane od rzeczywistości.
Prowadzi to albo do odrzucania dobrych szkiców, albo do utraty zaufania do prognozy w ogóle.
Solver nie ma tego problemu: `generator_history_window` kończy okno dzień przed początkiem horyzontu, więc widzi historię poprawnie.
Rozjeżdżają się więc solver i ekran, mimo że PLAN.md par. 3 obiecuje: „To samo okno liczy solver i raport".

**Reprodukcja.**
Skrypt `docs/qa-suite-6/repro_double_count.py`; wynik powtarzalny.

---

### BLK6-03 (bloker): osiem workerów CP-SAT na przydziale dwóch CPU obniża jakość rozwiązania

**Obserwacja.**
`docker-compose.yml` przydziela usłudze `worker` `cpus: 2.0` i jednocześnie ustawia `ONCALL_SOLVER_WORKERS=8`.
`scheduler.py:852` używa `solver_workers or min(8, os.cpu_count() or 1)`, ale wobec jawnie ustawionej zmiennej środowiskowej ogranicznik nigdy nie działa.
Niezależnie od tego `os.cpu_count()` w kontenerze zwraca **16**, a `sched_getaffinity` również 16, mimo że `cpu.max` wynosi `200000 100000`, czyli 2 rdzenie.
Python nie widzi limitu cgroup, więc nawet gdyby zmiennej nie było, ogranicznik ustawiłby 8, a nie 2.

**Dowód, trzy powtórzenia każdej konfiguracji, horyzont 28 dni, budżet 15 s, kotwica `secondary`:**

| Workerów | Próba | Czas | Status CP-SAT | Kryterium | primary |
| --- | --- | --- | --- | --- | --- |
| 8 | 1 | 19,3 s | FEASIBLE | **NIE** | 4,0 |
| 8 | 2 | 20,1 s | FEASIBLE | **NIE** | 4,0 |
| 8 | 3 | 21,1 s | FEASIBLE | **NIE** | 4,0 |
| 2 | 1 | 20,3 s | FEASIBLE | **TAK** | 3,0 |
| 2 | 2 | 19,1 s | FEASIBLE | **TAK** | 3,0 |
| 2 | 3 | 20,1 s | FEASIBLE | **TAK** | 3,0 |

Wynik jest w pełni powtarzalny w obie strony, przy tym samym czasie ściennym.

**Skutek.**
Ośmiokrotne przesubskrybowanie dwóch rdzeni sprawia, że każdy z ośmiu wątków wyszukiwania dostaje około jednej czwartej czasu procesora, więc w tym samym budżecie robi znacznie mniejszy postęp.
Dopasowanie liczby workerów do przydziału zamienia szkic niespełniający kryterium w szkic je spełniający, bez żadnego kosztu czasowego.
Dla docelowych 2 do 4 rdzeni to najtańsza dostępna poprawa jakości generowania.

---

### HGH6-01: domyślna kotwica `secondary` jest najgorszą konfiguracją na każdej mierzonej osi

Zestawienie tych samych przebiegów przy obu kotwicach, horyzont i budżet identyczne:

| Konfiguracja | 28 dni / 15 s | 28 dni / 30 s | 35 dni / 15 s | 35 dni / 30 s | 14 dni / 30 s, czas |
| --- | --- | --- | --- | --- | --- |
| `secondary` | kryterium NIE | kryterium NIE | kryterium NIE | kryterium NIE | **134,9 s** |
| `independent` | kryterium **TAK** | kryterium **TAK** | kryterium **TAK** | kryterium **TAK** | **36,2 s** |

Do tego dochodzi zamienialność dyżurów z BLK6-01: 26% wobec 79%.

Kotwica `independent` wygrywa jednocześnie na jakości rozwiązania, na przewidywalności czasu i na wykonalności zamian.
Przy `independent` czas ścienny to konsekwentnie budżet plus około 6 sekund, bez kaskady dodatkowych przebiegów.
Jedynym kosztem jest utrata gwarancji, że osoba na 11-19 jest tą samą osobą co secondary, co jest decyzją produktową, nie techniczną.

Nie rekomenduję automatycznej zmiany domyślnej wartości bez decyzji zamawiającego, ale rekomenduję postawienie tej decyzji świadomie, z powyższymi liczbami.

---

### HGH6-02: budżet solvera jest budżetem na przebieg, a interfejs nazywa go budżetem na generowanie

**Obserwacja.**
Podpowiedź pod polem na ekranie generatora brzmi: „Ile sekund solver ma na jedno generowanie (5-300)".
W kodzie `solve_seconds` jest budżetem pojedynczego wywołania `solver.solve`, a jedno generowanie wykonuje ich kilka: przebieg z kryterium jako ograniczeniem twardym, przebieg ze zdjętymi regułami rozrzedzania, przebieg bez ograniczenia kryterium oraz do trzech prób bisekcji szukających najniższej osiągalnej rozpiętości, każda po `FLOOR_PROBE_SECONDS = 25` sekund.

**Zmierzony czas ścienny przy kotwicy `secondary`:**

| Horyzont | Budżet 5 s | Budżet 15 s | Budżet 30 s | Budżet 60 s | Budżet 120 s |
| --- | --- | --- | --- | --- | --- |
| 7 dni | 8,1 s | 9,1 s | 10,1 s | 9,1 s | 11,1 s |
| **14 dni** | 32,2 s | **80,5 s** | **134,9 s** | **165,1 s** | **225,5 s** |
| 28 dni | 71,4 s | 20,3 s | 36,2 s | 65,5 s | 124,8 s |
| 35 dni | 10,1 s | 21,1 s | 36,2 s | 66,4 s | 125,8 s |

Ustawienie 15 sekund dało 80,5 sekundy oczekiwania.
Ustawienie 120 sekund dało 225,5 sekundy, czyli blisko czterech minut.
Horyzont 14 dni jest przy tej kotwicy najdroższy ze wszystkich, droższy niż 35 dni, co jest samo w sobie nieoczywiste i warte odnotowania.

**Uwaga do polecenia zamawiającego.**
W systemie **nie ma żadnego limitu 30 sekund**.
Czas generowania ograniczają trzy rzeczy: pole polityki `scheduling_policies.solve_seconds` o zakresie 5 do 300 sekund i wartości domyślnej 15, stała `FLOOR_PROBE_SECONDS = 25` na jedną próbę bisekcji, oraz `proxy_read_timeout 90s` w nginx, dotyczące wyłącznie synchronicznej ścieżki, z której interfejs już nie korzysta.
Podczas testów budżet podnoszono do 120 sekund; po testach przywrócono wartość domyślną 15.

---

### HGH6-03: zwiększanie budżetu nie poprawia wyniku, a bywa, że go pogarsza

Pełny przemiat, kotwica `secondary`, tryb hybrydowy, rozpiętości według raportu po uwzględnieniu szkicu:

| Horyzont | Budżet | Status CP-SAT | Kryterium | primary | secondary | weekendy |
| --- | --- | --- | --- | --- | --- | --- |
| 7 dni | 5 do 120 s | **OPTIMAL** | TAK | 2,0 | 3,0 | 2,0 |
| 14 dni | 5 s | FEASIBLE | NIE | 2,0 | 3,06 | 4,0 |
| 14 dni | 15 do 120 s | FEASIBLE | NIE | 2,0 | 3,0 | **4,0** |
| 28 dni | 5 do 120 s | FEASIBLE | NIE | **4,0** | 2,0 do 3,0 | 2,82 |
| 35 dni | 5 s | FEASIBLE | NIE | 4,0 | 2,0 | 0,74 |
| 35 dni | 15 s | FEASIBLE | NIE | 4,0 | 2,0 | 0,74 |
| 35 dni | **30 s** | FEASIBLE | **TAK** | **3,0** | 2,0 | 0,74 |
| 35 dni | 60 s | FEASIBLE | **NIE** | 4,0 | 3,0 | 0,74 |
| 35 dni | 120 s | FEASIBLE | NIE | 4,0 | 2,0 | 0,74 |

Trzy wnioski.

Po pierwsze, **status `OPTIMAL` osiągany jest wyłącznie na horyzoncie 7 dni**, i to już przy budżecie 5 sekund.
Dla 14, 28 i 35 dni solver nie dowodzi optymalności nawet w 120 sekundach.

Po drugie, **dla 14 i 28 dni wynik jest identyczny od 5 do 120 sekund**.
Dwudziestoczterokrotne zwiększenie budżetu nie zmienia ani jednej rozpiętości.
Czas nie jest wąskim gardłem.

Po trzecie, **przebieg 35 dni przy 30 sekundach spełnia kryterium, a przy 60 i 120 sekundach już nie**.
Więcej czasu dało gorszy wynik.
To sygnał, że wyszukiwanie nie zbiega, tylko błądzi, i że funkcja celu nie prowadzi solvera w stronę metryki, którą ocenia raport.

---

### HGH6-04: podział bloku weekendowego przez zamianę jest obiecany w dwóch miejscach i zablokowany w kodzie

**Obserwacja.**
Ekran „Ustawienia generowania" zawiera dosłownie:

> Weekendy i bloki świąteczne są regułą twardą: solver zawsze przydziela cały blok jednej osobie w danej roli. Podział bloku jest możliwy tylko ręcznie, przez korektę koordynatora **albo zamianę po publikacji**.

`docs/SOLVER.md` powtarza to samo:

> Podział pozostaje możliwy wyłącznie świadomie: korektą koordynatora albo zamianą po publikacji.

**Stan faktyczny, sprawdzony obiema ścieżkami:**

| Ścieżka | Zachowanie |
| --- | --- |
| Korekta koordynatora na samą sobotę | **200**, blok rozbity, naruszenie `day_off_block` zwrócone jako ostrzeżenie |
| Zamiana po publikacji, ta sama sobota | **409**, twarda blokada, żadnego z 8 zastępców nie da się przyjąć |

Z dwóch obiecanych ścieżek działa jedna.
Asymetria jest w kodzie zamierzona (decyzja D3: zamiana blokuje, korekta ostrzega), ale tekst widoczny dla użytkownika obiecuje obie.
To 232 z 1048 zliczonych naruszeń i 16 z 56 zablokowanych slotów.

---

### HGH6-05: generowanie wstrzymuje powiadomienia i inne generowania

**Obserwacja.**
`worker_cycle()` wykonuje sekwencyjnie `drain_outbox`, potem `process_schedule_run`, potem `scan_handover`.
`process_schedule_run` pobiera **jeden** bieg i blokuje pętlę na czas całego rozwiązywania.

**Pomiar: dwa generowania 28-dniowe zakolejkowane naraz przez dwóch koordynatorów, budżet 60 s, plus zamiana złożona przez członka zespołu w trakcie.**

| Czas | Generowanie A | Generowanie B | Outbox |
| --- | --- | --- | --- |
| 5 s | running (32%) | **queued (0%)** | pending = 1 |
| 35 s | running (61%) | **queued (0%)** | pending = 1 |
| 65,8 s | completed | **queued (0%)** | pending = 1 |
| 75,9 s | completed | running (36%) | przetworzone |
| 136,6 s | completed | completed | przetworzone |

Dwa skutki:

1. **Powiadomienie o zamianie czekało 70 sekund** w stanie `pending`, przez cały czas trwania generowania A.
   Przy budżecie 120 sekund i kaskadzie przebiegów z HGH6-02 byłyby to minuty.
2. **Drugi koordynator czekał 70 sekund** na sam start swojego zadania, widząc „queued" i postęp 0%.
   Interfejs nie podaje pozycji w kolejce ani szacowanego czasu.
   Naturalną reakcją na ekran, który nic nie pokazuje, jest ponowne uruchomienie generowania, co pogłębia problem.

Przy 10 równoczesnych użytkownikach i dwóch koordynatorach jest to realny scenariusz, nie teoretyczny.

---

### HGH6-06: solver egzekwuje kryterium w innej metryce, niż ocenia je raport

**Obserwacja.**
Dla tego samego szkicu (28 dni, tryb hybrydowy, kotwica `secondary`) policzono rozpiętość obiema metodami:

| Soczewka | Metryka raportu | Metryka solvera |
| --- | --- | --- |
| primary | 3,00 | 2,63 |
| secondary | 2,00 | 1,00 |
| weekendy | 2,82 | 2,73 |
| święta | 2,00 | 2,00 |

Solver, po spełnieniu ograniczenia `maximum - minimum <= 3 * SCALE`, uznaje kryterium za dotrzymane i nie zapisuje żadnego ostrzeżenia ani `acceptance_floor`.
Ekran prognozy dla tego samego szkicu potrafi jednocześnie pokazać rozpiętość 4,0 i „kryterium niespełnione".
Koordynator dostaje wtedy szkic bez jednego słowa ostrzeżenia i ekran, który go odrzuca.

Zlokalizowano dwie konkretne przyczyny rozjazdu.

**Przyczyna 1: `horizon_total` dla soczewek dwurolowych jest zaniżony o czynnik równy liczbie ról.**
`scheduler.py:523` liczy `horizon_total = sum(weight(day) for day in days if counts(day))`.
Dla soczewek `weekends` i `holidays`, które obejmują `ONCALL_ROLES`, daje to liczbę **dni**, podczas gdy faktycznie obsadzane są **dwa sloty na dzień**.
Pomiar na realnym szkicu: `horizon_total` solvera wyniósł 8, a faktycznie przydzielono 16 dyżurów weekendowych.
Komentarz w kodzie („Exactly one person holds each slot, so the deviations always sum to a constant") jest prawdziwy dla soczewek jednorolowych i fałszywy dla tych dwóch.
Skutek jest podwójny: oczekiwany udział każdej osoby w weekendach jest połową prawdy, a wyliczona z niego `mean` przesuwa wypukły człon kształtujący rozkład w złe miejsce.

**Przyczyna 2 (wynika z analizy kodu, nie z pomiaru): solver i raport inaczej definiują ekspozycję.**
`scheduler.py:509` w funkcji `exposed` wyklucza dni, w których osoba zgłosiła twardą niedostępność.
`fairness._eligible_exposure` takich dni nie wyklucza.
Ta sama osoba ma więc inny „uczciwy udział" w obu systemach.
W badanym horyzoncie Filip Górski ma szkolenie przez 7 z 28 dni, co samo w sobie przesuwa jego oczekiwany udział o rząd wielkości bliski jednej trzeciej budżetu kryterium.
W odróżnieniu od przyczyny 1, której skutek zmierzono wprost (8 wobec 16), ta przyczyna jest wywiedziona z lektury `scheduler.py:509` i `fairness._eligible_exposure`, a nie z osobnego pomiaru.
Należy ją potwierdzić pomiarem przed albo w trakcie naprawy.

**Sprawdzono i wykluczono trzecią hipotezę.**
Rozłożenie oczekiwanego udziału na dwa podokresy (historia osobno, horyzont osobno) zamiast jednej proporcji na całym oknie rozjeżdża się maksymalnie o **0,07 punktu**, także dla osoby dołączającej później.
To nie jest przyczyną i nie należy tego ruszać.

**Dobra wiadomość.**
Mechanizm `acceptance_floor` z decyzji D2 działa poprawnie tam, gdzie się uruchamia.
Dla horyzontu 14 dni solver rzetelnie zapisał: „Kryterium 3 punktów rozpiętości jest nieosiągalne przy zastanym długu historycznym. Najniższa osiągalna rozpiętość to 4 punktów".
Problem dotyczy wyłącznie przypadków, w których solver **błędnie uważa**, że kryterium spełnił.

---

### MED6-01: kolumna „Razem pkt" i wiersz „Razem" liczą co innego

Na ekranie Sprawiedliwość suma wartości w kolumnie „Razem pkt" dla dziesięciu osób wynosi **1212**, a wiersz podsumowania „Razem" pokazuje **960**.
Różnica 252 to dokładnie suma zmian 11-19, których kolumna jest ukryta przy kotwiczeniu (`late_shift_balanced = false`).
Kolumna per osoba wlicza ukrytą soczewkę, wiersz podsumowania jej nie wlicza.
Czytelnik nie ma jak tych dwóch liczb pogodzić, bo składnik różnicy nie jest na ekranie widoczny.
Zrzut: `docs/qa-shots-6/15-sprawiedliwosc-dol.png`.

---

### MED6-02: kolumna „Razem pkt" bez kontekstu udziału krzywdzi osoby bez pełnej eligibility i nowe

Każda kolumna soczewkowa ma pasek, odchylenie i opis słowny („0,87 poniżej udziału").
Kolumna „Razem pkt" nie ma żadnego z tych elementów, a jest pierwszą, na którą pada wzrok przy porównywaniu ludzi.

| Osoba | Razem pkt | Dlaczego |
| --- | --- | --- |
| Cezary Dudek, Filip Górski | 134 | pełna eligibility, pełny rok |
| **Emil Zając** | **105** | brak eligibility do 11-19, kolumna 11-19 ukryta |
| **Jakub Polak** | **54** | w rotacji od 2026-04-01 |

Emil wygląda na 29 punktów poniżej zespołu z powodu, którego na ekranie nie widać, bo kolumna 11-19 jest ukryta.
Jakub wygląda na osobę robiącą 40% tego co reszta, mimo że jego bilans w każdej pojedynczej soczewce jest niemal idealny.
Ekran, którego celem jest wyjaśnienie sprawiedliwości, w swojej najbardziej widocznej kolumnie sprawiedliwości nie wyjaśnia.
Jest to sprzeczne z zapisem z PLAN.md par. 6: „Ekran sprawiedliwości nie eksponuje liczb bez kontekstu".

---

### MED6-03: drawer dnia miesza szczegóły dnia z formularzem zmiany obsady

Kliknięcie komórki macierzy otwiera okno zatytułowane nazwiskiem klikniętej osoby i datą.
Okno zawiera trzy różne rzeczy: szczegóły obsady całego dnia, formularz przypisania roli **klikniętej osobie**, oraz formularz dodania wydarzenia do **całego dnia**.

Konsekwencje:

- Żeby zdjąć dyżur z osoby X, trzeba kliknąć pustą komórkę osoby Y, a nie komórkę osoby X.
  Naturalny odruch („klikam dyżur, żeby go zmienić") prowadzi do okna z wyłączonym przyciskiem.
- Przycisk „Zmień obsadę…" jest wtedy wyłączony bez podania powodu.
- Pole „Rola do zmiany" ma różną wartość domyślną w zależności od klikniętej komórki: dla osoby z dyżurem 11-19 domyślnie „11-19", dla osoby bez dyżuru „PRIMARY".
- Wydarzenie kalendarza jest bytem całodniowym, a dodaje się je z okna zatytułowanego imieniem i nazwiskiem konkretnej osoby.

Zrzuty: `docs/qa-shots-6/03-drawer-dnia.png`, `docs/qa-shots-6/04-override-potwierdzenie.png`.

---

### MED6-04: zmiana obsady po publikacji bez prognozy wpływu na bilans

Okno potwierdzenia korekty koordynatora pokazuje datę, rolę oraz „Przypiszesz: X zamiast Y".
Nie pokazuje ani wpływu na bilans, ani naruszeń reguł, mimo że:

- endpoint `/api/v1/calendar/override/check` istnieje właśnie po to i zwraca komplet naruszeń,
- ścieżka zamiany, która przenosi dokładnie ten sam punkt, ma pełną prognozę wpływu z opisem słownym,
- korekta koordynatora nie wymaga niczyjej akceptacji, więc jest to jedyny moment na refleksję.

Koordynator przenosi realne punkty rozliczeniowe bez żadnej informacji o skutkach.
Ta sama operacja wykonana przez członka zespołu jako zamiana pokazuje „49 → 48 (-1), dalej od równowagi".

---

### MED6-05: dwa nierozróżnialne szkice o tej samej nazwie i zakresie

Dwukrotne zakolejkowanie generowania tego samego zakresu tworzy dwa szkice o identycznej nazwie, identycznym zakresie, identycznej wersji, identycznej liczbie przydziałów i identycznej dacie utworzenia.
Na liście „Szkice w toku" nie ma niczego, co pozwoliłoby je rozróżnić, poza kolejnością.
Nic nie zapobiega zakolejkowaniu duplikatu, mimo że kod `list_runs` odnotowuje właśnie to ryzyko w komentarzu.
W połączeniu z HGH6-05 (drugie zadanie stoi w kolejce z postępem 0%) prawdopodobieństwo takiego duplikatu rośnie.
Zrzut: `docs/qa-shots-6/16-generator.png`.

---

### MED6-06: brak możliwości wpisania niedostępności w imieniu innej osoby

Zgłoszone przez zamawiającego, potwierdzone.

Cały moduł dostępności jest wyłącznie własnościowy:
`GET /api/v1/availability/me`, `POST /api/v1/availability/me`, `DELETE /api/v1/availability/me/{id}`.
Nie ma żadnego endpointu pozwalającego koordynatorowi lub administratorowi zapisać wpis dla innego członka zespołu.
Ekran „Moja dostępność" nie ma selektora osoby; koordynator widzi tam wyłącznie własne wpisy.

Skutki operacyjne:

- Osoba na urlopie, chora albo bez dostępu do systemu nie ma jak zgłosić niedostępności, a koordynator nie ma jak zrobić tego za nią.
- Urlop zgłoszony mailem albo ustnie nie trafia do solvera, więc generator ułoży grafik wbrew znanej nieobecności.
- Jedynym obejściem jest wygenerowanie grafiku, zauważenie kolizji i ręczna korekta każdego slotu po publikacji, czyli dokładnie ta praca, którą generator ma eliminować.
- Konto administratora nie jest powiązane z członkiem zespołu, więc `/api/v1/availability/me` zwraca dla niego 409; administrator nie może zgłosić niedostępności nawet teoretycznie.

Projekt rozwiązania w planie naprawczym, pozycja N7.

---

## 6. Uwagi niskiej wagi

| Id | Obserwacja |
| --- | --- |
| LOW6-01 | `GET /api/v1/calendar/feeds` zwraca dla viewera 200 i pustą listę, a `POST` zwraca 409. Sekcja ICS może się pokazać jako pusta zamiast jako niedostępna. |
| LOW6-02 | Konto poza rotacją dostaje trzy różne kody dla tej samej przyczyny: `availability/me` 409, `swaps` 409, `fairness` 403. |
| LOW6-03 | Na ekranie „Moja dostępność" nagłówek mówi „Powód zobaczą tylko koordynatorzy i administratorzy", a pole nazywa się „Prywatna notatka". Dwa sprzeczne sygnały o prywatności. |
| LOW6-04 | W motywie jasnym w prawym górnym rogu macierzy widać biały prostokąt wychodzący poza obramowanie tabeli, prawdopodobnie brak tła na rynience przewijania nagłówka. Zrzut `docs/qa-shots-6/20-motyw-jasny.png`. |
| LOW6-05 | Nagłówek „Szkice w toku" opisuje listę gotowych szkiców, a nie trwających generowań. Myli się z sekcją postępu. |
| LOW6-06 | W raporcie miesięcznym nazwy osób są wyrównane do prawej, a nagłówek kolumny „Osoba" do lewej. |
| LOW6-07 | `DraftScheduleResponse` nie zawiera `acceptance_floor`, mimo że pole istnieje na `schedules` i jest zwracane przez `fairness-impact`. Klient czytający sam szkic nie ma dostępu do dna kryterium. |
| LOW6-08 | `GET /api/v1/schedules/published` przyjmuje `starts_on` i `ends_on`, ale ich nie stosuje; zwracany jest cały grafik. |
| LOW6-09 | `suggested-range` zaproponował start 2026-09-08, a zakres 34-dniowy do 2026-10-11. Dokumentacja mówi o 28 do 34 dniach, więc jest to górna granica; warto sprawdzić, czy to zamierzone. |

---

## 7. Wydajność

### 7.1 Odczyt przy 10 równoczesnych użytkownikach

Dziesięć równoległych sesji, po 12 powtórzeń każdej ze ścieżek, łącznie 600 zapytań.
Pomiar wykonano dwukrotnie: bez ograniczeń oraz pod ograniczeniem odwzorowującym cel sprzętowy (`api` 2 CPU / 3 GB, `db` 1 CPU / 2 GB, `worker` 2 CPU / 2 GB, `web` 0,5 CPU).

| Ścieżka | p50 bez limitu | p95 bez limitu | p50 z limitem | p95 z limitem |
| --- | --- | --- | --- | --- |
| `/api/v1/schedules/published` | 33 ms | 191 ms | 30 ms | 190 ms |
| `/api/v1/calendar` (30 dni) | 41 ms | 77 ms | 46 ms | 115 ms |
| `/api/v1/fairness` | 135 ms | 240 ms | 123 ms | 218 ms |
| `/api/v1/team` | 15 ms | 88 ms | 18 ms | 107 ms |
| `/api/v1/auth/me` | 9 ms | 41 ms | 9 ms | 33 ms |

Przepustowość 181 zapytań na sekundę bez limitu i 178 z limitem.

**Wniosek: ścieżki odczytu nie są wąskim gardłem i nie wymagają pracy.**
Ograniczenie do dwóch rdzeni praktycznie nie zmieniło wyników, co oznacza, że przy 10 użytkownikach system nie jest związany procesorem na odczycie.
`/api/v1/fairness` jest najdroższą ścieżką (`_eligible_exposure` to pętla 365 dni razy 5 soczewek razy 10 osób na żądanie), ale p95 rzędu 220 ms jest w pełni akceptowalne.
Optymalizacja tej pętli byłaby przedwczesna.

### 7.2 Generowanie

Wąskim gardłem jest wyłącznie generowanie, i to z trzech niezależnych powodów, opisanych jako BLK6-03, HGH6-02 i HGH6-05:

- osiem workerów CP-SAT na dwóch rdzeniach obniża jakość przy tym samym czasie,
- czas ścienny jest wielokrotnością budżetu, bo generowanie to kilka przebiegów,
- generowania są ściśle szeregowane i blokują dostarczanie powiadomień.

### 7.3 Ile faktycznie trwa generowanie na docelowym sprzęcie

Przy rekomendowanej konfiguracji (kotwica `independent`, `ONCALL_SOLVER_WORKERS=2`, budżet 15 s) czas ścienny generowania na 28 dni wynosi około **21 sekund**, a kryterium jest spełnione.
Przy konfiguracji domyślnej ten sam zakres zajmuje około 20 sekund i kryterium nie spełnia, a przy 14 dniach potrafi zająć 135 sekund.

---

## 8. Odpowiedź na pytanie „kiedy solver będzie dawał rozwiązania optymalne szybko"

Krótko: **nie przez zwiększanie budżetu czasu**.

Dane z paragrafu HGH6-03 pokazują, że od 5 do 120 sekund wynik jest identyczny w trzech z czterech horyzontów, a w czwartym więcej czasu dało gorszy wynik.
Status `OPTIMAL` pojawia się tylko na horyzoncie 7 dni i to natychmiast.

Kolejność działań, uporządkowana według zmierzonego zysku na jednostkę ryzyka:

1. **Dopasować liczbę workerów CP-SAT do przydziału CPU** (BLK6-03).
   Zysk zmierzony: kryterium przechodzi z „niespełnione" na „spełnione" na horyzoncie 28 dni, 3 przebiegi na 3, przy tym samym czasie.
   Ryzyko: zerowe.
2. **Naprawić `horizon_total` dla soczewek dwurolowych** (HGH6-06, przyczyna 1).
   Solver optymalizuje dziś weekendy i święta względem połowy prawdziwej liczby dyżurów.
   To jest pojedyncza linia i zarazem najprawdopodobniejsze źródło rozpiętości weekendowej 4,0, której żaden budżet nie ruszył.
3. **Ujednolicić definicję ekspozycji** między solverem a raportem (HGH6-06, przyczyna 2).
   Dopóki obie strony liczą inny „uczciwy udział", solver nie może trafiać w kryterium, które raport ocenia, inaczej niż przypadkiem.
4. **Postawić świadomą decyzję o kotwicy 11-19** (HGH6-01).
   `independent` wygrywa na jakości, na czasie i na wykonalności zamian; kosztem jest rozdzielenie 11-19 od secondary.
5. **Dopiero potem** wracać do strojenia budżetu, podpowiedzi startowej i łamania symetrii.
   Wcześniej nie ma czego stroić, bo solver celuje w niewłaściwą tarczę.

Prognoza: po punktach 1 do 3 spodziewam się kryterium spełnionego na horyzontach 14, 28 i 35 dni przy budżecie 15 sekund i czasie ściennym poniżej 25 sekund, przy kotwicy `secondary`.
Jest to prognoza do zweryfikowania pomiarem, a nie obietnica.

---

## 9. Metodyka i artefakty

Wykonano:

- 998 wierszy historii zaimportowanych przez prawdziwy endpoint CSV,
- 18 operacji na 4 rolach plus sesja anonimowa w macierzy RBAC,
- 16 przypadków walidacji negatywnej,
- 551 prób złożenia zamiany, po jednej na każdego zastępcę oferowanego przez interfejs, w celu zmierzenia realnej wykonalności, powtórzonych na dwóch wersjach grafiku,
- 35 przebiegów solvera w przemiatach po budżecie, horyzoncie i kotwicy,
- 6 powtórzeń kontrolowanego porównania liczby workerów,
- 1200 zapytań w dwóch przebiegach obciążenia odczytu,
- pełny przegląd wizualny wszystkich ekranów w obu motywach i we wszystkich czterech rolach.

Zrzuty ekranu: `docs/qa-shots-6/`.
Skrypty reprodukcyjne i surowe dane pomiarowe: `docs/qa-suite-6/`.
Skrypty korzystają ze wspólnego klienta `api.py`; uruchamia się je z katalogu projektu, na przykład `python docs/qa-suite-6/test_swap_reachability.py`.

Środowisko przywrócono do stanu domyślnego: polityka `hybrid` / kotwica `secondary` / budżet 15 s, `ONCALL_SOLVER_WORKERS` bez zmian względem repozytorium, ograniczenia zasobów w osobnym pliku `docker-compose.qa6-limits.yml`, nienakładanym domyślnie.
Dane testowe pozostawiono w bazie do samodzielnej weryfikacji zgłoszonych defektów.

Plan naprawczy: [docs/PLAN-NAPRAWCZY-6.md](PLAN-NAPRAWCZY-6.md).
