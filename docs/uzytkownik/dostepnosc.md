# Moja dostępność

Ekran **Moje** (`/moje`) służy do dwóch rzeczy: zgłaszania dostępności oraz
tworzenia własnej subskrypcji kalendarza.

## Zgłoszenie terminu

Formularz ma cztery pola i przycisk:

| Pole | Co wpisać |
| --- | --- |
| **Typ** | „Nie mogę”, „Wolę nie” albo „Chętnie wezmę” |
| **Od** | pierwszy dzień zakresu (`DD-MM-RRRR`) |
| **Do** | ostatni dzień zakresu; dla jednego dnia ta sama data co „Od” |
| **Powód (widzą koordynatorzy)** | opcjonalny |

„Dodaj” zapisuje wpis; pojawia się on na liście poniżej i można go stamtąd
usunąć.

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

Koordynator i administrator mają nad formularzem pole **Osoba**. Po wybraniu
kogoś formularz zgłasza dostępność w jego imieniu:

- osoba dostaje o tym powiadomienie,
- może wpis usunąć,
- operacja trafia do audytu jako „Zgłoszono dostępność (w imieniu)”.

Jeżeli Twoje konto samo nie jest w rotacji, wybór osoby jest obowiązkowy -
dopóki go nie zrobisz, ekran pokazuje prośbę o wskazanie osoby zamiast
formularza.

## Kiedy zgłaszać

Dostępność wpływa na grafik tylko wtedy, gdy istnieje **przed** wygenerowaniem
szkicu obejmującego te dni. Zgłoszenie po publikacji nie zmienia grafiku
samo z siebie - trzeba wtedy skorzystać z [zamiany](zamiany.md).

## Subskrypcja kalendarza (ICS)

Sekcja „Subskrypcja kalendarza (ICS)” na dole ekranu tworzy adres, który
pokazuje **wyłącznie Twoje dyżury**.

1. Wpisz nazwę subskrypcji (na przykład „Mój kalendarz”) i kliknij
   „Utwórz adres ICS”.
2. Skopiuj adres przyciskiem kopiowania.
3. Dodaj go w aplikacji kalendarza jako subskrypcję adresu internetowego.

Dyżury pojawią się jako wydarzenia całodniowe. Korekty i zatwierdzone zamiany
przychodzą jako **aktualizacje istniejących wpisów**, nie jako nowe.

Adres można odwołać w dowolnym momencie - przestaje działać natychmiast.
Przełącznik nad listą pokazuje także adresy już odwołane.
