# Erste On-call: przebudowa UI, UX i architektury informacji

## Kontekst

System działa i jest funkcjonalnie bogaty: solver CP-SAT, workflow `draft → proposed → published`, zamiany jednodniowe, bilans 12M, audyt, ICS, linki viewer i raport kadrowy.
Backend jest solidny (38 endpointów, 18 plików testowych, RBAC, optimistic locking, transactional outbox).
Problem leży prawie wyłącznie po stronie prezentacji.

Cały frontend to jeden plik `frontend/src/App.tsx` (1881 linii), który renderuje wszystkie jedenaście paneli jednocześnie w jednym `<main>`.
"Nawigacja" to kotwice `#hash`, więc kliknięcie w "Kalendarz" przewija stronę zamiast zmieniać widok.
Zmierzone: 5302 px wysokości dla admina na 1440×900 i 10 517 px na 390×844, przy czym poniżej 760 px nawigacja znika całkowicie (`styles.css:587` ustawia `.topnav { display: none }` bez żadnego zamiennika).

To bezpośrednio rozjeżdża się z `docs/PLAN.md` §6, który specyfikuje siedem osobnych ekranów, oraz z §7, który stawia cel WCAG 2.2 AA i mierzalne kryteria UX (bieżący primary w 5 sekund, zgłoszenie niedostępności w 30 sekund, zamiana w 60 sekund).
Celem tej pracy jest doprowadzenie warstwy prezentacji do stanu opisanego we własnej specyfikacji produktu, bez naruszania działającej logiki domenowej.

### Zakres weryfikacji

Wszystkie zrzuty ekranu i pomiary w przeglądarce wykonano na koncie `admin`, które ma `has_team_member: false`.
Oznacza to, że `AvailabilityPanel`, `CalendarFeedsPanel` i formularz tworzenia zamiany oceniono z kodu, nie z żywej sesji.
Ustalenia dotyczące tych trzech obszarów są oznaczone niżej jako wywiedzione z kodu.

---

## Ustalenia krytyczne

Poniższe uporządkowano według dotkliwości, nie według obszaru.

### 1. Zmiana trybu rotacji po cichu zapisuje globalną politykę

`App.tsx:1006-1029`.
Selecty "Tryb rotacji" i "Powiązanie 11–19" stoją wewnątrz formularza "Utwórz szkic" i wyglądają jak jego pola wejściowe.
W rzeczywistości `onChange` natychmiast woła `updateMode.mutate`, czyli `PUT /api/v1/scheduling/policy`.
Koordynator, który tylko przegląda opcje przed generowaniem, trwale zmienia globalną politykę zespołu i generuje wpis `policy.updated` w audycie.
Nie ma potwierdzenia, nie ma cofnięcia, nie ma nawet informacji zwrotnej, że coś zapisano.
To najgroźniejsze zachowanie w całej aplikacji i zarazem najtańsze do naprawy.

### 2. Szkic generatora jest nieodzyskiwalny po odświeżeniu

`App.tsx:950` trzyma wynik w `useState`.
`backend/src/oncall/routes/scheduling.py` nie ma żadnego `GET` dla szkiców: są tylko `POST /generate`, `POST /{id}/override`, `GET /{id}/fairness-impact`, `POST /{id}/propose` i `POST /{id}/publish`.
Po przeładowaniu strony szkic zostaje w bazie ze statusem `draft`, ale jest nieosiągalny z UI na zawsze.
Koordynator traci pracę wraz z ręcznymi korektami komórek.

### 3. Brak jakiejkolwiek nawigacji na mobile

Poniżej 760 px `.topnav` znika bez zamiennika.
Użytkownik dostaje stronę o wysokości 10 517 px, po której może się poruszać wyłącznie przewijaniem.
Dla narzędzia dyżurowego, sprawdzanego głównie z telefonu, to blokuje podstawowy scenariusz użycia.

### 4. Główne narzędzie pracy pokazuje 30% własnego zakresu

Macierz kalendarza ma sztywne kolumny 112 px (`styles.css:262-270`) przy domyślnym zakresie 30 dni.
Na 1440 px widać około 9 dni.
Nie ma znacznika "dzisiaj", nie ma granic tygodni ani miesięcy, nagłówek pokazuje `09-03` bez roku.
Kontener przewijany poziomo nie ma żadnej afordancji, więc nie widać, że po prawej jest jeszcze 21 dni.
Komórki są w większości puste: pastylka "P" w polu 112×76 px.

### 5. Luki w pokryciu są niewidoczne

Aplikacja istnieje po to, żeby zagwarantować obsadę, ale dzień bez `primary` wygląda dokładnie tak samo jak dzień obsadzony.
Trzeba przeskanować kolumnę wzrokiem.
`docs/PLAN.md` §6 wprost wymaga, żeby filtry nie ukrywały aktywnych konfliktów bez czytelnego komunikatu.
Dobra wiadomość: `CalendarData.assignments` zawiera już komplet przydziałów dla zakresu, więc wykrycie luk jest w pełni policzalne po stronie klienta.

### 6. Fonty tworzące tożsamość wizualną nigdy się nie ładują

`theme.ts:24` deklaruje `Inter`, a `styles.css` w czterech miejscach `IBM Plex Mono`.
W repozytorium nie ma ani jednego `@font-face`, ani linku do Google Fonts, ani plików fontów.
Cała koncepcja "Dark NOC Console" z monospace zarezerwowanym dla dat, statusów i identyfikatorów po cichu degraduje się na korporacyjnym Windowsie do Segoe UI i Consolas.
Zaprojektowana tożsamość po prostu nie trafia do użytkownika.

### 7. Kontrast przycisku podstawowego łamie WCAG AA

Lighthouse: 3.47:1 dla białego tekstu na `#3a8dde` przy 14 px, wymagane 4.5:1.
Dotyczy motywu ciemnego, który jest domyślny.
Motyw jasny używa `#005ea8` i jest w porządku, więc poprawka ma być punktowa, nie globalna.
`docs/PLAN.md` §7 deklaruje WCAG 2.2 AA jako cel, a Erste jako instytucja finansowa realnie tego wymaga.

### 8. "Kto jest teraz?" nie odpowiada na pytanie operacyjne

Kafle mówią kto, ale nie mówią do kiedy, kto następny ani jak się skontaktować.
`PLAN.md` §3 definiuje pokrycie 19:00-09:00 w dni robocze i całodobowe w dni wolne, ale godzina przekazania nie pojawia się nigdzie w UI.
Kafel ma `min-height: 156px` i `margin-top: 26px` nad nazwiskiem, żeby pomieścić trzy krótkie napisy, z czego data powtarza się cztery razy na ekranie.
To najczęściej oglądany element aplikacji i zarazem najmniej gęsty informacyjnie.

---

## Ustalenia szczegółowe

### Architektura informacji

- Wszystkie panele montują się naraz, więc logowanie odpala równolegle zapytania o grafik, kalendarz, zamiany, politykę, bilans, audyt, linki i feedy niezależnie od tego, czego użytkownik potrzebuje.
- `react-router-dom` jest zainstalowany, ale obsługuje wyłącznie `/share/:token` (`App.tsx:1876-1879`).
- Zakres dat kalendarza, filtr audytu i data bilansu żyją w stanie komponentu, więc nie da się wysłać komuś linku do konkretnego widoku ani cofnąć się przeglądarką.
- Nawigacja nie ma stanu aktywnego.
- Hierarchia jest płaska: "Raport miesięczny" (używany raz w miesiącu) ma dokładnie tę samą wagę wizualną co kalendarz zespołu.
- Brak ekranu administracji osób. `GET /api/v1/admin/users` istnieje bez UI, `GET /api/v1/team` nie jest w ogóle wołany z frontendu, a README przyznaje, że adresy e-mail ustawia się surowym `PATCH`. `PLAN.md` §6 ekran 7 i §8 etap 2 pozostają w połowie niezrealizowane.

### Zamiany

- Jedna płaska lista miesza `pending`, `approved`, `rejected` i `cancelled`. Backend (`swaps.py:177`) sortuje po `created_at desc` bez paginacji i bez filtra statusu, więc lista rośnie w nieskończoność.
- Nic nie mówi koordynatorowi "dwa wnioski czekają na Ciebie". Nie ma licznika, nie ma grupowania, nie ma skrzynki zadań.
- Status renderowany jest jako zwykły szary tekst, czyli najmniej widoczny element wiersza, mimo że jest najważniejszy.
- Pole "Powód odrzucenia / wycofania" wisi w wierszu na stałe dla każdego wniosku wymagającego akcji, także gdy zamierzasz zatwierdzić. Powód należy do dialogu potwierdzenia.
- Brak podglądu wpływu na punkty przed wysłaniem prośby, mimo że `PLAN.md` §4 tego wymaga.
- Select "Mój dyżur" pokazuje `2026-09-14 · PRIMARY` bez dnia tygodnia i bez informacji, jak daleko to jest.

