# Model grafiku

## Dzień, rola, slot

Najmniejszą jednostką jest **slot**: jeden dzień i jedna rola. Grafik na 30 dni
to 30 slotów `PRIMARY`, 30 slotów `SECONDARY` i tyle slotów `11–19`, ile w tym
okresie wypada polskich dni roboczych.

Reguły twarde dotyczące slotów:

- Każdy dzień ma dokładnie jednego `PRIMARY` i jednego `SECONDARY`.
- `PRIMARY` i `SECONDARY` tego samego dnia to zawsze **różne osoby**.
- `11–19` występuje **wyłącznie w polskie dni robocze**. W soboty, niedziele i
  dni ustawowo wolne nie jest generowana ani możliwa do dodania ręcznie.
- Obsadzić slot może tylko osoba z ważnym eligibility na tę rolę i ten dzień.
- Osoba ze zgłoszonym „nie mogę” w danym dniu nie zostanie do niego przydzielona.

## Pokrycie dobowe

Domyślne okna dyżuru w strefie `Europe/Warsaw`:

| Typ dnia | Okno |
| --- | --- |
| dzień roboczy | 19:00-09:00 dnia następnego |
| sobota, niedziela, święto ustawowe | całą dobę |

Zmiana `11–19` obejmuje godziny 11:00-19:00 w dniu roboczym.

## Eligibility

Eligibility to **okres**, nie flaga: rola plus data początku i opcjonalna data
końca. Ta sama osoba może być eligible do `PRIMARY` od stycznia, do `SECONDARY`
od marca, a do `11–19` wcale.

Konsekwencje:

- Osoba wchodząca do rotacji w połowie roku nie ma „długu” za okres sprzed
  eligibility - patrz [Sprawiedliwość](sprawiedliwosc.md).
- Zakończenie eligibility nie kasuje historii; przeszłe dyżury nadal się liczą.
- Osoba bez eligibility do `11–19` nie blokuje roli kotwiczącej.

Rotacja (przynależność do zespołu dyżurowego) jest osobnym okresem: „wejście
od” i opcjonalne „wyjście do”.

## Dostępność

Członek zespołu zgłasza zakresy dat w trzech rodzajach:

| Rodzaj | Etykieta | Siła |
| --- | --- | --- |
| `unavailable` | **Nie mogę** | **reguła twarda** - solver nie obsadzi tego dnia |
| `prefer_not` | Wolę nie | preferencja miękka - solver unika, ale może przydzielić |
| `prefer` | Chętnie wezmę | preferencja miękka - solver preferuje |

Powód jest opcjonalny i prywatny: widzi go autor wpisu oraz koordynator i
administrator. Koordynator i administrator mogą zgłosić dostępność w imieniu
innej osoby; osoba dostaje o tym powiadomienie i może wpis usunąć.

## Dni wolne i stawka 2X

Kalendarz polskich świąt pochodzi z biblioteki `holidays` i jest ten sam dla
solvera, raportu sprawiedliwości i raportu miesięcznego - nie ma dwóch definicji
świąt, które mogłyby się rozjechać.

- Dzień roboczy = **1 punkt (X)**.
- Sobota, niedziela lub święto ustawowe = **2 punkty (2X)**.
- Mnożniki **nie kumulują się**: święto w sobotę to nadal 2X, nie 4X.
- Święto przypadające w weekend liczy się raz. W raporcie miesięcznym trafia do
  kategorii weekendu, w soczewkach sprawiedliwości weekend i święto nigdy nie
  liczą tego samego dnia dwa razy.

Weekendy i bloki świąteczne są regułą twardą bloku: solver przydziela cały blok
jednej osobie w danej roli. Podzielić blok można tylko ręcznie - korektą
koordynatora albo zamianą po publikacji.

## Rozrzedzanie dyżurów

W trybie dziennym i hybrydowym:

- najwyżej **3 dyżury on-call w dowolnych 7 kolejnych dniach** dla jednej osoby,
- minimum **2 dni przerwy** po serii co najmniej dwóch dni,
- drugi dyżur tej samej osoby w tym samym tygodniu ISO jest dodatkowo miękko
  karany.

Te reguły **nie obowiązują w trybie tygodniowym** - tydzień u jednej osoby
byłby wtedy nie do obsadzenia. Jeżeli obsada i nieobecności uniemożliwiają
spełnienie reguł rozrzedzania, solver zawiesza je, układa szkic według
pozostałych reguł i pokazuje jawne ostrzeżenie zamiast milczeć.

## Powiązanie zmiany 11–19

Ustawienie „Powiązanie 11–19” ma trzy wartości:

| Wartość | Znaczenie |
| --- | --- |
| Ta sama osoba co `SECONDARY` | domyślne |
| Ta sama osoba co `PRIMARY` | |
| Niezależnie od on-call | `11–19` bilansowane jak osobna rola |

Dla osoby eligible do obu ról zgodność jest **twarda**. Osoba bez eligibility
do `11–19` nie blokuje roli kotwiczącej - odstępstwo jest karane miękko i
widoczne w wyniku generatora. Twarda niedostępność i eligibility zawsze mają
pierwszeństwo przed powiązaniem.

## Wydarzenia kalendarza

Administrator może nanieść na macierz wydarzenia informacyjne (nazwa, zakres
dat, kolor). Są wyłącznie oznaczeniem wizualnym: **nie zmieniają grafiku,
stawek ani raportów** i nie wpływają na solver.

## Korekty i zamiany po publikacji

- **Korekta koordynatora (override)** - koordynator lub administrator zmienia
  przydział w jednej komórce bez zgody zastępcy i bez dodatkowego kroku
  akceptacji. Zapisuje override, korzysta z wersjonowania i dotyczy wyłącznie
  wybranego dnia i roli. Reguły twarde są sprawdzane przed zapisem, ale nie
  blokują korekty bezwarunkowo: w sytuacji awaryjnej koordynator może je
  **świadomie** złamać. Korekta łamiąca regułę twardą przechodzi tylko z jawnym
  potwierdzeniem - w API polem `acknowledge_rule_violations: true`; bez niego
  (albo z `false`) żądanie kończy się odpowiedzią `409` z listą naruszeń i
  niczego nie zmienia. Potwierdzone naruszenie trafia do dziennika audytu jako
  „świadome naruszenie reguł” wraz z identyfikatorami reguł. Tak samo działa
  korekta wsadowa przy zakończeniu rotacji.
- **Zamiana (swap)** - wniosek członka zespołu, który wymaga zgody zastępcy i
  zatwierdzenia koordynatora. Może objąć jedną rolę i dzień, obie role dnia,
  zakres albo cały tydzień. Zatwierdzenie tworzy override i **nie regeneruje
  pozostałych dni**, a punkty trafiają do osoby faktycznie dyżurującej.

Publikacja nowego grafiku jest serializowana w bazie, sprawdza pełne pokrycie i
zastępuje tylko te opublikowane grafiki, które w całości mieszczą się w nowym
zakresie. Częściowe nakładanie rozstrzyga się per slot, a pokrycie poza nowym
zakresem zostaje zachowane.
