# Moja dostępność

Ekran **Moje** (`/moje`) zbiera to, co dotyczy jednej osoby: najbliższe
dyżury, zgłaszanie dostępności oraz własną subskrypcję kalendarza.

## Moje dyżury

Sekcja „Moje dyżury” wypisuje Twoje dyżury z najbliższych 60 dni: dzień, rola,
okno pokrycia i stawka (`1X` albo `2X`). Przy każdym dyżurze jest przycisk
**Poproś o zamianę**, który otwiera ekran Zamiany z tym dyżurem już wybranym.

## Zgłoszenie terminu

Sekcja „Moja dostępność” ma kalendarz miesiąca i formularz pod nim. W
kalendarzu widać Twoje dyżury i już zgłoszone terminy, więc kolizję widzisz
przed zapisem. Kliknięcie dnia zaczyna zakres, drugie kliknięcie go kończy;
te same daty można też ustawić w polach **Od** i **Do**.

| Pole | Co wpisać |
| --- | --- |
| **Rodzaj** | „Nie mogę”, „Wolę nie” albo „Chętnie wezmę” |
| **Od** | pierwszy dzień zakresu |
| **Do** | ostatni dzień zakresu; dla jednego dnia ta sama data co „Od” |
| **Powód** | opcjonalny; widzą go koordynatorzy i administratorzy |

Przycisk **Zapisz** (z datami zakresu w etykiecie) dodaje wpis; pojawia się on
na liście „Zgłoszone terminy” poniżej i można go stamtąd usunąć. Minione
wpisy są schowane za przełącznikiem **Pokaż minione**.

### Co znaczy który typ

- **Nie mogę** - reguła **twarda**. Generator nie przydzieli Ci dyżuru w tym
  zakresie. Używaj do urlopu, szkolenia, nieobecności.
- **Wolę nie** - preferencja **miękka**. Generator będzie unikał tych dni, ale
  może je przydzielić, jeśli inaczej nie da się obsadzić grafiku albo gdyby
  kosztowało to zbyt wiele równości.
- **Chętnie wezmę** - preferencja miękka w drugą stronę.

Siła preferencji miękkich zależy od wagi „Preferencje zespołu” w ustawieniach
generowania. Nie są obietnicą.

### Prywatność powodu

Powód widzą wyłącznie: Ty, koordynatorzy i administratorzy. Inni członkowie
zespołu widzą tylko, że dany dzień jest u Ciebie zajęty. Konta podglądowe nie
widzą dostępności w ogóle.

## Zgłoszenie w imieniu innej osoby

Koordynator i administrator mają nad kalendarzem pole **Osoba**. Po wybraniu
kogoś kalendarz i formularz pokazują dostępność tej osoby i zgłaszają wpisy w
jej imieniu:

- osoba dostaje o tym powiadomienie,
- może wpis usunąć,
- operacja trafia do audytu jako „Zgłoszono dostępność (w imieniu)”.

Jeżeli Twoje konto samo nie jest w rotacji, wybór osoby jest obowiązkowy -
dopóki go nie zrobisz, sekcja pokazuje prośbę „Wybierz osobę” zamiast
kalendarza i formularza.

## Kiedy zgłaszać

Dostępność wpływa na grafik tylko wtedy, gdy istnieje **przed** wygenerowaniem
szkicu obejmującego te dni. Zgłoszenie po publikacji nie zmienia grafiku
samo z siebie - trzeba wtedy skorzystać z [zamiany](zamiany.md).

## Subskrypcja kalendarza (ICS)

Sekcja „Subskrypcja kalendarza (ICS)” na dole ekranu tworzy adres, który
pokazuje **wyłącznie Twoje dyżury**.

1. Wpisz **Nazwę subskrypcji** (na przykład „telefon”) i kliknij
   „Utwórz adres ICS”.
2. Skopiuj adres przyciskiem kopiowania - adres jest pokazywany tylko raz.
3. Dodaj go w aplikacji kalendarza jako subskrypcję adresu internetowego.

Dyżury pojawią się jako wydarzenia całodniowe. Korekty i zatwierdzone zamiany
przychodzą jako **aktualizacje istniejących wpisów**, nie jako nowe.

Adres można odwołać w dowolnym momencie - przestaje działać natychmiast.
Przełącznik **Pokaż odwołane** nad listą pokazuje także adresy już odwołane.
