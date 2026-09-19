# PLAN NAPRAWCZY 6

Plan odpowiada na ustalenia z [docs/QA-REPORT-6.md](QA-REPORT-6.md).
Kolejność jest ustalona według zmierzonego zysku na jednostkę ryzyka, a nie według wagi defektu.
Każda pozycja ma warunek odbioru wyrażony pomiarem, który można powtórzyć.

## Kolejność wykonania

| Etap | Pozycje | Sens etapu |
| --- | --- | --- |
| 0 | N1 | Jedna zmienna środowiskowa, natychmiastowy zysk jakości generowania |
| 1 | N2, N3 | Naprawa metryki, żeby solver celował w tę samą tarczę co raport |
| 2 | N4, N5 | Odblokowanie zamian, czyli podstawowej ścieżki członka zespołu |
| 3 | N6 | Naprawa prognozy, na której opiera się decyzja o publikacji |
| 4 | N7 | Luka funkcjonalna: niedostępność w imieniu innej osoby |
| 5 | N8, N9 | Przepustowość workera i przewidywalność czasu |
| 6 | N10 do N13 | Czytelność bilansu i ergonomia korekty |
| 7 | N14 | Drobne poprawki zbiorczo |

---

## Etap 0

### N1: dopasować liczbę workerów CP-SAT do przydziału CPU

Odpowiada na: **BLK6-03**.

**Problem.**
`docker-compose.yml` daje usłudze `worker` `cpus: 2.0` i jednocześnie `ONCALL_SOLVER_WORKERS=8`.
`os.cpu_count()` w kontenerze zwraca 16, bo Python nie widzi limitu cgroup, więc ogranicznik `min(8, os.cpu_count())` też nie pomaga.

**Zmiana.**

1. W `oncall/config.py` wyliczyć domyślną liczbę workerów z **rzeczywistego przydziału**, nie z `os.cpu_count()`:
   odczytać `/sys/fs/cgroup/cpu.max` (cgroup v2) i `/sys/fs/cgroup/cpu/cpu.cfs_quota_us` z `cpu.cfs_period_us` (v1), wziąć `ceil(quota / period)`, a przy braku limitu użyć `len(os.sched_getaffinity(0))`.
   Wynik ograniczyć do przedziału od 1 do 8.
2. W `docker-compose.yml` usunąć jawne `ONCALL_SOLVER_WORKERS: 8` z usług `api` i `worker`, żeby wyliczenie mogło zadziałać.
   Zmienną zostawić jako świadome nadpisanie.
3. W `docker-compose.yml` dopisać komentarz wiążący `cpus: 2.0` z liczbą workerów, żeby przy zmianie przydziału nikt nie zapomniał o drugiej stronie.
4. Test jednostkowy parsera limitu cgroup dla obu wersji i dla przypadku bez limitu.

**Warunek odbioru.**
Generowanie 28 dni, budżet 15 s, kotwica `secondary`, trzy przebiegi: kryterium spełnione w każdym z nich, rozpiętość `primary` nie większa niż 3,0, czas ścienny nie gorszy niż 25 s.
Pomiar odniesienia z raportu: 3 na 3 niespełnione przy 8 workerach, 3 na 3 spełnione przy 2.

**Ryzyko.** Zerowe. Zmiana nie dotyka modelu ani danych.

---

## Etap 1

### N2: naprawić `horizon_total` dla soczewek obejmujących dwie role

Odpowiada na: **HGH6-06 przyczyna 1**.

**Problem.**
`scheduler.py:523` liczy `horizon_total = sum(weight(day) for day in days if counts(day))`.
Dla soczewek `weekends` i `holidays`, które obejmują `ONCALL_ROLES`, jest to liczba dni, a nie liczba obsadzanych slotów.
Pomiar na realnym szkicu: `horizon_total` wyniósł 8, a przydzielono 16 dyżurów weekendowych.
Ten sam błąd dotyczy `historical_exposure`, a przez to `mean`, `span` i `upper_bounds`.

**Zmiana.**