### Generator

- Dwa spiętrzone formularze. Panel wag, czyli rzadko dotykane strojenie z trzyliniowym alertem objaśniającym, jest na stałe rozwinięty nad wynikiem i spycha rezultat pod krawędź ekranu.
- `draft → proposed → published` to dwa nieopisane przyciski w prawym dolnym rogu. Brak steppera, brak informacji kto ma działać na którym etapie.
- Niewykonalność modelu pokazuje się jako surowy chip `CP-SAT: <status>`, podczas gdy `PLAN.md` §3 wymaga pokazania konkretnych konfliktów.

### Bilans sprawiedliwości

- Tabela przekracza szerokość 1440 px i ucina kolumnę "Razem pkt", czyli akurat tę podsumowującą.
- Każda z pięciu komórek powtarza "Wykonane / Uczciwy udział / chip odchylenia", co daje piętnaście fragmentów tekstu na wiersz.
- Brak kodowania wizualnego. "0.5 ponad udział" i "2.5 ponad udział" wyglądają identycznie, dopóki nie przeczytasz liczby, więc nie da się przeskanować wzrokiem kto odstaje.

### Wizualnie i językowo

- Motyw jasny istnieje w `theme.ts` i jest bootstrapowany z `localStorage['mui-mode']` w `index.html`, ale **w UI nie ma żadnego przełącznika**. Funkcja jest martwa.
- W motywie jasnym `.topbar` zachowuje zahardkodowane `rgba(8, 19, 31, 0.88)` i `color: #edf5fc`, przez co chip roli staje się nieczytelny (biały na jasnym). `.eyebrow` w `#79bfff` nie ma kontrastu na jasnym tle.
- `styles.css` używa `!important` około trzydziestu razy, żeby walczyć z MUI, i operuje na surowych hexach zamiast tokenach motywu.
- Eyebrowy są po angielsku nad polskimi nagłówkami: `[OPERATIONAL CALENDAR]`, `[PAYROLL EXPORT]`, `[SINGLE-SLOT OVERRIDE]`, `[READ ONLY]`. Chip roli pokazuje surowy enum `admin`.
- Daty wszędzie w formacie ISO `2026-09-14`, bez dnia tygodnia. Dla aplikacji grafikowej jednostką operacyjną jest "czw 14.09".
- Natywne `<input type="date">` renderują MM/DD/YYYY, a `type="month"` pokazuje "September 2026" w polskim interfejsie.

### Stany, błędy i dostępność

- Alerty sukcesu nigdy nie znikają. "Raport został pobrany." zostaje na ekranie do końca sesji.
- Każdy panel ma własny `<Alert severity="error">` z łańcuchem `?? ?? ??`, który nigdy się nie czyści.
- Akcje destrukcyjne bez potwierdzenia: usunięcie wpisu dostępności, odwołanie linku viewer, odwołanie subskrypcji ICS. Dialog ma tylko publikacja.
- Jednorazowy link i adres ICS pokazują się w alercie z tekstem "zapisz go, nie pokazujemy go ponownie", ale alert znika przy następnym renderze bez wymuszonego potwierdzenia.
- 167 elementów fokusowalnych na jednej stronie, z czego 120 to komórki kalendarza, przy zaledwie czterech osobach w zespole. Przy dziesięcioosobowym zespole to ponad 300 przystanków Tab przed dotarciem do sekcji zamian. Brak nawigacji strzałkami i roving tabindex.
- Lighthouse `label-content-name-mismatch`: `aria-label` komórki to `"Anna Kowalska, 2026-09-06"` i pomija treść dyżuru, więc czytnik ekranu nie mówi co w tej komórce jest.
- Cztery pola formularzy bez `id` i `name` (Tryb rotacji, Powiązanie 11–19, Ważność, Akcja), co psuje `<label for>` i autouzupełnianie.
- `.share-row`, używany też przez panel audytu, powoduje poziome przepełnienie całego dokumentu na mobile (scrollWidth 445 px przy viewport 390 px). Dotyczy admina, bo tylko on renderuje audyt.
- Zero testów frontendowych, mimo że `vitest`, `@testing-library/react` i `jest-dom` są w `devDependencies`, a `PLAN.md` §7 wymaga testów axe, klawiatury, kontrastu i regresji wizualnej.

---

## Plan wykonania

> Fazy 0, 1, 2, 3 i 4 są zrobione i zweryfikowane. Szczegóły i dowody w sekcji "Status realizacji" na końcu dokumentu.

### Faza 0. Poprawki punktowe, natychmiast

Niezależne od reszty, każda to kilka linii.

1. **Odłącz zapis polityki od formularza generatora.** `App.tsx:1006-1029`. Usuń mutację z `onChange`, ale zostaw selecty czytające `policy.data`, i wciel je do istniejącego formularza wag (`App.tsx:1050-1099`), który już poprawnie stosuje wzorzec jawnego zapisu. Jeden przycisk "Zapisz ustawienia generowania" obejmujący tryb, powiązanie 11–19 i trzy wagi, wysyłający wszystkie pięć pól.

   Uwaga: **nie** wystarczy trzymać wyboru w stanie lokalnym bez zapisu. `api.ts:354` pokazuje, że `generateSchedule` wysyła wyłącznie `{starts_on, ends_on}`, a solver czyta tryb rotacji i powiązanie 11–19 z zapisanej polityki. Sam stan lokalny dałby UI pokazujące `weekly`, podczas gdy backend generuje `hybrid`, czyli zamieniłby cichy zapis na jeszcze trudniejszą do wykrycia rozbieżność.

   Zweryfikowane: `PUT /api/v1/scheduling/policy` (`scheduling.py:83-91`) używa strażników `is not None`, więc pominięte pola opcjonalne są zachowywane, a nie zerowane. Obecny formularz wag nie kasuje zatem powiązania 11–19. Scalony formularz i tak powinien wysyłać komplet pól dla jednoznaczności.
2. **Kontrast przycisku.** W `theme.ts` podnieś `dark.palette.primary.main` do wartości dającej 4.5:1 z bielą przy 14 px, albo ustaw `contrastText` na ciemny. Zweryfikuj oba motywy.
3. **Załaduj fonty.** Dodaj self-hostowane `Inter` i `IBM Plex Mono` (`woff2`, `font-display: swap`) przez `@font-face` w `styles.css` plus `<link rel="preload">` w `index.html`. Self-hosting zamiast CDN, bo to aplikacja wewnętrzna banku.
4. **Napraw `aria-label` komórek kalendarza.** `App.tsx:476` i `App.tsx:806`. Etykieta ma zawierać rolę dyżuru, status override lub zamiany i stan dostępności, nie tylko osobę i datę.
5. **Dodaj `id` i `name`** do czterech pól bez identyfikatorów.
6. **Napraw przepełnienie `.share-row`** na mobile: `min-width: 0` na `.grow` i `flex-basis: 100%` dla treści poniżej progu.

### Faza 1. Routing i powłoka aplikacji

To jest kręgosłup. Mobilna nawigacja, stan aktywny, deep-linki, ładowanie danych per ekran i hierarchia zadań wynikają z niego naturalnie, a bez niego każde z nich jest obejściem.

Rozbij `App.tsx` na `frontend/src/screens/` i `frontend/src/components/`, zachowując komponenty jako gotowe cegły (`CalendarMatrix`, `DutyCard`, `FairnessCell`, `ImpactCell`, `CopyButton` są już wydzielone i nadają się do przeniesienia bez zmian).

Trasy zgodnie z ustaleniem:

```
/                → Dyżury: sekcja "Teraz" + macierz
/kalendarz       → macierz, filtry, luki pokrycia
/moje            → dostępność, subskrypcje ICS
/zamiany         → zamiany, widok zależny od roli
/generator       → lista szkiców, kreator, publikacja
/sprawiedliwosc  → bilans 12M
/admin/osoby     → konta, role, eligibility, adresy e-mail
/admin/linki     → linki viewer
/admin/import    → import historii
/admin/raporty   → raport miesięczny CSV
/admin/audyt     → dziennik audytu
/share/:token    → bez zmian
```

Elementy powłoki:

