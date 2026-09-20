# Dyżury

Ekran **Dyżury** (`/`) jest pulpitem aplikacji i ma dwie części: „Kto jest
teraz?” oraz macierz osób × dni.

## Kto jest teraz?

Nagłówek pokazuje status i datę grafiku, na przykład `[OPUBLIKOWANY] · 2026-09-20`.

Pod nim są trzy karty - `PRIMARY`, `SECONDARY` i `11–19` - a każda podaje:

- nazwę osoby pełniącej dyżur,
- okno pokrycia („całą dobę” albo godziny) i dzień tygodnia z datą,
- dane kontaktowe, jeśli są uzupełnione,
- kto obejmuje dyżur jako następny.

Karta `11–19` w sobotę, niedzielę lub święto pokazuje, że ta zmiana **nie
występuje** - to nie jest luka w obsadzie.

Jeśli dzień nie ma obsady, karta oznacza to jako brak, a nie pustkę.

## Macierz osób × dni

Domyślnie widać 30 dni. Osoby są na osi pionowej, kolejne dni na poziomej.
Pierwsza kolumna i nagłówki dat zostają widoczne podczas przewijania.

Nagłówek każdej kolumny podaje datę, skrót dnia tygodnia, oznaczenie weekendu
albo polskiego święta oraz stawkę **2X**.

Komórka łączy dwie informacje:

| Co | Jak wygląda |
| --- | --- |
| dyżur | `P` (`PRIMARY`), `S` (`SECONDARY`), `11–19` |
| dostępność | „nie mogę”, „wolę nie”, „chętnie wezmę” |
| korekta lub zamiana | osobny status, nie tylko inny kolor |

Kolor nigdy nie jest jedynym nośnikiem informacji - każdy stan ma też etykietę
tekstową, czytaną również przez czytnik ekranu.

### Szczegóły dnia

Kliknięcie komórki (albo `Enter` na zaznaczonej komórce) otwiera panel
szczegółów dnia. Po siatce poruszasz się strzałkami, a `PageUp` i `PageDown`
przeskakują o tydzień.

Z tego panelu:

- **członek zespołu** może rozpocząć prośbę o zamianę własnego slotu,
- **koordynator i administrator** mogą zmienić dowolny przydział bezpośrednio,
  bez zgody zastępcy i bez kroku akceptacji. Zmiana nadal respektuje reguły
  twarde, zapisuje korektę i dotyczy wyłącznie wybranego dnia i roli.

Powody niedostępności pozostają prywatne: koordynator widzi je w szczegółach,
członek zespołu tylko przy własnych wpisach, a konto podglądowe nie dostaje
danych o dostępności w ogóle.

## Sterowanie widokiem

Pasek nad macierzą zawiera:

| Kontrolka | Co robi |
| --- | --- |
| **Tydzień** (w lewo / w prawo) | przesuwa cały zakres o siedem dni |
| **Od** i **Do** | ustawiają zakres wprost |
| **Najbliższe 30 dni** | wraca do zakresu domyślnego |
| **Macierz** / **Lista dni** | przełącza układ |
| **Tylko osoby z dyżurem** | ukrywa osoby bez przydziału w zakresie |

Zawężenie widoku nie może ukryć aktywnego konfliktu bez czytelnego komunikatu:
jeśli w wybranym zakresie któryś dzień opublikowanego grafiku nie ma pełnej
obsady, nad macierzą pojawia się ostrzeżenie z przyciskiem „Pokaż pierwszy”.

## Małe ekrany

Przełącznik **Lista dni** (a poniżej progu szerokości także układ domyślny)
zamienia macierz w listę: jedna karta na dzień, z obsadą wszystkich ról. To ten
sam komplet informacji, ułożony pionowo; dotknięcie roli otwiera szczegóły.

## Widok tylko do odczytu

Konto podglądowe i sesja z linku podglądowego widzą uproszczoną wersję tego
ekranu: sekcję „Teraz”, macierz w trybie tylko do odczytu i etykietę mówiącą o
ograniczeniu. Sesja z linku dodatkowo pokazuje pasek z nazwą linku, jego
zakresem dat i datą ważności.