1. `horizon_total` i odpowiadające mu sumy historyczne przemnożyć przez liczbę ról składających się na soczewkę.
   Najbezpieczniej policzyć je bezpośrednio jako sumę po parach `(dzień, rola)`, tak jak liczone są zmienne decyzyjne, zamiast po samych dniach.
   Wtedy niezgodność nie może wrócić przy dodaniu kolejnej soczewki.
2. Poprawić komentarz „Exactly one person holds each slot, so the deviations always sum to a constant": jest prawdziwy dla soczewek jednorolowych i fałszywy dla dwurolowych.
3. Dodać test, który dla soczewki `weekends` sprawdza, że suma odchyleń po rozwiązaniu jest równa zeru z dokładnością do zaokrągleń.
   To jest niezmiennik, który dziś nie zachodzi i który wyłapie każdą przyszłą regresję tej klasy.

**Warunek odbioru.**
Niezmiennik sumy odchyleń zachodzi dla wszystkich pięciu soczewek.
To jest twardy warunek odbioru tej pozycji: dziś nie zachodzi dla `weekends` i `holidays`, a po poprawce musi zachodzić dla wszystkich.

**Hipoteza do zweryfikowania, nie warunek odbioru.**
Spodziewam się, że rozpiętość `weekends` na horyzoncie 14 dni zejdzie poniżej 4,0, czyli poniżej wartości, której nie ruszył żaden budżet od 5 do 120 sekund.
Jest to wnioskowanie z natury błędu, a nie wynik pomiaru, więc nieosiągnięcie tego progu nie oznacza, że poprawka jest zła.
Zmierzyć po wdrożeniu i dopiero wtedy zdecydować, czy potrzebna jest dalsza praca nad soczewką weekendową.

---

### N3: ujednolicić definicję ekspozycji między solverem a raportem

Odpowiada na: **HGH6-06 przyczyna 2**.

**Problem.**
`scheduler.py:509` w `exposed` wyklucza dni, w których osoba zgłosiła twardą niedostępność.
`fairness._eligible_exposure` ich nie wyklucza.
Ta sama osoba ma inny „uczciwy udział" w obu systemach, więc solver nie może trafiać w kryterium raportu inaczej niż przypadkiem.
Rozbieżność wywiedziono z lektury obu funkcji, a nie z osobnego pomiaru, więc pierwszym krokiem tej pozycji jest zmierzenie jej wielkości na realnym szkicu z osobą nieobecną w środku horyzontu.

**Zmiana.**

Wymaga najpierw **decyzji produktowej**, bo obie definicje da się obronić:

- **Wariant A**: ekspozycja liczy dni niedostępności.
  Osoba na urlopie zachowuje pełny udział oczekiwany, więc po powrocie system dąży do jej nadrobienia.
- **Wariant B**: ekspozycja pomija dni niedostępności.
  Urlop obniża udział oczekiwany proporcjonalnie, więc nie tworzy długu do odrobienia.

