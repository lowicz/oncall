# Teraz i Grafik

Codzienna praca z grafikiem dzieje się na dwóch ekranach: **Teraz** (`/`)
odpowiada na pytanie „kto ma dyżur?”, a **Grafik** (`/grafik`) pokazuje
macierz osób × dni na wybrany zakres.

## Teraz

Tytułem ekranu jest dzisiejsza data, a pod nią stan opublikowanego grafiku:
do kiedy sięga i która to wersja. W dzień wolny lub święto podtytuł dodaje,
że obowiązuje stawka 2X (`PRIMARY` i `SECONDARY` trwają wtedy całą dobę).
Podtytuł podaje też liczbę zamian czekających na Twoją decyzję (link do
Zamian) oraz, dla koordynatora, wynik kryterium sprawiedliwości.
Kto ma dyżur w tej chwili, do kiedy i pod jakim telefonem, pokazuje stale
pasek „Dyżur teraz” nad każdym ekranem, więc sam ekran nie powtarza obsady.
Rola, której nikt nie ma, jest w pasku pogrubiona i oznaczona czerwoną
kropką: **brak obsady**.

Akcje po prawej zależą od roli: członek zespołu ma **Zgłoś dostępność**
(prowadzi do ekranu Moje), koordynator i administrator mają **Generuj
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
dla członka zespołu, **Eksport ICS**. Gdy nikt nie jest jeszcze w rotacji, sekcja
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

## Grafik: macierz osób × dni

Nagłówek ekranu podaje zakres i wersję opublikowanego grafiku, a
koordynatorowi także propozycję czekającą na publikację; przycisk **Otwórz
propozycję** prowadzi prosto do niej w Generatorze. Eksport ICS członek
zespołu znajdzie w menu **⋯** nad macierzą i na ekranie Moje.

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
  całego wiersza działa tak samo. Korekta dotyczy wyłącznie
  wybranego dnia i roli, a wszystko, co trzeba o niej wiedzieć, pojawia się w
  panelu tuż pod wyborem osoby, bez osobnego okna potwierdzenia: linia reguł
  („Bez naruszeń reguł twardych”) i wpływ na bilans punktów obu osób. Jeśli
  zmiana złamie regułę twardą, w miejscu linii reguł pojawia się ramka „Ta
  korekta złamie reguły twarde” z listą naruszeń i polem „Rozumiem i świadomie
  łamię te reguły”; takie naruszenie trafia do dziennika audytu. Przycisk
  **Zapisz zmianę obsady** zapisuje dopiero wtedy, gdy wybrana jest osoba,
  reguły są sprawdzone, a naruszenia potwierdzone. Korekta dnia, który już
  minął, jest wyjątkiem: przycisk **Zapisz zmianę obsady…** otwiera okno
  „Potwierdź korektę historyczną”, które prosi o powód (co najmniej 10 znaków,
  wymóg audytu), a zapis następuje z tego okna. Gdy zapis zostanie odrzucony,
  na przykład bo grafik zmienił się w międzyczasie, powód odmowy pojawia się w
  panelu i dostaje fokus, a przy korekcie historycznej w jej oknie. Wyjątkiem
  jest odmowa wskazująca nowo złamane reguły: okno się wtedy zamyka, reguły i
  ich potwierdzenie pojawiają się w panelu, a wpisany powód zostaje na
  następne otwarcie okna. Po zapisie panel się zamyka, a powiadomienie mówi,
  co zmieniono i kto dostanie e-mail („Zmieniono obsadę 14 lis · PRIMARY:
  Anna Kowalska → Jan Nowak”); przycisk **Otwórz dzień** otwiera panel tego
  dnia ponownie,
- **koordynator i administrator** mogą z tego samego panelu dodać wydarzenie
  kalendarza na ten dzień albo je usunąć; usunięcie działa od razu, a
  powiadomienie ma przycisk **Cofnij**, który przez kilka sekund przywraca
  wydarzenie.

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
| **⋯** → **Eksport ICS** | otwiera adresy kalendarza z Twoimi dyżurami na ekranie Moje (członek zespołu) |

Na Grafiku początek zakresu i długość są częścią adresu strony
(`/grafik?od=2026-09-14&zoom=8`), więc link do konkretnego widoku można
przekazać dalej; starsze linki z `od` i `do` nadal działają. Paleta poleceń
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
