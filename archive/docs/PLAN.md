# Erste On-call - plan produktu i implementacji

## 1. Cel

Wewnętrzna aplikacja ma skrócić przygotowanie grafiku, zapewnić mierzalnie sprawiedliwy podział dyżurów i umożliwić bezpieczne zmiany po publikacji. Obsługuje trzy równoległe przydziały: `primary`, `secondary` oraz zmianę `11–19`.

Domyślny jest tryb hybrydowy; dzienny i tygodniowy pozostają wybieralną konfiguracją. Tydzień jest jedynie bazowym blokiem: każda doba pozostaje osobnym przydziałem, dzięki czemu można zamienić pojedynczy dzień bez naruszania reszty tygodnia.

## 2. Role i bezpieczeństwo

| Rola | Zakres |
| --- | --- |
| `viewer` | Tylko opublikowany grafik: primary, secondary i 11–19 |
| `member` | Viewer plus własna dostępność, preferencje, zamiany i bilans |
| `coordinator` | Generowanie, porównanie, akceptacja, publikacja i zamiany |
| `admin` | Konta, role, eligibility, polityki, import, święta i audyt |

Viewer nie uczestniczy w solverze i nie widzi szkiców, urlopów, powodów niedostępności, punktów, wynagrodzeń, wniosków o zamianę ani ustawień. Stały dostęp otrzymuje przez imienne konto. Administrator może też utworzyć czasowy link związany z odbiorcą, zakresem dat i datą wygaśnięcia (maksymalnie 30 dni). Jednorazowy token linku jest wymieniany na ograniczoną sesję i usuwany z adresu.

Uwierzytelnianie używa sesji `HttpOnly`, `Secure`, `SameSite=Lax`, ochrony CSRF i Argon2id. Backend zawsze egzekwuje RBAC; frontend nie jest granicą bezpieczeństwa. Publikacje i zamiany korzystają z optimistic locking, a wszystkie istotne operacje są audytowane.

## 3. Reguły grafiku

- Każdy dzień ma dokładnie jednego eligible primary i secondary; role muszą należeć do różnych osób.
- Zmiana `11–19` występuje dokładnie raz wyłącznie w polskie dni robocze. W soboty,
  niedziele i dni ustawowo wolne nie jest generowana ani możliwa do dodania ręcznie.
- Eligibility jest wersjonowane osobno dla roli i zakresu dat.
- Urlop i „nie mogę” są twardymi ograniczeniami. „Wolę nie” i „chętnie wezmę” są preferencjami miękkimi.
- Powiązanie zmiany 11–19 jest konfigurowalne: może wymagać tej samej osoby co
  `secondary`, tej samej osoby co `primary` albo działać niezależnie. Dla osoby
  eligible do obu ról zgodność jest twarda. Osoba bez eligibility do 11–19 nie
  blokuje roli kotwiczącej; odstępstwo jest miękko karane i widoczne w wyniku
  generatora. Twarda niedostępność i eligibility zawsze mają pierwszeństwo.
- Pokrycie jest konfigurowalne per typ dnia, początkowo 19:00–09:00 w dni robocze i całodobowo w dni wolne, w `Europe/Warsaw`.
- Tryb tygodniowy wybiera bazową parę poniedziałek–niedziela, lecz zapisuje siedem dziennych przydziałów.
- Tryb hybrydowy premiuje ciągłość tygodnia, ale automatycznie rozbija blok dla twardych ograniczeń lub istotnej nierówności; tryb dzienny nie premiuje ciągłości.
- W trybie dziennym i hybrydowym jedna osoba ma najwyżej 3 dyżury on-call w
  dowolnych 7 kolejnych dniach i minimum 2 dni przerwy po serii co najmniej dwóch
  dni. Drugi dyżur tej samej osoby w tygodniu ISO jest dodatkowo miękko karany.
  Jeżeli obsada i nieobecności uniemożliwiają spełnienie nowych reguł rozrzedzania,
  solver zawiesza je, generuje szkic według pozostałych reguł i pokazuje jawne
  ostrzeżenie. Reguły te nie obowiązują w trybie tygodniowym.