- `AppShell` z topbarem, nawigacją desktop i szufladą mobilną (MUI `Drawer` + `IconButton` z hamburgerem poniżej 760 px).
- Filtrowanie pozycji nawigacji po roli przeniesione z ciała `Dashboard` do jednej deklaratywnej mapy tras. `PLAN.md` §6 wymaga, żeby viewer nie widział pustych pozycji do niedostępnych funkcji.
- Stan aktywny przez `NavLink`.
- Zakres dat, filtr audytu i `as_of` bilansu przenieś do query paramów przez `useSearchParams`, żeby widoki dało się linkować.
- Globalny `Snackbar` na potwierdzenia zamiast alertów sukcesu, które nigdy nie znikają.
- `ErrorBoundary` plus jeden wspólny komponent błędu zamiast per-panelowych łańcuchów `??`.
- `ConfirmDialog` jako współdzielony komponent dla akcji destrukcyjnych, na wzór istniejącego dialogu publikacji z `App.tsx:1138-1160`.

Krytyczne pliki: `frontend/src/App.tsx` (rozbicie), `frontend/src/main.tsx` (router), nowy `frontend/src/screens/*`, nowy `frontend/src/components/*`.

### Faza 2. Ekran Dyżury i macierz kalendarza

**Sekcja "Teraz"** przeprojektowana na gęstą listę zamiast trzech wysokich kafli.
Każdy wiersz: rola, osoba, kontakt, okno pokrycia (19:00-09:00 lub całodobowo według typu dnia), znacznik override lub zamiany, oraz kto przejmuje następny.
Data pojawia się raz w nagłówku sekcji, nie cztery razy.

**Macierz** to główne narzędzie i wymaga najwięcej pracy.

Najpierw budżet szerokości, bo on rozstrzyga resztę decyzji.
Przy `Container maxWidth="lg"` (1200 px) i kolumnie osoby 180 px na 30 dni zostaje około 32 px na kolumnę.
To mieści trzy znaki monospace, więc pełne słowo "PRIMARY" w komórce jest fizycznie niemożliwe przy domyślnym zakresie.
Rozstrzygnięcie: **zostają krótkie kody, ale przestają być zagadką**.

- Ekran `/kalendarz` wychodzi poza `Container` na pełną szerokość okna, a kolumny dostają minimum 44 px (to zarazem minimalny cel dotykowy). Przy 1440 px daje to 180 + 28×44 = 1412 px, czyli 28 z 30 domyślnych dni bez przewijania, zamiast dzisiejszych 9.
- Kody `P`, `S` i `11–19` zostają w komórkach, ale nad macierzą stoi **stała legenda**, a pełna nazwa roli trafia do `aria-label` komórki i do dialogu dnia. To spełnia wymóg `PLAN.md` §6, żeby kolor nie był jedynym nośnikiem informacji: nośnikiem jest kod tekstowy, a legenda go rozszyfrowuje.
- Domyślny zakres zostaje 30 dni zgodnie z `PLAN.md` §6, ale dochodzą strzałki przeskoku o tydzień i cienie krawędziowe, żeby dwa dni poza kadrem były oczywiste, a nie zaskakujące.
- Wyraźna kolumna "dzisiaj", separatory tygodni, nagłówek grupujący miesiąc.
- Wiersz podsumowania pokrycia nad macierzą: dni z brakującym `primary` lub `secondary` podświetlone, plus licznik "3 dni bez obsady" z przejściem do pierwszego. Liczone z `CalendarData.assignments`, bez zmian w backendzie.
- Sortowanie wierszy: najpierw zalogowany użytkownik, potem osoby z dyżurami w zakresie, na końcu reszta. Opcja ukrycia osób bez przydziałów w zakresie.
- Nawigacja klawiaturą po siatce: roving tabindex, strzałki, Home i End, `PageUp` i `PageDown` dla przeskoku tygodnia. Redukuje 120 przystanków Tab do jednego.
- Semantyczna alternatywa tabelaryczna zgodnie z `PLAN.md` §6, jako przełącznik "widok listy" dla wąskich ekranów.

Krytyczne pliki: `frontend/src/components/CalendarMatrix.tsx` (wydzielone z `App.tsx:367-559`), `frontend/src/styles.css` sekcja `.calendar-*`.

### Faza 3. Zamiany jako skrzynka zadań

`/zamiany` to jedna trasa adaptująca się do roli, nie dwa ekrany.
Dzisiejsza nawigacja już pokazuje jedną pozycję "Zamiany" dla `hasTeamMember || coordinator || admin` (`App.tsx:1770-1772`) i tak zostaje.
Członek widzi swoje wnioski i formularz tworzenia, koordynator dodatkowo kolejkę do zatwierdzenia.
Rozbicie tego na `/moje` i `/zamiany` oznaczałoby dwa komponenty renderujące te same wiersze.

- Podział na "Wymaga Twojej akcji", "W toku" i "Zakończone", zwinięte domyślnie dla ostatniej grupy.
- Licznik oczekujących jako badge przy pozycji nawigacji, żeby koordynator widział zaległości bez wchodzenia w ekran.
- Status jako `Chip` z kolorem i ikoną, nie szary tekst.
- Powód odrzucenia i wycofania przeniesiony do `ConfirmDialog`, usunięty z wiersza.
- Select "Mój dyżur" formatuje datę jako "czw 14.09 (za 11 dni) · PRIMARY".
- **Podgląd wpływu na punkty** przed wysłaniem prośby, zgodnie z `PLAN.md` §4.

Backend: nowy `GET /api/v1/swaps/impact?service_date=&role=&replacement_member_id=`, zwracający bilans przed i po dla obu osób.
Wzoruj się na `backend/src/oncall/routes/scheduling.py:429` (`fairness-impact`) i module `backend/src/oncall/fairness.py`, ale to musi być osobny endpoint: istniejący jest zawężony do szkicu i jego wersji.
Backend powinien też przyjąć opcjonalny filtr `status` i paginację w `GET /api/v1/swaps` (`swaps.py:175`), bo lista rośnie bez ograniczeń.

### Faza 4. Generator i cykl życia szkicu

**Backend:** dodaj `GET /api/v1/scheduling/schedules?status=draft,proposed` oraz `GET /api/v1/scheduling/{schedule_id}` w `backend/src/oncall/routes/scheduling.py`.
Autoryzacja jak w istniejących endpointach szkicu, czyli `require_roles(coordinator, admin)`.
Odpowiedź `DraftScheduleResponse`, która już istnieje.
To zamyka lukę, przez którą szkice są dziś nieodzyskiwalne.

**Frontend:**

- Ekran `/generator` otwiera się listą istniejących szkiców i propozycji, z datami, statusem i autorem, zamiast pustym formularzem.
- Panel wag zwinięty w `Accordion` "Ustawienia zaawansowane", zgodnie z `PLAN.md` §6, który nazywa je ustawieniami zaawansowanymi.
- `Stepper` dla `draft → proposed → published` z informacją, kto działa na którym etapie.
- Niewykonalność modelu prezentowana jako lista konkretnych konfliktów zamiast surowego statusu CP-SAT, w miarę tego, co zwraca solver.

Krytyczne pliki: `backend/src/oncall/routes/scheduling.py`, nowy `frontend/src/screens/Generator.tsx`.

### Faza 5. Bilans, administracja i wykończenie

**Bilans:** zwężenie tabeli tak, żeby "Razem pkt" mieściło się na 1440 px, oraz dodanie wizualnego wskaźnika odchylenia (pasek dwukierunkowy wokół zera) obok liczby, żeby dało się skanować wzrokiem.
Redukcja powtórzeń w komórce: "uczciwy udział" do tooltipa lub jednego wiersza nagłówkowego kolumny.

**Administracja osób** (`/admin/osoby`): nowy ekran na istniejących `GET /api/v1/admin/users` i `GET /api/v1/team`.
Lista kont z rolą, przypisaniem do zespołu, eligibility (dane są już w `TeamMemberResponse`) i edycją adresu e-mail przez istniejący `PATCH /api/v1/admin/users/{id}`.
To domyka `PLAN.md` §6 ekran 7 i §8 etap 2.

**Kontakt w sekcji "Teraz"** (backend): rozszerz `AssignmentResponse` w `backend/src/oncall/schemas.py` o `member_id` oraz kontakt, i dołóż do `PublishedSchedule` okno pokrycia dla danego typu dnia.
RBAC: `PLAN.md` §2 wymienia, czego viewer nie widzi, i kontakt nie jest na tej liście, ale nie ma powodu wysyłać go poza zespół. Kontakt widoczny dla `member`, `coordinator` i `admin`, ukryty dla `viewer` oraz sesji z linku. Wzoruj się na gotowym wzorcu `can_view_team_availability` z `backend/src/oncall/routes/calendar.py:130`, który już poprawnie różnicuje payload według roli.

**Wykończenie wizualne:**

