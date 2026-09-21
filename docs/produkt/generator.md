# Generator grafiku

Generator to model CP-SAT (OR-Tools) uruchamiany w osobnym procesie roboczym,
nie w procesie API. Dzięki temu długie liczenie nie blokuje aplikacji: postęp
widać na ekranie, a inne ekrany działają normalnie.

## Dwa piętra reguł

Solver najpierw **spełnia wszystkie reguły twarde**, a dopiero potem
optymalizuje cele miękkie. Nigdy nie łamie po cichu reguły twardej - jeśli
zestaw reguł jest sprzeczny, pokazuje konkretne konflikty.

### Reguły twarde

- pełne pokrycie `PRIMARY` i `SECONDARY` każdego dnia zakresu,
- `PRIMARY` ≠ `SECONDARY` w tym samym dniu,
- `11–19` wyłącznie w polskie dni robocze,
- eligibility na rolę i dzień,
- zgłoszone „nie mogę”,
- nierozdzielny blok weekendowy i świąteczny,
- limit 3 dyżurów w 7 dniach i 2 dni odpoczynku po serii (poza trybem
  tygodniowym; zawieszane z jawnym ostrzeżeniem, gdy są niewykonalne),
- powiązanie `11–19` dla osób eligible do obu ról.

### Cele miękkie

Trzy znormalizowane rodziny celów, optymalizowane w jednym przebiegu. Znaczenie
ma **wyłącznie relacja między wagami**, nie ich wartości bezwzględne: 6 / 4 / 2
działa tak samo jak 3 / 2 / 1.

| Waga | Domyślnie | Co robi |
| --- | --- | --- |
| **Równy udział** | 3.0 | wyrównuje rozkład i wypukle karze wartości odstające |
| **Preferencje zespołu** | 2.0 | respektuje „wolę nie” i „chętnie wezmę” |
| **Ciągłość rotacji** | 1.0 | ogranicza przekazania w obrębie tygodnia |

Wartość `0` wyłącza dany człon celu w całości - także „Równy udział”, który
preferencją nie jest. Żadna waga nie może wyłączyć reguły twardej.

## Tryby rotacji

| Tryb | Zachowanie |
| --- | --- |
| **Hybrydowy** (domyślny) | premiuje ciągłość tygodnia, ale rozbija blok dla reguł twardych albo istotnej nierówności |
| **Dzienny** | nie premiuje ciągłości |
| **Tygodniowy** | wybiera bazową parę poniedziałek-niedziela, ale zapisuje siedem osobnych dziennych przydziałów |

W każdym trybie zapisem końcowym są **przydziały dzienne**, więc pojedynczy
dzień można potem zamienić bez naruszania reszty tygodnia.

## Zakres i sugestia

- Jedno uruchomienie obejmuje **maksymalnie 35 dni**. Dłuższy okres dzieli się
  na kolejne, zachodzące po sobie szkice.
- Bez jawnego zakresu generator zaczyna od pierwszego dnia nieobjętego
  opublikowanym grafikiem i proponuje koniec w niedzielę zamykającą cztery
  pełne tygodnie poniedziałek-niedziela (łącznie 28-34 dni).
- Zakres otwarty świadomie z kalendarza ma pierwszeństwo przed sugestią.
- Nazwa szkicu zawiera tryb rotacji i zakres w formacie `DD-MM-YYYY`.
- Zakres jednodniowy jest przyjmowany, ale nie ma na nim czego bilansować:
  wynik jest obsadzeniem dnia, nie grafikiem. Ekran to sygnalizuje.

## Kryterium odbioru

Mierzone w kroczącym oknie dwunastu miesięcy kończącym się ostatnim dniem
szkicu, na soczewkach `PRIMARY`, `SECONDARY`, weekendy i święta:

- **kryterium odbioru: 3 punkty** rozpiętości odchylenia,
- **cel optymalizacyjny: 2 punkty**.

Granica 3 uwzględnia niepodzielne bloki weekendowe 2X. Soczewka `11–19` podlega
kryterium wyłącznie przy powiązaniu „Niezależnie od on-call”; przy kotwiczeniu
jej rozkład jest w celu jedynie rozstrzygaczem remisów.

Gdy zastana nierówność czyni kryterium nieosiągalnym, generator podaje
**najniższą osiągalną rozpiętość** zamiast milczącej porażki.

Solver i raport sprawiedliwości liczą to samo okno i tę samą historię - rozjazd
między nimi był w przeszłości źródłem błędu, więc obie ścieżki korzystają z
jednego rozwiązania slotów.

## Budżet czasu

Budżet jest polem polityki grafikowania (5-300 sekund, domyślnie 15), edytowalnym
w aplikacji w panelu „Ustawienia generatora”. Zmienna środowiskowa
`ONCALL_SOLVER_SECONDS` jedynie zasila to pole przy pierwszym utworzeniu wiersza
polityki.

Budżet dotyczy **jednego przebiegu solvera**. Jedno generowanie wykonuje ich
kilka - model, który musi dowieść, że kryterium odbioru jest nieosiągalne, jest
rozwiązywany wielokrotnie - więc górny limit całego generowania jest
odpowiednio większy. Ekran pokazuje obie liczby.

Liczba równoległych wątków CP-SAT wynika z przydziału CPU kontenera roboczego
(w Compose: 2 CPU), z limitem 8. Można ją nadpisać zmienną
`ONCALL_SOLVER_WORKERS`.

## Powtarzalność

Identyczne wejście **nie musi** dawać identycznych przydziałów: równoległy
CP-SAT może znaleźć różne rozwiązania tej samej jakości. Gwarantowana jest
jakość wyniku wobec reguł i kryterium, nie konkretny układ nazwisk.

## Prognoza sprawiedliwości

Obok macierzy szkicu widać prognozę: dla każdej osoby bilans przed zakresem,
bilans po uwzględnieniu bieżącej wersji szkicu oraz zmianę. Prognoza przelicza
się po wygenerowaniu i po każdej ręcznej korekcie komórki. Pozostaje prognozą -
nie zastępuje raportu faktycznie odbytych dyżurów.
