# Raport testów QA nr 4 - Erste On-call

Runda niezależna od rund 1-3.
Zakres i przypadki testowe zbudowano od zera na podstawie `docs/PLAN.md`, a nie na podstawie wcześniejszych raportów.
Wcześniejsze raporty przeczytano dopiero na końcu, żeby oznaczyć, które defekty są nowe, a które powracają.

Data wykonania: 2026-09-06.
Wersja aplikacji: gałąź robocza, `ortools 9.15.6755`, PostgreSQL 17, obraz `oncall-api` / `oncall-worker` z `docker compose`.

---

## 1. Poświadczenia testowe

Wszystkie konta poza `admin` mają hasło **`OncallQA-2026!`**.
Konto `admin` ma hasło z pliku `.env`, czyli **`Qwertyuiop1!`**.

| Login | Osoba | Rola | W rotacji | Eligibility | Uwagi |
| --- | --- | --- | --- | --- | --- |
| `admin` | Administrator | admin | nie | - | hasło `Qwertyuiop1!` |
| `ola.zielinska` | Ola Zielińska | coordinator | tak, od 01-09-2024 | primary, secondary, 11-19 | koordynator będący jednocześnie członkiem rotacji |
| `halina.koordynator` | Halina Sikora | coordinator | nie | - | koordynator spoza rotacji |
| `anna.kowalska` | Anna Kowalska | member | tak, od 01-09-2024 | primary, secondary, 11-19 | ma wpis „nie mogę” 19-20.09.2026 |
| `marek.wisniewski` | Marek Wiśniewski | member | tak, od 01-09-2024 | primary, secondary, 11-19 | ma wpis „wolę nie” 14-18.09.2026 |
| `piotr.lewandowski` | Piotr Lewandowski | member | tak, od 01-09-2024 | primary, secondary, 11-19 | ma wpis „nie mogę” 01-04.10.2026 |
| `katarzyna.dabrowska` | Katarzyna Dąbrowska | member | tak, od 01-09-2024 | primary, secondary, 11-19 | ma „nie mogę” 11.09.2026 w dniu własnego dyżuru |
| `tomasz.szymanski` | Tomasz Szymański | member | tak, od 01-09-2024 | primary, secondary | **bez** eligibility do 11-19 |
| `magdalena.wozniak` | Magdalena Woźniak | member | tak, od 01-09-2024 | primary, secondary, 11-19 | |
| `rafal.kaminski` | Rafał Kamiński | member | tak, od 01-09-2024 | secondary, 11-19 | **bez** eligibility do primary |
| `julia.nowak` | Julia Nowak | member | tak, od 01-09-2024 | primary, secondary, 11-19 | ma wpis „chętnie wezmę” 26-27.09.2026 |
| `bartosz.mazur` | Bartosz Mazur | member | **tak, dopiero od 01-04-2026** | primary, secondary, 11-19 | osoba, która dołączyła do rotacji 7 miesięcy po reszcie |
| `kontroler.viewer` | Kontroler Audytu | viewer | nie | - | konto tylko do odczytu |
| `dawid.stary` | Dawid Stary | member | nie | - | konto **wyłączone**, do testów logowania |

Aplikacja: `http://localhost:8080`.

---

## 2. Dane testowe

Wszystkie wcześniejsze dane testowe zostały usunięte (`TRUNCATE` na tabelach biznesowych, `alembic_version` nietknięty).
W ich miejsce załadowano 15 miesięcy historii: **2025-06-01 - 2026-09-06, 1245 wierszy**, zaimportowanych przez prawdziwy endpoint `POST /api/v1/history/preview` + `/commit`.

Historia została wygenerowana tak, aby po imporcie była **mierzalnie sprawiedliwa według metryki samej aplikacji**, a nie tylko według arytmetyki skryptu.
Generator historii przydziela jednostki (nierozdzielny blok weekendowo-świąteczny albo ciąg maksymalnie trzech dni roboczych) osobie o najniższym odchyleniu w soczewce, której ta jednostka dotyczy, znormalizowanym przez ekspozycję do tej pory.
Dzięki temu osoba dołączająca później nie jest systematycznie faworyzowana ani karana.

Weryfikacja przez `GET /api/v1/fairness` bezpośrednio po imporcie (okno 2025-09-06 - 2026-09-06):

| Osoba | primary | secondary | 11-19 | weekendy | święta |
| --- | --- | --- | --- | --- | --- |
| Anna Kowalska | +2.0 | -2.0 | +3.2 | +1.5 | -0.9 |
| **Bartosz Mazur** (dołączył 01-04-2026) | **+0.3** | **-1.1** | **+1.0** | **+0.2** | **+0.4** |
| Julia Nowak | -4.0 | +3.0 | -2.8 | -0.5 | +0.1 |
| Katarzyna Dąbrowska | -1.0 | -1.0 | -1.8 | -0.5 | +0.1 |
| Magdalena Woźniak | +1.0 | +3.0 | +0.2 | -0.5 | +1.1 |
| Marek Wiśniewski | -0.0 | +1.0 | -0.8 | -0.5 | -0.9 |
| Ola Zielińska | +1.0 | -3.0 | +1.2 | -0.5 | -0.9 |
| Piotr Lewandowski | -2.0 | -4.0 | +1.2 | -0.5 | +0.1 |
| Rafał Kamiński | 0.0 | +3.0 | -1.8 | -0.5 | +1.1 |
| Tomasz Szymański | +3.0 | +1.0 | 0.0 | +1.5 | +0.1 |

Rozpiętość odchylenia w każdej soczewce mieści się w przedziale 3.2 - 7.0 punktu na 12 miesięcy, a osoba dołączająca później faktycznie startuje z neutralnym bilansem.
To jest punkt odniesienia dla wszystkich pomiarów solvera niżej: **wejście do generatora było sprawiedliwe**.

Skrypty odtwarzające dane leżą w `docs/qa-suite-4/` i zostały opisane w rozdziale 13.

---

## 3. Katalog przypadków testowych

Katalog wywiedziono z `docs/PLAN.md`, sekcja po sekcji, przed otwarciem wcześniejszych raportów.
Pełna, ponumerowana lista przypadków A1-L5 leży w `docs/qa-suite-4/catalog.md`.
Grupy: `A` RBAC i sesja, `B` reguły grafiku, `C` workflow, `D` zamiany, `E` import historii, `F` sprawiedliwość, `G` generator, `H` raport miesięczny, `I` ICS i linki, `J` audyt, `K` UI i dostępność, `L` wydajność.

| Grupa | Przypadków | Wykonano | Zaliczono | Nie wykonano | Uwagi |
| --- | --- | --- | --- | --- | --- |
| A. RBAC, CSRF, sesja | 8 | 8 | 7 | - | 39 sprawdzeń automatycznych; A5 zaliczony z zastrzeżeniem SEC-01 |
| B. Reguły twarde grafiku | 9 | 9 | 8 | - | naruszenie tylko w MED-03 (korekta ręczna) |
| C. Workflow draft-published | 7 | 7 | 6 | - | MED-02; C3 i C7 zweryfikowane pomiarem |
| D. Zamiany | 5 | 5 | 5 | - | pełna ścieżka, odrzucenie i wycofanie z powodem |
| E. Import historii | 3 | 3 | 1 | - | HGH-05, HGH-06 |
| F. Sprawiedliwość | 6 | 6 | 6 | - | model liczy poprawnie, problem jest w solverze |
| G. Generator i solver | 7 | 7 | 2 | - | BLK-01, HGH-01, HGH-02, HGH-03, HGH-04 |
| H. Raport miesięczny | 3 | 3 | 3 | - | zgodność 1:1 z niezależnym przeliczeniem |
| I. ICS, linki, powiadomienia | 3 | 3 | 3 | - | |
| J. Audyt | 3 | 3 | 2 | - | MED-06 |
| K. UI, dostępność, użyteczność | 10 | 9 | 6 | K8 (`prefers-reduced-motion` sprawdzone tylko statycznie) | LOW-02, LOW-03, LOW-04; K1, K2 i K3 zmierzone stoperem i zaliczone |
| L. Wydajność | 5 | 5 | 3 | - | HGH-01 i degradacja opisana w rozdziale 10 |

Świadomie **nie wykonano** w tej rundzie:

- test z czytnikiem ekranu i test z użytkownikami (par. 7 planu przewiduje je jako osobny etap projektowy);
- zachowanie `prefers-reduced-motion` w praktyce, sprawdzono wyłącznie obecność reguły CSS;
- ścieżka LDAP i powiązanie konta lokalnego z AD, bo w środowisku nie ma katalogu;
- faktyczna wysyłka e-mail, bo `ONCALL_SMTP_HOST` nie jest ustawiony; sprawdzono wyłącznie kolejkę `notification_outbox`;
- zachowanie przy rotacji istotnie większej niż 10 osób.

---

## 4. Podsumowanie

