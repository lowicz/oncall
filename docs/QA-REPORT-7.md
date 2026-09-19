# QA-REPORT-7 - pełny przegląd jakości Erste On-call

Data: 2026-09-12 (sobota).
Autor: przegląd testerski wykonany od zera, na świeżych danych, bez opierania się na wynikach QA-REPORT 1-6.
Zakres: poprawność funkcji, testy eksploracyjne, użyteczność i wygląd, bezpieczeństwo podstawowe, wydajność (10+ użytkowników, host 2-4 rdzenie / 8 GB), optymalność i szybkość solvera.

## Streszczenie

Aplikacja jest dojrzała w warstwie uprawnień, prywatności, audytu, linków udostępniania, ICS i odporności na współbieżność.
Wydajność dla 10 równoczesnych użytkowników jest z dużym zapasem wystarczająca na 2 i na 4 rdzeniach.
Solver daje bardzo dobre wyniki sprawiedliwości w kilka sekund, ale nigdy nie dowodzi optymalności przez sposób zamodelowania ciągłości, a w części przypadków marnuje 3/4 czasu generowania.
Znaleziono 3 blokery i 9 defektów wysokiej wagi, w tym takie, które cicho psują dane (utrata zatwierdzonych zamian, łamanie twardej reguły 3 nocy na styku miesięcy, fałszywy obraz sprawiedliwości dla każdego członka zespołu).
Werdykt (szczegóły w par. 10): **można pokazać zespołowi jako wersję próbną, nie należy jeszcze zaczynać na niej realnego planowania dyżurów** - najpierw faza 0 planu naprawczego.

## 1. Środowisko i metoda

- Stos: `docker compose -f docker-compose.yml -f docs/qa-suite-7/docker-compose.host4.yml up -d`.
- Host docelowy odwzorowany jako wspólna pula CPU dla całego stosu (`cpuset`), a nie osobne kwoty per kontener: wariant 4 rdzenie (`docker-compose.host4.yml`) i 2 rdzenie (`docker-compose.host2.yml`), limity RAM łącznie 7,25 GB. Istniejący `docker-compose.qa6-limits.yml` sumuje 5,5 rdzenia, więc nie odpowiada hostowi 2-4 rdzenie.
- Worker ma w bazowym compose `cpus: 2.0`, więc solver pracuje na 2 wątkach w obu wariantach.
- UI testowane w przeglądarce przez `chrome-devtools-axi` (1440×900, 390×844, motyw ciemny i jasny), logowanie na 7 różnych kont w 4 rolach.
- API testowane skryptami w `docs/qa-suite-7/` (klient z sesją i CSRF jak SPA).
- Reguły twarde grafików sprawdzane niezależnym walidatorem `check_rules.py`, czytającym bezpośrednio z bazy, z uwzględnieniem dyżurów sprzed horyzontu. Sprawdzenia „max 3 z rzędu” i „max 3 w 7 dniach” są dokładne; „2 dni przerwy po serii” jest przybliżeniem reguły z modelu i nie powinno być jedyną podstawą zgłoszenia. Walidator nie zna zwolnienia długich bloków świątecznych z limitu (flaguje 24-27.12 zgodnie z projektem).
- Solver badany w kontenerze workera na produkcyjnych danych wejściowych, ze śladem (czas, wartość celu, dolna granica) każdego rozwiązania: `bench_trace.py`, `bench_variants.py`.
- Zrzuty ekranu: `docs/qa-shots-7/`.
- Wyniki pomiarów: `docs/qa-suite-7/results/`.
- Limit budżetu solvera podnoszony w testach do 300 s.

## 2. Poświadczenia testowe

Wszystkie konta poza `admin` mają hasło `QA7-Haslo-Testowe!`.
Konto `admin` ma hasło `Qwertyuiop1!` (z `.env`).
Adres: http://localhost:8080

| Login | Rola konta | W rotacji | Charakterystyka |
|---|---|---|---|
| admin | admin | nie | konto bootstrap z `.env` |
| szef.dzialu | admin | nie | drugi administrator |
| tomasz.krawczyk | coordinator | tak | koordynator, który sam pełni dyżury |
| ewa.maj | coordinator | nie | koordynatorka spoza rotacji |
| anna.wrobel | member | tak | |
| bartosz.kowal | member | tak | przejął kilka dyżurów zamianami, ma nadwyżkę primary |
| celina.mazur | member | tak | |
| dawid.lewandowski | member | tak | |
| elzbieta.kaczmarek | member | tak | |
| grzegorz.zielinski | member | tak | bez uprawnień do zmiany 11-19 |
| halina.szymanska | member | tak | |
| igor.wojcik | member | tak | junior: tylko secondary i 11-19, nigdy primary |
| julia.nowak | member | tak | dołączyła 2026-03-02, 14 miesięcy po reszcie |
| robert.baran | member, konto wyłączone | do 2026-03-01 | odszedł z zespołu, jest w historii |
| patryk.podglad | viewer | nie | tylko podgląd |
| Anna.Wrobel | viewer | nie | duplikat utworzony w teście QA7-M05, hasło `aaaaaaaaaaaa` |

## 3. Dane testowe

Poprzednie dane testowe (15 kont, 3 grafiki, 1436 zamian, 3522 zdarzenia audytu) zostały wykasowane.

