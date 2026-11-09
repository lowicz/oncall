# Teraz i Grafik

Codzienna praca z grafikiem dzieje się na dwóch ekranach: **Teraz** (`/`)
odpowiada na pytanie „kto ma dyżur?”, a **Grafik** (`/grafik`) pokazuje
macierz osób × dni na wybrany zakres.

## Teraz

Tytułem ekranu jest dzisiejsza data, a pod nią stan opublikowanego grafiku:
do kiedy sięga i z którego dnia jest ta publikacja („publikacja z 28 sie”). W dzień wolny lub święto podtytuł dodaje,
że obowiązuje stawka 2X (`PRIMARY` i `SECONDARY` trwają wtedy całą dobę).
Podtytuł podaje też liczbę zamian czekających na Twoją decyzję (link do
Zamian) oraz, dla koordynatora, wynik kryterium sprawiedliwości.
Kto ma dyżur w tej chwili, do kiedy i pod jakim telefonem, pokazuje stale
pasek „Dyżur teraz” nad każdym ekranem, więc sam ekran nie powtarza obsady.
Rola, której nikt nie ma, jest w pasku pogrubiona i oznaczona czerwoną
kropką: **brak obsady**.

Akcje po prawej zależą od roli: członek zespołu ma **Zgłoś dostępność**
(prowadzi do ekranu Moje dyżury), koordynator i administrator mają **Generuj
kolejny zakres**, który otwiera Generator z zakresem zaczynającym się dzień
po końcu opublikowanego grafiku.

Pod nagłówkiem jest rząd znaczników ryzyka, tylko o widocznym zakresie: dni
bez pełnej obsady, dni poza opublikowanym zakresem i, dla koordynatora,
osoby z dyżurem w dniu zgłoszonego „nie mogę”. Znacznik, który prowadzi do
dnia, kończy się strzałką.

Niżej jest sekcja **Najbliższe 4 tygodnie** z tą samą macierzą co na ekranie
Grafik i tym samym pasem kontrolek w nagłówku sekcji: długość 2 / 4 / 8
tygodni, tydzień wstecz i do przodu, powrót do dziś oraz menu **⋯**
(**Więcej**) z pozycjami **Tylko z dyżurem**, **Lista dni**, **Legenda** i,
dla członka zespołu, **Subskrypcja ICS**. Gdy nikt nie jest jeszcze w rotacji, sekcja
zamiast pustej macierzy mówi to wprost i nie pokazuje kontrolek;
administrator dostaje w niej przycisk **Otwórz Osoby**, żeby dodać zespół.
Gdy zespół ma osoby, ale żadna nie jest w rotacji w widocznym zakresie,
sekcja też mówi to wprost, lecz zostawia kontrolki, żeby przejść do zakresu
z dyżurami.

Na telefonie ekran zamienia pasek „Dyżur teraz” na trzy karty - `PRIMARY`,
`SECONDARY` i `11–19` - z nazwiskiem, oknem pokrycia, przyciskami **Zadzwoń**,
**SMS** i **E-mail** (gdy dane kontaktowe są uzupełnione) oraz informacją, kto
obejmuje rolę jako następny. Karta `11–19` w sobotę, niedzielę lub święto
pokazuje, że ta zmiana **nie występuje** - to nie jest luka w obsadzie. Pod
kartami członek zespołu widzi swój najbliższy dyżur, a grafik jest listą dni.

## Przekazanie numeru

Numer on-call dzwoni u osoby na `PRIMARY`. Gdy ona musi odejść, a umówiła się
z osobą na `SECONDARY`, może na kilka godzin przekazać numer tej osobie, bez
administratora i bez logowania do panelu WCO. Przekazanie jest widoczne tylko
wtedy, gdy administrator ustawił przełączanie numeru na **Włączone** albo
**Próbny**; przy **Wyłączone** aplikacja nie wie, gdzie numer dzwoni, więc
nie pokazuje ani znacznika, ani przycisków.

### Gdzie widać, u kogo dzwoni numer

