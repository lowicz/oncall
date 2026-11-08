# Moje dyżury i dostępność

Ekran **Moje** (`/moje`) odpowiada na trzy pytania członka zespołu, w tej
kolejności: kiedy mam dyżur, co zgłosiłem, jak wyglądam na tle zespołu.
Tytułem ekranu jest „Moje dyżury”, a pod nim: kto, w jakiej roli konta, ile
dyżurów w ostatnich 90 dniach i kiedy jest następny. Po prawej są dwie
akcje: **Eksport ICS (tylko moje)** i **Zaproponuj zamianę** (otwiera
Zamiany z najbliższym dyżurem już wybranym).

Na szerokim ekranie lewa kolumna to dyżury i kalendarz dostępności, prawa to
punkty, zamiany, które Cię dotyczą, i Twój telefon. Na telefonie sekcje idą
jedna pod drugą: dyżury, punkty z przyciskiem **Zgłoś dostępność**,
kalendarz, zamiany, telefon.

## Najbliższe dyżury

Lista dyżurów z najbliższych 60 dni, jeden wiersz na dzień: dzień i rola
(dwie role tego samego dnia są w jednym wierszu, na przykład
`SECONDARY + 11–19`), a pod spodem okno pokrycia, stawka (`1X` albo `2X`) i
kto jeszcze ma tego dnia dyżur (`Secondary: Marek`). Dyżur trwający dziś jest
podświetlony i ma przycisk **Szczegóły** (otwiera ten dzień na Grafiku);
każdy inny ma przycisk **Zamień**, który otwiera ekran Zamiany z tym dyżurem
już wybranym. Dzień, który koliduje ze zgłoszonym „nie mogę”, ma bursztynową
krawędź i dopisek **kolizja**; kliknięcie go przewija do kalendarza
dostępności otwartego na miesiącu tego dnia. Link **Grafik** w
nagłówku sekcji otwiera macierz z podświetleniem Twojego wiersza.

## Moja dostępność

Dostępność zgłasza się **na kalendarzu miesiąca**, bez formularza z datami.
W nagłówku sekcji jest nazwa miesiąca jako nagłówek kalendarza, ze
strzałkami zmieniającymi miesiąc po obu stronach. Na telefonie wiersz z
miesiącem zostaje przyklejony pod górnym paskiem, gdy przewijasz kalendarz.
Nad kalendarzem jest pędzel z czterema trybami - **nie mogę**, **wolę nie**,
**chętnie** i **wyczyść** - a obok niego pole **Powód do kolejnych wpisów**:
najpierw wybierasz, co i dlaczego, potem zaznaczasz dni. Miesiąc jest w adresie
strony (`/moje?miesiac=2026-10`), więc odświeżenie zostawia ten sam kalendarz.

- Kliknięcie dnia zapisuje ten jeden dzień wybranym trybem.
- Przeciągnięcie po dniach zapisuje cały zakres; Shift+klik domyka zakres od
  ostatnio zapisanego dnia.
- Na telefonie przeciąganie przewija stronę, więc zakres zaznacza się dwoma
  dotknięciami: pierwsze zaczyna zakres (pod kalendarzem pojawia się ramka
  „Zakres: od 12 paź” z przyciskiem **Anuluj**), drugie domyka go i zapisuje.
  Jeden dzień to dwa dotknięcia tego samego dnia.
- Z klawiatury kalendarz to jeden przystanek klawisza Tab. Strzałki
  przechodzą między dniami (w górę i w dół o tydzień), Home i End na początek
  i koniec tygodnia, a Enter lub Spacja zapisują dzień wybranym trybem; z
  Shift domykają zakres od ostatnio zapisanego dnia.
- Tryb **wyczyść** usuwa zgłoszenie z zaznaczonych dni. Jeżeli wpis obejmował
  więcej dni, pozostałe zostają.
- Zapis jest natychmiastowy; potwierdza go jeden komunikat na cały zakres,
  na przykład „Zapisano: 12 – 16 paź „nie mogę”” z powodem pod spodem
  („powód: urlop”), jeśli go podano.
