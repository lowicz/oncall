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

Ekran **Sprawiedliwość** (`/sprawiedliwosc`) podaje kryterium i jego wynik
już w podtytule: „12 miesięcy do 30 wrz · 5 osób · kryterium: nikt poza
±2,0 pkt od udziału” ze znacznikiem **SPEŁNIONE** albo **NIESPEŁNIONE**.
Pod nim rząd znaczników z liczbami, które koordynator i tak liczy w głowie:
rozpiętość każdej soczewki z werdyktem, średnia punktów na osobę i średnia
dni weekendowych. Znacznik soczewki, która nie spełnia kryterium, po najechaniu
nazywa osobę najwyżej i najniżej.

Sekcja **Zespół** to jedna tabela: dla każdej osoby odchylenie od udziału
jako pasek dwukierunkowy (ponad udział w prawo, poniżej w lewo), potem
**Razem** i każda soczewka jako `wykonane / udział` w kolumnach liczbowych.
Linki w nagłówku sekcji (**Razem**, `PRIMARY`, `SECONDARY`, `11–19`,
**Weekendy**, **Święta**) zmieniają tylko sortowanie i to, którą soczewkę
pokazuje pasek. Rola, której osoba nie pełni, ma zamiast liczb „nie pełni tej
roli”; niski wynik osoby, która weszła do rotacji w trakcie okna, ma dopisek
„w rotacji od”.

Strzałka na końcu wiersza rozwija osobę: punkty miesiąc po miesiącu jako
słupki na tle jej średniej miesięcznej, liczby w słowach, odchylenie na każdej
soczewce, lista dyżurów składających się na wynik i to, co zrobi z tym
generator. **Eksport CSV** zapisuje tabelę; **Stan na dzień** przesuwa koniec
okna - domyślnie na koniec ostatniej publikacji, więc liczą się też dyżury
już zaplanowane.

Koordynator i administrator widzą cały zespół; członek zespołu widzi tylko
siebie (skrót swojego wyniku ma też na ekranie Moje).

## Wpływ na kolejne generowanie

Dodatnia różnica (powyżej udziału) **lekko zmniejsza**, a ujemna **lekko
zwiększa** preferencję kolejnych przydziałów. To wpływ miękki:

- nie jest gwarancją,
- nie łamie eligibility, dostępności ani reguł ciągłości,
- działa tylko o tyle, o ile pozwala waga „Równy udział”.

Ustawienie tej wagi na `0` wyłącza wyrównywanie całkowicie.