- `docs/qa-suite-7/seed_team.py` - czyści wszystkie tabele biznesowe (poza `alembic_version` i kontem `admin`) i tworzy powyższy zespół z okresami członkostwa i eligibility.
- `docs/qa-suite-7/make_history.py` - historia 2025-09-01..2026-08-30 (979 wierszy), budowana niezależnie od solvera: przydział per jednostka (dzień roboczy albo niepodzielny blok wolnych), osobie najdalej poniżej jej proporcjonalnego udziału, z regułami odpoczynku trybu hybrydowego. Wagi heurystyki dobrane przeszukaniem siatki.
- Historia zaimportowana przez UI jako `tomasz.krawczyk`.
- Rozpiętości historii w jej własnym oknie: primary 4,00, secondary 3,30, 11-19 3,00, weekendy 2,95, święta 3,00 (4 pkt to granulacja jednego weekendu).
- W raporcie aplikacji (okno 2025-09-12..2026-09-12): primary 7,00, secondary 5,54, 11-19 3,00, weekendy 2,22, święta 3,00. Różnica to przesunięcie okna o 11 dni i jest świadomie pozostawiona jako realistyczna odziedziczona nierówność.
- `docs/qa-suite-7/seed_availability.py` - 8 zgłoszeń dostępności na październik złożonych przez samych członków + przypadki negatywne.
- Opublikowane: grafik 31.08-27.09 (wygenerowany i opublikowany przez UI, z zamianami i korektami) oraz 26.10-29.11 (publikowany dwukrotnie w teście QA7-B02).
- Szkice: 28.09-25.10, 26.10-29.11 (trzeci wariant; pierwszy wycofany, drugi opublikowany), 30.11-27.12.

## 4. Plan testów i wyniki

Legenda: OK - zgodnie z oczekiwaniem; DEF - defekt (identyfikator w par. 5).

### 4.1 Logowanie i konta

| # | Przypadek | Wynik |
|---|---|---|
| 1 | Błędne hasło: neutralny komunikat | OK |
| 2 | Konto wyłączone nie loguje się | OK (komunikat jak dla złego hasła, QA7-L03) |
| 3 | 30 błędnych prób, potem poprawna | DEF QA7-H08 |
| 4 | Enumeracja kont po czasie odpowiedzi | DEF QA7-M11 |
| 5 | Login wielkimi literami / ze spacjami | DEF QA7-L02 |
| 6 | Utworzenie konta z loginem różniącym się wielkością liter | DEF QA7-M05 |
| 7 | Aktywacja: polityka hasła | DEF QA7-M06 |
| 8 | Link aktywacyjny jednorazowy | OK (ponownie 400) |
| 9 | Żądania zmieniające bez CSRF | OK (403) |

### 4.2 Import historii

| # | Przypadek | Wynik |
|---|---|---|
| 10 | Podgląd 979 wierszy przed zapisem | OK |
| 11 | Walidacja członkostwa, eligibility, 11-19 w dzień wolny, kolizji z opublikowanym | OK (kod) |
| 12 | Szablon CSV z ekranu importu przechodzi walidację | DEF QA7-L04 |
| 13 | Zatwierdzenie i lista wcześniejszych importów z „Cofnij import” | OK |

### 4.3 Generator i publikacja

| # | Przypadek | Wynik |
|---|---|---|
| 14 | Sugerowany zakres na pustej instalacji | DEF QA7-M01 |
| 15 | Wpisanie daty z klawiatury | DEF QA7-M02 |
| 16 | Generowanie 28 dni, postęp, szkic, macierz, wpływ na sprawiedliwość | OK (QA7-L07, QA7-L08) |
| 17 | Kompletność slotów, rozłączność P/S, eligibility, niedostępność, bloki weekendowe, 11-19 | OK |
| 18 | Reguły odpoczynku na styku z poprzednim okresem | DEF QA7-B03 |
| 19 | Szkic → do akceptacji → publikacja, ostrzeżenie o przeszłości | OK (brak cofnięcia z „Do akceptacji”, QA7-L09) |
| 20 | Kryterium odbioru a osoba, która odeszła | DEF QA7-H02 |
| 21 | Publikacja drugiego szkicu tego samego zakresu | DEF QA7-B02, QA7-H04 |
| 22 | Publikacja z nieopublikowaną luką przed zakresem | DEF QA7-H05 |
| 23 | Równoległe żądania generowania tego samego zakresu | OK (jeden przebieg) |
| 24 | Długi blok świąteczny 24-27.12 | OK (jedna para, zgodnie z projektem) |
| 25 | Czas generowania przy nieosiągalnym kryterium | DEF QA7-H07 |

### 4.4 Dostępność, zamiany, korekty

| # | Przypadek | Wynik |
|---|---|---|
| 26 | Zgłoszenie „nie mogę” przez członka, ostrzeżenie o kolizji z dyżurem | OK (QA7-L10) |
| 27 | Walidacja: zakres odwrócony, nakładanie, >366 dni, przeszłość, notatka >500, viewer/admin | OK |
| 28 | XSS w notatce | OK (tekst) |
| 29 | Wniosek o zamianę, lista zastępców z powodami blokady | OK (QA7-L11) |
| 30 | Duplikat, zastępca bez eligibility, zamiana ze sobą, cudzy slot | OK |
| 31 | Zamiana dyżuru z przeszłości | DEF QA7-H01 |
| 32 | Pełny cykl: wniosek → akceptacja → zatwierdzenie → ICS | OK |
| 33 | Koordynator zatwierdza własną zamianę | DEF QA7-M03 |
| 34 | Zamiana rozbijająca blok weekendowy | DEF QA7-M04 |
| 35 | Korekta: osoba bez eligibility | DEF QA7-M08 |
| 36 | Korekta dnia z przeszłości | DEF QA7-M09 |
| 37 | Korekta secondary przy kotwicy 11-19 | DEF QA7-M10 |
| 38 | Równoległe korekty tego samego slotu | OK (200 + 409) |
| 39 | Powiadomienia i audyt dla całego cyklu | OK |

### 4.5 Sprawiedliwość i raporty