- Przełącznik motywu w topbarze, zapisujący do `localStorage['mui-mode']`, którego `index.html` już oczekuje. Dziś motyw jasny jest kompletnie nieosiągalny.
- Przeniesienie zahardkodowanych hexów ze `styles.css` do tokenów motywu, ze zwróceniem szczególnej uwagi na `.topbar` i `.eyebrow` w motywie jasnym.
- Ograniczenie `!important` przez przeniesienie nadpisań do `theme.components`.
- Ujednolicenie języka: polskie eyebrowy, przetłumaczone etykiety ról zamiast surowego enuma.
- Wspólny formater dat pokazujący dzień tygodnia (`czw 14.09`), używany w selektach, listach i dialogach. Monospace zostaje zarezerwowany dla ISO i identyfikatorów, zgodnie z `PLAN.md` §6.
- Skeletony zamiast gołych `CircularProgress`, żeby ograniczyć skoki układu.
- Zaprojektowane stany puste z wezwaniem do działania.

### Faza 6. Testy

`PLAN.md` §7 wymaga testów axe, klawiatury, kontrastu i regresji wizualnej, a we frontendzie nie ma dziś ani jednego pliku testowego, mimo skonfigurowanego `vitest` i `@testing-library/react`.

Minimalny zakres:

- Smoke render każdego ekranu na każdą rolę, weryfikujący że nawigacja nie pokazuje pozycji niedostępnych.
- Test nawigacji klawiaturą po macierzy.
- Test axe na kluczowych ekranach.
- Test regresji: zmiana selecta trybu rotacji nie wywołuje `PUT /policy`.

---

## Weryfikacja

Środowisko: `docker compose up --build`, frontend na `http://localhost:8080`.
Do zaludnienia danymi: `ONCALL_DEMO_PASSWORD='...' python -m oncall.seed_demo`, konta `admin`, `anna`, `marek`, `ola`, `piotr`, `viewer`.
Uwaga: katalog nie jest repozytorium git, więc weryfikacja nie obejmuje kroków gałęzi ani commitów.

Backend:

```bash
cd backend && pytest && ruff check .
```

Frontend:

```bash
cd frontend && npm run lint && npm run build && npm test
```

W przeglądarce, przez `chrome-devtools-axi`, na każdą z ról (`admin`, `coordinator`, `member`, `viewer` oraz sesja z linku `/share/{token}`):

1. **Kryteria z `PLAN.md` §7 zmierzone stoperem:** znalezienie bieżącego primary i 11–19 poniżej 5 sekund, zgłoszenie niedostępnego weekendu poniżej 30 sekund, wysłanie zamiany jednodniowej poniżej 60 sekund.
2. **Wysokość strony:** `document.body.scrollHeight` dla każdego ekranu poniżej trzech wysokości viewportu na 1440×900.
3. **Brak przepełnienia poziomego:** `document.documentElement.scrollWidth === clientWidth` na 390×844 i 1440×900, na każdym ekranie i każdej roli.
4. **Mobile:** szuflada nawigacji otwiera się i prowadzi do każdego dozwolonego ekranu na 390×844.
5. **Macierz:** na 1440 px widocznych co najmniej 28 z 30 domyślnych dni bez przewijania (dziś 9), legenda kodów widoczna, cienie krawędziowe sygnalizują resztę, strzałki przeskoku tygodnia działają, "dzisiaj" jest widoczne, dzień z brakującą obsadą jest oznaczony i policzony.
6. **Klawiatura:** przejście przez całą macierz strzałkami, wejście w komórkę i powrót Tabem do reszty strony bez przechodzenia przez wszystkie komórki.
7. **Lighthouse:** `chrome-devtools-axi lighthouse` z accessibility 100 i zerowymi naruszeniami `color-contrast` oraz `label-content-name-mismatch`. Kategorie SEO i Agentic Browsing pomijamy, bo aplikacja jest celowo `noindex` i wewnętrzna.
8. **Motyw jasny:** przełącznik działa, topbar, chipy i eyebrowy są czytelne, kontrasty przechodzą w obu motywach.
9. **Fonty:** w zakładce Network widoczne żądania `woff2`; `getComputedStyle` na `.date-code` raportuje `IBM Plex Mono`.
10. **Regresja polityki:** zmiana selecta "Tryb rotacji" nie generuje żądania `PUT /api/v1/scheduling/policy` (weryfikacja przez `chrome-devtools-axi network`).
11. **Trwałość szkicu:** wygeneruj szkic, wprowadź ręczną korektę komórki, przeładuj stronę, odnajdź szkic z korektą na liście `/generator`.
12. **Deep-linki:** wklejenie `/kalendarz?od=2026-10-01&do=2026-10-31` w nowej karcie odtwarza dokładnie ten widok; przycisk wstecz działa.

---

## Status realizacji

Aktualizowane w miarę postępu prac.

### Faza 0 - zrobione

| Ustalenie | Stan | Dowód |
| --- | --- | --- |
| Cichy zapis polityki z `onChange` | naprawione | Zmiana selecta "Tryb rotacji" nie generuje już `PUT /api/v1/scheduling/policy` (sprawdzone w zakładce sieci). Tryb i powiązanie 11–19 trafiły do formularza z jawnym przyciskiem "Zapisz ustawienia generowania", a formularz generowania pokazuje, które ustawienia są zapisane i czy są niezapisane zmiany. |
| Kontrast przycisku podstawowego | naprawione | `contrastText: '#08131f'` na ciemnym `primary`: 5.38:1 zamiast 3.47:1. Lighthouse `color-contrast` przechodzi w obu motywach, accessibility 100. |
| Fonty się nie ładują | naprawione | `@fontsource-variable/inter` i `@fontsource/ibm-plex-mono` self-hostowane, serwowane z własnego origin razem z podzbiorem `latin-ext` potrzebnym dla polskich znaków. Uwaga: pakiet rejestruje rodzinę jako `Inter Variable`, więc dotychczasowe `Inter` w `theme.ts` i tak nigdy by nie zadziałało. |
| `aria-label` komórek kalendarza | naprawione | Etykieta zawiera teraz osobę, dzień tygodnia, datę, dzień wolny lub święto, role dyżurów, override lub zamianę oraz stan dostępności. |
| Pola formularzy bez `id` i `name` | naprawione | Lighthouse `label` przechodzi, ostrzeżenia konsoli o `<label for>` zniknęły. |
| Poziome przepełnienie na mobile | naprawione | `scrollWidth` 390 = `clientWidth` 390 przy viewport 390 px (było 445). |

### Faza 1 - zrobione

| Zmiana | Efekt |
| --- | --- |
| Rozbicie `App.tsx` na trasy | 1881 linii w jednym pliku rozdzielone na `lib/`, `components/` i `screens/`; `App.tsx` to teraz same definicje tras. |
| Realne trasy zamiast kotwic | Wysokość strony pulpitu 5302 px → 1077 px (5,9 → 1,1 ekranu). Na każdym ekranie jest teraz jeden `<h1>` zamiast jedenastu. |
| Nawigacja mobilna | Szuflada z hamburgerem poniżej 760 px. Wcześniej nawigacja nie istniała w ogóle. |
| Hierarchia nawigacji | Codzienna praca w pasku (Dyżury, Moje, Zamiany, Generator, Sprawiedliwość), rzadkie operacje pod jednym menu "Administracja". |
| Stan aktywny | `NavLink` podświetla bieżący ekran w pasku i w szufladzie. |
| Deep-linki | Zakres kalendarza w URL: `/?od=2026-10-01&do=2026-10-14` odtwarza widok. Przycisk wstecz działa. |
| Gating tras po roli | Trasa niedostępna dla roli przekierowuje na pulpit zamiast renderować pusty ekran. Backend nadal egzekwuje RBAC. |
| Przełącznik motywu | Motyw jasny był zaimplementowany, ale nieosiągalny z UI. Teraz przełączalny i zapisywany do `localStorage['mui-mode']`, którego `index.html` już oczekiwał. |
| Tokeny motywu | `.topbar` i `.eyebrow` przestały być zahardkodowane; w motywie jasnym chip roli był wcześniej biały na białym. |
| Etykiety ról | Surowy enum `admin` zastąpiony etykietą "Administrator". |

Odstępstwo od zatwierdzonej mapy tras: `/kalendarz` nie jest osobną pozycją nawigacji.
Macierz zespołu stoi na pulpicie bezpośrednio pod sekcją "Teraz", zgodnie z `PLAN.md` §6 ekran 1, więc osobna pozycja prowadziłaby do tego samego widoku.
Trasa `/kalendarz` pozostaje obsłużona jako przekierowanie, żeby starsze linki działały.

### Znane odstępstwo

Lighthouse nadal raportuje `label-content-name-mismatch` na komórkach macierzy.
Reguła (WCAG 2.5.3) wymaga, żeby widoczny tekst był zawarty w nazwie dostępnej, a widoczny tekst to skrót `P` lub `S`, podczas gdy nazwa mówi `PRIMARY` i `SECONDARY`.
Wynika to wprost z decyzji o krótkich kodach wymuszonej budżetem szerokości kolumny i zostanie domknięte w Fazie 2 razem ze stałą legendą.
Kategoria accessibility ma mimo to 100, bo axe waży tę regułę zerem, a sama nazwa dostępna niesie dziś ściśle więcej informacji niż przed zmianą.

