# Moje dyżury i dostępność

Ekran **Moje** (`/moje`) odpowiada na trzy pytania członka zespołu, w tej
kolejności: kiedy mam dyżur, co zgłosiłem, jak wyglądam na tle zespołu.
Tytułem ekranu jest „Moje dyżury”, a pod nim: kto, w jakiej roli konta, ile
dyżurów w ostatnich 90 dniach i kiedy jest następny. Po prawej są dwie
akcje: **Eksport ICS (tylko moje)** i **Zaproponuj zamianę** (otwiera
Zamiany z najbliższym dyżurem już wybranym).

Na szerokim ekranie lewa kolumna to dyżury i kalendarz dostępności, prawa to
punkty i zamiany, które Cię dotyczą. Na telefonie sekcje idą jedna pod drugą:
dyżury, punkty z przyciskiem **Zgłoś dostępność**, kalendarz, zamiany.

## Najbliższe dyżury

Lista dyżurów z najbliższych 60 dni, jeden wiersz na dzień: dzień i rola
(dwie role tego samego dnia są w jednym wierszu, na przykład
`SECONDARY + 11–19`), a pod spodem okno pokrycia, stawka (`1X` albo `2X`) i
kto jeszcze ma tego dnia dyżur (`S Marek`). Dyżur trwający dziś jest
podświetlony i ma przycisk **Szczegóły** (otwiera ten dzień na Grafiku);
każdy inny ma przycisk **Zamień**, który otwiera ekran Zamiany z tym dyżurem
już wybranym. Dzień, który koliduje ze zgłoszonym „nie mogę”, ma bursztynową
krawędź i dopisek „koliduje z Twoją niedostępnością”. Link **Grafik** w
nagłówku sekcji otwiera macierz z podświetleniem Twojego wiersza.

## Moja dostępność

Dostępność zgłasza się **na kalendarzu miesiąca**, bez formularza z datami.
W nagłówku sekcji jest pędzel z czterema trybami - **nie mogę**, **wolę
nie**, **chętnie** i **wyczyść** - oraz strzałki zmieniające miesiąc.

- Kliknięcie dnia zapisuje ten jeden dzień wybranym trybem.
- Przeciągnięcie po dniach zapisuje cały zakres; Shift+klik domyka zakres od
  ostatnio zapisanego dnia (przydatne z klawiatury).
- Tryb **wyczyść** usuwa zgłoszenie z zaznaczonych dni. Jeżeli wpis obejmował
  więcej dni, pozostałe zostają.
- Zapis jest natychmiastowy; potwierdza go komunikat „Zapisano: 12 – 16 paź
  „nie mogę”” w rogu ekranu.

Dni już zgłoszone mają kolor trybu i literę (`N`, `W`, `C`). Kropka w rogu
dnia to Twój dyżur; jeśli „nie mogę” trafia na dzień z dyżurem, dzień dostaje
bursztynową obwódkę, a pod kalendarzem pojawia się ostrzeżenie - zgłoszenie
nie zdejmuje dyżuru, trzeba go oddać zamianą albo poprosić koordynatora.
Dni minionych nie da się zaznaczyć.

Pole **Powód** pod kalendarzem jest opcjonalne i dotyczy kolejnych zapisów;
powód widać po najechaniu na dzień.

### Co znaczy który tryb

- **Nie mogę** - reguła **twarda**. Generator nie przydzieli Ci dyżuru w tym
  zakresie. Używaj do urlopu, szkolenia, nieobecności.
- **Wolę nie** - preferencja **miękka**. Generator będzie unikał tych dni, ale
  może je przydzielić, jeśli inaczej nie da się obsadzić grafiku albo gdyby
  kosztowało to zbyt wiele równości.
- **Chętnie** - preferencja miękka w drugą stronę.

Siła preferencji miękkich zależy od wagi „Preferencje zespołu” w ustawieniach
generatora. Nie są obietnicą.

### Prywatność powodu

Powód widzą wyłącznie: Ty, koordynatorzy i administratorzy. Inni członkowie
zespołu widzą tylko, że dany dzień jest u Ciebie zajęty. Konta podglądowe nie
widzą dostępności w ogóle.

## Zgłoszenie w imieniu innej osoby

Koordynator i administrator mają w nagłówku sekcji pole **Osoba**. Po
wybraniu kogoś kalendarz pokazuje dostępność tej osoby i zapisuje wpisy w jej
imieniu:

- osoba dostaje o tym powiadomienie,
- może wpis usunąć,
- operacja trafia do audytu jako „Zgłoszono dostępność (w imieniu)”.

Jeżeli Twoje konto samo nie jest w rotacji, wybór osoby jest obowiązkowy -
dopóki go nie zrobisz, sekcja pokazuje prośbę „Wybierz osobę” zamiast
kalendarza; pozostałych sekcji ekranu wtedy nie ma.

## Kiedy zgłaszać

Dostępność wpływa na grafik tylko wtedy, gdy istnieje **przed** wygenerowaniem
szkicu obejmującego te dni. Zgłoszenie po publikacji nie zmienia grafiku
samo z siebie - trzeba wtedy skorzystać z [zamiany](zamiany.md).

## Moje punkty

Jedna liczba: Twoje odchylenie od sprawiedliwego udziału w punktach za
ostatnie 12 miesięcy (na przykład `+0,5`), pod nią pasek dwukierunkowy i
werdykt względem progu (**W normie** albo **Poza normą**, z progiem
podanym w treści). Tabela miesięcy pokazuje punkty, liczbę dyżurów i dni
weekendowych; przełącznik **12 mies.** / **Ten miesiąc** zawęża listę. Link
**Pełny raport sprawiedliwości** prowadzi do ekranu z całym zespołem - jak
liczone są punkty, opisuje [Sprawiedliwość](../produkt/sprawiedliwosc.md).

## Zamiany

Skrót zamian z Twoim udziałem: kto komu oddaje, dzień i rola, a pod spodem,
na kogo zamiana czeka. Prośba skierowana do Ciebie ma przycisk **Zdecyduj**,
który otwiera skrzynkę „Do mnie” na ekranie Zamiany; **Wszystkie** otwiera
cały ekran.

## Subskrypcja kalendarza (ICS)

Przycisk **Eksport ICS (tylko moje)** otwiera panel z adresami, które
pokazują **wyłącznie Twoje dyżury**.

1. Wpisz **Nazwę subskrypcji** (na przykład „telefon”) i kliknij
   „Utwórz adres ICS”.
2. Skopiuj adres przyciskiem kopiowania - adres jest pokazywany tylko raz.
3. Dodaj go w aplikacji kalendarza jako subskrypcję adresu internetowego.

Dyżury pojawią się jako wydarzenia całodniowe. Korekty i zatwierdzone zamiany
przychodzą jako **aktualizacje istniejących wpisów**, nie jako nowe.

Adres można odwołać w dowolnym momencie - przestaje działać natychmiast.
Przełącznik **Pokaż odwołane** pod listą pokazuje także adresy już odwołane.