| # | Przypadek | Wynik |
|---|---|---|
| 40 | Widok koordynatora: udział proporcjonalny do okresu w rotacji (Julia) | OK |
| 41 | Widok członka: własny bilans | DEF QA7-B01 |
| 42 | Stabilność „spełnia / nie spełnia” w czasie | DEF QA7-M12 |
| 43 | Dyżury przyszłe nie są liczone | OK |
| 44 | Raport miesięczny i CSV, sumy dni | OK (QA7-M13, QA7-L13) |

### 4.6 Administracja, prywatność, udostępnienia

| # | Przypadek | Wynik |
|---|---|---|
| 45 | Viewer: 403 na zespół, sprawiedliwość, zamiany, szkice, audyt, raporty | OK |
| 46 | Członek widzi tylko swoją dostępność | OK |
| 47 | Link udostępnienia: jednorazowy, klipowany, bez e-maili, odwołanie | OK (QA7-L05) |
| 48 | Odejście osoby z przyszłymi dyżurami | OK dla członkostwa, DEF QA7-M07 dla eligibility |
| 49 | Audyt, wydarzenia, osoby - przegląd wizualny | DEF (par. 5.4) |

### 4.7 Responsywność, motywy, jakość kodu

| # | Przypadek | Wynik |
|---|---|---|
| 50 | Szerokość 390 px | DEF QA7-M14 |
| 51 | Motyw jasny | OK |
| 52 | Lighthouse (dostępność, dobre praktyki) | OK (100/100) |
| 53 | `eslint`, `vitest`, `npm run build`, `ruff`, `pytest` | OK (132/132, 303/303; QA7-L17) |

## 5. Defekty

Każdy defekt ma login do samodzielnej weryfikacji.
Stan bazy po testach: widoczne od razu są QA7-B01, B02 (03.11), B03 (szkic 30.11-27.12 i opublikowany 31.08-27.09), H01 (zamiana 01.09 w „Zakończone”), H02 (szkic 28.09-25.10), H04 (wniosek 05.11), H05 (luka 28.09-25.10), M03 (zamiana 26.09), M04 (19.09), M05 (konto `Anna.Wrobel`).
Wycofane po teście i wymagające powtórzenia kroków: M07 (eligibility Haliny przywrócone), M09 i M10 (korekty 03.09, 23.09 i 24.09 przywrócone do stanu wyjściowego, ale z flagą korekty).
Budżet solvera w polityce przywrócony do 15 s.

### 5.1 Blokery

**QA7-B01 - Członek zespołu zawsze widzi „zgodnie z udziałem”.**
Login: `bartosz.kowal` (porównaj z `ewa.maj`), ekran Sprawiedliwość.
Oczekiwane: bilans członka taki sam jak w widoku koordynatora.
Faktyczne: Bartosz jako członek widzi primary 56 / 56 (0), koordynatorka widzi 56 / 53,33 (+2,67); Julia weekendy 14 / 14 (0) zamiast 14 / 11,58 (+2,42).
Przyczyna: `backend/src/oncall/routes/fairness.py:62` zawęża listę osób przed `compute_fairness`, więc udział oczekiwany liczony jest z dyżurów jednej osoby.
Skutek: każdy członek zespołu dostaje fałszywą informację, że jest w równowadze - dokładnie odwrotność celu tego ekranu.

**QA7-B02 - Ponowna publikacja zakresu cicho kasuje zatwierdzone zamiany i korekty.**
Login: `tomasz.krawczyk`, kalendarz 03.11.2026.
Kroki: opublikowano 26.10-29.11, zamiana 03.11 primary Julia → Anna zatwierdzona, potem opublikowano drugi szkic tego zakresu.
Faktyczne: 03.11 primary znowu Julia; brak ostrzeżenia w dialogu publikacji, brak powiadomień do osób, których dyżur zmienił się po raz drugi.
Skutek: ktoś ma w telefonie (ICS, e-mail) inny dyżur niż w systemie; jedyny sposób na „poprawienie” miesiąca (regeneracja) niszczy uzgodnienia zespołu.

**QA7-B03 - Twarde reguły odpoczynku nie obejmują styku z poprzednim okresem.**
Login: `tomasz.krawczyk`, Generator, szkic 30.11-27.12; lub `python docs/qa-suite-7/check_rules.py <id szkicu>`.
Faktyczne: Julia Nowak secondary 28-29.11 (opublikowany listopad) + primary 30.11-02.12 (szkic) = 5 nocy z rzędu, 5 dyżurów w 7 dniach. Wcześniej: Elżbieta Kaczmarek i Halina Szymańska po 4 dyżury w 7 dniach na styku 31.08.
Przyczyna: w `scheduler._build_model` okna „max 3 z rzędu”, „max 3 w 7 dniach” i „2 dni przerwy po serii” iterują tylko po dniach horyzontu; ekran szkicu i tak twierdzi „Grafik spełnia wszystkie reguły twarde”.
Skutek: przy comiesięcznym planowaniu reguła bezpieczeństwa operacyjnego jest łamana systematycznie, bez ostrzeżenia.

### 5.2 Wysokie

**QA7-H01 - Zamiany dyżurów z przeszłości są dozwolone.**
Login: `bartosz.kowal` → Zamiany → Zakończone (01.09.2026, „11 dni temu”).
Anna złożyła wniosek o primary 01.09, Bartosz zaakceptował, Ewa zatwierdziła; historia i sprawiedliwość zmieniły się wstecz.
Walidacja odrzuca taki wniosek tylko przypadkiem, gdy łamie regułę.