### Testy frontendowe - start Fazy 6

Skonfigurowany `vitest` z `jsdom` i wspólnym harnessem `src/test/render.tsx`, który podaje te same providery co realna powłoka.

`src/screens/Swaps.test.tsx` (6 testów) pokrywa bramkowanie akcji, czyli ekran z największą liczbą warunków w aplikacji:
zastępca dostaje "Akceptuję" i "Odrzuć", osoba niezwiązana z wnioskiem nie dostaje nic,
koordynator dostaje "Zatwierdź" dopiero po akceptacji zastępcy, "Odrzuć" jest zablokowane bez podania powodu,
wniosek rozstrzygnięty nie pokazuje żadnych akcji, a ekran sam pobiera opublikowany grafik.

`src/screens/Mine.test.tsx` (3 testy) pokrywa ekran `/moje`, który jest nieosiągalny dla kont spoza rotacji, więc sesja administratora używana do testów ręcznych nigdy go nie renderuje.

### Poprawki wykryte przy okazji

- `SwapPanel` pobiera teraz opublikowany grafik sam. Wcześniej po refaktorze robił to komponent nadrzędny, przez co `GET /api/v1/schedules/published` leciał na każdej trasie, w tym na `/audyt` i `/raporty`. Zweryfikowane: `/audyt` wysyła dziś tylko `auth/me` i `admin/audit`.
- Selecty "Mój dyżur" i "Zastępca" renderowały się bez dzieci, gdy lista była pusta, co dawało ostrzeżenie MUI w konsoli. Dostały jawne, zablokowane pozycje zastępcze, które przy okazji tłumaczą, dlaczego lista jest pusta ("Najpierw wybierz swój dyżur", "Brak dostępnych zastępców").
- Konsola przeglądarki jest teraz czysta. Wcześniej raportowała cztery pola formularzy bez `id` lub `name` i cztery niepoprawne `<label for>`.

### Znane zachowanie do rozstrzygnięcia

Wejście na trasę niedostępną dla roli przekierowuje na pulpit bez komunikatu.
Dla `viewer`, który otworzy zakładkę do `/sprawiedliwosc`, oznacza to ciche wylądowanie na innym ekranie.
Wymóg `PLAN.md` §6, żeby viewer nie widział pozycji nawigacji do niedostępnych funkcji, jest spełniony,
ale ciche przekierowanie to co innego niż brak pozycji w menu i warto docelowo pokazać krótkie wyjaśnienie.

### Faza 2 - zrobione

Macierz kalendarza, czyli podstawowe narzędzie pracy.

| Zmiana | Efekt |
| --- | --- |
| Szerokość kolumn | Kolumny 44 px zamiast 112 px, kolumna osoby 150 px zamiast 180 px, powłoka na `maxWidth="xl"`. Widocznych 26 z 30 domyślnych dni zamiast 9, przy realnej szerokości okna 1350 px. Przy 1440 px mieści się 28 dni. |
| Stała szerokość kolumn | `table-layout: fixed` z `colgroup`. Wcześniej etykieta miesiąca w nagłówku `colSpan` rozciągała kolumny, na które trafiła: dwudniowa grupa października wymuszała ~50 px na kolumnę. |
| Legenda | Stała legenda nad macierzą tłumaczy `P`, `S`, `11–19`, `Z` (zamiana), `K` (korekta), `N`/`W`/`C` (dostępność) oraz `!` (brak obsady). Kody zastąpiły dopiski w rodzaju „· zamiana”, które nie mieściły się w wąskiej kolumnie. |
| Luki w pokryciu | Dzień bez `primary` lub `secondary` dostaje czerwoną flagę `!` w nagłówku, tło ostrzegawcze i wpis w podsumowaniu nad macierzą, z przyciskiem „Pokaż pierwszy”, który przewija i ustawia focus na tej komórce. Liczone po stronie klienta z danych, które ekran i tak pobiera. |
| Znacznik dnia dzisiejszego | Wyróżniona kolumna z etykietą „dziś”. Wcześniej nic nie wskazywało bieżącego dnia. |
| Granice tygodni i miesięcy | Pionowa linia na każdy poniedziałek oraz osobny wiersz nagłówka z nazwą miesiąca i rokiem. Etykieta jest `sticky`, więc nie znika przy przewijaniu w głąb miesiąca, a przy krótkich grupach skraca się do „paź 2026”. |
| Kolejność wierszy | Najpierw zalogowana osoba (z chipem „Ty”), potem osoby z dyżurem w zakresie, na końcu reszta alfabetycznie z polską kolacją. Doszedł przełącznik „Tylko osoby z dyżurem”. |
| Nawigacja klawiaturą | Roving tabindex: 120 komórek to teraz jeden przystanek Tab zamiast 120. Strzałki poruszają po siatce, PageUp i PageDown skaczą o tydzień, Home i End na krańce wiersza. Liczba realnych przystanków Tab na stronie spadła ze 167 do 16. |
| Przeskok o tydzień | Przyciski „Tydzień” w obie strony obok pól zakresu. |
| Skeleton zamiast spinnera | CLS 0,038 (wynik 1) zamiast 0,63. Wcześniej macierz zwijała się do zera na czas ładowania i cała treść pod nią skakała. |
| Podpis tabeli | `<caption>` dla czytników ekranu opisujący zakres i układ osie. |

Zweryfikowane w przeglądarce: nawigacja strzałkami i PageDown przenosi focus dokładnie o tydzień,
„Pokaż pierwszy” ustawia focus na komórce dnia 2026-10-02 i przewija do niej kontener,
`tabbableCells` wynosi 1 przy 120 komórkach, a dokument nie przepełnia się poziomo ani przy 1350 px, ani przy 390 px.

### Testy

24 testy frontendowe w 4 plikach.
Doszły `src/lib/calendar.test.ts` (9 testów: wykrywanie luk w pokryciu, w tym to, że brak zmiany 11–19 nie jest luką, kolejność wierszy, grupowanie miesięcy)
oraz `src/hooks/useGridNavigation.test.tsx` (6 testów: jeden przystanek Tab, strzałki, przeskok tygodnia, brak zawijania na krawędziach, Home i End, programowy `focusCell` używany przez „Pokaż pierwszy”).

### Zasięg zmian we współdzielonym CSS

Klasa `.calendar-matrix` jest używana przez cztery tabele: kalendarz operacyjny, macierz szkicu, tabelę sprawiedliwości i tabelę wpływu szkicu.
Pierwsza wersja zmian z Fazy 2 przeniosła `top` z reguły bazowej do `.month-row` i `.day-row` oraz ustawiła `table-layout: fixed` globalnie na tej klasie.
Skutek: trzy pozostałe tabele straciły przyklejony nagłówek (`position: sticky` z `top: auto` nie przykleja), a macierz szkicu straciła układ nagłówka.

Naprawione przez rozdzielenie odpowiedzialności:

- Reguła bazowa `.calendar-matrix thead th` znów ma `top: 0`, więc tabele z jednowierszowym nagłówkiem działają jak wcześniej.
- `table-layout: fixed` i `min-width: 0` przeniesione na modyfikator `.matrix-grid`, który noszą tylko dwie siatki dni.
- Macierz szkicu dostała tę samą strukturę co kalendarz: `colgroup`, wiersz miesiąca, wiersz dni, separatory tygodni, kolumny 44 px i kompaktowy znacznik `K` zamiast dopisku „· korekta”, który nie mieściłby się w wąskiej kolumnie.

Zweryfikowane w przeglądarce na wszystkich czterech tabelach: `/sprawiedliwosc` ma `headerTop: 0px` i `tableLayout: auto`,
a wygenerowany szkic na `/generator` renderuje się z `tableLayout: fixed`, wierszem miesiąca i kolumnami 44 px.

### Poprawka blokująca w nawigacji klawiaturą

Pierwsza wersja `useGridNavigation` trzymała aktywną komórkę w stanie i nie uzgadniała jej z rozmiarem siatki.
Wystarczyło nacisnąć End przy zakresie 30 dni, a potem skrócić zakres do tygodnia, żeby żadna komórka nie pasowała do aktywnej pozycji,
wszystkie dostawały `tabIndex: -1` i macierz stawała się całkowicie nieosiągalna z klawiatury.
To samo dawało włączenie filtra „Tylko osoby z dyżurem” po ustawieniu focusu w niższym wierszu.