Aplikacja jest w bardzo dobrym stanie w warstwie **produktowej**: RBAC, prywatność danych o dostępności, workflow publikacji, zamiany, ICS, linki czasowe, audyt i raport kadrowy działają dokładnie tak, jak opisuje plan, a ekrany przechodzą skan `axe-core` bez ani jednego naruszenia WCAG 2.2 AA w obu motywach.

Cała waga defektów leży w **solverze i w integralności danych**.

Jeden błąd jednowierszowy w `scheduler.py` odbiera generatorowi całą równoległość i większość jakości rozwiązania.
Drugi błąd, w normalizacji funkcji celu, sprawia, że suwaki wag są praktycznie martwe.
Trzeci, w imporcie historii, pozwala cichaczem nadpisać opublikowany grafik i wyparować dyżury z rozliczenia kadrowego.

| Waga | Liczba | Identyfikatory |
| --- | --- | --- |
| Blokujące | 1 | BLK-01 |
| Wysokie | 6 | HGH-01, HGH-02, HGH-03, HGH-04, HGH-05, HGH-06 |
| Średnie | 6 | MED-01, MED-02, MED-03, MED-04, MED-05, MED-06 |
| Niskie | 11 | LOW-01 do LOW-11 |
| Bezpieczeństwo | 1 | SEC-01 |

---

## 5. Defekty blokujące

### BLK-01 Założenie CP-SAT wyłącza całą równoległość solvera i psuje presolve

**Waga:** blokująca.
**Miejsce:** `backend/src/oncall/scheduler.py`, `model.add_assumption(spacing_enabled)`.

`ONCALL_SOLVER_WORKERS` jest udokumentowany w `README.md` i w `docs/SOLVER.md`, ma domyślną wartość 8, a usługa `worker` dostała w `docker-compose.yml` jawną alokację `cpus: 2.0` właśnie po to, żeby solver miał na czym pracować.
Ta konfiguracja nie robi nic.

CP-SAT wypisuje w logu wyszukiwania:

```
Forcing sequential search as assumptions are not supported in multi-thread.
Forcing presolve to keep all feasible solutions in the presence of assumptions.
...
Starting search at 0.06s with 1 workers.
```

Model używa `add_assumption` po to, żeby po `INFEASIBLE` odczytać rdzeń niewykonalności i powtórzyć próbę bez reguł rozrzedzania.
Ceną za tę wygodę jest wymuszenie **jednego wątku** i **osłabionego presolve** na każdym przebiegu, także tym, który kończy się sukcesem.

**Dowód, że parametr jest martwy.** Ten sam zakres, ten sam budżet, różne wartości `solver_workers`:

| workers | status | wartość celu | dolne ograniczenie | luka | gałęzie |
| --- | --- | --- | --- | --- | --- |
| 1 | FEASIBLE | 576 671 | 469 133 | 18.65 % | 197 883 |
| 2 | FEASIBLE | 576 671 | 469 133 | 18.65 % | 197 888 |
| 4 | FEASIBLE | 576 671 | 469 133 | 18.65 % | 197 885 |
| 8 | FEASIBLE | 576 671 | 469 133 | 18.65 % | 197 883 |
| 16 | FEASIBLE | 576 671 | 469 133 | 18.65 % | 197 883 |

Identyczne co do jednostki wartości celu i dolnego ograniczenia dla 1 i 16 workerów.

**Dowód, jaka jest cena.** Ta sama historia, ten sam zakres, ten sam budżet 30 s, jedyna różnica to zamiana `add_assumption(spacing_enabled)` na `add(spacing_enabled == 1)`:

| Zakres | Wariant | Status | Wartość celu | Luka | Rozpiętość primary w horyzoncie |
| --- | --- | --- | --- | --- | --- |
| 28 dni | obecny kod | FEASIBLE | 576 671 | 18.6 % | 5 |
| 28 dni | bez assumption | FEASIBLE | **561 767** | **1.35 %** | 5 |
| 35 dni | obecny kod | FEASIBLE | 1 249 212 | 64.2 % | 9 |
| 35 dni | bez assumption | FEASIBLE | **541 262** | **11.2 %** | 8 |
| 56 dni | obecny kod | FEASIBLE | 825 500 | 54.9 % | - |
| 56 dni | bez assumption | FEASIBLE | **576 125** | **10.5 %** | - |
| 91 dni | obecny kod | FEASIBLE | 9 467 472 | 97.9 % | 17 |
| 91 dni | bez assumption | FEASIBLE | **441 530** | **18.3 %** | 8 |

Dla 91 dni wartość celu jest **21 razy gorsza** niż w tym samym modelu bez założenia.
Dla 28 dni obecny kod potrzebuje **300 sekund**, żeby dojść tam, gdzie ten sam model bez założenia dochodzi w **30 sekundach** (562 097 przy luce 1.39 % kontra 561 767 przy luce 1.35 %).

Tryb `weekly` jest odporny, bo reguły rozrzedzania w nim nie obowiązują i założenie nie powstaje.
To niezależnie potwierdza diagnozę: przy `weekly` obecny kod i wariant bez założenia dają identyczną wartość celu 570 293.

**Naprawa.** Zbudować model dwa razy zamiast używać założeń.
Klonowanie nie wystarczy: jeżeli pierwszy przebieg ma twarde `spacing_enabled == 1`, klon dziedziczy to ograniczenie i drugi przebieg jest trywialnie niewykonalny.

```python
def build_model(*, spacing: bool) -> tuple[cp_model.CpModel, dict]:
    model = cp_model.CpModel()
    ...                                  # wspólna część modelu
    if spacing:
        for member_index in range(len(members)):
            for start in range(len(days) - 6):
                model.add(sum(window) <= 3)        # bez only_enforce_if
            ...                                     # dwudniowy odpoczynek po serii
    return model, variables

model, variables = build_model(spacing=(mode != RotationMode.weekly))
status = solver.solve(model)
if status == cp_model.INFEASIBLE and mode != RotationMode.weekly:
    # Drugi przebieg, także wielowątkowy: reguły rozrzedzania po prostu nie powstają.
    model, variables = build_model(spacing=False)
    status = solver.solve(model)
    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        warnings.append("Reguły rozrzedzania musiały zostać zawieszone...")
```

Rozróżnienie „niewykonalne z powodu rozrzedzania” kontra „niewykonalne z innego powodu” zachowuje się w całości: drugi przebieg albo się uda (wtedy winne było rozrzedzanie), albo nie (wtedy winne jest coś innego).
Koszt to najwyżej jedno dodatkowe zbudowanie modelu w rzadkim przypadku, a zysk to równoległość i pełny presolve w każdym przypadku typowym.

**Ograniczenie tego pomiaru.** Wszystkie liczby w tabelach powyżej pochodzą z wariantu, w którym `add_assumption(spacing_enabled)` zamieniono na `add(spacing_enabled == 1)` **bez** ścieżki zapasowej.
Zmierzony jest więc wyłącznie pierwszy przebieg.
Ścieżka fallbacku po naprawie pozostaje nieprzetestowana i wymaga własnego testu regresyjnego: obsada, przy której reguły rozrzedzania są niespełnialne, musi nadal dawać kompletny szkic z ostrzeżeniem, a nie błąd 409.

**Dodatkowo:** `solver.parameters.num_search_workers` jest w OR-Tools 9.15 polem przestarzałym; bieżące pole nazywa się `num_workers`.
Po naprawie założenia warto ustawić `num_workers` i **nie** ustawiać obu naraz - ustawienie obu daje `MODEL_INVALID`, który obecny kod tłumaczy użytkownikowi jako „Ograniczenia (...) są wzajemnie sprzeczne”, czyli komunikat całkowicie mylący.

---

## 6. Defekty wysokie

### HGH-01 Generowanie 91 dni na docelowym sprzęcie kończy się brakiem grafiku

**Waga:** wysoka.
**Kryterium z planu:** `PLAN.md` par. 8, „90-dniowy grafik w skonfigurowanym budżecie czasu (domyślnie 30 sekund)”.

Przy kontenerze `worker` ograniczonym do 2 rdzeni, czyli dokładnie tak, jak deklaruje `docker-compose.yml`, generowanie zakresu 2027-01-04 - 2027-04-04 (91 dni) kończy się:

```
run failed w 34.2s
błąd: Solver wyczerpał budżet czasu bez kompletnego grafiku | Powód: UNKNOWN
```

Powtórzone dwukrotnie, raz bez obciążenia i raz przy 12 równoczesnych użytkownikach, za każdym razem z tym samym skutkiem.
Koordynator nie dostaje żadnego szkicu, ani nawet częściowego.