**QA7-H02 - Osoba, która odeszła, psuje kryterium odbioru.**
Login: `tomasz.krawczyk`, szkic 28.09-25.10, tabela wpływu.
Weekendy 3,43 „nie spełnia” wyłącznie przez Roberta Barana (+1,94); bez niego 3,00.
Solver pomija osoby bez zmiennych w horyzoncie (`scheduler.balance`, `if not weighted: continue`), raport i podgląd je liczą, `acceptance_floor` jest `null`, więc UI nie wyjaśnia rozbieżności.
Stan „nie spełnia” utrzyma się przy każdym szkicu do marca 2027.

**QA7-H03 - Solver nigdy nie dowodzi optymalności trybu hybrydowego** - szczegóły w par. 7.

**QA7-H04 - Wnioski o zamianę na wycofanym grafiku zostają osierocone.**
Login: `bartosz.kowal`, wniosek 05.11 Celina → Bartosz.
Po ponownej publikacji zastępca może go zaakceptować (200), zatwierdzenie zwraca 409, a wniosek na zawsze zostaje „w toku”.

**QA7-H05 - Publikacja z nieobsadzoną luką i planowanie na nieaktualnej historii.**
Login: `tomasz.krawczyk`.
26.10-29.11 opublikowany, gdy 28.09-25.10 nie ma publikacji - bez ostrzeżenia.
Generator dla 26.10 nie widzi szkicu 28.09-25.10, więc drugi miesiąc jest bilansowany tak, jakby pierwszego nie było.
Publikacja nie wykrywa też nieaktualności szkicu (zamiany, korekty, dostępność po wygenerowaniu) i nie sprawdza reguł odpoczynku.

**QA7-H06 - Argon2 w pętli zdarzeń + brak limitu prób = łatwy DoS.**
8 równoległych pętli błędnych haseł (26 prób/s) podnosi opóźnienie zwykłego odczytu z p50 9 ms do 194 ms (p95 506 ms) dla wszystkich; każda próba dopisuje wiersz audytu.

**QA7-H07 - Wyznaczanie dna kryterium marnuje 3/4 czasu generowania.**
Każda próba `cap_feasible` optymalizuje pełny cel przez 25 s, choć potrzebuje tylko odpowiedzi „wykonalne czy nie”.
35 dni: 117 s przy budżecie 30 s; z `stop_after_first_solution=True` w próbach 31,5 s i to samo dno (4 pkt). Grudzień: 118 s.

**QA7-H08 - Brak ograniczenia prób logowania.**
30 błędnych haseł dla `ewa.maj`, 31. poprawna próba loguje; brak blokady, opóźnienia, alertu.

**QA7-H09 - Wyniki „na dziś” i kryterium są w praktyce nieinterpretowalne dla koordynatora** (połączenie QA7-H02 i QA7-M12): ekran przez większość miesiąca pokazuje „nie spełnia”, choć szkic obiecywał „spełnia”, a ani ekran, ani podgląd nie mówią dlaczego.

### 5.3 Średnie

| ID | Defekt | Login / miejsce | Szczegóły |
|---|---|---|---|
| QA7-M01 | Sugerowany zakres startuje zawsze od jutra i może zaczynać w środku weekendu | tomasz.krawczyk / Generator | W sobotę 12.09 zaproponował 13.09 (niedziela); dzisiejsza sobota zostaje bez dyżuru, blok weekendowy rozdzielony między dwa grafiki |
| QA7-M02 | Pole daty cicho zmienia wpisaną datę | dowolne pole daty | Wpisanie `31082026` w polu z wrześniem daje 03-08-2026 (wrzesień ma 30 dni, cyfry przesuwają się do miesiąca) |
| QA7-M03 | Koordynator zatwierdza własną zamianę | tomasz.krawczyk | Zamiana 26.09 secondary Tomasz → Anna zatwierdzona przez Tomasza; brak zasady czterech oczu |
| QA7-M04 | Dialog zatwierdzenia zamiany bez wpływu na bilans i bez ostrzeżeń | ewa.maj / Zamiany | Zamiana soboty 19.09 rozbiła blok weekendowy (sobota Bartosz, niedziela Tomasz) bez sygnału |
| QA7-M05 | Loginy i e-maile nie są unikalne bez względu na wielkość liter | admin / Osoby | Konto `Anna.Wrobel` obok `anna.wrobel`, ten sam e-mail, konto aktywne |
| QA7-M06 | Polityka haseł to tylko długość ≥ 12 | aktywacja konta | `aaaaaaaaaaaa` przyjęte |
| QA7-M07 | Skrócenie eligibility nie sprawdza przyszłych dyżurów; brak narzędzia offboardingu | admin / Osoby | 3 okresy Haliny skrócone do 20.09 mimo 16 dyżurów po tej dacie; zakończenie członkostwa ma poprawną blokadę, ale jedyna droga to 16 ręcznych korekt albo regeneracja (QA7-B02) |
| QA7-M08 | Korekta oferuje osoby bez eligibility, błąd dopiero po potwierdzeniu | ewa.maj / kalendarz 23.09 | Igor jako primary: dialog pokazuje bilans „0 → 1”, serwer zwraca „Osoba nie ma eligibility” (angielski termin) |
| QA7-M09 | Korekta dnia z przeszłości bez ostrzeżenia i powodu | ewa.maj | Primary 03.09 zmienione i przywrócone, wpis w audycie bez uzasadnienia |
| QA7-M10 | Korekta secondary nie przenosi zakotwiczonej 11-19; ta sama osoba może mieć primary + 11-19 | ewa.maj | 23.09: Julia 11:00-19:00 i 19:00-09:00 (22 h) zgłoszone tylko jako naruszenie kotwicy |
| QA7-M11 | Enumeracja kont po czasie | API logowania | istniejący login ~40 ms, nieistniejący ~4 ms |
| QA7-M12 | Rozpiętość „na dziś” to szum | ewa.maj / Sprawiedliwość, „Stan na dzień” | Ten sam grafik: primary 5,0 (12.09), 10,0 (20.09), 5,0 (27.09) |
| QA7-M13 | Sprzeczne konwencje świąt w weekend | Raport miesięczny vs Sprawiedliwość | Raport: „raz jako święto”; Sprawiedliwość: „w soczewce Weekendy”; 15.08.2026 to sobota |
| QA7-M14 | Nagłówek wystaje poza ekran telefonu | julia.nowak, 390 px | `scrollWidth` 406 px, „Wyloguj” ucięty, poziome przewijanie na każdym ekranie |
| QA7-M15 | Ekran „Moje” nie pokazuje moich dyżurów | julia.nowak / Moje | Jedyna lista własnych dyżurów jest w polu „Mój dyżur” na ekranie zamian |
| QA7-M16 | API ma na sztywno 2 procesy | Dockerfile `--workers 2` | Przepustowość stoi na ~140 rps przy 2 wolnych rdzeniach (par. 6) |