Znacznik **numer on-call** stoi przy osobie, u której numer dzwoni: w pasku
„Dyżur teraz”, na kartach na telefonie i w nagłówku ekranu Teraz. W czasie
przekazania jest przy osobie na `SECONDARY` i mówi, do której godziny:
„numer on-call · do 13:40”. Telefon `PRIMARY` zostaje w pasku, bo to ta osoba
odpowiada za dyżur. Kliknięcie znacznika pokazuje szczegóły: kto odbiera, od
kiedy do kiedy, czy WCO potwierdziło przekierowanie i o której. Znacznik
zmienia stan na bieżąco, a stan jest też podany tekstem, nie samym kolorem:

| Stan | Co znaczy |
| --- | --- |
| **numer on-call** | WCO potwierdziło, że numer dzwoni u tej osoby |
| **przełączam** | WCO jeszcze nie potwierdziło przekierowania |
| **nie przełączono** | WCO nie potwierdziło po progu alarmu; numer może nadal dzwonić u poprzedniej osoby |

W trybie **Próbny** szczegóły mówią, że WCO nie zostanie zmienione: przekazanie
jest zapisane, ale numer w centrali zostaje, jak był. Gdy próbne logowanie do
WCO się nie uda, znacznik od razu mówi **nie przełączono (próba)**, a
szczegóły - że w trybie próbnym nikt nie dostaje e-maila.

### Jak przekazać numer

Przycisk jest przy parze dyżurnej dnia: osoba na `PRIMARY` widzi **Przekaż
numer…**, osoba na `SECONDARY` **Przejmij numer…**. Widzi go też koordynator
i administrator, w imieniu pary. Nikt inny go nie ma, bo przekazać można
tylko w obrębie pary dnia; inne zmiany obsady robi się korektą.

1. Kliknij przycisk. Na biurku otwiera się podpowiedź przy przycisku, na
   telefonie arkusz od dołu z przyciskiem **Zamknij**; to nie jest okno
   z pytaniem.
2. Wybierz, na jak długo: **1 h**, **2 h**, do końca dyżuru (przycisk
   podaje godzinę, domyślnie jutro 9:00, czyli godzinę przypomnienia) albo
   **inny…**, który odsłania pole z godziną. Zdanie pod wyborem mówi, kiedy
   numer wróci, na przykład „Numer wraca do Ciebie o 13:40”. Godzina musi być
   późniejsza niż teraz i nie późniejsza niż koniec dyżuru; segment, który
   by go przekroczył, jest nieaktywny.
3. Kliknij **Przekaż numer** (**Przejmij numer** przy przejmowaniu). Wystarczy
   jedno kliknięcie jednej strony: umowa zapada przez telefon, a druga strona
   nie musi niczego zatwierdzać.

Powiadomienie „Przełączam numer · odbiera Marek Nowak · do 13:40” ma przez
kilka sekund przycisk **Cofnij**, który kończy przekazanie. Potem znacznik
przy nowej osobie mówi **przełączam**, a gdy WCO potwierdzi, **numer
on-call**.

Gdy przejmująca osoba nie ma numeru telefonu na ekranie Moje dyżury, ramka w
podpowiedzi mówi to z nazwiskiem i blokuje przycisk: numer trzeba najpierw
uzupełnić. Gdy numer jest już przekazany, znacznik mówi, do której godziny,
a w miejscu przycisku przekazania stoi przycisk zakończenia opisany niżej.

### Jak numer wraca

- **Sam**, o wybranej godzinie albo najpóźniej o godzinie przypomnienia, gdy
  numer i tak przechodzi na kolejną osobę na `PRIMARY`. Nie trzeba nic
  klikać ani nikogo prosić.