**Wynik jest niedeterministyczny i to jest istotne.**
Ten sam zakres, ta sama historia i ten sam budżet uruchomione jako osobny proces **w tym samym kontenerze `worker`** dały `FEASIBLE` przy luce 98.3 %.
Ścieżka aplikacyjna dała dwukrotnie `UNKNOWN`.
Model przy 91 dniach siedzi więc dokładnie na granicy znalezienia **czegokolwiek**: to samo wejście raz zwraca bardzo zły grafik, a raz nie zwraca żadnego.
To wzmacnia diagnozę, a nie osłabia: przy jednym wątku wyszukiwania (BLK-01) pierwsze pełne rozwiązanie jest kwestią szczęścia.

Jako niepotwierdzony kandydat na dodatkową przyczynę różnicy między ścieżką aplikacyjną a benchmarkiem zostaje sposób uruchomienia solvera: `generate_draft` woła CP-SAT przez `anyio.to_thread.run_sync`, a `worker.py` w tym czasie budzi pętlę zdarzeń co sekundę, żeby aktualizować pasek postępu.
Nie zostało to zmierzone i nie należy tego traktować jako ustalonej przyczyny.

Po podniesieniu `ONCALL_SOLVER_SECONDS` do 120 s ten sam zakres kończy się sukcesem, ale jakość jest zła (patrz HGH-02).

Przyczyna jest wspólna z BLK-01: model przy 91 dniach jest tak blisko granicy znalezienia czegokolwiek, że jednowątkowe wyszukiwanie bywa po prostu za wolne, żeby zdążyć z pierwszym pełnym rozwiązaniem.

**Naprawa:** naprawić BLK-01, a do czasu naprawy podnieść domyślny `ONCALL_SOLVER_SECONDS` do co najmniej 90 s **oraz** ograniczyć maksymalny zakres pojedynczego uruchomienia w UI do 35 dni.

### HGH-02 Wygenerowany grafik łamie kryterium sprawiedliwości z planu o rząd wielkości

**Waga:** wysoka.
**Kryterium z planu:** `PLAN.md` par. 8, „brak niewyjaśnionej nierówności większej niż jeden dyżur 2X”, czyli maksymalnie 2 punkty rozpiętości.

Szkic 91-dniowy na zakres 2026-10-05 - 2027-01-03, wygenerowany przez aplikację i oceniony **jej własnym endpointem** `GET /api/v1/scheduling/{id}/fairness-impact`.
Wartości „przed” to stan bezpośrednio przed tym uruchomieniem: rozpiętość odchylenia wynosiła wtedy **primary 4.0, secondary 7.0, 11-19 14.0, weekendy 3.0, święta 2.0**.
Soczewka 11-19 była już wcześniej zepsuta przez wcześniejszą publikację 29-dniową (to osobny defekt, HGH-04); soczewka primary była czysta.

| Soczewka | Odchylenie przed | Odchylenie po szkicu | Rozpiętość po |
| --- | --- | --- | --- |
| primary | od -1.54 do +2.46 | od **-6.79** (Piotr Lewandowski) do **+10.21** (Ola Zielińska) | **17.00 pkt** |
| secondary | od -3.59 do +3.41 | od -7.18 do +7.60 | **14.78 pkt** |
| 11-19 | od -5.47 do +8.53 | od -3.77 do +5.23 | 9.00 zmian |
| weekendy | od -1.29 do +1.71 | od -4.73 do **+6.27** | **11.00 dyżurów** |
| święta | od -0.93 do +1.07 | od -1.62 do +1.58 | 3.20 |

Najczystszy pojedynczy wynik: rozpiętość soczewki **primary rośnie z 4.0 na 17.0 w jednym uruchomieniu generatora**.
Ola Zielińska ma po tym szkicu o **17 punktów** więcej ponad swój udział niż Piotr Lewandowski.
Tomasz Szymański ma o **11 weekendów** więcej ponad udział niż Anna Kowalska.
To jest różnica, którą zespół zauważy natychmiast i która podważa cały sens narzędzia.

Nawet po naprawie BLK-01 rozpiętość spada tylko do 11 punktów dla primary i 5 weekendów.
Przy 28 dniach jest znacznie lepiej, ale nadal ponad kryterium.

**Wniosek:** kryterium par. 8 nie jest dziś spełnione dla żadnego zakresu dłuższego niż około miesiąc.
Naprawa BLK-01 zmniejsza problem mniej więcej dwukrotnie, ale go nie zamyka; potrzebne są też HGH-03 i HGH-04, a docelowo zwiększony budżet czasu.

### HGH-03 Normalizacja funkcji celu jest błędna, przez co suwaki wag nie działają

**Waga:** wysoka.
**Miejsce:** `backend/src/oncall/scheduler.py`, `fairness_bound += lens.span`.

`docs/SOLVER.md` obiecuje, że rodziny celów mają „wyliczane z horyzontu górne granice surowego wkładu”, a koszt jednostkowy `max(1, round(10_000 * waga / granica))` sprawia, że „liczba członów danej rodziny nie odwraca znaczenia suwaków”.
Domyślna hierarchia ma wynosić sprawiedliwość 3.0, preferencje 2.0, ciągłość 1.0.

Rodzina sprawiedliwości zawiera człon zakresu `(max - min) * span` oraz jeden człon kwadratowy o zakresie `[0, span^2]` na osobę.
Jej faktyczny maksymalny wkład jest więc **kwadratowy** względem `span`, a granica normalizująca jest liczona jako **suma `span`**, czyli liniowa.

Zmierzone wartości (instrumentacja modelu produkcyjnego, ta sama historia):

| Zakres | Maksymalny wkład sprawiedliwości | preferencji | ciągłości | Faktyczna proporcja |
| --- | --- | --- | --- | --- |
| 28 dni | 22 270 608 | 19 988 | 9 936 | **1114 : 1 : 0.5** |
| 91 dni | 67 290 720 | 19 926 | 9 828 | **3376 : 1 : 0.5** |

Zamiast 3 : 2 : 1 mamy 1114 : 1 : 0.5, a dysproporcja **rośnie wraz z długością horyzontu**.

Podana proporcja jest **ostrożna, czyli zaniżona**.
Sonda liczyła wkład rodziny sprawiedliwości jako `2 * span^2` na soczewkę, a rodzina ma jeden człon zakresu przeskalowany przez `span` oraz jeden człon kwadratowy **na osobę**, czyli `span^2 * (n + 1)`.
Faktyczna dysproporcja jest więc jeszcze kilkukrotnie większa niż zmierzone 1114 : 1.

**Skutek praktyczny.** Suwak sprawiedliwości nie ma użytecznego zakresu.
Ten sam zakres 28 dni, tylko `fairness_weight` zmieniany:

| `fairness_weight` | rozpiętość primary | rozpiętość secondary | rozpiętość weekendów |
| --- | --- | --- | --- |
| 3.0 (domyślnie) | 5 | 4 | 0 |
| 1.0 | 5 | 4 | 0 |
| 0.5 | 6 | 6 | 2 |
| 0.1 | 5 | 6 | 2 |
| 0.0 (wyłączona) | 6 | 8 | 2 |

Zejście z 3.0 na 0.1, czyli trzydziestokrotne osłabienie kryterium, zmienia wynik o jeden dyżur.
Koordynator, który chce świadomie oddać trochę sprawiedliwości za lepsze preferencje, nie ma jak tego zrobić.
UI opisuje wagi tak, jakby relacja między nimi miała znaczenie; nie ma.

**Drugi skutek.** Współczynniki celu sięgają `184 900 * 29 ≈ 5.4 mln` na pojedynczy człon, a zakres celu startuje jako `[-5 419 259, 122 984 832]`.
CP-SAT raportuje przy takim modelu **91 284** nieudanych rozwiązań LP (`Lp debug ... Bad 91'284`).
To jest druga, niezależna od BLK-01, przyczyna tego, że dolne ograniczenie rośnie tak wolno.

**Naprawa.** Zbić granicę do rzeczywistego maksimum rodziny:

```python
# Rodzina sprawiedliwości ma jeden człon zakresu przeskalowany przez span
# oraz jeden człon kwadratowy na osobę, więc jej maksimum jest kwadratowe.
fairness_bound += lens.span * lens.span * (len(lens.deviations) + 1)
```

albo, co jest rozwiązaniem czystszym numerycznie, znormalizować sam człon kwadratowy przez `span`, tak żeby wszystkie człony sprawiedliwości pozostały rzędu `span`.
Drugie podejście dodatkowo zbija zakres współczynników o dwa rzędy wielkości i powinno wyraźnie poprawić relaksację LP.

### HGH-04 Przy domyślnym kotwiczeniu soczewka 11-19 systematycznie się rozjeżdża

**Waga:** wysoka.
**Miejsce:** `backend/src/oncall/scheduler.py`, `fairness_roles = ... if late_shift_anchor == independent else ONCALL_ROLES`.

Przy domyślnej polityce (`late_shift_anchor = secondary`) solver **usuwa soczewkę 11-19 z funkcji celu**.
Uzasadnienie z `docs/SOLVER.md` brzmi: przydział 11-19 jest wtedy „niemal funkcją roli kotwiczącej”, więc wystarczy wyrównać secondary.