### 5.4 Niskie, wizualne i językowe

| ID | Defekt | Miejsce |
|---|---|---|
| QA7-L01 | Pusta instalacja: kalendarz domyślnie na zakres jednego dnia (dziś-dziś) | Dyżury |
| QA7-L02 | Login wrażliwy na wielkość liter i nieprzycinany; komunikat jak dla złego hasła | Logowanie |
| QA7-L03 | Po nieudanym logowaniu hasło zostaje w polu; konto wyłączone nie mówi „poproś administratora” | Logowanie |
| QA7-L04 | Szablon CSV zawiera `2026-01-01,late_shift` (Nowy Rok) i osoby spoza zespołu, więc importer go odrzuca | Import historii |
| QA7-L05 | Sesja linku na 14-20.09 dostaje w `current` dyżurnych z dziś (12.09) | `/schedules/published` |
| QA7-L06 | `expected_version` w korekcie opcjonalne - integracja bez wersji nadpisuje równoległe zmiany | `/calendar/override` |
| QA7-L07 | Nagłówek „Kryterium odbioru…” w podglądzie szkicu ma ~48 px (większy niż tytuł strony), lista soczewek to niestylowane `<ul>` | Generator, zrzut `12-draft-mid.png` |
| QA7-L08 | Ucięta etykieta miesiąca (`sie 20:`) w nagłówku macierzy, gdy miesiąc ma jeden dzień | Generator, `11-draft-top.png` |
| QA7-L09 | Brak cofnięcia z „Do akceptacji” do szkicu; komunikat FEASIBLE przegadany i odsyłający „tam, nie tutaj” | Generator |
| QA7-L10 | Ostrzeżenie o kolizji z dyżurem bez przejścia do wniosku o zamianę | Moje |
| QA7-L11 | „PRIMARY -0.23” przy zastępcy bez legendy; panel wpływu pokazuje punkty absolutne (28 → 27) bez udziału oczekiwanego | Zamiany |
| QA7-L12 | Pole „Zastępca” po wyborze wyższe niż sąsiednie pola; plakietka licznika nachodzi na „Zamiany” | Zamiany, nawigacja |
| QA7-L13 | Raport miesięczny bez kolumny punktów 1X/2X do rozliczenia | Raport miesięczny |
| QA7-L14 | Wiersz „Rozpiętość” w kolumnie „Razem” pokazuje „nie spełnia” bez liczby | Sprawiedliwość |
| QA7-L15 | Kolejność wierszy macierzy niestabilna (Halina po Tomaszu u Ewy); tabela nie wypełnia szerokości kontenera | Dyżury |
| QA7-L16 | Dialog korekty: podpowiedź wystaje w prawo, przyciski nierówno; Osoby: nagłówek „Osoba” niżej, ucięty placeholder, różne czcionki, „Administrator Administrator”; Wydarzenia: przycisk „Dodaj” inaczej wyrównany; Audyt: surowe kody akcji, „Override … late_shift”, strefa czasowa w każdym wierszu | Administracja |
| QA7-L17 | 1773 ostrzeżenia deprecacji w pytest; pakiet JS 917 KB bez dzielenia kodu; obraz Docker na Pythonie 3.13, venv 3.14 | Higiena |
| QA7-L18 | Komunikaty walidacji Pydantic po angielsku obok polskich; natywne dymki przeglądarki | API, formularze |
| QA7-L19 | Karta „Kto jest teraz?” podaje e-mail, nie telefon; model nie ma pola na numer | Dyżury |
| QA7-L20 | Przekazanie do osoby wracającej z urlopu jest w celu solvera darmowe (zmienna przejścia nie powstaje przy luce) | Solver |
| QA7-L21 | Żaden z 435 testów automatycznych nie łapie blokerów B01-B03 ani H01 | Testy |

## 6. Wydajność

Scenariusz realistyczny: sesje z logowaniem, 10 członków/koordynatorów/viewer, mieszanka ekranów SPA (grafik, kalendarz 30 i 35 dni, sprawiedliwość, zamiany, opcje zamian, raport, CSV, audyt, podgląd wpływu szkicu).
Scenariusz stresowy: te same sesje bez przerw.

