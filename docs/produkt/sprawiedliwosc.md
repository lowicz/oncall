# Sprawiedliwość

Raport sprawiedliwości odpowiada na jedno pytanie: **czy podział dyżurów jest
równy, a jeśli nie - o ile i w którą stronę.**

## Co jest liczone

- **Tylko faktycznie odbyte dyżury**, z grafików opublikowanych i zastąpionych.
  Szkice nie liczą się w ogóle.
- **Okno kroczące 12 miesięcy**, kończące się dniem odniesienia.
- Każdy slot jest liczony z **efektywnej wersji grafiku**, czyli po override'ach
  i zatwierdzonych zamianach. Punkty trafiają do osoby, która faktycznie
  dyżurowała, a nie do pierwotnie przydzielonej.
- Dzień pokryty przez dwie publikacje liczy się **raz**.

## Punkty

| Typ dnia | Punkty |
| --- | --- |
| dzień roboczy | 1 (X) |
| sobota, niedziela, święto ustawowe | 2 (2X) |

Mnożniki nie kumulują się. `PRIMARY` i `SECONDARY` dostają takie samo X lub 2X.

## Soczewki

Pięć kategorii bilansowanych **osobno**:

| Soczewka | Zakres |
| --- | --- |
| `PRIMARY` | dyżury w roli głównej |
| `SECONDARY` | dyżury w roli wspierającej |
| `11–19` | robocze zmiany 11-19 |
| Weekendy | dyżury on-call w soboty i niedziele |
| Święta | dyżury on-call w święta ustawowe wypadające w dni robocze |

Soczewka weekendów obejmuje sobotę i niedzielę, soczewka świąt - święta w dni
robocze, więc **żaden dzień nie jest liczony w obu naraz**.

Przy powiązaniu `11–19` z `PRIMARY` lub `SECONDARY` soczewka `11–19` pozostaje
informacyjna, bo jej przydziały wynikają z roli kotwiczącej. Przy powiązaniu
„Niezależnie od on-call” jest bilansowana przez solver na równi z pozostałymi.

## Uczciwy udział

Udział oczekiwany jest **proporcjonalny do liczby dni eligibility osoby w
oknie**, a nie do liczby osób w zespole. Osoba eligible przez pół okna ma
oczekiwany udział o połowę mniejszy.

Konsekwencja dla nowych osób: ktoś, kto właśnie wszedł do rotacji, **zaczyna z
neutralnym bilansem**. System nie tworzy mu długu za okres sprzed eligibility i
nie próbuje „nadrobić” całego roku większą liczbą dyżurów. Od dnia dołączenia
dostaje udział proporcjonalny do bieżącej dostępnej puli.

## Jak to czytać

Dla każdej kategorii ekran pokazuje trzy rzeczy:

1. **wykonane** - ile punktów osoba faktycznie odbyła,
2. **uczciwy udział do dziś** - ile powinna była odbyć,
3. **różnicę opisaną słowami**, nie samą liczbą.

Kliknięcie osoby prowadzi do listy jej konkretnych dyżurów, więc każdą liczbę
da się rozłożyć na dni.

Koordynator i administrator widzą cały zespół; członek zespołu widzi tylko
siebie.

## Wpływ na kolejne generowanie

Dodatnia różnica (powyżej udziału) **lekko zmniejsza**, a ujemna **lekko
zwiększa** preferencję kolejnych przydziałów. To wpływ miękki:

- nie jest gwarancją,
- nie łamie eligibility, dostępności ani reguł ciągłości,
- działa tylko o tyle, o ile pozwala waga „Równy udział”.

Ustawienie tej wagi na `0` wyłącza wyrównywanie całkowicie.