To rozumowanie nie jest prawdziwe, bo **punkty za secondary i liczba zmian 11-19 to dwie różne wielkości**.
Dyżur secondary w sobotę daje 2 punkty i zero zmian 11-19.
Dyżur secondary w środę daje 1 punkt i jedną zmianę 11-19.
Wyrównanie punktów secondary nie wyrównuje więc liczby zmian 11-19, i to nie marginalnie.

Prognoza pokazywana przez samą aplikację pod macierzą szkicu, dla zwykłego szkicu 29-dniowego:

| Osoba | 11-19 przed | 11-19 po szkicu | Komentarz aplikacji |
| --- | --- | --- | --- |
| Piotr Lewandowski | +1.13 | **+8.53** | „dalej od równowagi o 7.4” |
| Anna Kowalska | +3.13 | +5.53 | „dalej od równowagi o 2.4” |
| Julia Nowak | -1.87 | -5.47 | „dalej od równowagi o 3.6” |
| Magdalena Woźniak | +0.13 | -3.47 | „dalej od równowagi o 3.34” |

Jedna osoba przejmuje w miesiąc ponad siedem zmian 11-19 ponad swój udział.
W skali roku to około 90 zmian różnicy.
Interfejs sam to raportuje jako pogorszenie i nic z tym nie robi.

**Naprawa.** Zostawić soczewkę 11-19 w celu także przy kotwiczeniu.
Zmierzony efekt na zakresie 91 dni: rozpiętość 11-19 spada z 16 do **8**, kosztem wzrostu rozpiętości weekendów z 5 do 9.
To jest realny kompromis, a nie darmowy zysk, więc właściwym rozwiązaniem jest wprowadzenie soczewki do celu **i** poprawienie normalizacji z HGH-03, żeby oba kryteria dało się wyważyć.
Wariant z obiema poprawkami dał 10 zmian i 7 weekendów, czyli lepszy kompromis niż każda z poprawek osobno.

### HGH-05 Import historii cicho nadpisuje opublikowany grafik

**Waga:** wysoka, integralność danych.
**Miejsce:** `backend/src/oncall/routes/history.py`, `published_at=datetime.now(UTC)`.

Import CSV zapisuje grafik ze statusem `superseded`, ale z `published_at` ustawionym na **moment importu**.
`effective_assignments()` rozstrzyga sloty według `published_at` rosnąco, więc świeżo zaimportowany „historyczny” wiersz jest najnowszy i **wygrywa z realną publikacją**.

Odtworzenie, z nazwiskiem zapisanym **dokładnie** tak jak w zespole, żeby oddzielić ten defekt od HGH-06:

1. Opublikuj grafik obejmujący 23-09-2026 (w tej rundzie: primary Piotr Lewandowski).
2. Zaimportuj CSV z jednym wierszem `2026-09-23,primary,Rafał Kamiński`.
3. Otwórz `Dyżury` na 23-09-2026.

Wynik zmierzony: primary to Rafał Kamiński (`member_id` poprawnie ustawiony), a nie Piotr Lewandowski.
Nadpisanie nie zależy więc od wielkości liter; zależy wyłącznie od `published_at`.
Wersja opublikowanego grafiku **nie została podbita**, nikt nie dostał powiadomienia, w audycie jest tylko `history.imported`, a kanały ICS zaczynają rozsyłać zmianę jako aktualizację.
Podgląd importu nie ostrzega ani słowem, że wiersz koliduje z opublikowanym dniem.

Komentarz w `effective.py` zakłada, że import „przegrywa z każdą realną publikacją tego samego slotu”.
Ta obietnica nie jest dotrzymana.

**Zaostrzenie.** Import nie sprawdza eligibility.
Rafał Kamiński **nie ma** eligibility do roli `primary`, a mimo to powyższy import wstawił go na opublikowany dyżur `primary`.
Dla danych czysto historycznych brak tej kontroli jest obroniony (eligibility mogła się zmienić), ale w połączeniu z nadpisywaniem publikacji stawia na żywym dyżurze osobę, której solver nigdy by tam nie postawił.

**Naprawa.** Import historii nie jest publikacją i nie powinien konkurować z publikacjami na tej samej osi.
Najprostsza poprawka: zapisywać import z `published_at` równym `starts_on` grafiku (albo jawnie `NULL`) i dodać w `effective_assignments()` porządek, w którym `Schedule.name.startswith("Import historii:")` zawsze przegrywa z publikacją.
Niezależnie od tego podgląd importu powinien zgłaszać jako konflikt każdy wiersz, którego data jest już objęta grafikiem opublikowanym.

### HGH-06 Import z inną wielkością liter gubi tożsamość i dyżur znika z rozliczenia

**Waga:** wysoka, integralność danych.
**Miejsce:** `backend/src/oncall/routes/history.py`, walidacja używa `casefold()`, a `commit` używa `member_ids.get(row.assignee_name)`.

Walidacja dopasowuje osobę bez uwzględnienia wielkości liter, a zapis dopasowuje identyfikator **dokładnie**.
Wiersz `2026-09-15,primary,rafał kamiński` przechodzi podgląd jako poprawny, a w bazie ląduje z `assignee_name = 'rafał kamiński'` i `member_id = NULL`.

Skutki dalej w łańcuchu, wszystkie zmierzone:

- **Raport miesięczny dla kadr** ma nadal 10 wierszy, ale ten dyżur **nie jest przypisany nikomu**. Osoba, której go odebrano, po prostu ma o jeden dyżur mniej, a nikt nie ma go więcej.
- **Raport sprawiedliwości** traci te punkty z sum: `primary_points` spadło z 481.0 na 478.0 po zaimportowaniu dwóch takich wierszy.
- Dyżur jest niewidoczny dla dopasowania po `member_id`, więc każda późniejsza zmiana nazwiska ostatecznie go osieroca.

Defekt jest niebezpieczny właśnie dlatego, że nic się nie psuje głośno.
Interfejs pokazuje dyżur, a rozliczenie kadrowe go nie widzi.

**Naprawa.** Użyć w `commit` tego samego dopasowania co w walidacji (`casefold`) i zapisywać `display_name` z bazy, a nie łańcuch z CSV.
Dodatkowo warto odrzucać wiersz z `member_id = NULL` dla osoby, która **jest** w zespole, bo to zawsze oznacza błąd dopasowania, a nie legalny import osoby spoza systemu.

---

## 7. Defekty średnie

### MED-01 Etykieta „[OPUBLIKOWANY]” jest napisem na stałe

`frontend/src/screens/Duty.tsx:21` renderuje `[OPUBLIKOWANY] · {today}` bezwarunkowo.
Po wyczyszczeniu bazy i zaimportowaniu wyłącznie historii (status `superseded`, żadnej publikacji) ekran „Dyżury” nadal deklaruje „[OPUBLIKOWANY]”, chociaż nic opublikowanego nie ma.
Etykieta powinna wynikać ze statusu grafiku rozstrzygającego dzisiejszy dzień i rozróżniać co najmniej „opublikowany”, „historia” i „brak pokrycia”.

### MED-02 Sugerowany zakres zaczyna się dziś i publikacja przepisuje trwający dyżur

`_first_uncovered()` liczy pierwszy dzień nieobjęty **opublikowanym** grafikiem, a import historii ma status `superseded`, więc dzisiejszy dzień jest traktowany jako wolny.
Generator zaproponował 06-09-2026 - 04-10-2026, czyli start **dzisiaj**.

Po publikacji tego szkicu bieżący dyżur zmienił się w trakcie trwania: primary na 06-09-2026 przeszedł z Tomasza Szymańskiego na Annę Kowalską, a worker wysłał do obu maila „Przekazanie numeru on-call: 2026-09-06”.
Formalnie zgodne z par. 6 planu, operacyjnie to pułapka.

Dodatkowo start w niedzielę rozcina blok weekendowy 05-06.09, który ma być nierozdzielny.

**Propozycja.** Liczyć pierwszy dzień nieobjęty **żadnym** rozstrzygającym grafikiem, nigdy nie proponować daty wcześniejszej niż jutro, a jeżeli koordynator świadomie wybierze zakres obejmujący dzień dzisiejszy albo przeszły, pokazać w oknie publikacji jawne ostrzeżenie „ta publikacja zmieni dyżur, który już trwa”.

### MED-03 Ręczna korekta szkicu nie sprawdza reguł odpoczynku

`POST /api/v1/scheduling/{id}/override` sprawdza zakres dat, dzień roboczy dla 11-19, eligibility, twardą niedostępność i rozłączność primary/secondary.
Nie sprawdza limitu trzech dyżurów w oknie siedmiu dni, maksymalnie trzech kolejnych nocy ani dwóch dni przerwy po serii.