- Pojedynczy szkic obejmuje maksymalnie 35 dni.
  Kryterium odbioru wynosi 3 punkty rozpiętości odchylenia, a celem optymalizacyjnym są 2 punkty.
  Mierzy się je w kroczącym oknie dwunastu miesięcy kończącym się ostatnim dniem szkicu, na
  soczewkach `primary`, `secondary`, weekendy i święta.
  Soczewka 11–19 podlega kryterium wyłącznie przy kotwicy `independent`; przy kotwiczeniu jej
  rozkład jest w celu jedynie rozstrzygaczem remisów.
  Gdy zastana nierówność czyni kryterium nieosiągalnym, generator podaje najniższą osiągalną
  rozpiętość zamiast milczącej porażki.
  Granica 3 uwzględnia niepodzielne bloki weekendowe 2X.
  To samo okno liczy solver i raport; rozjazd między nimi był przyczyną BLK5-01.
- Zamiana może obejmować jedną rolę i dzień, obie role, zakres albo cały tydzień. Zatwierdzona zamiana tworzy override i nie regeneruje pozostałych dni.

Bilans korzysta z faktycznie odbytych dyżurów w kroczącym oknie 12 miesięcy: 1 punkt/X za dzień roboczy oraz 2 punkty/2X za sobotę, niedzielę lub święto. Primary, secondary, weekendy, święta i zmiany 11–19 są raportowane osobno. Przy niezależnej zmianie 11–19 wszystkie te soczewki są także bilansowane przez solver; przy kotwiczeniu soczewka 11–19 pozostaje informacyjna, ponieważ jej przydziały wynikają z roli kotwiczącej. Udział oczekiwany jest proporcjonalny do okresu eligibility. Osoba, która dopiero wchodzi do rotacji, zaczyna z neutralnym bilansem: system nie tworzy jej długu za okres sprzed początku eligibility i nie próbuje „nadrobić” całego roku większą liczbą dyżurów. Od dnia dołączenia otrzymuje udział proporcjonalny do bieżącej dostępnej puli, z uwzględnieniem pozostałych reguł.

Solver najpierw spełnia reguły twarde, a następnie w jednym przebiegu optymalizuje
znormalizowane rodziny celów. Domyślna hierarchia to sprawiedliwość (`3.0`) ponad
preferencjami (`2.0`) i ciągłością (`1.0`). Sprawiedliwość obejmuje rozpiętość oraz
wypukłą karę całego rozkładu, ze szczególną karą dla wartości odstających. Brak
rozwiązania pokazuje konkretne konflikty; solver nigdy nie łamie po cichu reguły twardej.

## 4. Workflow

Grafik przechodzi przez `draft → proposed → published → superseded`. Koordynator porównuje wariant dzienny i tygodniowy wraz z metrykami, a publikacja wymaga jawnej akceptacji.

Jednodniowa zamiana przebiega: wybór daty i roli → wybór eligible zastępcy → podgląd wpływu na punkty → zgoda zastępcy → akceptacja koordynatora → override → aktualizacja e-mail/ICS → przypomnienie o przełączeniu numeru. Punkty i X/2X trafiają do osoby faktycznie dyżurującej.

Import historii CSV przyjmuje datę, osobę, rolę, opcjonalne godziny, zmianę 11–19 oraz informację o zastępstwie. Podgląd wykrywa duplikaty, nieznane osoby i konflikty. Kalendarz polskich świąt pochodzi bezpośrednio z biblioteki `holidays`, wspólnej dla wszystkich ścieżek obliczeniowych.

## 5. Architektura