Wariant B jest spójny z zapisem z PLAN.md par. 3 o osobie wchodzącej do rotacji („nie próbuje nadrobić całego roku") i z bieżącym zachowaniem solvera.
Rekomenduję B, ale decyzja należy do zamawiającego, bo dotyczy tego, co zespół uzna za sprawiedliwe.

Po decyzji:

1. Wydzielić **jedną** funkcję liczącą ekspozycję i wywoływać ją z obu miejsc, zamiast utrzymywać dwie zgodne implementacje.
   Naturalne miejsce to `oncall.fairness`, bo solver już importuje stamtąd `ACCEPTANCE_POINTS`.
2. Dopisać test wiążący obie strony: dla tego samego zestawu członków, dostępności i okna rozpiętość policzona metryką solvera i metryką raportu nie może różnić się o więcej niż jedną dziesiątą punktu.
   Dziś różnica sięga jednego pełnego punktu (`secondary` 1,00 wobec 2,00).
3. Zaktualizować `docs/SOLVER.md`, gdzie zdanie „roughly a point off the report metric at worst" przestanie być prawdziwe i powinno zniknąć razem z przyczyną.

**Warunek odbioru.**
Dla dziesięciu kolejnych szkiców różnica między rozpiętością wg solvera a wg raportu nie przekracza 0,1 punktu w żadnej soczewce.
Żaden szkic nie kończy się jednocześnie brakiem ostrzeżenia solvera i komunikatem „kryterium niespełnione" na ekranie prognozy.

---

## Etap 2

### N4: umożliwić zamianę roli kotwiczącej razem ze zmianą 11-19

Odpowiada na: **BLK6-01**, część `late_shift_anchor`.

**Problem.**
Zamiana obejmuje jeden slot, a kotwiczenie wiąże dwa.
Skutek: 0 z 28 slotów `secondary` i 0 z 20 slotów 11-19 da się zamienić przy domyślnej kotwicy.

**Zmiana.**

1. Rozszerzyć `SwapRequest` o pojęcie **zamiany sprzężonej**: gdy polityka kotwiczy 11-19, a zamieniany slot to rola kotwicząca albo sama zmiana 11-19, prośba obejmuje **oba sloty tego dnia** i jest rozpatrywana jako jedna decyzja.
   Model danych: albo dodatkowa kolumna `paired_role`, albo wiersz `swap_request_slots` powiązany z prośbą.
   Rekomenduję wiersz zależny, bo otwiera drogę do zamian zakresowych z PLAN.md par. 3 („zamiana może obejmować jedną rolę i dzień, obie role, zakres albo cały tydzień"), których dziś w ogóle nie ma.
2. `substitution_check` uruchamiać na komplecie slotów, nie na pojedynczym.
   Sprzężona zamiana nie łamie wtedy `late_shift_anchor`, bo obie role wędrują razem.
3. Zastępca bez eligibility do 11-19 nie blokuje przejęcia roli kotwiczącej; wtedy 11-19 pozostaje u dotychczasowej osoby, a odstępstwo jest raportowane jako wyjątek kotwiczenia, dokładnie tak jak robi to dziś solver.
4. Interfejs pokazuje wprost, że prośba obejmuje dwa sloty, i wymienia oba przed wysłaniem.

**Warunek odbioru.**
Powtórzenie pomiaru z BLK6-01 przy kotwicy `secondary` daje co najmniej 40 z 48 slotów `secondary` i 11-19 z choć jednym możliwym zastępcą.
Odniesienie: dziś 0 z 48, a przy kotwicy `independent` 40 z 48.

---

### N5: nie oferować zastępców, których nie da się przyjąć, i mówić dlaczego

Odpowiada na: **BLK6-01**, warstwy druga i trzecia, oraz **HGH6-04**.

**Zmiana.**

1. `GET /api/v1/swaps/options` uruchamia `substitution_check` dla każdego kandydata i zwraca wynik przy nim.
   Kandydat, którego przyjęcie łamie regułę twardą, jest albo pominięty, albo zwrócony z jawnym powodem i nieaktywny w interfejsie.
   Rekomenduję drugie: puste okno bez wyjaśnienia jest gorsze niż lista z powodami.
   Koszt: `substitution_check` to jedno okno 21 dni na kandydata; przy dziesięciu osobach to jedno zapytanie i pętla w Pythonie, więc mieści się w budżecie tego endpointu.
   Jeżeli pomiar pokaże inaczej, liczyć leniwie po rozwinięciu listy.
2. `frontend/src/api.ts:479-483` ma przepuszczać tablicę `violations`, nie tylko `message`.
   Ekran zamian pokazuje nazwę reguły, osobę i dni, tak jak robi to już panel ostrzeżeń generatora.
3. Komunikat kończy się następnym krokiem, zgodnie z PLAN.md par. 6: „poproś koordynatora o korektę" albo „wybierz inny dzień".
4. **Rozstrzygnąć sprzeczność z HGH6-04.**
   Tekst na ekranie generatora oraz `docs/SOLVER.md` obiecują, że blok dni wolnych można podzielić zamianą po publikacji, a kod to blokuje.
   Dwie drogi wyjścia:
   - **A**: dopuścić podział bloku przez zamianę, tak jak dopuszcza go korekta koordynatora, czyli z ostrzeżeniem zamiast blokady.
     Odzyskuje 16 slotów weekendowych i jest zgodne z tym, co produkt obiecuje.
   - **B**: zmienić oba teksty i przestać obiecywać ścieżkę, której nie ma.
   Rekomenduję A, bo weekendy to najczęstszy powód proszenia o zastępstwo, ale każda decyzja jest lepsza niż utrzymywanie sprzeczności.

**Warunek odbioru.**
Dla każdego z 76 slotów opublikowanego grafiku liczba oferowanych zastępców, których da się przyjąć, jest równa liczbie oferowanych w ogóle.
Odrzucenie po wysłaniu prośby przestaje być możliwe inaczej niż przez wyścig o ten sam slot.
Po N4 i N5 wariant A: 76 z 76 slotów ma możliwego zastępcę albo jawnie wyjaśniony powód, dlaczego nie ma.

---

## Etap 3

### N6: prognoza sprawiedliwości szkicu musi podstawiać, a nie dodawać

Odpowiada na: **BLK6-02**.

**Problem.**
`routes/scheduling.py:887` liczy wariant „po" jako `historical_duties + draft_duties`.
Dni pokryte jednocześnie przez opublikowany grafik i przez szkic liczą się dwa razy.

**Zmiana.**

1. Przed dodaniem przydziałów szkicu usunąć z `historical_duties` wszystkie pozycje o kluczu `(service_date, role)` występującym w szkicu.
   To odwzorowuje to, co publikacja faktycznie robi: rozstrzyga per slot, a nie sumuje.
2. Wydzielić tę operację jako funkcję `project_duties(historical, draft)` w `fairness_data.py` i użyć jej wszędzie, gdzie prognozuje się skutek niezapisanej zmiany.
   Dziś jest tam już `reassign` dla zamian; obie należą do tej samej rodziny i powinny stać obok siebie.
3. Test regresyjny: szkic w całości pokrywający opublikowany zakres nie może zmieniać sumy punktów w oknie.
   Dziś zmienia ją dokładnie o punkty szkicu (481,0 do 499,0 przy 18,0 punktach szkicu).

**Warunek odbioru.**
Dla szkicu pokrywającego opublikowany zakres suma punktów `primary` w wariancie „przed" i „po" jest identyczna.
Dla szkicu na zakresie nieobjętym niczym wynik nie zmienia się względem dzisiejszego.

---

## Etap 4

### N7: niedostępność wpisywana w imieniu innej osoby

Odpowiada na: **MED6-06**, luka funkcjonalna zgłoszona przez zamawiającego.

**Problem.**
Cały moduł dostępności jest własnościowy (`/availability/me`).
Koordynator nie ma jak zgłosić urlopu za osobę, która jest na urlopie, chora albo bez dostępu do systemu.

**Zmiana.**

**Backend.**

1. Nowe zasoby, obok istniejących, bez zmiany istniejących:
   - `GET /api/v1/availability/members/{member_id}` - odczyt wpisów wskazanej osoby, rola koordynator lub administrator,
   - `POST /api/v1/availability/members/{member_id}` - utworzenie wpisu,
   - `DELETE /api/v1/availability/members/{member_id}/{entry_id}` - usunięcie wpisu.
2. Cała logika biznesowa jest **wspólna z `/me`**: zakaz wpisu w całości w przeszłości, wykrywanie nakładania się zakresów, ostrzeżenie o kolizji z istniejącym dyżurem.
   Wydzielić ją do jednej funkcji i wywołać z obu ścieżek, żeby reguły nie mogły się rozjechać.
   Dzisiejsza implementacja `create_my_availability` nadaje się do tego bez przepisywania.
3. Osobne akcje audytu: `availability.created_on_behalf` i `availability.deleted_on_behalf`, z zapisanym w `details` zarówno wykonawcą, jak i osobą, której wpis dotyczy.
   Ślad audytowy musi rozróżniać „zgłosiłem swój urlop" od „koordynator zgłosił urlop za mnie", bo to dwie różne odpowiedzialności.
4. Powiadomienie do osoby, której wpis dotyczy, przez istniejący outbox: „koordynator X zgłosił w Twoim imieniu: nie mogę, 14-09 do 27-09".
   Osoba musi mieć szansę zauważyć, że ktoś zapisał coś w jej imieniu, i zaprotestować.
   Nowy szablon w `notifications/templates.py`, bez zmian w mechanice dostarczania.
5. Wpis założony w czyimś imieniu jest zwykłym wpisem: członek widzi go na swoim ekranie i może usunąć.
   Nie wprowadzamy wpisów, których adresat nie może cofnąć, bo to zamienia narzędzie planistyczne w narzędzie nadzoru.

**Frontend.**

6. Na ekranie „Moja dostępność" dla koordynatora i administratora dodać selektor osoby, domyślnie ustawiony na siebie, z jawną etykietą przy wyborze kogoś innego: „wpisujesz w imieniu: Beata Lis".
   Etykieta musi być widoczna przy przycisku zapisu, nie tylko na górze formularza, bo formularz jest długi.
7. Lista wpisów pokazuje, kto wpis założył, gdy nie jest to sama osoba.
8. Dla administratora bez powiązanego członka zespołu ekran przestaje zwracać 409 i otwiera się od razu w trybie „w imieniu", bo administrator nie ma własnej dostępności do pokazania.
   To przy okazji usuwa dzisiejsze 409 z `availability/me` dla konta `admin`.

**RBAC.**
Członek nie ma dostępu do nowych zasobów (403).
Viewer nie ma dostępu (403).
Koordynator i administrator mają dostęp do wszystkich członków rotacji.
Notatka o powodzie pozostaje widoczna wyłącznie dla koordynatora, administratora i samego zainteresowanego, dokładnie jak dziś.

**Warunek odbioru.**
Koordynator zgłasza urlop w imieniu `beata.lis`, wpis jest widoczny na jej ekranie, jest respektowany przez generator jako twarde ograniczenie, w audycie widnieje jako `availability.created_on_behalf` z obiema osobami, a Beata dostaje powiadomienie i może wpis usunąć.
Członek próbujący tego samego dostaje 403.

---

## Etap 5

### N8: rozdzielić generowanie od dostarczania powiadomień

Odpowiada na: **HGH6-05**.

**Problem.**
`worker_cycle()` wykonuje `drain_outbox`, `process_schedule_run` i `scan_handover` sekwencyjnie, a generowanie blokuje pętlę na cały czas rozwiązywania.
Zmierzone: powiadomienie o zamianie czekało 70 sekund, drugi koordynator czekał 70 sekund na start.

**Zmiana.**

1. Rozdzielić pętlę workera na **dwa niezależne zadania asyncio**: jedno obsługuje outbox i przypomnienia w stałym rytmie, drugie przejmuje zadania generowania.
   Nie wymaga to nowego procesu ani kolejki: `process_schedule_run` już dziś wykonuje właściwe liczenie w `anyio.to_thread.run_sync`, więc pętla powiadomień może działać równolegle w tej samej pętli zdarzeń.
2. Umożliwić więcej niż jedno równoczesne generowanie, sterowane konfiguracją i domyślnie ustawione na 1 przy przydziale 2 CPU.
   Blokada `SKIP LOCKED` jest już na miejscu, więc skalowanie w poziomie nie wymaga zmian w SQL.
   Domyślne 1 jest tu świadome: przy dwóch rdzeniach dwa równoległe solvery będą wolniejsze niż dwa kolejne.
3. Ujawnić **pozycję w kolejce** w odpowiedzi `/api/v1/scheduling/runs/{id}` i pokazać ją na ekranie: „w kolejce, 1 zadanie przed Tobą, szacowany start za około 40 s".
   Ekran pokazujący „queued 0%" bez kontekstu prowokuje ponowne uruchomienie.
4. Nie pozwalać zakolejkować drugiego generowania tego samego zakresu, gdy pierwsze jeszcze trwa; zamiast tego pokazać to trwające (**MED6-05**).

**Warunek odbioru.**
Powtórzenie pomiaru z HGH6-05: wiersz outboxu utworzony w trakcie generowania jest przetworzony w czasie nie dłuższym niż dwa cykle workera, niezależnie od długości generowania.
Drugi koordynator widzi swoją pozycję w kolejce od pierwszego odpytania.

---

### N9: nazwać budżet czasu tym, czym jest, i ograniczyć czas całego generowania

Odpowiada na: **HGH6-02**.

**Zmiana.**

1. Poprawić podpowiedź w interfejsie: budżet dotyczy **jednego przebiegu solvera**, a jedno generowanie może wykonać ich kilka.
2. Wprowadzić **twardy budżet całego generowania**, wyliczany z budżetu przebiegu, i pilnować go w `generate_schedule`, odejmując czas już zużyty przed każdym kolejnym przebiegiem.
   Bez tego użytkownik nie ma żadnej kontroli nad czasem oczekiwania: ustawienie 15 s dało 80,5 s, a 120 s dało 225,5 s.
3. Pokazać w interfejsie faktyczny górny limit czasu obok pola budżetu, żeby liczba na ekranie odpowiadała temu, na co użytkownik czeka.
4. Bisekcję szukającą `acceptance_floor` uruchamiać z budżetu pozostałego, a nie ze stałej `FLOOR_PROBE_SECONDS = 25` na próbę.
   Dno kryterium jest informacją pomocniczą i nie może kosztować więcej niż samo rozwiązanie.

**Warunek odbioru.**
Dla każdej kombinacji budżetu od 5 do 120 sekund i horyzontu od 7 do 35 dni czas ścienny nie przekracza zadeklarowanego limitu całkowitego.
Odniesienie: dziś 14 dni przy budżecie 120 s trwa 225,5 s.

---

## Etap 6

### N10: uzgodnić „Razem" w kolumnie i w wierszu

Odpowiada na: **MED6-01**.

Suma kolumny „Razem pkt" wynosi 1212, a wiersz „Razem" pokazuje 960; różnica 252 to ukryta soczewka 11-19.
Ustalić jedną definicję i zastosować ją w obu miejscach.
Rekomendacja: oba liczą wyłącznie kolumny widoczne, a ukryty składnik jest wymieniony w przypisie pod tabelą.
Test frontendowy sprawdzający, że suma kolumny równa się wierszowi podsumowania.

---

### N11: dać kolumnie „Razem pkt" kontekst udziału

Odpowiada na: **MED6-02**.

Kolumna „Razem pkt" jest jedyną bez paska, odchylenia i opisu słownego, a zarazem pierwszą, na którą pada wzrok.
Emil Zając pokazuje 105 wobec 134, bo nie ma eligibility do 11-19, a ta kolumna jest ukryta.
Jakub Polak pokazuje 54, bo jest w rotacji od kwietnia.

Zmiana: „Razem pkt" dostaje wartość oczekiwaną i odchylenie tak samo jak każda inna kolumna, plus krótkie wyjaśnienie przy wartościach odstających z przyczyny strukturalnej: „w rotacji od 01-04-2026" oraz „bez eligibility do 11-19".
Jest to bezpośrednie wykonanie zapisu z PLAN.md par. 6: „Ekran sprawiedliwości nie eksponuje liczb bez kontekstu".

---

### N12: rozdzielić szczegóły dnia od zmiany obsady

Odpowiada na: **MED6-03**.

1. Kliknięcie komórki otwiera **szczegóły dnia**: kto pełni którą rolę, jakie są dostępności, jakie wydarzenia.
   Nazwa osoby z klikniętej komórki jest kontekstem, nie tytułem operacji.
2. Zmiana obsady jest osobnym, jawnym krokiem: „Zmień obsadę" otwiera formularz z wyborem **roli i osoby**, obu wprost, zamiast wyprowadzać osobę z tego, którą komórkę kliknięto.
   Znika wtedy pułapka „klikam dyżur, żeby go zmienić, a przycisk jest wyłączony".
3. Dodawanie wydarzenia przenieść z okna osoby do nagłówka dnia, bo wydarzenie jest bytem całodniowym.
4. Każdy wyłączony przycisk podaje powód wyłączenia.

---

### N13: pokazać skutki korekty koordynatora przed jej zatwierdzeniem

Odpowiada na: **MED6-04**.

Okno potwierdzenia korekty ma pokazywać to samo, co widzi członek zespołu przy zamianie:
wynik `/api/v1/calendar/override/check`, czyli listę reguł, które operacja złamie, oraz wpływ na bilans obu osób z opisem słownym.
Endpoint sprawdzający już istnieje i jest napisany dokładnie w tym celu; brakuje wyłącznie wywołania i prezentacji.
Korekta koordynatora nie wymaga niczyjej akceptacji, więc okno potwierdzenia jest jedynym momentem na refleksję.

---

## Etap 7

### N14: poprawki drobne

| Id | Poprawka |
| --- | --- |
| LOW6-01 | `GET /api/v1/calendar/feeds` zwraca 403 dla konta poza rotacją, spójnie z `POST` |
| LOW6-02 | Jeden kod odpowiedzi dla „konto poza rotacją" na wszystkich ścieżkach, z jednym komunikatem |
| LOW6-03 | Ujednolicić opis notatki: albo „Powód (widzą koordynatorzy)", albo usunąć słowo „prywatna" |
| LOW6-04 | Naprawić białe tło rynienki przewijania w prawym górnym rogu macierzy w motywie jasnym |
| LOW6-05 | Zmienić nagłówek „Szkice w toku" na „Szkice" i zarezerwować „w toku" dla trwających generowań |
| LOW6-06 | Wyrównać nazwy osób w raporcie miesięcznym do lewej, zgodnie z nagłówkiem kolumny |
| LOW6-07 | Dodać `acceptance_floor` do `DraftScheduleResponse` |
| LOW6-08 | `GET /api/v1/schedules/published` albo stosuje `starts_on` i `ends_on`, albo przestaje je przyjmować |
| LOW6-09 | Zweryfikować, czy `suggested-range` ma proponować górną granicę 34 dni, czy wartość bliższą 28 |

---

## Czego świadomie nie zmieniamy

- **Ścieżki odczytu.**
  Przy 10 równoczesnych użytkownikach i przydziale dwóch rdzeni p95 najdroższej ścieżki wynosi 218 ms.
  Optymalizacja pętli w `_eligible_exposure` byłaby przedwczesna.
- **Rozkład oczekiwanego udziału na dwa podokresy** w `scheduler.balance`.
  Sprawdzono: rozjazd wobec wzoru raportu wynosi 0,07 punktu, także dla osoby dołączającej później.
  To nie jest przyczyna niczego i nie warto tego ruszać.
- **Proporcjonalne naliczanie udziału dla nowej osoby.**
  Działa poprawnie i jest jednym z lepiej zrobionych elementów systemu.
- **RBAC, CSRF, prywatność viewera, linki udostępnień, kanały ICS, audyt.**
  Przeszły pełny przegląd bez zastrzeżeń.
- **Domyślnej kotwicy 11-19** nie zmieniamy bez decyzji zamawiającego.
  Liczby przemawiające za `independent` są w QA-REPORT-6 par. HGH6-01; decyzja jest produktowa, nie techniczna.
  Po wykonaniu N4 znika główny argument przeciwko `secondary`, więc decyzję warto podjąć dopiero po tym etapie.

---

## Podsumowanie zależności

```
N1 (workery)  ──────────────────────────────► pomiar bazowy dla N2 i N3
N2 (horizon_total) ──┐
                     ├─► N3 (ekspozycja) ──► wiarygodne kryterium ──► decyzja o kotwicy
N4 (zamiana sprzężona) ──┐
                         ├─► N5 (opcje i komunikaty) ──► ścieżka zamiany działa
N6 (prognoza) ──────────────────────────────► decyzja o publikacji na prawdziwych liczbach
N7 (dostępność w imieniu) ──────────────────► niezależne od reszty, można równolegle
N8 (worker) ──► N9 (budżet) ────────────────► przewidywalny czas i powiadomienia
N10 do N13 ─────────────────────────────────► niezależne, kosmetyka i ergonomia
```

N7 nie zależy od niczego i może iść równolegle z etapem 0 albo 1.
N4 i N5 warto robić razem, bo N5 bez N4 tylko schowa problem, a N4 bez N5 zostawi mylące komunikaty.
