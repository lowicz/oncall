# Solver grafiku - stan implementacji

## Silnik

Generator używa Google OR-Tools CP-SAT (`ortools.sat.python.cp_model`).
Dla każdego dozwolonego połączenia `(dzień, rola, osoba)` powstaje zmienna binarna.
Wyjątkiem są bloki dni wolnych (opisane w sekcji ograniczeń twardych): cały blok
dostaje jedną zmienną na parę `(blok, rola, osoba)`.
Cały zakres dat jest rozwiązywany jednocześnie; nie jest to algorytm zachłanny.
Pojedyncze uruchomienie obejmuje maksymalnie 35 dni. Solver dąży do rozpiętości
2 punktów, a kryterium odbioru dla każdej ocenianej soczewki wynosi 3 punkty;
dodatkowy punkt jest tolerancją na niepodzielne bloki 2X.
Kryterium jest w pierwszym przebiegu ograniczeniem twardym, a nie tylko celem,
więc gdy da się je spełnić, jest spełnione konstrukcyjnie, a nie szczęściem
wyszukiwania. Gdy nie da się, solver zdejmuje ograniczenie, rozwiązuje ponownie
i podaje najniższą osiągalną rozpiętość (`acceptance_floor`) zamiast milczeć.

Historia dla generatora jest liczona w tym samym kroczącym oknie dwunastu
miesięcy, które kończy się ostatnim dniem szkicu i którego używa raport
sprawiedliwości (`fairness_data.generator_history_window`). Wcześniej solver
optymalizował okno zakotwiczone na początku horyzontu, a raport pokazywał inne;
ten sam zestaw przydziałów miał wtedy rozpiętość `secondary` 4,18 w oknie
solvera i 9,00 w oknie raportu (BLK5-01).

Udział oczekiwany w każdej soczewce liczy jedna funkcja, `fairness.slot_exposure`,
wołana i przez raport, i przez `scheduler.balance`. Liczy sloty `(dzień, rola)`,
nie dni - dwa dla soczewek `weekends` i `holidays`, obejmujących obie role
on-call - i pomija dni twardej niedostępności (decyzja D3, wariant B: urlop
obniża udział oczekiwany, nie tworzy długu do odrobienia). Wcześniej raport
tych dni nie pomijał i celował w inną tarczę niż solver (HGH6-06 przyczyna 2).
Rezydualny rozjazd wynika już tylko z rozbicia udziału horyzontu i historii na
dwa podokresy w `balance` i przy realnej historii jest rzędu 0,1 punktu.

CP-SAT używa `ONCALL_SOLVER_WORKERS` równoległych workerów. Bez jawnego nadpisania
ich liczba wynika z limitu CPU cgroup v2 lub v1, a przy braku limitu z affinity
procesu; wynik jest ograniczony do przedziału 1–8. Budżet czasu jest polem polityki generowania
(`scheduling_policies.solve_seconds`, zakres 5-300 s, edytowalne w panelu
„Ustawienia generowania”); `ONCALL_SOLVER_SECONDS` ustawia tylko wartość, z jaką
polityka powstaje przy pierwszym użyciu. Domyślne 15 sekund pochodzi z pomiaru:
maksimum ocenianych soczewek jest identyczne przy 5, 15, 30, 60 i 90 sekundach,
a 15 s to najmniejszy budżet, przy którym gałąź licząca dno kryterium kończy się
`OPTIMAL`, nie `FEASIBLE` (`docs/qa-suite-5/budget-z14*.jsonl`).
`ONCALL_SOLVER_LOG` włącza diagnostyczny log postępu.
Cała funkcja celu, łącznie z kształtowaniem rozkładu, jest rozwiązywana w jednym
przebiegu. Wynik nie jest deterministyczny i nie jest to wymaganie produktowe.
Model dostaje przez `add_hint` startową rotację round-robin. Podpowiedź respektuje
eligibility, twardą niedostępność, rozłączność primary/secondary, kotwiczenie 11–19
i wspólne zmienne bloków dni wolnych; pozostałe ograniczenia solver może naprawić.