- Komunikat ma przycisk **Cofnij**, aktywny przez 10 sekund. Cofnięcie
  przywraca zaznaczone dni do stanu sprzed zapisu: wpisy, które tam były,
  wracają na te dni z rodzajem i powodem, a dni poza zaznaczeniem zostają
  bez zmian. Jeśli cofnięcie się nie uda,
  komunikat o tym mówi, a **Cofnij** można kliknąć ponownie.

Dni już zgłoszone mają kolor trybu i literę (`N`, `W`, `C`); dzień z powodem
ma w rogu małą ikonę notatki, a sam powód widać po najechaniu na dzień. Kropka
w rogu dnia to Twój dyżur. Dni minionych nie da się zaznaczyć.

Jeśli „nie mogę” trafia na dzień z dyżurem, dzień dostaje bursztynową
obwódkę, a pod kalendarzem pojawia się ramka, na przykład „Masz dyżur PRIMARY
9 mar, a zgłaszasz „nie mogę””. Zgłoszenie nie zdejmuje dyżuru, dlatego
ramka ma dla każdego takiego dnia przycisk **Poproś o zamianę**, który
otwiera ekran Zamiany z tym dyżurem już wybranym. Ramka obejmuje wszystkie
nadchodzące kolizje w wyświetlanym miesiącu i znika, gdy żadnej nie ma.

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
imieniu (wybrana osoba też jest w adresie strony, jako `osoba=`):

- osoba dostaje o tym powiadomienie,
- może wpis usunąć,
- operacja trafia do audytu jako „Zgłoszono dostępność (w imieniu)”.

Jeśli „nie mogę” trafia na dyżur tej osoby, ramka pod kalendarzem mówi o tym
jej imieniem, na przykład „Beata Lis ma dyżur PRIMARY 9 mar, a wpis to „nie
mogę””. Zamiast **Poproś o zamianę** ma dla każdego takiego dnia przycisk
**Otwórz dzień**, który otwiera ten dzień w grafiku, gdzie można zmienić
obsadę.

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

## Mój telefon

Sekcja **Mój telefon** pokazuje numer zapisany na Twoim koncie - ten, który
zalogowane osoby widzą na pasku „Dyżur teraz” i na karcie dyżurnego. Wpisz
numer w dowolnej postaci (`600 100 200`, `48600100200`, `+48 600-100-200`) i
kliknij **Zapisz numer**: aplikacja zapisuje go jako `+48` i dziewięć cyfr i
pokazuje tę postać w polu. Numer zagraniczny nie jest przyjmowany - pole
mówi „Popraw numer”, a osoba w rotacji bez numeru widzi „Wymagany dla osób w
rotacji”. Oba komunikaty pojawiają się dopiero po wyjściu z pola albo przy
zapisie, nie w trakcie pisania. Puste pole usuwa numer.

Przy logowaniu z katalogu (LDAP / Active Directory) administrator może
włączyć pobieranie numeru z katalogu: wypełnia ono tylko puste pole, więc
numer wpisany tu albo przez administratora zostaje, nawet jeśli katalog
zna inny. Kto chce wrócić do numeru z katalogu, wpisuje go.

## Subskrypcja kalendarza (ICS)

Przycisk **Eksport ICS (tylko moje)** otwiera panel z adresami, które
pokazują **wyłącznie Twoje dyżury**.

1. Wpisz **Nazwę subskrypcji** (na przykład „telefon”) i kliknij
   „Utwórz adres ICS”.
2. Skopiuj adres przyciskiem kopiowania - adres jest pokazywany tylko raz.
3. Dodaj go w aplikacji kalendarza jako subskrypcję adresu internetowego.

Dyżury pojawią się jako wydarzenia całodniowe. Korekty i zatwierdzone zamiany
przychodzą jako **aktualizacje istniejących wpisów**, nie jako nowe.

Adres można odwołać w dowolnym momencie przyciskiem **Odwołaj**. Po potwierdzeniu
przestaje działać natychmiast i nie da się go przywrócić - trzeba utworzyć nowy.
Przełącznik **Pokaż odwołane** pod listą pokazuje także adresy już odwołane.