| Host | Obciążenie | Żądania/s | p95 kalendarz | p95 sprawiedliwość | p95 wpływ szkicu | p95 logowanie | CPU API | Błędy produktowe |
|---|---|---|---|---|---|---|---|---|
| 4 rdzenie | 10 użytk., przerwy 2-5 s | 3 | 13 ms | 89 ms | 126 ms | 82 ms | 5% | 0 |
| 2 rdzenie | 10 użytk., przerwy 2-5 s | 3 | 17 ms | 79 ms | 132 ms | 299 ms | 5% | 0 |
| 4 rdzenie | 10 sesji bez przerw | 146 | 179 ms | 220 ms | 309 ms | 285 ms | 194% | 0 |
| 2 rdzenie | 10 sesji bez przerw | 136 | 186 ms | 219 ms | 308 ms | 563 ms | 179% | 0 |
| 4 rdzenie | 25 sesji bez przerw | 135 | 387 ms | 432 ms | 613 ms | 741 ms | 191% | 0 |
| 4 rdzenie | 50 sesji bez przerw | 141 | 592 ms | 633 ms | 687 ms | 1460 ms | 197% | 0 |
| 4 rdzenie | 100 sesji bez przerw | 135 | 1073 ms | 1136 ms | 1083 ms | 4631 ms | 203% | 0 |
| 4 rdzenie | 25 sesji + generowanie 35 dni | 128 | 436 ms | 469 ms | 553 ms | 1184 ms | 182% | 0 |
| 2 rdzenie | 10 użytk. (0,5-2 s) + generowanie 35 dni | 8 | 23 ms | 137 ms | 204 ms | 1288 ms | - | 0 |

Kolumna błędów pomija pojedyncze odpowiedzi 403 wynikające z niedopasowania ról w skrypcie obciążenia (koordynatorka spoza rotacji pytająca o własną dostępność, koordynator pytający o audyt tylko dla administratora); to poprawne odmowy, nie błędy.

Wnioski:
- Wymóg 10 równoczesnych użytkowników jest spełniony z zapasem rzędu 40× na obu wariantach sprzętu.
- Raporty (sprawiedliwość, raport miesięczny, CSV) nie są wąskim gardłem; najdroższy jest podgląd wpływu szkicu, bo liczy sprawiedliwość dwukrotnie w Pythonie.
- Wąskim gardłem przepustowości jest stała liczba 2 procesów API (QA7-M16): na 4 rdzeniach baza pracuje w ~20%, a dwa rdzenie są wolne.
- Generowanie na 4 rdzeniach nie wpływa na API (worker ograniczony do 2 CPU); na 2 rdzeniach odczuwalne jest tylko logowanie (Argon2 konkuruje z solverem).
- Ryzykiem jest logowanie, nie raporty (QA7-H06, QA7-H08).
- Czas generowania przy nieosiągalnym kryterium sięga sufitu 4× budżetu (QA7-H07).

## 7. Solver - optymalność i szybkość

Horyzont 28.09-25.10 (hybrid, kotwica 11-19 do secondary, 2 wątki), produkcyjne dane wejściowe, ślad każdego rozwiązania.

### 7.1 Budżet nie jest problemem

| Budżet | Status | Cel | Dolna granica | Luka | Ostatnia poprawa |
|---|---|---|---|---|---|
| 15 s | FEASIBLE | 119 400 | 62 200 | 47,9% | 9,5 s |
| 30 s | FEASIBLE | 117 400 | 62 800 | 46,5% | 13,2 s |
| 60 s | FEASIBLE | 118 400 | 63 600 | 46,3% | 14,3 s |
| 120 s | FEASIBLE | 118 400 | 63 800 | 46,1% | 9,3 s |
| 300 s | FEASIBLE | 115 400 | 63 400 | 45,1% | 188,7 s |

Podniesienie budżetu z 15 s do 300 s poprawia cel o 3,4%, a lukę o niecałe 3 punkty procentowe.
Wszystkie te rozwiązania mają identyczne rozpiętości sprawiedliwości (primary 1,0-1,5, secondary 2,5, weekendy 3,0).

### 7.2 Gdzie jest luka

| Eksperyment | Status | Czas | Luka | Wniosek |
|---|---|---|---|---|
| Sam człon sprawiedliwości (ciągłość i preferencje = 0) | OPTIMAL | 8,9 s (najlepsze po 0,16 s) | 0% | sprawiedliwość jest łatwa |
| Tryb `daily` (bez kar za przekazania) | OPTIMAL | 13,8 s (najlepsze po 0,48 s) | 0% | cały problem to ciągłość |
| Tryb `weekly` (kara ×10) | FEASIBLE | 30 s | 85,8% | im większa waga ciągłości, tym gorzej |
| Leksykograficznie: sprawiedliwość udowodniona, potem reszta | FEASIBLE | 60 s | 43,9% | zamrożenie sprawiedliwości nie pomaga |
| `linearization_level=2` | FEASIBLE | 30 s | 46,7% | bez zmian |
| Bez podpowiedzi | FEASIBLE | 30 s | 47,7% | podpowiedź round-robin nic nie wnosi |
| 4 wątki / 8 wątków | FEASIBLE | 30 s | 46,2% / 26,5% | więcej wątków podnosi granicę, ale host ma 2-4 rdzenie |
| **Prototyp: ciągłość jako serie (≤ 3 dni) w tygodniu ISO** | FEASIBLE | 60 s | **8,2%*** | przydział o koszcie produkcyjnym 116 400 po 5,4 s (produkcja: 118 400 po 60 s) |
| Prototyp serii + cięcie „drugi dyżur” | FEASIBLE | 60 s / 300 s (4 wątki) | 7,8%* / 7,5%* | przydział o koszcie produkcyjnym 115 400 po ~21 s (produkcja osiąga to dopiero po 300 s) |

\* Luka prototypu jest liczona na jego własnej funkcji celu, która na tym samym przydziale różni się od produkcyjnej o 1-2% (seria ≤ 3 dni i cięcie „drugiego dyżuru” liczą przekazania przy lukach zmiennych, których produkcja nie liczy). Porównanie jakości rozwiązań jest więc zrobione uczciwie, przeliczeniem przydziału funkcją celu produkcji.