Pozycja jest teraz przycinana przy renderze, a nie tylko przy ruchu.
Test regresji sprawdzono w obie strony: bez poprawki `useGridNavigation when the grid shrinks` nie przechodzi, z poprawką przechodzi.

### Co zostaje z Fazy 2

Osobny „widok listy” dla wąskich ekranów nie powstał.
Macierz jest poprawną semantycznie tabelą z `scope`, `caption` i pełnymi nazwami dostępnymi, i na 390 px przewija się poziomo we własnym kontenerze bez przepełniania dokumentu,
ale alternatywa listowa opisana w `PLAN.md` §6 nadal jest do zrobienia.

### Faza 3 - zrobione

Zamiany przestały być jedną płaską listą.

| Zmiana | Efekt |
| --- | --- |
| Trzy grupy zamiast listy | „Wymaga Twojej akcji”, „W toku” i zwinięte „Zakończone”. Wcześniej cztery rozstrzygnięte wnioski stały w jednym ciągu z tymi, które czekały na decyzję. |
| Licznik w nawigacji | Badge przy pozycji „Zamiany” pokazuje, ile wniosków czeka na Ciebie. Koordynator widzi zaległość bez wchodzenia w ekran. Zapytanie leci tylko dla ról, które mogą działać na zamianie; viewer go nie wysyła. |
| Status jako `Chip` | Kolor plus ikona plus tekst, zamiast najmniej widocznego szarego napisu w wierszu. |
| Powód w dialogu | Pole „Powód odrzucenia / wycofania” zniknęło z wiersza. Nowy współdzielony `ConfirmDialog` zbiera powód dopiero po wybraniu akcji i blokuje potwierdzenie, dopóki powód jest pusty. |
| Czytelne daty | „pon 14.09 · PRIMARY (za 11 dni)” zamiast `2026-09-14 · PRIMARY`, także w selekcie wyboru własnego dyżuru. Nowe `formatDay` i `relativeDay` w `lib/dates.ts`. |
| Podgląd wpływu na punkty | Wymóg `PLAN.md` §4. Po wybraniu dyżuru i zastępcy pokazuje się saldo obu osób przed i po, z kierunkiem zmiany i wagą dnia (1 pkt albo 2 pkt w dzień 2X). |

Backend:

- Nowy `GET /api/v1/swaps/impact`. Nic nie zapisuje. RBAC: viewer dostaje 403, członek zespołu może podejrzeć tylko zamianę, w której sam uczestniczy, koordynator i administrator dowolną.

  Okno prognozy ma tę samą długość (12 miesięcy) i to samo źródło dyżurów co raport sprawiedliwości, ale jest zakotwiczone na dacie dyżuru, a nie na dzisiaj, żeby przenoszony dyżur w ogóle mieścił się w oknie.
  Dla zamiany w przyszłości oznacza to, że „Wykonane” w podglądzie i na ekranie sprawiedliwości mogą się różnić. Podgląd wypisuje więc użyte okno wprost.
- `GET /api/v1/swaps` przyjmuje filtr `status` i paginację. Wcześniej zwracał wszystkie zamiany od początku istnienia systemu, bez ograniczenia.
- Nowy moduł `oncall/fairness_data.py` z współdzielonym oknem, ładowaniem danych i mapowaniem odpowiedzi. `routes/fairness.py` korzysta teraz z niego zamiast własnych kopii, a `reassign()` przenosi jeden slot na inną osobę bez dotykania bazy.

### Testy po Fazie 3

37 testów frontendowych w 5 plikach i 104 backendowe.

Doszły:

- `tests/test_swap_impact.py` (8): punkty przechodzą dokładnie z jednej osoby na drugą i zgadzają się z wagą dnia, podgląd niczego nie zapisuje i nie tworzy wniosku, slot bez opublikowanego przydziału daje 404, obcy członek zespołu dostaje 403, koordynator 200, a `reassign()` rusza wyłącznie wskazany slot.
- `src/lib/swaps.test.ts` (9): kto jest adresatem decyzji na każdym etapie i jak dzielą się grupy.
- `src/components/AppShell.test.tsx` (5): viewer nie widzi pozycji do niedostępnych funkcji i nie odpytuje zamian, koordynator widzi generator i menu administracji, a badge liczy tylko wnioski czekające na zalogowaną osobę.
- `src/screens/Swaps.test.tsx` przepisany (8): grupowanie, brak akcji na wnioskach rozstrzygniętych, powód wymagany w dialogu, wycofanie własnego wniosku, oraz podgląd wpływu, który nie odpytuje backendu, dopóki nie wybrano zastępcy.

### Sprzątanie przy okazji

Usunięto myślniki em z tekstów interfejsu w `Mine.tsx`, `Fairness.tsx`, `DutyCard.tsx` i `DraftScheduleMatrix.tsx`.
Zostaje półpauza w „11–19”, bo to zapis zakresu godzin używany w całym produkcie.

### Faza 4 - zrobione

Szkice generatora przestały ginąć.

Backend:

- `GET /api/v1/scheduling/drafts` zwraca szkice i propozycje bez przydziałów, najnowsze wg daty początku.
- `GET /api/v1/scheduling/{schedule_id}` zwraca jeden grafik z przydziałami. Obie trasy zadeklarowane przed `/{schedule_id}`, żeby literalna ścieżka wygrywała z parametrem.
- Migracja `0011_schedule_created_at` dokłada `created_at` na `schedules`. Kolumna jest nullowalna, więc wiersze sprzed migracji nie wymagają backfillu, a UI po prostu nie pokazuje dla nich daty utworzenia.

Frontend:

| Zmiana | Efekt |
| --- | --- |
| Lista szkiców | `/generator` otwiera się listą istniejących szkiców i propozycji, z zakresem, trybem, wersją, liczbą przydziałów i datą utworzenia. Wcześniej otwierał się pustym formularzem, a wynik żył wyłącznie w `useState`. |
| Otwieranie szkicu | Otwarty szkic siedzi w URL jako `?szkic=<id>`, tak samo jak zakres kalendarza w `?od=/?do=`. Konkretny szkic razem z ręcznymi korektami przeżywa przeładowanie, da się go wysłać linkiem, a przycisk wstecz działa. |
| Stepper cyklu życia | `Szkic → Do akceptacji → Opublikowany` z podpisem, kto działa na którym etapie. Wcześniej były to dwa nieopisane przyciski w prawym dolnym rogu. |
| Ustawienia w akordeonie | Panel wag i trybu zwinięty, z sygnalizacją niezapisanych zmian w nagłówku. Wcześniej stał na stałe rozwinięty nad wynikiem i spychał go pod krawędź ekranu. |
| Status solvera | Wynik inny niż `OPTIMAL` lub `FEASIBLE` daje ostrzeżenie z listą typowych przyczyn zamiast samego surowego chipa. |
| Ograniczona lista | Domyślnie cztery najnowsze szkice plus „Pokaż wszystkie”. |

Zweryfikowane w przeglądarce: po wdrożeniu lista pokazała **26 szkiców**, które do tej pory leżały w bazie i były nieosiągalne z interfejsu.
Część z nich powstała w trakcie testów poprzednich faz. To jest dokładnie ten błąd, który faza miała naprawić.
Otwarcie szkicu przywraca macierz, prognozę sprawiedliwości i stepper.

### Testy po Fazie 4

49 testów frontendowych w 7 plikach i 110 backendowych.

- `tests/test_draft_persistence.py` (6): szkic da się pobrać ponownie po wygenerowaniu, listing znajduje osierocony szkic, propozycje zostają a opublikowane wypadają, ręczna korekta przeżywa przeładowanie, członek zespołu dostaje 403, nieznane id daje 404.
- `src/screens/Generator.test.tsx` (7): lista zamiast pustego formularza, otwieranie po id, stepper z opisem etapów, ostrzeżenie przy statusie solvera bez rozwiązania, zwinięte ustawienia zaawansowane i podpowiedź przy braku szkiców.

### Znane ograniczenie testów

Endpoint publikacji bierze `pg_advisory_xact_lock`, którego SQLite użyty w testach nie potrafi wykonać.
Żaden test nie przechodzi więc przez samą publikację przez API; test listingu ustawia status bezpośrednio w bazie, bo dla filtra liczy się status, a nie droga dojścia do niego.
Pełne pokrycie tej ścieżki wymagałoby testów na PostgreSQL i zostaje do zrobienia.

### Poprawki wykryte przy przeglądzie Fazy 4