`PLAN.md` par. 6 mówi, że korekta „nadal respektuje twarde reguły”.
Rozbicie bloku weekendowego jest świadomie dozwolone i to jest w porządku, ale reguły odpoczynku nie są w planie wymienione jako możliwe do obejścia przez koordynatora.
Minimum to ostrzeżenie w oknie korekty, tak jak przy niedostępności.

### MED-04 Okno korekty szkicu nie pokazuje kontekstu decyzji

Dialog „Anna Kowalska · 07-09-2026” zawiera wyłącznie wybór roli, napis „Obecnie: Julia Nowak” i przycisk.
Nie widać dostępności wybieranej osoby na ten dzień, jej aktualnego bilansu, ani tego, co ta korekta zrobi z prognozą sprawiedliwości.
Prognoza przelicza się dopiero po zapisaniu, więc koordynator poznaje skutek decyzji po jej podjęciu.
Legenda nad macierzą obiecuje wprost, że oznaczenia N, W i C mają pomóc w wyborze, ale w samym oknie korekty ich nie ma.

### MED-05 Wszystkie trzy wagi ustawione na zero są przyjmowane bez ostrzeżenia

`PUT /api/v1/scheduling/policy` z `fairness_weight = 0`, `continuity_weight = 0` i `preference_weight = 0` zwraca 200.
Solver zostaje wtedy bez żadnej funkcji celu i zwraca dowolne rozwiązanie dopuszczalne.
Plan mówi, że „wartość 0 wyłącza tylko dane kryterium miękkie”, i nie przewiduje wyłączenia wszystkich naraz.
Konfiguracja powinna być odrzucona albo opatrzona jawnym potwierdzeniem.

### MED-06 Wyszukiwanie w audycie po cichu gubi zdarzenia logowania

`GET /api/v1/admin/audit?q=Zalogowano` zwraca **0 wyników**, mimo że w bazie jest 88 zdarzeń `auth.login` z dokładnie takim podsumowaniem.
Powodem jest filtr `AuditEvent.action != "auth.login"`, który jest doklejany zawsze, gdy `include_logins` jest wyłączone, a `action` nie jest dokładnie `auth.login`.
Wyszukiwarka odsiewa więc dokładnie te wiersze, których szuka użytkownik.

Ekran `#audyt` łagodzi to podpowiedzią „Rutynowe logowania są w tym widoku ukryte”, ale sam interfejs API nie daje żadnego sygnału.
Poprawka: gdy zapytanie tekstowe albo filtr aktora zwraca zero wyników przy wyłączonych logowaniach, zwracać w odpowiedzi informację o ukryciu, a nie pustą listę bez kontekstu.

---

## 8. Defekty niskie

| Id | Opis | Propozycja |
| --- | --- | --- |
| LOW-01 | Opublikowany grafik zachowuje nazwę „Szkic hybrydowy 06-09-2026 - 04-10-2026”. Na liście i w oknie publikacji widać słowo „Szkic” obok statusu „Opublikowany”. | Przy publikacji zamienić przedrostek na „Grafik”, albo nie wyświetlać nazwy roboczej po zmianie statusu. |
| LOW-02 | Viewer widzi w legendzie macierzy pozycje „N nie mogę”, „W wolę nie”, „C chętnie wezmę”, choć nigdy nie dostaje danych o dostępności. | Budować legendę z faktycznie widocznych stanów. |
| LOW-03 | Brakuje etykiety „Tylko do odczytu” na ekranie viewera, wprost wymaganej w `PLAN.md` par. 6. | Dodać etykietę w nagłówku ekranu „Dyżury” dla roli `viewer` i dla sesji z linku. |
| LOW-04 | Powłoka aplikacji ma dekoracyjny `radial-gradient`, a pasek górny `backdrop-filter: blur(12px)`. `PLAN.md` par. 6 zakazuje wprost „ozdobnych gradientów” i „glassmorphismu”. | Zastąpić jednolitym tłem i nieprzezroczystym paskiem. |
| LOW-05 | Prognoza sprawiedliwości opisuje różnice rzędu 0.02 jako „dalej od równowagi o 0.02”. | Wprowadzić próg istotności i poniżej niego pisać „bez istotnej zmiany”. |
| LOW-06 | Rafał Kamiński ma w kolumnie primary „0 → 0, saldo bez zmiany”, choć w ogóle nie ma eligibility do tej roli. | Pokazywać „nie pełni tej roli” zamiast zera. |
| LOW-07 | Lista zastępców w zamianach jest posortowana alfabetycznie i nieopisana. Wpływ na bilans pojawia się dopiero po wybraniu osoby, a wybór pierwszej z brzegu dał „dalej od równowagi” dla obu stron. | Sortować po wpływie na bilans i oznaczać kandydatów, którym zamiana pomaga. |
| LOW-08 | 29 kolumn nieobsadzonych dni renderuje się jako czerwone „!” na czerwonym tle. Normalny stan „jeszcze nie wygenerowano” wygląda jak awaria. | Odróżnić „poza opublikowanym zakresem” (neutralnie) od „luka w opublikowanym zakresie” (alarmowo). |
| LOW-09 | Lista własnych dyżurów w oknie zamiany nie oznacza dyżuru kolidującego z własnym zgłoszeniem „nie mogę”, choć system o tej kolizji wie i mówi o niej koordynatorowi. | Dodać znacznik przy takim dyżurze i podnieść go na początek listy. |
| LOW-10 | Logo „E/ ON-CALL” łamie się na dwie linie przy szerokości 390 px. | Ustawić `white-space: nowrap` albo skrócić wariant mobilny. |
| LOW-11 | Święto wypadające w weekend liczy się jako **weekend** w raporcie sprawiedliwości i jako **święto** w raporcie miesięcznym dla kadr. Zmierzone na 03-05-2026 (niedziela i Święto Konstytucji): dyżur Marka Wiśniewskiego dodaje w bilansie `+1` do soczewki weekendów i `0` do świąt, a w raporcie kadrowym za maj trafia do kolumny `primary_swieta`. Oba zachowania są zgodne z własnymi zapisami planu (par. 3 i par. 6), ale są ze sobą sprzeczne i nigdzie nie wyjaśnione. | Zostawić rozbieżność, jeżeli wynika z zasad wynagradzania, ale opisać ją w interfejsie obu raportów. |

---

## 9. Bezpieczeństwo

### SEC-01 Endpointy zamian nie mają strażnika roli, opierają się na skutku ubocznym

`backend/src/oncall/routes/swaps.py` zabezpiecza `GET /api/v1/swaps` i `POST /api/v1/swaps` samą zależnością `CurrentUser`.
Rolę `viewer` odcina dopiero `_member_for_user()`, które rzuca **409** „Konto nie jest członkiem zespołu”.

Zmierzone zachowanie dla konta `kontroler.viewer`:

- `GET /api/v1/swaps` zwraca **409**, a nie 403.
- `POST /api/v1/swaps` zwraca **422** (walidacja treści), a nie 403, bo walidacja Pydantic wykonuje się przed sprawdzeniem członkostwa.

Dane nie wyciekają, bo viewer nie ma powiązanego `team_member`.
Ryzyko jest jednak realne: wystarczy, że administrator kiedykolwiek powiąże konto `viewer` z członkiem rotacji (na przykład przy zmianie roli w drugą stronę), a viewer natychmiast zyska dostęp do wniosków o zamianę, których zgodnie z `PLAN.md` par. 2 nie ma prawa widzieć.

**Naprawa.** Dodać jawny `require_roles(UserRole.member, UserRole.coordinator, UserRole.admin)` na routerze zamian, tak jak zrobiono w `routes/scheduling.py` i `routes/admin.py`.
To samo dotyczy `routes/availability.py`, gdzie konto bez `team_member` również dostaje 409 zamiast 403.

**Co przeszło bez zastrzeżeń** (39 sprawdzeń automatycznych, `t_rbac.py`):

- viewer nie dostaje bilansu, szkiców, polityki, administracji, importu ani raportu kadrowego (403 na każdym).
- member nie utworzy szkicu, nie zmieni polityki, nie utworzy konta (403 na każdym).
- koordynator nie utworzy konta ani linku viewer (403).
- `POST` bez tokenu CSRF i z błędnym tokenem: odrzucone.
- konto wyłączone (`dawid.stary`) nie loguje się; błędne hasło zwraca 401 i zapisuje `auth.login_failed`.
- po wylogowaniu `GET /auth/me` zwraca 401.
- prywatność dostępności jest egzekwowana idealnie: viewer widzi 0 wpisów, member wyłącznie swój, koordynator i administrator wszystkie cztery wraz z notatkami.
- link czasowy: jednorazowy token po użyciu zwraca 410, zakres jest przycinany (link 10-12.09 przy zapytaniu 01-30.09 zwraca dokładnie 3 dni), `fairness`, `team`, `swaps` i `admin` zwracają 403, a unieważnienie linku zabija sesję natychmiast (401).
- kanał ICS członka zawiera wyłącznie jego własne dyżury.