- Backend: FastAPI, Pydantic, SQLAlchemy 2, Alembic, PostgreSQL.
- Solver: lokalny OR-Tools CP-SAT jako niezależny moduł domenowy.
- Worker: osobny proces dla solvera, importów, e-maili i przypomnień; kolejka i transactional outbox w PostgreSQL.
- Frontend: React, TypeScript, Vite, React Router, TanStack Query, MUI i FullCalendar Standard.
- Kontrakt: wersjonowane REST API/OpenAPI i generowany klient TypeScript.
- Runtime: Docker Compose; nginx serwuje SPA i proxy `/api`, `/auth`, `/calendar`.

Najważniejsze API obejmuje logowanie i sesję, odczyt opublikowanego grafiku, uruchomienia solvera, publikację, zamiany, import historii, kanały ICS oraz zaproszenia viewerów i czasowe udostępnienia.

## 6. Frontend - Dark NOC Console

Domyślny jest ciemny, profesjonalny interfejs operatorski z opcjonalnym motywem jasnym/systemowym. Branding Erste jest delikatny: zatwierdzone logo, firmowy niebieski jako akcent i nazwa „Erste On-call” lub „On-call / EBP Technology”. Dokładne logo, fonty i kolory muszą pochodzić z aktualnego wewnętrznego brand packa.

Monospace służy wyłącznie datom, godzinom, identyfikatorom, logom i statusom (`[DRAFT]`, `[PUBLISHED]`, `[CONFLICT]`). Interfejs nie używa ozdobnych gradientów, glassmorphismu, przypadkowych ilustracji, emoji ani nadmiaru kart. Tokeny semantyczne oddzielają branding, role i statusy. Kolor nigdy nie jest jedynym nośnikiem informacji.

Główne ekrany:

1. **Dyżury** - zwięzłe „Kto jest teraz”, a bezpośrednio pod nim główna macierz osób × dni. Nie ma osobnej listy obsady kolejnych dni.
2. **Grafik** - macierz jako podstawowy widok; szczegóły dnia w drawerze; widoczne dni 2X i override’y.
3. **Moja dostępność** - zakresy „nie mogę”, „wolę nie”, „chętnie wezmę”.
4. **Zamiany** - prowadzony proces z podglądem wpływu i statusem akceptacji.
5. **Generator** - preflight, postęp, porównanie wariantów, konflikty i publikacja.
6. **Sprawiedliwość** - tabela kategorii, odchylenia i przejście do konkretnych dyżurów.
7. **Administracja** - osoby, eligibility, polityki, święta, import, viewerzy, linki i audyt.

Generator bez jawnego zakresu zaczyna od pierwszego dnia nieobjętego opublikowanym
grafikiem i proponuje koniec w niedzielę zamykającą cztery pełne tygodnie
poniedziałek-niedziela (łącznie 28-34 dni). Zakres przekazany świadomie z kalendarza
ma pierwszeństwo. Nazwa szkicu zawiera tryb rotacji i zakres w formacie `DD-MM-YYYY`.

### Macierz kalendarza operacyjnego

Główny widok harmonogramu otrzymuje również wariant macierzowy przypominający kalendarz
operacyjny. Członkowie zespołu znajdują się na osi Y, a kolejne dni wybranego zakresu
na osi X; domyślny zakres to 30 dni. Pierwsza kolumna i nagłówki dat pozostają widoczne
podczas przewijania. Każda kolumna pokazuje datę, skrót dnia tygodnia, weekend lub
polskie święto oraz oznaczenie stawki 2X.

Komórka osoby i dnia łączy czytelne, tekstowe oznaczenia `primary`, `secondary` i
`11–19` z dostępnością: „nie mogę”, „wolę nie” albo „chętnie wezmę”. Override oraz
zatwierdzona zamiana są widoczne jako osobny status, nie tylko kolor. Powody
niedostępności pozostają prywatne: koordynator widzi je w szczegółach, członek tylko
dla własnych wpisów, a viewer nie otrzymuje danych o dostępności.

