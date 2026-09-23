# Teraz i Grafik

Codzienna praca z grafikiem dzieje się na dwóch ekranach: **Teraz** (`/`)
odpowiada na pytanie „kto ma dyżur?”, a **Grafik** (`/grafik`) pokazuje
macierz osób × dni na wybrany zakres.

## Teraz

Tytułem ekranu jest dzisiejsza data, a pod nią stan opublikowanego grafiku:
do kiedy sięga i która to wersja. W dzień wolny lub święto podtytuł dodaje,
że obowiązuje stawka 2X (`PRIMARY` i `SECONDARY` trwają wtedy całą dobę).
Kto ma dyżur w tej chwili, do kiedy i pod jakim telefonem, pokazuje stale
pasek „Dyżur teraz” nad każdym ekranem, więc sam ekran nie powtarza obsady.

Akcje po prawej zależą od roli: członek zespołu ma **Eksport ICS** i **Zgłoś
dostępność** (oba prowadzą do ekranu Moje), koordynator i administrator mają
**Generuj kolejny zakres**, który otwiera Generator z zakresem zaczynającym
się dzień po końcu opublikowanego grafiku.

Pod nagłówkiem jest rząd znaczników ryzyka: dni bez pełnej obsady i dni poza
opublikowanym zakresem (jak na Grafiku), liczba zamian czekających na Twoją
decyzję (prowadzi do Zamian) oraz, dla koordynatora, wynik kryterium
sprawiedliwości (prowadzi do raportu).

Niżej jest sekcja **Najbliższe 4 tygodnie** z tą samą macierzą co na ekranie
Grafik i tymi samymi kontrolkami w nagłówku sekcji: długość 2 / 4 / 8
tygodni, tydzień wstecz i do przodu, powrót do dziś, **Tylko z dyżurem**,
**Legenda** i **Lista dni**.

Na telefonie ekran zamienia pasek „Dyżur teraz” na trzy karty - `PRIMARY`,
`SECONDARY` i `11–19` - z nazwiskiem, oknem pokrycia, przyciskami **Zadzwoń**,
**SMS** i **E-mail** (gdy dane kontaktowe są uzupełnione) oraz informacją, kto
obejmuje rolę jako następny. Karta `11–19` w sobotę, niedzielę lub święto
pokazuje, że ta zmiana **nie występuje** - to nie jest luka w obsadzie. Pod
kartami członek zespołu widzi swój najbliższy dyżur, a grafik jest listą dni.

## Grafik: macierz osób × dni

Nagłówek ekranu podaje zakres i wersję opublikowanego grafiku, a
koordynatorowi także propozycję czekającą na publikację; przycisk **Otwórz
propozycję** prowadzi prosto do niej w Generatorze. Członek zespołu ma tu
**Eksport ICS**.

Domyślny zakres zaczyna się dziś i obejmuje cztery tygodnie (albo mniej, jeśli
opublikowany grafik kończy się wcześniej). Nagłówek sekcji nad macierzą
nazywa zakres, jego długość i liczbę osób w rotacji. Osoby są na osi
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
tekstową, czytaną również przez czytnik ekranu. Link **Legenda** w nagłówku
sekcji rozwija spis symboli; `Esc` go zamyka.

### Ryzyka w zakresie

Na ekranie Teraz nad macierzą jest rząd znaczników: dni opublikowanego
grafiku bez pełnej obsady (kliknięcie przeskakuje do pierwszego takiego dnia),
dni poza opublikowanym zakresem, dyżury kolidujące ze zgłoszonym „nie mogę”
albo **Pełna obsada**, gdy wszystko gra. Zawężenie widoku nie może ukryć
aktywnego konfliktu bez tego komunikatu. Grafik pokazuje tę samą macierz bez
rzędu ryzyk; dni bez obsady są w nim zaznaczone na czerwono w nagłówku
kolumny i w panelu dnia.

### Szczegóły dnia

Kliknięcie komórki (albo `Enter` na zaznaczonej komórce) otwiera panel dnia:
obsada każdej roli, wydarzenia kalendarza i zgłoszona dostępność. Po siatce
poruszasz się strzałkami, `Home` i `End` skaczą na początek i koniec wiersza,
a `PageUp` i `PageDown` przeskakują o tydzień.

Z tego panelu:

- **członek zespołu** może rozpocząć prośbę o zamianę własnego slotu,
- **koordynator i administrator** mogą zmienić dowolny przydział bezpośrednio,
  bez zgody zastępcy i bez kroku akceptacji. Zmiana nadal respektuje reguły
  twarde, pokazuje wpływ na bilans punktów obu osób, zapisuje korektę i
  dotyczy wyłącznie wybranego dnia i roli. Korekta dnia, który już minął,
  wymaga podania powodu,
- **koordynator i administrator** mogą z tego samego panelu dodać wydarzenie
  kalendarza na ten dzień.

Powody niedostępności pozostają prywatne: koordynator widzi je w szczegółach,
członek zespołu tylko przy własnych wpisach, a konto podglądowe nie dostaje
danych o dostępności w ogóle.

## Sterowanie widokiem

Kontrolki są w nagłówku sekcji nad macierzą, na Teraz i na Grafiku tak samo:

| Kontrolka | Co robi |
| --- | --- |
| **2 tyg.** / **4 tyg.** / **8 tyg.** | ustawia długość zakresu; dłuższy zakres ma mniejsze komórki |
| **‹** / **›** | przesuwa cały zakres o siedem dni |
| **dziś** | wraca do zakresu zaczynającego się dziś |
| **Tylko z dyżurem** | ukrywa osoby bez przydziału w zakresie |
| **Legenda** | rozwija spis symboli |
| **Lista dni** | przełącza między macierzą a listą dni |

Na Grafiku początek zakresu i długość są częścią adresu strony
(`/grafik?od=2026-09-14&zoom=8`), więc link do konkretnego widoku można
przekazać dalej; starsze linki z `od` i `do` nadal działają. Paleta poleceń
otwiera grafik z podświetloną osobą albo z panelem wskazanego dnia;
podświetlenie osoby wyłącza znacznik obok nagłówka.

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