---

## 10. Wyniki testów wydajnościowych

### 10.1 Środowisko pomiarowe

Host ma 16 rdzeni i 62 GB RAM, czyli znacznie więcej niż cel.
Wszystkie liczby poniżej zebrano **po sztucznym ograniczeniu kontenerów** do docelowej obwiedni, bo pomiar na pełnym hoście byłby mylący:

| Kontener | CPU | RAM |
| --- | --- | --- |
| `api` | 2.0 | 2 GB |
| `worker` | 2.0 (tyle deklaruje `docker-compose.yml`) | 2 GB |
| `db` | 1.0 | 2 GB |
| `web` | 0.5 | 512 MB |

Razem 5.5 rdzenia i 6.5 GB, czyli nieco powyżej górnego celu 4 rdzeni, ale poniżej 8 GB RAM.
Ograniczenia zostały zdjęte po pomiarach; środowisko wróciło do ustawień z `docker-compose.yml`.

### 10.2 Ścieżki odczytu, 10 równoczesnych użytkowników, 30 s

| Ścieżka | n | p50 | p95 | p99 | max |
| --- | --- | --- | --- | --- | --- |
| `GET /auth/me` | 2669 | 15 ms | 39 ms | 72 ms | 202 ms |
| `GET /calendar` (30 dni) | 2669 | 32 ms | 70 ms | 117 ms | 694 ms |
| `GET /schedules/published` | 2669 | 22 ms | 52 ms | 99 ms | 700 ms |
| `GET /team` | 2669 | 18 ms | 43 ms | 82 ms | 197 ms |

Przepustowość **356 zapytań na sekundę**, zero błędów.
To jest z dużym zapasem powyżej potrzeb dziesięcioosobowego zespołu.

### 10.3 Ścieżki ciężkie: bilans i raport miesięczny, 10 użytkowników, 30 s

| Ścieżka | n | p50 | p95 | p99 | max |
| --- | --- | --- | --- | --- | --- |
| `GET /fairness` | 1475 | 91 ms | 184 ms | 247 ms | 279 ms |
| `GET /calendar` (30 dni) | 1475 | 87 ms | 183 ms | 235 ms | 328 ms |
| `GET /reports/monthly` | 115 | 45 ms | 103 ms | 162 ms | 196 ms |

Przepustowość 102 zapytania na sekundę.
Raport sprawiedliwości liczy pełne okno 12 miesięcy przy każdym wywołaniu i mimo to trzyma p95 poniżej 200 ms na dwóch rdzeniach.
Nie ma tu problemu do naprawy.

### 10.4 Odczyty w trakcie generowania, 12 użytkowników

| Ścieżka | n | p50 | p95 | p99 |
| --- | --- | --- | --- | --- |
| `GET /calendar` | 1291 | 122 ms | 253 ms | 369 ms |
| `GET /fairness` | 1165 | 123 ms | 242 ms | 336 ms |
| `GET /reports/monthly` | 162 | 69 ms | 194 ms | 298 ms |

Degradacja o około 35 % względem pomiaru bez generowania i zero błędów.
Rozdzielenie solvera do osobnego procesu robi dokładnie to, co miało robić: generowanie nie zamraża API.

Zużycie pamięci w szczycie: `api` 274 MB, `worker` 162 MB, `db` 94 MB.
Pamięć nie jest wąskim gardłem nawet przy 2 GB na kontener.

### 10.5 Logowanie (Argon2id), 10 równoczesnych

50 logowań, wszystkie udane: **p50 498 ms, p95 1513 ms, max 1516 ms**.
Przy dwóch rdzeniach i dziesięciu jednoczesnych logowaniach (typowo poniedziałkowy poranek) użytkownik czeka około półtorej sekundy.
Jest to akceptowalne, ale warto to wiedzieć przy doborze sprzętu: Argon2id z domyślnymi parametrami `argon2-cffi` to najdroższa operacja w całym systemie.

### 10.6 Generowanie grafiku

Kontener `worker`, 2 rdzenie, budżet 30 s, ta sama historia.

| Zakres | Tryb | Status | Luka | Rozpiętość primary w horyzoncie |
| --- | --- | --- | --- | --- |
| 28 dni | hybrid | FEASIBLE | 8.8 % | 5 |
| 28 dni | daily | **OPTIMAL w 7.2 s** | 0 % | - |
| 28 dni | weekly | FEASIBLE | 2.0 % | - |
| 35 dni | hybrid | FEASIBLE | 64.2 % | 9 |
| 56 dni | hybrid | FEASIBLE | 54.9 % | - |
| 91 dni | hybrid | FEASIBLE lub **UNKNOWN** | 97.9 % | 17 |

Trzy obserwacje.

Po pierwsze, tryb **dzienny osiąga dowiedzioną optymalność w 7 sekund**, a domyślny hybrydowy nie osiąga jej nigdy.
Różnicą jest rodzina członów ciągłości: `add_abs_equality` na każdą parę dzień-rola-osoba tworzy 531 ograniczeń `kLinMax` przy 28 dniach i 1913 członów przy 91.
To pokazuje, że model **jest** rozwiązywalny do optymalności, gdy nie ma tej rodziny.

Po drugie, jakość załamuje się gwałtownie między 28 a 35 dniami.
Rekomendowany dziś praktyczny zakres jednego uruchomienia to **28-35 dni**, a nie 91.

Po trzecie, 91 dni w budżecie 30 s na dwóch rdzeniach kończy się czasem brakiem jakiegokolwiek grafiku (HGH-01).

### 10.7 Wniosek sprzętowy

Dla dziesięciu użytkowników i dziesięcioosobowej rotacji **2 rdzenie na API, 1 na bazę i 2 na worker w zupełności wystarczą** dla całej części odczytowej, raportowej i transakcyjnej, z wielokrotnym zapasem.

Wąskim gardłem nie jest sprzęt, tylko model solvera.
Po naprawie BLK-01 solver zacznie faktycznie używać przydzielonych mu dwóch rdzeni; dziś używa jednego niezależnie od konfiguracji.
Zwiększanie liczby rdzeni **przed** naprawą BLK-01 nie da nic mierzalnego.

---

## 11. Plan naprawczy

### Etap N1. Odblokowanie solvera (priorytet bezwzględny)

1. **BLK-01** Usunąć `add_assumption` z przebiegu głównego, zastąpić twardym `spacing_enabled == 1` i dodać drugi przebieg na wypadek `INFEASIBLE`.
   Zmierzony efekt: jakość z 300 s dostępna w 30 s dla 28 dni, wartość celu dla 91 dni lepsza 21-krotnie.
2. Przy okazji przejść z `num_search_workers` na `num_workers` i **nie ustawiać obu naraz**.
3. Dodać dwa testy regresyjne:
   - log CP-SAT **nie** zawiera „Forcing sequential search”, albo prostszy odpowiednik: dla ustalonego wejścia wynik z `workers=4` jest istotnie lepszy niż z `workers=1`;
   - **ścieżka zapasowa**: obsada, przy której reguł rozrzedzania nie da się spełnić, nadal daje kompletny szkic z ostrzeżeniem, a nie 409. Ten test jest po naprawie obowiązkowy, bo pomiary z rozdziału 5 dotyczyły wyłącznie pierwszego przebiegu.
4. **HGH-01** Podnieść domyślny `ONCALL_SOLVER_SECONDS` do 90 i zweryfikować 91 dni na dwóch rdzeniach po naprawie punktu 1.

**Kryterium wyjścia:** 91 dni na dwóch rdzeniach kończy się kompletnym grafikiem w każdym z dziesięciu kolejnych uruchomień.

### Etap N2. Jakość rozwiązania

5. **HGH-03** Poprawić `fairness_bound` na rzeczywiste maksimum rodziny, najlepiej przez normalizację członu kwadratowego przez `span`.
   Zweryfikować, że proporcja wkładów rodzin faktycznie odpowiada wagom 3 : 2 : 1, testem jednostkowym na samych granicach, bez uruchamiania solvera.
6. **HGH-04** Włączyć soczewkę 11-19 do funkcji celu także przy kotwiczeniu.
7. Rozważyć zamianę `add_abs_equality` w rodzinie ciągłości na parę nierówności `transition >= previous - current` i `transition >= current - previous`.
   Cel i tak minimalizuje tę zmienną, a znika 531 - 1913 ograniczeń `kLinMax`. W pojedynczych pomiarach efekt był niejednoznaczny, więc przed decyzją trzeba go zmierzyć na serii co najmniej pięciu powtórzeń.
8. **HGH-02** Po punktach 5-7 zmierzyć ponownie rozpiętość odchyleń i skonfrontować z kryterium par. 8.
   Jeżeli 91 dni nadal nie mieści się w dwóch punktach, świadomie zmienić kryterium albo ograniczyć zakres jednego uruchomienia w UI do 35 dni.