Kliknięcie komórki otwiera dostępne z klawiatury szczegóły dnia. Członek może stamtąd
rozpocząć standardową prośbę o zamianę własnego slotu. Koordynator i administrator mogą
bez akceptacji zastępcy oraz bez dodatkowego kroku approval bezpośrednio zmienić
dowolny przydział w komórce. Operacja nadal respektuje twarde reguły, zapisuje override,
korzysta z optimistic locking i aktualizuje wyłącznie wybraną datę oraz rolę.

Widok ma semantyczną alternatywę tabelaryczną, poziome przewijanie bez utraty kontekstu,
obsługę klawiatury, widoczny focus, odpowiedniki tekstowe kolorów oraz responsywny tryb
małych ekranów. Filtry zakresu, osób i ról nie mogą ukrywać aktywnych konfliktów bez
czytelnego komunikatu.

Viewer trafia na uproszczony ekran „Dyżury” z sekcją „Teraz”, macierzą kalendarza
i etykietą „Tylko do odczytu”. Nie widzi pustych pozycji nawigacji do niedostępnych funkcji.

Sekcja „Teraz” pozostaje nad macierzą i pokazuje wyłącznie aktualną obsadę. Lista
„Najbliższe dni” zostaje usunięta dla wszystkich ról, ponieważ powiela dane i odciąga
uwagę od podstawowego narzędzia pracy. Viewer korzysta z tej samej macierzy w trybie
readonly, bez kontrolek edycji i bez prywatnych stanów dostępności.

### Generator i edycja szkicu

Wynik generatora jest prezentowany w tej samej konwencji macierzy osób × dni co
opublikowany grafik, a nie jako liniowa lista przydziałów. Nagłówki zachowują dzień
tygodnia, święto/dzień wolny i 2X. Koordynator może przed publikacją kliknąć komórkę,
wybrać rolę i zastępcę oraz zapisać pojedynczą korektę szkicu. Zmiana nie regeneruje
pozostałych dni, podlega twardym regułom, korzysta z wersjonowania i jest oznaczona
jako ręczna korekta.

Obok macierzy szkicu widoczna jest prognoza sprawiedliwości. Dla każdej osoby pokazuje
bilans przed planowanym zakresem, bilans po uwzględnieniu bieżącej wersji szkicu oraz
zmianę. Prognoza jest przeliczana po wygenerowaniu i po każdej ręcznej korekcie komórki,
dzięki czemu koordynator widzi wpływ decyzji przed przekazaniem grafiku do akceptacji.
Wynik pozostaje prognozą: nie zastępuje raportu faktycznie odbytych dyżurów.

Konfigurowalne wagi są ustawieniami zaawansowanymi. Interfejs objaśnia skutek każdej
wagi prostym przykładem, pokazuje że znaczenie ma relacja między wagami oraz wyraźnie
oddziela je od reguł twardych, których wagi nie mogą wyłączyć. Domyślne wartości są
opisane jako zbalansowany preset; wartość `0` wyłącza tylko dane kryterium miękkie.

Ekran sprawiedliwości nie eksponuje liczb bez kontekstu. Dla każdej kategorii pokazuje
„wykonane”, „uczciwy udział do dziś” i różnicę opisaną słowami. Wyjaśnia również wpływ
na kolejne generowanie: dodatnia różnica lekko zmniejsza, a ujemna lekko zwiększa
preferencję kolejnych przydziałów, bez gwarancji i bez łamania dostępności, eligibility
lub ciągłości. Widoczna jest informacja, że udział liczy się dopiero od wejścia osoby
do danej rotacji.

### Raport miesięczny dla kadr