Szkic zapisuje status CP-SAT oraz użyty tryb rotacji. `OPTIMAL` oznacza dowiedzioną
optymalność całego jednoprzebiegowego celu; `FEASIBLE` oznacza kompletne rozwiązanie
bez dowodu optymalności w dostępnym czasie.

Nieudany wynik rozróżnia `PRECHECK` (nazwany brak pokrycia wykryty przed budową
modelu), `INFEASIBLE` (sprzeczność nazwanych rodzin reguł twardych potwierdzona przez
CP-SAT) oraz `UNKNOWN` (budżet czasu minął bez kompletnego rozwiązania i bez dowodu
sprzeczności). `UNKNOWN` podaje faktyczny budżet i sugeruje krótszy zakres albo jego
zwiększenie w panelu „Ustawienia generowania”, gdzie budżet faktycznie jest;
nie jest opisywany jako konflikt danych.
Komunikaty `PRECHECK` grupują dni w zakresy i rozróżniają brak eligibility od
zgłoszonej niedostępności; ról używają w etykietach zespołu (`PRIMARY`,
`SECONDARY`, `11–19`), nie w identyfikatorach.

Ostrzeżenia solvera - zawieszenie reguł rozrzedzania i nieosiągalne kryterium -
są zapisywane przy grafiku (`schedules.solver_warnings`) i docierają na ekran
generatora z etykietą źródła, obok ostrzeżeń o złamanych regułach twardych,
które podają nazwisko i dni.

## Ograniczenia twarde

- dokładnie jedna osoba na każdy slot `primary`, `secondary`, `late_shift`;
- aktywne członkostwo i eligibility dla roli w konkretnym dniu;
- `unavailable` całkowicie usuwa osobę z kandydatów danego dnia;
- primary i secondary danego dnia muszą być różnymi osobami;
- w trybie dziennym i hybrydowym jedna osoba ma najwyżej trzy kolejne noce on-call;
- w trybie dziennym i hybrydowym jedna osoba ma najwyżej trzy dyżury on-call w
  każdym oknie siedmiu dni oraz po serii co najmniej dwóch dyżurów ma minimum dwa
  dni przerwy. Reguły są kompilowane do twardych ograniczeń modelu. Jeżeli przy
  danej obsadzie są niespełnialne, solver buduje drugi, wolny od nich model i zwraca
  kompletny szkic z jawnym ostrzeżeniem zamiast błędu 409 (QA-REPORT-4, BLK-01).
  Dzięki temu oba przebiegi działają w pełni równolegle - CP-SAT nie używa założeń,
  które wymusiłyby jeden wątek wyszukiwania;
- zmiana `11–19` nie ma slotu w soboty, niedziele i polskie dni ustawowo wolne;
- gdy polityka kotwiczy zmianę `11–19` do `primary` albo `secondary`, osoba
  eligible do obu ról musi obsadzić oba sloty. Dla osoby bez eligibility do
  `late_shift` reguła pozostaje miękka, a użyte odstępstwo jest raportowane jako
  `anchor_exceptions` wyniku solvera;
- blok dni wolnych (weekend scalony z przyległymi świętami) jest nierozdzielczy:
  w każdej roli on-call cały blok obejmuje jedna osoba. Solver implementuje to
  jedną zmienną na `(blok, rola, osoba)`, więc podział jest niemożliwy z konstrukcji,
  a nie tylko karany. Osoba musi być eligible i dostępna na wszystkie dni bloku.
  Podział pozostaje możliwy wyłącznie świadomie: korektą koordynatora albo
  zamianą po publikacji. Gdy nikt nie może objąć całego bloku (albo tylko jedna
  osoba może, a potrzebne są dwie różne), generowanie kończy się nazwanym
  konfliktem zamiast cichym podziałem;