- **Ręcznie**, w tym samym miejscu, w którym zaczęło się przekazanie: osoba
  na `PRIMARY` klika **Zabierz numer z powrotem**, osoba na `SECONDARY`
  **Oddaj numer**, a koordynator **Zakończ przekazanie**. Administrator może
  też przyciskiem **Zakończ przekazanie** na karcie Stan ekranu
  [Przełączanie numeru](administracja.md#przełączanie-numeru-przelaczanie-administrator).
  Zakończenie nie pyta o potwierdzenie, bo ponowne przekazanie to jedno
  kliknięcie; powiadomienie mówi, kto znów odbiera numer.
- **Przez korektę grafiku**: gdy korekta lub zamiana zmienia, kto ma tego dnia
  `PRIMARY` albo `SECONDARY`, także gdy zamienia te dwie role między sobą,
  przekazanie kończy się samo, a numer wraca do osoby, która
  według grafiku ma `PRIMARY`. Obie strony dostają wtedy e-mail „Przekazanie
  numeru on-call zakończone przez korektę grafiku”, a ramka korekty uprzedza
  z góry: „Ta korekta zakończy przekazanie numeru on-call Anna Kowalska →
  Marek Nowak”. To
  jedyny e-mail o przekazaniu: przy powodzeniu nie wychodzi żaden, bo obie
  strony się umówiły, a stan jest w pasku.

### Gdy przełączenie się nie uda

Jeśli WCO nie potwierdza przekierowania, znacznik przechodzi w czerwony stan
**nie przełączono** i jest ogłaszany czytnikowi ekranu jako alert, a obok
przycisków przekazania pojawia się **Sprawdź ponownie**, a **Zakończ
przekazanie** oddaje numer osobie na `PRIMARY`. Alarm e-mail „Numer on-call”
idzie wtedy do koordynatorów i administratorów, do osoby na `PRIMARY` i do
osoby, która miała numer przejąć, żeby nikt nie czekał na telefon, który nie
dzwoni. Proces roboczy próbuje dalej sam.

Każde przekazanie i jego zakończenie są w [Audycie](administracja.md#audyt-audyt-administrator)
(„Przekazano numer on-call: Anna Kowalska → Marek Nowak do 13:40”, „Zakończono
przekazanie numeru on-call … zakończone ręcznie”), razem z tym, kto je zlecił.

## Grafik: macierz osób × dni

Nagłówek ekranu podaje zakres opublikowanego grafiku i datę jego publikacji, a
koordynatorowi także propozycję czekającą na publikację; przycisk **Otwórz
propozycję** prowadzi prosto do niej w Generatorze. Subskrypcję ICS członek
zespołu znajdzie w menu **⋯** nad macierzą i na ekranie Moje dyżury.

Domyślny zakres zaczyna się dziś i obejmuje cztery tygodnie (albo mniej, jeśli opublikowany grafik kończy się wcześniej).
Jeśli publikacja już wygasła, ekran pokazuje cztery tygodnie od dziś i ostrzeżenie z datą końca, a koordynatorowi także drogę do Generatora (albo do czekającej propozycji).
Nieprawidłowy zakres z adresu pokazuje akcję **Pokaż od dziś**, zamiast pozostawiać ekran bez kontrolek.
Nagłówek sekcji nad macierzą nazywa zakres, jego długość i liczbę osób w rotacji, a gdy w zakresie są dni bez pełnej obsady, także ich liczbę z linkiem do pierwszego z nich („2 dni bez pełnej obsady, pierwszy 14-11”). Osoby są na osi
pionowej, kolejne dni na poziomej. Kolumna z osobami i nagłówki dat zostają
widoczne podczas przewijania.

Nagłówek każdej kolumny podaje dzień miesiąca, skrót dnia tygodnia oraz
oznaczenie weekendu, polskiego święta i stawki **2X**. Wydarzenia kalendarza są
zaznaczone paskiem w kolorze wydarzenia.

Przy nazwie osoby jest pasek obciążenia w zakresie oraz oznaczenie **Ty** przy
Twoim wierszu albo **poza rotacją**, gdy osoba nie ma w tym zakresie uprawnień
do żadnej roli.

Komórka łączy dwie informacje:

| Co | Jak wygląda |
| --- | --- |
| dyżur | `P` (`PRIMARY`), `S` (`SECONDARY`), `11–19` |
| dostępność | „nie mogę”, „wolę nie”, „chętnie wezmę” |
| korekta lub zamiana | osobny status, nie tylko inny kolor |

Kolor nigdy nie jest jedynym nośnikiem informacji - każdy stan ma też etykietę
tekstową, czytaną również przez czytnik ekranu. Pozycja **Legenda** w menu
**⋯** nad macierzą rozwija spis symboli; `Esc` go zamyka.

### Ryzyka w zakresie

Na ekranie Teraz nad macierzą jest rząd znaczników: dni opublikowanego
grafiku bez pełnej obsady (kliknięcie przeskakuje do pierwszego takiego dnia),
dni poza opublikowanym zakresem, osoby z dyżurem w dniu zgłoszonego „nie
mogę” (kliknięcie przeskakuje do pierwszego takiego dnia) albo **Pełna
obsada**, gdy wszystko gra. Zawężenie widoku nie może ukryć aktywnego konfliktu bez tego
komunikatu. Grafik pokazuje tę samą macierz bez rzędu ryzyk; dni bez obsady
są w nim zaznaczone na czerwono w nagłówku kolumny i w panelu dnia, a
nagłówek sekcji podaje ich liczbę z linkiem do pierwszego.

### Szczegóły dnia

Kliknięcie komórki (albo `Enter` na zaznaczonej komórce) otwiera panel dnia:
obsada każdej roli, wydarzenia kalendarza i zgłoszona dostępność. Po siatce
poruszasz się strzałkami, `Home` i `End` skaczą na początek i koniec wiersza,
a `PageUp` i `PageDown` przeskakują o tydzień.

Z tego panelu:

- **członek zespołu** może rozpocząć prośbę o zamianę własnego slotu,
- **koordynator i administrator** mogą zmienić dowolny przydział bezpośrednio,
  bez zgody zastępcy i bez kroku akceptacji. Każdy wiersz roli w panelu ma
  na końcu przycisk **Zmień…** (pusta rola: **Obsadź…**), a kliknięcie
  całego wiersza działa tak samo. Pod wierszami, które zostają na miejscu z
  podświetlonymi zmienianymi rolami, otwiera się ramka „Zmiana obsady”, a
  wszystko, co trzeba wiedzieć o zmianie, jest w niej, bez osobnego okna
  potwierdzenia. Grupa **Role do zmiany** ma pola PRIMARY, SECONDARY i 11–19
  (to ostatnie tylko w dzień roboczy); kliknięta rola jest zaznaczona, a
  jedna korekta może dać jednej osobie dwie role, na przykład SECONDARY i
  11–19. PRIMARY i SECONDARY wykluczają się, bo jedna osoba nie może mieć
  obu on-call tego dnia: gdy jedno jest zaznaczone, drugie jest niedostępne,
  a powód stoi pod grupą. 11–19 jest zaznaczona domyślnie dokładnie wtedy,
  gdy polityka wiąże ją z zaznaczoną rolą, a osoba z tej roli ma też 11–19;
  zdanie pod grupą mówi, dlaczego 11–19 jest zaznaczona albo nie. Wiersz
  11–19 w panelu ma znacznik „powiązana z SECONDARY” (albo „powiązana z
  PRIMARY”), gdy ma ją osoba z roli kotwiczącej, a „poza powiązaniem z
  SECONDARY”, gdy ma ją ktoś inny; przy powiązaniu „niezależnie” znacznika
  nie ma. Odznaczenie 11–19 zostawia ją bez zmian, a jeśli przez to rozejdzie
  się z rolą kotwiczącą, ramka pokaże regułę powiązania do świadomego
  potwierdzenia. Pole **Osoba na `<role>`** wymienia wszystkich w rotacji
  tego dnia, a przy dwóch rolach przy nazwisku mówi, które z nich ta osoba
  może przejąć („Marek Nowak · SECONDARY, 11–19”). Kogo wybrać nie można,
  ten zostaje na liście z powodem po nazwisku („Anna Kowalska · niedostępna
  tego dnia”). Osoba, która może przejąć tylko część zaznaczonych ról
  („Piotr Zieliński · tylko SECONDARY (bez 11–19)”), też zostaje na liście,
  ale jej wybranie nie zmienia zaznaczenia: pod polem pojawia się, co
  odznaczyć albo kogo wybrać zamiast niej, a zapis czeka. Podpowiedź pod
  polem opisuje wybraną osobę: jej uprawnienia tego dnia i to, co zgłosiła
  na ten dzień. Pod wyborem są podgląd wiersz po wierszu (kto oddaje którą
  rolę), linia reguł sprawdzonych na stanie po wszystkich zmianach („Bez
  naruszeń reguł twardych”) i wpływ na bilans punktów każdej osoby, której
  zmiana dotyczy. Jeśli zmiana złamie regułę twardą, w miejscu linii reguł
  pojawia się ramka „Ta korekta złamie reguły twarde” z listą naruszeń i
  polem „Rozumiem i świadomie łamię te reguły”; takie naruszenie trafia do
  dziennika audytu. Korekta dnia, który już minął, prosi o powód (co
  najmniej 10 znaków, wymóg audytu) w polu tej samej ramki. Przycisk
  **Zapisz zmianę obsady** (przy dwóch rolach **Zmień obsadę (2 role)**)
  zapisuje dopiero wtedy, gdy wybrana jest osoba, reguły są sprawdzone,
  naruszenia potwierdzone, a powód podany. Dwie role to jedna zmiana
  grafiku z jednym wpisem audytu „Korekta grafiku” i jedną wiadomością
  „Zmiana przydziału” dla każdej osoby, z listą tylko jej slotów. Gdy zapis
  zostanie odrzucony, na przykład bo grafik zmienił się w międzyczasie,
  powód odmowy pojawia się w ramce i dostaje fokus, a odmowa wskazująca
  nowo złamane reguły pokazuje je od razu do potwierdzenia. Po zapisie panel
  się zamyka, a powiadomienie mówi, co zmieniono („Zmieniono obsadę 11 mar:
  Marek Nowak SECONDARY i 11–19”). Gdy każdą zmienioną rolę da się oddać
  osobie, która ją miała, powiadomienie ma przycisk **Cofnij**, który jedną
  zmianą przywraca poprzednią obsadę; e-maile wychodzą dopiero po
  zamknięciu okna „Cofnij”, a po cofnięciu nie wychodzą wcale. Gdy cofnąć
  się nie da (rola była pusta albo poprzednia osoba nie może jej tego dnia
  przejąć), powiadomienie mówi, kto dostanie e-mail, a przycisk **Pokaż dzień** otwiera panel tego dnia ponownie,
- **koordynator i administrator** mogą zamienić miejscami osoby z PRIMARY i
  SECONDARY tego dnia jednym ruchem, bez korekt przez osobę trzecią. Przycisk
  **Zamień miejscami…** stoi między wierszami PRIMARY i SECONDARY, gdy obie
  role mają różne osoby, i rozwija w panelu ramkę „Zamiana miejscami”: podgląd
  wiersz po wierszu (kto przechodzi na którą rolę), linię reguł sprawdzoną na
  stanie po zamianie i wpływ na bilans punktów obu osób. Gdy jedna z osób nie
  ma tego dnia uprawnień do roli drugiej albo ma wpis niedostępności na ten
  dzień, przycisk jest nieaktywny, a zdanie pod nim mówi dlaczego. Jeśli
  polityka wiąże 11–19 z rolą, którą oddaje osoba pełniąca też 11–19, ramka ma pole
  „razem z SECONDARY” (albo „razem z PRIMARY”), zaznaczone dokładnie wtedy,
  gdy druga osoba ma uprawnienia do 11–19, z jednym zdaniem dlaczego.
  Odznaczenie zostawia 11–19 bez zmian i pokazuje regułę powiązania do
  świadomego potwierdzenia. Powód jest potrzebny tylko dla dnia, który już
  minął (pole w ramce, co najmniej 10 znaków). **Zamień miejscami** zapisuje
  zamianę jako jedną zmianę grafiku z jednym wpisem audytu („Zamieniono role
  dnia”); obie osoby dostają e-mail „Zamiana ról” po zamknięciu okna
  „Cofnij”. Komunikat po zapisie ma przycisk **Cofnij**, a w panelu przez ten
  sam czas zamiast „Zamień miejscami…” stoi **Cofnij zamianę**; cofnięcie
  przywraca poprzednią obsadę, a e-maile nie wychodzą,
- **koordynator i administrator** mogą przyciskiem **Wydarzenie…** otworzyć
  osobne okno i dodać w nim wydarzenie kalendarza na ten dzień; panel dnia
  czeka pod spodem i po zapisie pokazuje nowe wydarzenie. Wydarzenie usuwa
  się z panelu dnia; usunięcie działa od razu, a powiadomienie ma przycisk
  **Cofnij**, który przez kilka sekund przywraca wydarzenie.

Gdy ktoś ma dyżur w dniu, na który zgłosił „nie mogę”, koordynator widzi nad
obsadą dnia ramkę „Kolizja: Jan Wiśniewski ma PRIMARY 14 mar mimo zgłoszenia
„Nie mogę””, z powodem zgłoszenia i przyciskiem **Zmień osobę…**, który otwiera
zmianę obsady tej roli. Czytnik ekranu czyta ten sam tekst przy wierszu roli.

Powody niedostępności pozostają prywatne: koordynator widzi je w szczegółach,
członek zespołu tylko przy własnych wpisach, a konto podglądowe nie dostaje
danych o dostępności w ogóle.

## Sterowanie widokiem

Kontrolki są jednym pasem w nagłówku sekcji nad macierzą, na Teraz i na
Grafiku tak samo:

| Kontrolka | Co robi |
| --- | --- |
| **2 tyg.** / **4 tyg.** / **8 tyg.** | ustawia długość zakresu; dłuższy zakres ma mniejsze komórki |
| **‹** / **›** | przesuwa cały zakres o siedem dni |
| **dziś** | wraca do zakresu zaczynającego się dziś |
| **⋯** → **Tylko z dyżurem** | ukrywa osoby bez przydziału w zakresie |
| **⋯** → **Lista dni** | przełącza między macierzą a listą dni |
| **⋯** → **Legenda** | rozwija spis symboli |
| **⋯** → **Subskrypcja ICS** | otwiera adresy kalendarza z Twoimi dyżurami na ekranie Moje dyżury (członek zespołu) |

Na Teraz i na Grafiku początek zakresu, jego długość, filtr **Tylko z
dyżurem** i wybór między macierzą a listą dni są częścią adresu strony
(`/grafik?od=2026-09-14&zoom=8&tylko=z-dyzurem&widok=lista`, na Teraz
`/?od=2026-09-14&zoom=8`; bez `widok` wąski ekran zaczyna od listy dni, a
szeroki od macierzy), więc odświeżenie strony zachowuje widok,
a link do niego można przekazać dalej; starsze linki z `od` i `do` nadal
działają. Paleta poleceń
otwiera grafik z podświetloną osobą albo z panelem wskazanego dnia; wiersz
podświetlonej osoby ma przy nazwisku znacznik „podświetlona”, a podświetlenie
wyłącza znacznik obok nagłówka.

Jeśli pierwsze pobranie grafiku nie powiedzie się, pasek „Dyżur teraz” pokazuje **brak danych** i **brak połączenia**, a nie **brak obsady**.
Błędy pobierania podają następny krok: sprawdzenie połączenia i ponowienie próby.

## Małe ekrany

Widok **Lista dni** zamienia macierz w listę: jeden wiersz na dzień, z obsadą
wszystkich ról. To ten sam komplet informacji, ułożony pionowo; dotknięcie roli
otwiera szczegóły. Na telefonie panel dnia otwiera się jako nakładka nad
listą.

## Widok tylko do odczytu

Konto podglądowe i sesja z linku podglądowego widzą macierz w trybie tylko do
odczytu, bez danych o dostępności i bez akcji. Pasek „Dyżur teraz” i karty na
telefonie pokazują im telefon dyżurnego (z **Zadzwoń** i **SMS**), ale nie
adres e-mail. Sesja z linku dodatkowo pokazuje pasek z nazwą linku, jego
zakresem dat i datą ważności.

Sekcja z macierzą na ekranie Teraz pokazuje w sesji z linku tylko dni z jego
zakresu. Link obejmujący najwyżej 8 tygodni widać w całości, z nagłówkiem
„zakres linku” i bez przełącznika długości oraz strzałek. W dłuższym linku
strzałki przesuwają widok tylko w jego granicach.