Koordynator i administrator mogą pobrać raport CSV dla wybranego miesiąca. Jeden wiersz
odpowiada jednej osobie i zawiera liczbę dyżurów `primary`, `secondary` oraz sumę on-call
w podziale na zwykłe dni robocze, weekendy i polskie święta, a także liczbę roboczych
zmian 11–19. Każdy slot jest liczony z efektywnej wersji grafiku po override’ach i
zamianach. Święto przypadające w weekend jest liczone raz, w kategorii święta. CSV ma
stabilny, wersjonowalny układ kolumn i kodowanie UTF-8; przyszłe XLSX/Word korzystają z
tego samego modelu raportowego, a nie z osobnej logiki liczenia.

Interfejs jest po polsku z zachowaniem terminów `primary`, `secondary`, `on-call` i `override`. Komunikaty podają wynik, przyczynę i następne działanie, nie antropomorfizują generatora i nie ujawniają prywatnych danych.

## 7. Dostępność i jakość UX

Cel to WCAG 2.2 AA: pełna klawiatura, widoczny focus, alternatywa tabelaryczna dla kalendarza, alternatywa dla drag-and-drop, kontrast obu motywów, `prefers-reduced-motion` i statusy przekazywane tekstem, ikoną oraz kolorem.

Kryteria UX: bieżący primary i 11–19 odnajdywane w 5 sekund, niedostępny weekend zgłoszony w 30 sekund, jednodniowa zamiana wysłana w 60 sekund, a podstawowe ścieżki działają bez instrukcji zewnętrznej.

Projekt przechodzi przez makiety niskiej szczegółowości, tokeny i komponenty w Storybooku, klikalny prototyp oraz test z co najmniej pięcioma członkami zespołu i dwiema osobami viewer. Implementacja ma testy axe, klawiatury, kontrastu i regresji wizualnej.

## 8. Etapy dostarczenia

1. Fundament repozytorium, sesje, RBAC, model danych i ekran readonly „Dyżury”.
2. Członkowie zespołu, eligibility, dostępność i import historii.
3. Solver oraz porównanie dzienne/tygodniowe.
4. Publikacja, jednodniowe override’y i pełny workflow zamian.
5. E-mail, ICS, przypomnienia numeru i czasowe linki viewer.
6. Raport sprawiedliwości, audyt, pilotaż i strojenie wag.
7. Macierz kalendarza operacyjnego: domyślne 30 dni, osoby × dni, święta i 2X,
   dostępności, override’y i zamiany oraz bezpośrednie zmiany koordynatora bez approval.
8. Ujednolicenie widoków operacyjnych i modelu bilansu: macierz jako główny ekran oraz
   widok wyniku generatora, edycja pojedynczej komórki szkicu przez koordynatora,
   usunięcie listy przyszłych dni, zakaz `11–19` w dni wolne, opisowe wagi i raport
   sprawiedliwości oraz normalizacja historii względem okresu eligibility nowych osób.
9. Prognoza wpływu szkicu i korekt na fairness, konfigurowalne powiązanie zmiany 11–19
   z primary/secondary lub tryb niezależny oraz miesięczny raport rozliczeniowy CSV dla
   koordynatora i administratora.

Kryteria techniczne: zero luk i naruszeń twardych, 35-dniowy szkic - maksimum jednego
uruchomienia, par. 3 - w skonfigurowanym budżecie czasu (domyślnie 15 sekund, pole
„Budżet czasu solvera” w ustawieniach generowania, zakres 5-300 s), pełna historia zmian
i brak niewyjaśnionej
nierówności większej niż jeden dyżur 2X. Identyczne wejście nie musi dawać
identycznych przydziałów; równoległy CP-SAT może znaleźć różne rozwiązania tej samej jakości.

## 9. Założenia

- Primary i secondary otrzymują takie samo X lub 2X.
- Kategorie dni wolnych nie kumulują mnożników.
- Konto viewer jest podstawową formą stałego dostępu; link czasowy jest wyjątkiem tworzonym przez administratora.
- Automatyczna telefonia, SSO i Slack/Teams pozostają poza MVP.