**Kryterium wyjścia:** dla zakresu 28-35 dni rozpiętość odchylenia w każdej soczewce nie przekracza 2 punktów przy sprawiedliwej historii wejściowej.

### Etap N3. Integralność danych

9. **HGH-05** Import historii nie może wygrywać z publikacją. Zmienić `published_at` importu i dodać jawny porządek w `effective_assignments()`.
10. **HGH-05** Podgląd importu ma raportować jako konflikt każdy wiersz objęty już opublikowanym grafikiem.
11. **HGH-06** Ujednolicić dopasowanie osoby w `commit` z walidacją i zapisywać `display_name` z bazy.
12. Dopisać test regresyjny: import wiersza z inną wielkością liter dla dnia objętego publikacją musi zostać odrzucony, a nie przyjęty.

**Kryterium wyjścia:** żaden import nie zmienia sumy punktów w raporcie sprawiedliwości ani liczby wierszy w raporcie kadrowym dla dni już opublikowanych.

### Etap N4. Domknięcie średnich

13. **MED-02** Sugerowany start liczony względem wszystkich rozstrzygających grafików, nigdy wcześniej niż jutro, plus ostrzeżenie w oknie publikacji przy zakresie obejmującym dzień trwający.
14. **MED-03** Dodać sprawdzenie reguł odpoczynku w korekcie szkicu, przynajmniej jako ostrzeżenie.
15. **MED-01** Etykieta statusu na ekranie „Dyżury” wyliczana z danych.
16. **MED-04** Rozbudować okno korekty o dostępność, bilans i podgląd skutku.
17. **MED-05** Odrzucać albo potwierdzać konfigurację z wszystkimi wagami zerowymi.
18. **MED-06** Sygnalizować w API ukrycie logowań zamiast zwracać pustą listę.
19. **SEC-01** Dodać jawny `require_roles` na routerach zamian i dostępności.

### Etap N5. Drobne

20. LOW-01 do LOW-11 w kolejności: LOW-03 i LOW-02 (zgodność z planem dla viewera), LOW-08 i LOW-09 (realny wpływ na pracę), LOW-05, LOW-06, LOW-07 (jakość komunikatów), LOW-01, LOW-04, LOW-10, LOW-11 (kosmetyka i dokumentacja).

---

## 12. Co działa bardzo dobrze

Warto to zapisać, bo raport defektów zawsze wygląda gorzej niż produkt.

- **Dostępność.** `axe-core` w regułach WCAG 2.2 AA zwrócił **zero naruszeń** na jedenastu ekranach w obu motywach. Nawigacja klawiaturą po macierzy działa dokładnie tak, jak opisuje podpowiedź: strzałki przesuwają o komórkę, PageDown o tydzień, focus jest widoczny (`outline: 3px solid`). Strona nie przewija się poziomo ani przy 1600 px, ani przy 390 px, a na wąskim ekranie macierz zamienia się w czytelną listę dni.
- **Prywatność danych o dostępności.** Egzekwowana bez jednego wyjątku na wszystkich sprawdzonych ścieżkach, łącznie z linkiem czasowym.
- **Model sprawiedliwości.** Liczy poprawnie, w tym rzecz najtrudniejszą: osoba dołączająca 7 miesięcy po reszcie startuje z bilansem neutralnym (+0.3 / -1.1 / +1.0 / +0.2 / +0.4), a jej udział oczekiwany jest proporcjonalny do 159 dni eligibility, a nie do pełnego roku.
- **Raport miesięczny dla kadr.** Niezależne przeliczenie wszystkich dziesięciu wierszy i siedmiu kolumn dało **zero rozbieżności**. CSV ma BOM, więc otwiera się poprawnie w Excelu.
- **Rozstrzyganie per slot.** Zmierzone wprost: po opublikowaniu grafiku na 01-28.03.2027, a potem krótszego na 09-15.03.2027, dni 05.03 i 25.03 nadal rozstrzygają się z dłuższego grafiku, a 10.03 z krótszego. Pokrycie poza zakresem republikacji nie ginie, a historia jest liczona raz mimo nakładających się publikacji.
- **Tryb tygodniowy.** Reguły rozrzedzania faktycznie w nim nie obowiązują: wygenerowany grafik `weekly` ma serię 7 kolejnych dyżurów jednej osoby, czyli dokładnie tyle, ile zakłada plan.
- **Porównanie wariantów.** `GET /api/v1/scheduling/compare` zwraca metryki, których wymaga plan: wariant dzienny 57 przekazań, najdłuższa seria 2 dni, rozpiętość obciążenia 4; wariant tygodniowy 19 przekazań, seria 7 dni, rozpiętość 5.
- **Cykl życia zamiany.** Wycofanie i odrzucenie wymagają powodu (`422` bez niego, `200` z nim), a stan przechodzi poprawnie do `rejected` i `cancelled`.
- **Wersjonowana eligibility.** Okres z datą końcową zapisuje się (`201`), a nakładający się okres tej samej roli jest odrzucany (`409 Okres eligibility nakłada się na istniejący okres tej roli`).
- **Trwałość śladu audytowego.** Konto koordynatora, które uruchomiło generator, usuwa się bez błędu (`204`, regresja `NEW-02` z rundy 2 zamknięta), wygenerowany szkic zostaje, a w audycie nadal widnieje `schedule.generated` z etykietą „Tymczasowy Koordynator”.
- **Usuwanie szkicu.** `DELETE` zwraca `204`, kolejny `GET` zwraca `404`.
- **Blokowanie optymistyczne przy zamianach.** Zatwierdzenie sprawdza własność konkretnego slotu, a nie wersję całego grafiku, i przy zmianie właściciela automatycznie anuluje wniosek z czytelnym komunikatem. To jest lepsze rozwiązanie niż naiwne `expected_version` i warto je zachować.
- **Transactional outbox.** Powiadomienia trafiają do kolejki w tej samej transakcji co zmiana biznesowa, łącznie z powiadomieniem koordynatorów o kolizji niedostępności z dyżurem.
- **Komunikat o statusie solvera.** „Grafik spełnia wszystkie reguły twarde, ale solver nie zdążył potwierdzić, że jest optymalny” to uczciwy, konkretny komunikat, który nie udaje, że wszystko jest w porządku.
- **Kryteria UX z par. 7 planu.** Bieżący primary, secondary i status 11-19 są widoczne po **0.9 s** od wejścia na stronę główną, bez przewijania i bez kliknięcia (cel: 5 s). Zgłoszenie niedostępności przez członka zespołu zajmuje **3.7 s** interakcji plus 2.5 s ładowania ekranu (cel: 30 s). Wysłanie prośby o zamianę pojedynczego dnia to cztery interakcje z podglądem wpływu na bilans po drodze, znacznie poniżej celu 60 s.
- **Walidacja granic.** Zakres powyżej 91 dni, odwrócone daty, waga 101, link na 31 dni, dostępność na 400 dni, zły format miesiąca, kalendarz na 5 lat: wszystko odrzucone z komunikatem po polsku wskazującym konkretną przyczynę.

---

## 13. Jak odtworzyć

### 13.1 Dane testowe

Skrypty leżą w `docs/qa-suite-4/`:

| Plik | Rola |
| --- | --- |
| `seed_users.py` | tworzy konta, członków rotacji i eligibility; uruchamiany w kontenerze `api` |
| `make_history.py` | generuje sprawiedliwy CSV historii (`ANCHOR_PULL=0.6`) |
| `import_history.py` | podgląd i import przez prawdziwe API |
| `check_fairness.py` | odczyt raportu sprawiedliwości z API |
| `verify_rules.py` | sprawdza wszystkie reguły twarde z `PLAN.md` par. 3 na wskazanym grafiku |
| `t_rbac.py` | 39 sprawdzeń RBAC, CSRF i sesji |
| `t_edge.py` | granice i ścieżki błędów |
| `t_reports.py` | niezależne przeliczenie raportu miesięcznego |
| `t_share_ics.py` | linki czasowe, sesje ograniczone, kanały ICS |
| `t_perf.py` | obciążenie równoczesne z percentylami |
| `bench_variant.py` | pomiar solvera z wariantami źródłowymi modelu |
| `bench_impact.py` | ocena wariantów solvera metryką `fairness-impact` samej aplikacji |
| `axe_scan.sh` | skan `axe-core` po ekranach i motywach |
| `t_gaps.py` | usuwanie szkicu, odrzucenie i wycofanie zamiany, wersjonowana eligibility, usunięcie konta autora generowania |
| `t_gaps2.py` | częściowa republikacja, tryb tygodniowy, porównanie wariantów |
| `login.sh` | logowanie sesji przeglądarki przez prawdziwy formularz (dla `chrome-devtools-axi`) |
| `catalog.md` | pełny, ponumerowany katalog przypadków A1-L5 |
| `bench_solver.py` | wcześniejsza, prostsza wersja pomiaru solvera |