Przyczyna: człon ciągłości `transition ≥ |x(d-1) − x(d)|` ma relaksację LP równą zeru - model może „rozmazać” rolę po 10 osobach po 0,1 i nie widzi żadnego przekazania.
Żaden parametr solvera tego nie naprawia; potrzebna jest inna formulacja.
Prototyp (w `bench_variants.py`, eksperymenty `runs`, `runs2`) wybiera serie osoba-rola-dni i liczy koszt jako „liczba serii w tygodniu − 1”.
Mierzalny efekt na koszcie produkcyjnym: przydział wart 115 400 powstaje w ~21 s zamiast 300 s, a luka własnej funkcji celu spada z ~46% do ~8%.
Pełny dowód optymalności wymaga dalszej pracy modelarskiej (wzmocnienie powiązania sprawiedliwości i serii, łamanie symetrii) - to zadanie projektowe, nie strojenie.

### 7.3 Pozostałe ustalenia

- Wyznaczanie dna kryterium marnuje czas (QA7-H07): 117 s → 31,5 s po jednej zmianie parametru.
- Komunikat „przyczyną jest zastana nierówność” zweryfikowany: ten sam 35-dniowy horyzont z wyzerowaną historią spełnia kryterium.
- Podpowiedź round-robin ignoruje historię i reguły: pierwsze rozwiązanie kosztuje 357 400, trzy razy więcej niż końcowe.
- Reguły odpoczynku bez styku z poprzednim okresem (QA7-B03) i pominięcie osób bez zmiennych (QA7-H02) to defekty modelu, nie wydajności.

### 7.4 Odpowiedź na pytanie „kiedy solver daje optymalne rozwiązania szybko”

- Dziś: sprawiedliwość jest optymalna (udowodnione) w < 10 s, a dobre rozwiązanie całości jest gotowe w 5-15 s; dłuższy budżet praktycznie nic nie daje, a statusu OPTIMAL w trybie hybrydowym nie będzie przy żadnym budżecie.
- Rekomendowany budżet produkcyjny po poprawce QA7-H07: 15-20 s na przebieg.
- Żeby dostać OPTIMAL szybko w trybie hybrydowym: przebudowa członu ciągłości na serie (par. 9, faza 2) + dwufazowe rozwiązywanie z raportowaniem udowodnionej optymalności sprawiedliwości i luki ciągłości zamiast gołego „FEASIBLE”.

## 8. Co działa dobrze

- RBAC i prywatność: viewer, członek, koordynator i admin widzą dokładnie to, co powinni; CSRF wymuszany.
- Linki udostępniania: jednorazowe, klipowane do zakresu, bez e-maili, natychmiastowe odwołanie.
- ICS odzwierciedla zamiany.
- Audyt kompletny dla całego cyklu zamian, korekt, publikacji, importu i kont.
- Współbieżność: optymistyczne blokady wersji, jeden przebieg na zakres, blokada publikacji.
- Walidacja dostępności, importu historii i wniosków o zamianę.
- Blokada zakończenia członkostwa przy przyszłych dyżurach z listą slotów.
- Sprawiedliwość proporcjonalna do okresu w rotacji dla osoby dołączającej później (widok koordynatora).
- Jakość rozwiązań solvera w wymiarze sprawiedliwości: z odziedziczonej rozpiętości primary 7 / secondary 5,5 do 1,0 / 2,5 w jednym miesiącu.
- Wydajność dla docelowej skali.
- Dostępność (Lighthouse 100), zielone lint i testy.

## 9. Plan naprawczy

### Faza 0 - przed pierwszym realnym planowaniem (blokery, 2-4 dni)

1. **QA7-B01** - liczyć `compute_fairness` na całym zespole, filtrować odpowiedź do własnego wiersza. Test: bilans członka równy wierszowi w widoku koordynatora.
2. **QA7-B03** - przekazać do solvera dyżury z 7 dni przed horyzontem (effective assignments) i włączyć je do okien reguł odpoczynku jako stałe; to samo w walidacji publikacji. Test: szkic zaczynający się po weekendzie osoby nie daje jej 4 dyżurów w 7 dniach.
3. **QA7-B02 / QA7-H04** - publikacja nakładająca się na opublikowany zakres z zamianami lub korektami: zablokować albo wymagać świadomego potwierdzenia z listą zmian, które zostaną utracone, i powiadomić osoby, których dyżur się zmienia; anulować oczekujące wnioski wycofanego grafiku z powiadomieniem. Test: próba ponownej publikacji pokazuje utraconą zamianę 03.11 i bez potwierdzenia jej nie kasuje. (Automatyczne przenoszenie zamian do nowej wersji wymaga ustalenia semantyki konfliktów i jest w fazie 1.)
4. **QA7-H01, QA7-M09** - zakazać zamian dla dat < dziś; korekty dat minionych tylko z wymaganym powodem i etykietą „korekta historyczna”.
5. **QA7-H07** - `stop_after_first_solution=True` w `cap_feasible`.

### Faza 1 - przed udostępnieniem całemu zespołowi (wysokie, 1-2 tygodnie)