- brak pokrycia lub brak rozwiązania nie tworzy częściowego szkicu.

## Historia

Historia pochodzi z `fairness_data.solver_history()`, czyli z dokładnie tego samego
źródła co ekran sprawiedliwości: rozstrzygnięcie per slot przez `effective_assignments()`,
kroczące okno `WINDOW_DAYS` kończące się dzień przed początkiem horyzontu, dopasowanie
po `member_id` z nazwą wyłącznie jako kluczem zapasowym.

Rozstrzyganie per slot jest tu istotne merytorycznie, nie kosmetycznie.
Kiedy krótszy zakres zostanie opublikowany wewnątrz dłuższego, oba grafiki pokrywają te same dni.
Wcześniejsze sumowanie surowych wierszy liczyło taki dyżur dwa albo trzy razy, więc solver
korygował nieistniejący dług i wypychał człowieka z rotacji na cały kolejny horyzont.

## Funkcja celu

Jedyny przebieg minimalizuje sumę ważoną:

- rozpiętość odchyleń (`max - min`) osobno w każdej soczewce;
- karę `prefer_not` i premię `prefer`;
- karę za przekazanie w trybie `hybrid` (umiarkowaną) i `weekly` (pięciokrotną),
  liczoną wewnątrz tygodnia ISO; `daily` nie ma tej kary;
- karę za każdy dyżur on-call ponad pierwszy w tygodniu ISO w trybie dziennym i
  hybrydowym;
- karę za rozjazd zmiany 11–19 z rolą kotwiczącą wyłącznie dla osoby, która nie
  ma eligibility do `late_shift`; dla osób eligible do obu ról zgodność jest
  ograniczeniem twardym.

Soczewki bilansowane osobno, te same, które pokazuje raport sprawiedliwości:
`primary`, `secondary`, `late_shift`, dyżury on-call w soboty i niedziele oraz
dyżury on-call w święta wypadające w dni robocze.
Gdy `late_shift` jest kotwiczona, jej przydział jest niemal funkcją roli
kotwiczącej, dlatego soczewka **nie znika z celu w całości**: traci człon
rozpiętości i zostaje w nim wyłącznie słaby człon rozkładu, jako rozstrzygacz
remisów, z wagą `TIE_BREAK_FRACTION`. Wartość wybrano pomiarem (decyzja D1):
przy 0,1 i 0,25 soczewka `secondary` wychodziła powyżej kryterium, a efekt na
samej 11–19 był marginalny (rozpiętość 10,0 zamiast 9,0), więc `TIE_BREAK_FRACTION`
wynosi 0 - czyli przy kotwiczeniu soczewka jest z celu usunięta, i jest to
zapisany wynik pomiaru, nie przeoczenie (`docs/qa-suite-5/tie-break.jsonl`).
Kryterium odbioru jej wtedy nie obejmuje, a raport sprawiedliwości ukrywa jej
kolumnę (`late_shift_balanced`), zachowując wartości per osoba.
Przy trybie `independent` soczewka pozostaje pełnoprawnym składnikiem celu i
kryterium.
Weekend i święto nie kumulują się: święto w weekend liczy się raz, jako weekend.
Punktacja to 1 za dzień roboczy i 2 za sobotę, niedzielę lub święto; zmiana 11–19
liczy się sztukowo.

Rozpiętość soczewki jest zapisana jako pary nierówności `maximum >= deviation` oraz
`minimum <= deviation`; minimalizacja sama domyka obie granice. Rozkład kształtuje
dodatkowo wypukły dolny estymator kwadratu odległości od średniej. Powstaje z najwyżej
16 stycznych na osobę, bez `add_multiplication_equality`. Dzięki temu podziały takie
jak `2/2/3/3` i `2/2/2/4` przestają być równoważne już w pierwszym przebiegu.