- Otwarty szkic był trzymany w `useState`. Po przeładowaniu wracała sama lista, a koordynator musiał szukać swojego szkicu wśród 26 wierszy; linku do konkretnego szkicu nie dało się wysłać. Przeniesione do `useSearchParams`, zgodnie ze wzorcem ustalonym w Fazie 1.
- `Przekaż do akceptacji` i `Opublikuj` unieważniały tylko listę szkiców, nie wpis `['schedule', id]`. Przy globalnym `staleTime` 30 s wejście na inny ekran i powrót w ciągu pół minuty przywracało status sprzed przejścia, stepper cofał się do „Szkic”, a kolejne przejście leciało na niezgodnej wersji. Test regresji sprawdzono w obie strony.
- `confirm()` w zamianach wpadał w gałąź `approve`, gdy lista chwilowo nie miała danych. Członek zespołu trafiłby wtedy na endpoint tylko dla koordynatora i dostał 403. Teraz endpoint wybierany jest wprost ze statusu wiersza.

---

## Plan: zgłoszenia z 2026-09-03

Trzy rzeczy zgłoszone po Fazie 4, uporządkowane według dotkliwości.

### A. Krytyczne: publikacja krótszego zakresu kasuje sąsiednie dni

**Zgłoszenie:** mam zaplanowany miesiąc, generuję i publikuję nowe dwa tygodnie, poprzednie dwa tygodnie znikają.

**Zreprodukowane.** `tests/test_partial_republish.py` pokazuje, że po opublikowaniu drugiej połowy miesiąca piętnaście dni pierwszej połowy traci obsadę w `/api/v1/calendar` i w `/api/v1/schedules/published`.

**Przyczyna.** `publish_schedule` (`routes/scheduling.py`) oznacza jako `superseded` **każdy** opublikowany grafik, który zachodzi na nowy zakres choćby jednym dniem:

```sql
WHERE status = 'published' AND starts_on <= new.ends_on AND ends_on >= new.starts_on
```

Grafik na cały miesiąc zachodzi na nowe dwa tygodnie, więc traci status w całości. Dni, których nowa publikacja nie obejmuje, nie mają już żadnego opublikowanego grafiku.

**Dlaczego nie zostało wykryte.** Endpoint publikacji nie miał żadnego testu, bo brał `pg_advisory_xact_lock`, którego SQLite użyty w testach nie potrafi wykonać. Blokada jest teraz zależna od dialektu (PostgreSQL bierze ją jak dotąd, SQLite pomija, bo i tak serializuje zapisy), dzięki czemu ścieżka publikacji w ogóle da się testować.

**Naprawa.**

1. `publish_schedule` oznacza jako `superseded` wyłącznie grafiki **w całości pokryte** nowym zakresem. Częściowo zachodzące zostają opublikowane.
2. Jedno wspólne rozstrzyganie „który przydział obowiązuje” w nowym module `oncall/effective.py`: dla każdej pary (dzień, rola) wygrywa przydział z najpóźniej opublikowanego grafiku. Dokładnie ten wzorzec jest już poprawnie zaimplementowany w `routes/reports.py`; brakuje go w `/api/v1/schedules/published`, a `routes/calendar.py` ma go w wersji zawężonej do statusu `published`.
3. Rozstrzyganie obejmuje `published` i `superseded`, sortowane po `published_at`. To ważne z dwóch powodów: import historii celowo zapisuje się jako `superseded` (`routes/history.py`), a istniejące grafiki błędnie zsuperseded'owane przez starą regułę **same wrócą do widoku**, bo dla ich niepokrytych dni będą jedynym źródłem. Naprawa leczy więc dane, które już ucierpiały, bez migracji.
4. `fairness_data.load_inputs` przechodzi na to samo rozstrzyganie. Dziś sumuje wszystkie przydziały ze statusem `published` i `superseded` bez deduplikacji, więc po częściowej repulikacji ten sam dyżur liczy się dwa razy.

**Weryfikacja.** Testy z reprodukcji muszą przejść, wraz z testem, że grafik w całości pokryty nadal jest superseded, oraz testem, że fairness nie liczy dnia podwójnie.

### B. Nie da się usunąć szkicu

Po Fazie 4 lista pokazała 26 porzuconych szkiców. Skoro są już widoczne, muszą dać się sprzątnąć.

- Backend: `DELETE /api/v1/scheduling/{schedule_id}`, dozwolone wyłącznie dla statusów `draft` i `proposed`. Próba usunięcia opublikowanego lub zastąpionego grafiku zwraca 409, bo to historia. Operacja audytowana (`schedule.deleted`), przydziały schodzą kaskadą.
- Frontend: przycisk usuwania w wierszu listy szkiców, za wspólnym `ConfirmDialog` (akcja nieodwracalna). Po usunięciu otwartego szkicu widok wraca do listy i `?szkic` znika z adresu.

### C. Ekran administracji osób

`GET /api/v1/admin/users` istnieje bez UI, `GET /api/v1/team` nie jest w ogóle wołany z frontendu, a README przyznaje, że adresy e-mail ustawia się surowym `PATCH`. `PLAN.md` §6 ekran 7 i §8 etap 2 pozostają w połowie niezrealizowane.

Zakres pierwszej wersji, oparty na tym, co backend już udostępnia:

- `/admin/osoby` z listą kont: login, nazwa wyświetlana, rola, status aktywności, adres e-mail, oraz informacja czy konto jest członkiem rotacji.
- Edycja adresu e-mail przez istniejący `PATCH /api/v1/admin/users/{id}`.
- Widok eligibility per osoba i rola, na podstawie `TeamMemberResponse`, które już niesie te dane.
- Pozycja w menu „Administracja”.

Poza zakresem tej iteracji, do osobnej decyzji: zakładanie kont, zmiana roli i edycja eligibility. Backend nie ma dziś na to endpointów, a każdy z nich to realna zmiana uprawnień, więc wymaga własnego projektu i audytu.

### D. Reszta Fazy 5

Bez zmian względem pierwotnego planu: zwężenie tabeli sprawiedliwości (kolumna „Razem pkt” nadal jest ucinana), wskaźnik odchylenia, kontakt i okno przekazania w sekcji „Teraz”, oraz wykończenie językowe i stany puste.

---

## Realizacja zgłoszeń z 2026-09-03

### A. Krytyczne: publikacja krótszego zakresu - naprawione

**Zreprodukowane przed naprawą.** `tests/test_partial_republish.py` pokazał, że po opublikowaniu drugiej połowy miesiąca piętnaście dni pierwszej połowy traci obsadę:

```
AssertionError: days lost their primary after a partial republish:
['2026-09-03', '2026-09-04', ... '2026-09-17']
```

**Co zmieniono.**

1. `publish_schedule` oznacza jako `superseded` wyłącznie grafiki w całości pokryte nowym zakresem (`starts_on >= new.starts_on AND ends_on <= new.ends_on`). Wcześniej warunek brzmiał „zachodzi choćby jednym dniem”, więc grafik na cały miesiąc znikał w całości.
2. Nowy moduł `oncall/effective.py` rozstrzyga per (dzień, rola): wygrywa przydział z najpóźniej opublikowanego grafiku. Ten sam wzorzec był już poprawnie zaimplementowany w `routes/reports.py`; teraz korzystają z niego także `/api/v1/schedules/published`, `/api/v1/calendar` i model sprawiedliwości.
3. Rozstrzyganie obejmuje `published` i `superseded`. Dzięki temu grafiki błędnie zsuperseded'owane przez starą regułę wracają do widoku same, bez migracji danych, a import historii (celowo zapisywany jako `superseded`) nadal działa i przegrywa z każdą realną publikacją.
4. Blokada `pg_advisory_xact_lock` jest teraz zależna od dialektu. PostgreSQL bierze ją jak dotąd, SQLite pomija, bo i tak serializuje zapisy. To odblokowało testowanie ścieżki publikacji, która wcześniej nie miała ani jednego testu - i dlatego ten błąd mógł powstać.

**Efekt uboczny naprawiony przy okazji.** `fairness_data.load_inputs` sumowało wszystkie przydziały ze statusem `published` i `superseded` bez deduplikacji. Po częściowej repulikacji ten sam dyżur liczył się dwa razy: `tests/test_fairness_dedup.py` pokazywał 15 dyżurów zamiast 10. Teraz korzysta z tego samego rozstrzygania.

**Zweryfikowane w działającej aplikacji.** Przy opublikowanym grafiku 2026-09-03 – 2026-10-02 wygenerowano, przekazano i opublikowano zakres 2026-09-20 – 2026-10-02. Po publikacji wszystkie 30 dni ma obsadę (`primaryDays: 30, missing: []`), dni od 20-go pochodzą z nowej publikacji, wcześniejsze ze starej.

### B. Usuwanie szkiców - zrobione