Zrzut bazy sprzed rundy (`backup-before-qa4.sql`) pozostał w katalogu roboczym sesji, poza repozytorium.
`history.csv` to dokładnie ten plik, który zaimportowano w rozdziale 2.

Pełna sekwencja odtworzenia danych:

```bash
docker compose exec -T db psql -U oncall -d oncall -c \
  "TRUNCATE TABLE account_tokens, assignments, audit_events, availability, calendar_events, \
   calendar_feed_tokens, eligibility, notification_outbox, schedule_runs, schedules, \
   scheduling_policies, sessions, share_links, swap_requests, team_members, users \
   RESTART IDENTITY CASCADE;"
docker compose restart api
docker compose exec -T api python - < seed_users.py
ANCHOR_PULL=0.6 python make_history.py history.csv
python import_history.py history.csv
python check_fairness.py
```

### 13.2 Najkrótsze ścieżki ręczne dla nowych defektów

**BLK-01.** Ustaw `ONCALL_SOLVER_LOG=true`, wygeneruj dowolny szkic w trybie `hybrid` lub `daily` i poszukaj w logu kontenera `worker` linii `Forcing sequential search as assumptions are not supported in multi-thread.` oraz `Starting search at ... with 1 workers.`.
Następnie zmień `ONCALL_SOLVER_WORKERS` na 1 i na 8 i porównaj wynikowe wartości celu: będą identyczne.

**HGH-01.** Zaloguj się jako `ola.zielinska`, w generatorze wpisz zakres `04-01-2027` - `04-04-2027` i uruchom.
Przy domyślnym budżecie 30 s i kontenerze `worker` z `cpus: 2.0` uruchomienie kończy się błędem `UNKNOWN`.

**HGH-02.** Wygeneruj szkic 91-dniowy (z podniesionym budżetem, żeby w ogóle powstał) i zjedź do sekcji „Wpływ szkicu na sprawiedliwość”.
Porównaj skrajne wartości w kolumnie PRIMARY.

**HGH-03.** W „Ustawienia generowania” zmień wagę sprawiedliwości z 3 na 0.1, zapisz i wygeneruj ten sam zakres ponownie.
Wynik będzie praktycznie taki sam jak przy 3.

**HGH-04.** Wygeneruj dowolny szkic przy domyślnym kotwiczeniu `secondary` i spójrz na kolumnę „11-19” w prognozie sprawiedliwości.
Co najmniej jedna osoba będzie miała opis „dalej od równowagi” o kilka zmian.

**HGH-05 i HGH-06.** Jako `ola.zielinska` przejdź do `Administracja → Import historii` i wgraj plik:

```csv
service_date,role,assignee_name
2026-09-15,primary,rafał kamiński
```

Podgląd zgłosi plik jako poprawny.
Po imporcie otwórz `Dyżury` na 15-09-2026: primary zmieni się z osoby z opublikowanego grafiku na `rafał kamiński` małymi literami.
Otwórz `Administracja → Raport miesięczny` za 2026-09: tego dyżuru nie ma u nikogo.

**MED-01.** Wyczyść bazę, zaimportuj samą historię i otwórz ekran „Dyżury”: etykieta „[OPUBLIKOWANY]” jest widoczna mimo braku publikacji.

**MED-06.** Jako `admin` otwórz `Administracja → Audyt`, wpisz w wyszukiwarce `Zalogowano` i nie włączaj przełącznika „Pokaż zwykłe logowania”: wynik będzie pusty.

---

## 14. Zestawienie z wcześniejszymi rundami

Katalog testów zbudowano niezależnie, a raporty z rund 1-3 przeczytano dopiero po zakończeniu testów.
Porównanie:

**Znalezione niezależnie, pokrywają się z otwartymi defektami z rundy 3:**

- HGH-01 odpowiada `HGH-08` z rundy 3 („dla części zakresów 91-dniowych solver nie znajduje żadnego rozwiązania”). Ta runda dodaje przyczynę: BLK-01.
- MED-03 dotyczy tego samego obszaru co `MED-15` z rundy 3 (korekta pojedynczej komórki), ale innej luki: `MED-15` był o obsadzeniu slotu tą samą osobą i został naprawiony, a MED-03 dotyczy niesprawdzanych reguł odpoczynku.

**Potwierdzone jako naprawione:**

- `MED-17` z rundy 3: zgłoszenie niedostępności na dzień z dyżurem zwraca teraz ostrzeżenie w odpowiedzi, wyświetla baner „1 osoba ma dyżur w dniu zgłoszonej niedostępności” i wysyła powiadomienie do koordynatorów.
- `NEW-01` z rundy 2: filtr audytu `auth.login` działa i zwraca 88 zdarzeń; ekran ma przełącznik i podpowiedź. Pozostaje MED-06, dotyczący samego API.
- `NEW-04` z rundy 2: filtry „Rola” i „Status” na ekranie osób mają pełną szerokość.
- `NEW-05` z rundy 2: podgląd raportu miesięcznego pokazuje wszystkie kolumny rozliczeniowe i zgadza się co do wiersza z CSV.
- `LOW-07` z rundy 3: nazwy szkiców zawierają tryb rotacji i zakres, więc się nie duplikują.
- `NEW-02` z rundy 2: usunięcie konta, które kiedykolwiek uruchomiło generator, zwraca `204`, a nie `500`.
- `MED-15` z rundy 3: `POST /api/v1/calendar/override` z osobą, która już pełni tę rolę tego dnia, zwraca teraz `422 Ta osoba już pełni tę rolę tego dnia`.
- `MED-16` z rundy 3: okno publikacji ma nowy tekst z liczbą dni i zdaniem „Wcześniejszy grafik zachowuje ważność poza tym zakresem”.
- `LOW-09` z rundy 3: baner luk odmienia poprawnie („1 dzień jest poza opublikowanym zakresem”, „29 dni pozostaje poza opublikowanym zakresem”).
- `LOW-11` z rundy 3: schematy żądań mają `extra="forbid"`; `POST /api/v1/scheduling/runs` z polem `rotation_mode` w treści zwraca `422 extra_forbidden` zamiast po cichu je ignorować.

**Nowe w tej rundzie:** BLK-01, HGH-02, HGH-03, HGH-04, HGH-05, HGH-06, MED-01, MED-02, MED-04, MED-05, SEC-01 oraz cała lista LOW.

---

## 15. Uwagi metodyczne i ograniczenia

- Pomiary solvera są niedeterministyczne z założenia. Każdą liczbę w rozdziale 5 i 10.6 zebrano co najmniej dwukrotnie, ale porównania między wariantami modelu (na przykład wpływ zamiany `add_abs_equality`) opierają się na pojedynczych przebiegach i przed decyzją projektową wymagają serii powtórzeń.
- `axe-core` wykrywa około jednej trzeciej naruszeń WCAG. Zero naruszeń automatycznych nie jest równoważne zgodności z AA; testy z czytnikiem ekranu i z użytkownikami nie były częścią tej rundy.
- Testy wykonano na danych syntetycznych o rozmiarze zgodnym z celem (10 osób, 10 użytkowników). Zachowanie przy 50 osobach w rotacji nie było badane i przy obecnym modelu solvera należy się spodziewać dalszego pogorszenia.
- W trakcie rundy inny użytkownik zalogowany jako `admin` w osobnej przeglądarce zmienił tryb rotacji na `daily` i uruchomił własne generowanie. Polityka została przywrócona do `hybrid` przed pomiarami; zdarzenie jest widoczne w audycie o 07:24 i nie wpłynęło na żadną z podanych liczb.
- Ograniczenia CPU nałożone na potrzeby pomiarów zostały zdjęte, a kontenery odtworzone z `docker-compose.yml`. `ONCALL_SOLVER_SECONDS` wrócił do 30. Dane testowe z rozdziału 1 i 2 pozostawiono w bazie, żeby można było odtwarzać defekty ręcznie.
- **Tabela z rozdziału 2 opisuje stan bezpośrednio po imporcie i nie odtworzy się dziś.** W trakcie rundy na tych samych danych opublikowano grafik 06-09-2026 - 04-10-2026, wykonano jedną korektę koordynatora na 07-09-2026, zatwierdzono jedną zamianę na 11-09-2026 oraz opublikowano grafiki na marzec 2027. Suma punktów `primary` w oknie kończącym się 30-09-2026 wynosi przez to dziś 479, a nie 481 jak zaraz po imporcie. Żeby odtworzyć dokładnie liczby z rozdziału 2, trzeba powtórzyć całą sekwencję z rozdziału 13.1 na czystej bazie.
- W bazie zostały szkice pomocnicze użyte w testach (`05-10-2026 - 03-01-2027`, `04-01-2027 - 04-04-2027`, `07-09-2026 - 04-10-2026` dzienny, para wariantów `07-06-2027 - 04-07-2027`). Można je usunąć z ekranu generatora; nie wpływają na żaden opublikowany grafik.