6. **QA7-B02 (docelowo)** - przenoszenie zatwierdzonych zamian i korekt do nowej publikacji: gdy slot w nowym szkicu ma innego wykonawcę albo zastępca ma w nowym szkicu przeciwną rolę tego dnia, zamiana trafia na listę konfliktów do decyzji koordynatora.
7. **QA7-H02** - jedno źródło prawdy dla kryterium: raport, podgląd szkicu i solver liczą rozpiętość po tych samych osobach (aktywnych w oknie horyzontu); osoby, które odeszły, pokazywać osobno, poza kryterium.
8. **QA7-H05** - ostrzeżenie o luce przed zakresem; generator dla kolejnego miesiąca bierze pod uwagę szkic/propozycję poprzedniego albo blokuje generowanie; znacznik nieaktualności szkicu (zmiany po wygenerowaniu) i walidacja reguł odpoczynku przy publikacji.
9. **QA7-H06, QA7-H08, QA7-M11** - limit prób logowania per login i IP z rosnącym opóźnieniem; `argon2` przez `anyio.to_thread`; stały czas odpowiedzi dla nieistniejącego loginu (weryfikacja pozornego hasha); agregacja audytu nieudanych prób.
10. **QA7-H09, QA7-M12** - domyślny widok sprawiedliwości „na koniec opublikowanego grafiku”, kryterium oceniane na granicach horyzontów, wyjaśnienie „dlaczego nie spełnia” (kto i o ile).
11. **QA7-M01, QA7-M02** - sugerowany start: pierwszy nieobsadzony dzień (także dziś), wyrównany do początku bloku dni wolnych; pola dat z walidacją wpisu zamiast przesuwania cyfr.
12. **QA7-M03, QA7-M04, QA7-M10** - zakaz zatwierdzania własnej zamiany; w dialogu zatwierdzenia wpływ na bilans i ostrzeżenia (rozbicie bloku, reguły); korekta roli kotwiczącej przenosi 11-19 jako jedną decyzję.
13. **QA7-M05, QA7-M06** - unikalność loginu i e-maila bez względu na wielkość liter (indeks na `lower()`), normalizacja loginu przy logowaniu; sprawdzenie hasła względem listy popularnych haseł.
14. **QA7-M14, QA7-M15** - nagłówek mobilny bez przepełnienia; lista „Moje dyżury” z punktami i przejściem do zamiany.

### Faza 2 - solver i skalowanie (2-4 tygodnie)

15. **QA7-H03** - przebudowa członu ciągłości na serie (prototyp w `docs/qa-suite-7/bench_variants.py`, `build_runs`): zmienne serii osoba-rola-dni w tygodniu ISO, `x = Σ serii`, koszt = serie − 1; długie bloki świąteczne jako dozwolone dłuższe serie. Następnie rozwiązywanie dwufazowe: sprawiedliwość do dowodu, potem ciągłość z zamrożoną sprawiedliwością. W UI zamiast „FEASIBLE” komunikat „sprawiedliwość optymalna (udowodniona), ciągłość w granicy X%”. Kryterium akceptacji: horyzont 28 dni, 2 wątki, luka ≤ 5% w ≤ 20 s i status OPTIMAL dla fazy sprawiedliwości.
16. **QA7-L20** - przekazanie przy luce zmiennych liczone jak każde inne (wynika naturalnie z formulacji seriami).
17. Podpowiedź startowa z rozwiązania fazy sprawiedliwości albo z opublikowanego poprzedniego miesiąca zamiast round-robin.
18. **QA7-M16** - liczba procesów API z przydziału CPU (np. `WEB_CONCURRENCY` wyliczane w entrypoincie); worker `cpus` zgodnie z hostem.
19. **QA7-M07** - kontrola przyszłych dyżurów przy skracaniu eligibility; kreator offboardingu: wskazanie daty wyjścia → lista dyżurów → przepisanie przez solver tylko tych slotów.

### Faza 3 - porządki (w toku)

20. **QA7-M08, QA7-M13, QA7-L01..L19** - eligibility w payloadzie kalendarza, jedna konwencja świąt w weekend w raporcie i sprawiedliwości (z kolumną punktów), poprawki wizualne i językowe z par. 5.4, tłumaczenie komunikatów walidacji, pole telefonu dyżurnego, podział pakietu JS, usunięcie deprecacji.
21. **QA7-L21** - testy regresyjne dla B01-B03, H01, H02, H04, H07 (skrypty z `docs/qa-suite-7/` są gotowym materiałem: `check_rules.py`, scenariusze API z tego raportu).

## 10. Werdykt

**Pokazanie zespołowi: TAK, jako wersja próbna do zebrania opinii.**
Interfejs jest spójny, większość ścieżek działa, uprawnienia i prywatność są solidne, wydajność wystarczająca, a jakość sprawiedliwości generowanych grafików przekonująca.
Przy prezentacji trzeba wprost powiedzieć, że ekran sprawiedliwości dla członków zespołu pokazuje dziś nieprawdziwe dane (QA7-B01).

**Rozpoczęcie realnego korzystania (planowanie prawdziwych dyżurów): NIE, jeszcze nie.**
Trzy blokery psują dane po cichu, w sposób, którego użytkownik nie zauważy:
reguła „max 3 noce z rzędu” jest łamana na styku każdego miesiąca (QA7-B03),
ponowna publikacja kasuje uzgodnione zamiany (QA7-B02),
a każdy członek zespołu widzi „jesteś w równowadze” niezależnie od faktów (QA7-B01).
Dołożone do tego zamiany wsteczne (QA7-H01) i fałszywe „nie spełnia” przez osobę, która odeszła (QA7-H02) podważą zaufanie do systemu, którego jedyną wartością jest sprawiedliwość i przewidywalność.

Po wykonaniu fazy 0 (kilka dni pracy, wszystkie poprawki są lokalne i dobrze zdiagnozowane) system nadaje się do pilotażu na jednym miesiącu równolegle z dotychczasowym sposobem planowania.
Pełne wdrożenie rekomenduję po fazie 1.
Faza 2 (solver) nie blokuje wdrożenia - obecne wyniki są dobre, brakuje tylko dowodu optymalności i przewidywalnego czasu.