- `DELETE /api/v1/scheduling/{schedule_id}`, dozwolone tylko dla `draft` i `proposed`. Opublikowany lub zastąpiony grafik zwraca 409, bo jest zapisem tego, kto faktycznie dyżurował. Operacja audytowana jako `schedule.deleted`, przydziały schodzą kaskadą.
- Ikona usuwania w wierszu listy szkiców, za wspólnym `ConfirmDialog`. Usunięcie otwartego szkicu zamyka widok i czyści `?szkic` z adresu.
- Zweryfikowane w aplikacji: liczba szkiców spadła z 27 na 26, dialog zamknął się sam.

### C. Ekran „Osoby” - zrobione

`/osoby` w menu Administracja, oparty na istniejących `GET /api/v1/admin/users` i `GET /api/v1/team`.

- Lista kont: nazwa, login, rola konta po polsku, status aktywności, adres powiadomień i uprawnienia do ról dyżurowych.
- Edycja adresu powiadomień przez istniejący `PATCH /api/v1/admin/users/{id}`; puste pole wyłącza powiadomienia.
- Konta spoza rotacji opisane jako „Poza rotacją”.
- `TeamMemberResponse` dostał `user_id`, żeby złączenie kont z członkami rotacji nie opierało się na zgodności nazw wyświetlanych.

Ekran mówi wprost, czego jeszcze nie potrafi: zakładanie kont, zmiana roli i edycja eligibility wymagają nowych endpointów i osobnej decyzji, bo zmieniają zakres dostępu.

### Testy

59 testów frontendowych w 8 plikach i 121 backendowych.

- `tests/test_partial_republish.py` (5): pierwsza połowa przeżywa repulikację drugiej, „dziś” nadal się rozstrzyga, grafik w całości pokryty nadal jest superseded, nowsza publikacja wygrywa swoje dni, a grafik zsuperseded'owany starą regułą wraca do widoku.
- `tests/test_fairness_dedup.py` (1): nakładające się grafiki nie liczą dyżuru dwa razy.
- `tests/test_draft_delete.py` (5): usunięcie szkicu i propozycji, 409 na opublikowanym, 403 dla członka zespołu, wpis w audycie.
- `src/screens/admin/People.test.tsx` (5) i trzy nowe przypadki w `Generator.test.tsx`.

### Konsekwencje naprawy A, znalezione przy autoprzeglądzie

Skoro dwa grafiki mogą być teraz jednocześnie opublikowane, każda ścieżka, która „wybierała jeden grafik”, wymagała sprawdzenia.

**Zamiany celowały w grafik podany przez klienta.** `create_swap` szukał przydziału wewnątrz `schedule_id` z żądania, a ten identyfikator pochodzi z `/schedules/published`, czyli od grafiku obejmującego najwcześniejszy widoczny dzień. Po repulikacji dawało to dwa błędy naraz, oba zreprodukowane w `tests/test_swap_after_republish.py`:

- osoba faktycznie dyżurująca w repulikowanym zakresie dostawała 409 „Ten slot nie należy do Ciebie”,
- osoba, którą nowsza publikacja zdjęła z dyżuru, mogła zgłosić zamianę cudzego już slotu.

Naprawione przez rozstrzyganie właściciela slotu po stronie serwera. `schedule_id` z żądania nie jest już podstawą wyszukiwania.

**Kanał ICS** miał własną, czwartą kopię deduplikacji per slot. Działała poprawnie, ale została zastąpiona wspólnym `effective.py`, żeby subskrybowany kalendarz nie mógł się rozjechać z aplikacją.

Po tych zmianach jedno rozstrzyganie obsługuje pięć ścieżek odczytu: pulpit, kalendarz, raport miesięczny, model sprawiedliwości i kanał ICS.

### Stan po zgłoszeniach

123 testy backendowe i 59 frontendowych, lint i typecheck czyste, accessibility 100, brak przepełnienia poziomego na żadnej trasie.

---

## Format daty i Faza 5

### Format daty: DD-MM-YYYY

**Zgłoszenie:** daty pokazują się jako MM/DD/YYYY.

**Przyczyna.** Natywny `<input type="date">` renderuje się według locale **przeglądarki**, nie strony. Testowa przeglądarka ma `navigator.language = en-US`, więc mimo `<html lang="pl">` pokazywała MM/DD/YYYY. Na polskiej przeglądarce ten sam ekran pokazałby DD.MM.YYYY. Format zależał więc od maszyny użytkownika i aplikacja nie miała na niego wpływu.

**Naprawa.** Wspólne `DateField` i `MonthField` oparte na `@mui/x-date-pickers` z jawnym formatem `DD-MM-YYYY`, niezależnym od locale przeglądarki. Wartość na drucie pozostaje ISO (`YYYY-MM-DD`), czyli to, czego oczekują wszystkie endpointy. Nazwy miesięcy i dni są polskie (`adapterLocale="pl"`).

Zamienione wszystkie natywne pola dat: kalendarz, generator, dostępność, linki viewer, sprawiedliwość oraz miesiąc rozliczenia, który pokazywał „September 2026” po angielsku, a teraz `09-2026`.

Testy `src/components/DateField.test.tsx` (7) sprawdzają kolejność segmentów dzień-miesiąc-rok, renderowanie daty niejednoznacznej (`2026-03-04` musi dać `04-03-2026`), zwracanie ISO przez kalendarz oraz format miesiąca rozliczenia.

### Faza 5: tabela sprawiedliwości

Kolumna „Razem pkt” była ucinana: tabela miała 1304 px w kontenerze 1285 px, bo każda komórka trzymała trzy linie tekstu w kolumnie 160 px.

- Komórka pokazuje teraz `wykonane / uczciwy udział` w jednej linii, a pod spodem pasek odchylenia rosnący od linii środka: w lewo poniżej udziału, w prawo powyżej. Obok paska liczba ze znakiem.
- Nagłówki kolumn mówią, co znaczą obie liczby (`pkt / udział`).
- Kolumny zwężone do 118 px. Tabela ma 878 px i mieści się w całości.
- Kolor nie jest jedynym nośnikiem: liczba ze znakiem i pełny opis w `aria-label` niosą to samo. Kontrast sprawdzony w obu motywach (najniższy 5,1:1 po przyciemnieniu koloru neutralnego z 4,3:1).

### Faza 5: sekcja „Kto jest teraz?”

Kafle odpowiadały tylko na „kto”, co jest najmniej użyteczną częścią pytania w trakcie incydentu.

Backend: nowe pole `current` w `/api/v1/schedules/published` z oknem pokrycia, kontaktem, oznaczeniem override i następnym dyżurnym w danej roli. Nowy moduł `oncall/coverage.py` liczy okno zgodnie z `PLAN.md` §3: 19:00-09:00 w dni robocze, całą dobę w dni wolne, a zmiana 11–19 ma własne okno 11:00-19:00, bo to praca dzienna, a nie dyżur pod telefonem.

RBAC: kontakt widzą `member`, `coordinator` i `admin`. Viewer i sesja z linku dostają nazwiska i godziny bez adresów.

Frontend: kafel pokazuje osobę, okno godzinowe z dniem tygodnia, klikalny adres kontaktowy i „Następnie: <osoba> (za N dni)”. Zniknął 26-pikselowy odstęp, który istniał tylko po to, żeby wypełnić kafel z dwiema informacjami.

Testy `tests/test_current_duty.py` (4): okno i kontakt w odpowiedzi, następny dyżurny w roli, viewer bez kontaktu, oraz czysty test okna pokrycia dla dnia roboczego, weekendu, święta i zmiany 11–19.

### Stan

127 testów backendowych i 66 frontendowych, lint i typecheck czyste, accessibility 100, brak przepełnienia poziomego na żadnej z ośmiu tras.

### Faza 5 domknięta

**Widok listy dni.** `PLAN.md` §6 wymagał responsywnego trybu małych ekranów. Macierz 30 kolumn na telefonie da się tylko przewijać w bok, więc poniżej 760 px kalendarz przełącza się na listę dzień po dniu: data, obsada trzech ról, oznaczenie zamiany lub korekty, dzień 2X, brak obsady i własna dostępność. Przełącznik „Macierz / Lista dni” pozwala wymusić dowolny widok na każdej szerokości, a opis sekcji zmienia się razem z widokiem. Sprawdzone przy 390 px: 30 kart, brak macierzy, brak przepełnienia poziomego; przy 1350 px nadal macierz.

**Stany puste.** Wspólny komponent `EmptyState` zastąpił pojedyncze szare zdania. Mówi, do czego służy lista i co dalej zrobić, zamiast samego „brak danych”. Zastosowany w dostępności, subskrypcjach ICS, zamianach, linkach viewer i audycie.

Na tym kończy się pierwotny plan przeglądu. Otwarte pozostaje wyłącznie to, co zostało zapisane jako świadome ograniczenie: brak testów ścieżki publikacji na PostgreSQL oraz reguła `label-content-name-mismatch` wynikająca z krótkich kodów w macierzy.