Rodziny sprawiedliwości, preferencji i ciągłości mają koszt jednostkowy liczony
od pojedynczej decyzji, nie od maksimum rodziny: `max(1, round(1000 * waga / krok))`,
gdzie krok to odchylenie, jakie jedna dyżurowa decyzja robi w tej rodzinie.
Dla preferencji i ciągłości krok to 1 (przydział, przekazanie). Dla
sprawiedliwości krok to `SCALE = 10`, bo jeden punkt soczewki przesuwa człon
rozpiętości o jednostki odchylenia. Dzięki temu jedna zmiana dyżuru wycenia się
bezpośrednio przeciwko jednemu przydziałowi `prefer` lub jednemu przekazaniu,
a nie przeciwko pesymistycznemu maksimum całej rodziny: przy domyślnych wagach
jeden punkt sprawiedliwości przebija jedno przypisanie preferencyjne i jedno
przekazanie, natomiast opuszczenie suwaka sprawiedliwości naprawdę oddaje grafik
preferencjom i ciągłości. Domyślna hierarchia wynosi: sprawiedliwość `3.0`,
preferencje `2.0`, ciągłość `1.0`.

Ciągłość w trybie hybrydowym i tygodniowym jest modelowana seriami w obrębie
tygodnia ISO. Zmienna serii pokrywa od jednego do trzech kolejnych dni, a każdy
przydział jest równy sumie serii, które go pokrywają. Cel karze kolejne serie
zamiast każdej granicy dzień po dniu; tryb tygodniowy stosuje mnożnik 10.
Szkic przechowuje też informację, czy solver udowodnił optimum, oraz względną
lukę wartości celu względem najlepszej znanej granicy.

## Zweryfikowane testami

- kompletność slotów i rozłączność primary/secondary;
- twarda niedostępność;
- nierozdzielczość weekendów i bloków świątecznych, w tym odporność reguły na
  częściową niedostępność i nazwany konflikt dla bloku, którego nikt nie może
  objąć w całości;
- brak zmiany 11–19 w dni wolne, zarówno w generatorze, jak i na drodze odczytu
  (`effective_assignments`, kalendarz);
- twarda zgodność 11–19 z rolą kotwiczącą i wykonalność z raportowanym wyjątkiem
  dla osoby bez eligibility do `late_shift`;
- limit 3 dyżurów w dowolnych 7 dniach, dwudniowy odpoczynek po serii, brak tych
  reguł w trybie tygodniowym oraz fallback z ostrzeżeniem przy zbyt małej obsadzie;
- ciągłość w trybie tygodniowym;
- wpływ historycznej nierówności na rozwiązanie;
- historia liczona raz mimo nakładających się publikacji;
- kryterium z `PLAN.md` par. 8 w produkcyjnym trybie hybrydowym i z kotwicą
  secondary: brak niewyjaśnionej nierówności większej niż jeden dyżur 2X także
  przy święcie w środku tygodnia i preferencji jednej osoby;
- osobne wyrównanie weekendów, także wobec historycznej nadwyżki weekendowej;
- kształtowanie całego rozkładu zamiast dosypywania dyżurów jednej osobie;
- raportowanie braku pokrycia;
- jakość obu rozwiązań jest kryterium; testy nie wymagają identycznych przydziałów
  dla identycznego wejścia.

## Stan funkcji względem planu docelowego

- biblioteka `holidays` jest wspólnym źródłem polskich świąt dla solvera,
  kalendarza, fairness, importu i raportów;
- nie ma jeszcze polityk odpoczynku konfigurowanych per osoba;
- generowanie działa jako trwałe zadanie `schedule_runs`: API zwraca `202`, worker
  przejmuje zadanie z blokadą `SKIP LOCKED`, a interfejs odpytuje postęp i może
  odzyskać wynik niezależnie od czasu wykonania; API działa dodatkowo w dwóch procesach;
- szkic można przekazać do akceptacji i opublikować; ekran generatora porównuje
  wariant dzienny i tygodniowy o tym samym zakresie, pokazując przekazania,
  najdłuższą serię, rozpiętość obciążenia i korekty ręczne.
