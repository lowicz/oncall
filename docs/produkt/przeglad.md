# Przegląd produktu

## Po co to jest

Zespół utrzymania pełni dyżury poza godzinami pracy. Bez narzędzia grafik
powstaje w arkuszu: układanie zajmuje godziny, nikt nie potrafi wykazać, że
podział jest równy, a zamiana jednego dnia wymaga rozmowy i ręcznej poprawki w
kilku miejscach naraz.

Erste On-call ma trzy cele:

1. **Skrócić przygotowanie grafiku** - koordynator podaje zakres dat, a solver
   układa obsadę zgodną z regułami twardymi.
2. **Uczynić podział mierzalnym** - każdy widzi, ile dyżurów odbył i jaki
   udział by mu się należał.
3. **Umożliwić bezpieczną zmianę po publikacji** - zamiana jednego dnia nie
   przelicza reszty grafiku i zostawia ślad w audycie.

## Co aplikacja obsługuje

Każdy dzień ma trzy niezależne przydziały:

| Przydział | Kiedy występuje | Kto |
| --- | --- | --- |
| `PRIMARY` | codziennie | jedna osoba z uprawnieniem do tej roli |
| `SECONDARY` | codziennie | inna osoba niż `PRIMARY` |
| `11–19` | wyłącznie w polskie dni robocze | osoba z uprawnieniem do tej zmiany |

Jedna doba jest zawsze osobnym przydziałem, nawet w trybie tygodniowym. Dzięki
temu można zamienić pojedynczy dzień, nie ruszając reszty tygodnia.

## Słownik

| Pojęcie | Znaczenie |
| --- | --- |
| **dyżur (on-call)** | obsada jednej roli w jednym dniu |
| **eligibility** | uprawnienie osoby do pełnienia danej roli w danym zakresie dat |
| **dostępność** | zgłoszenie osoby: „nie mogę”, „wolę nie”, „chętnie wezmę” |
| **szkic (draft)** | wynik generatora; nie obowiązuje nikogo |
| **publikacja** | moment, od którego grafik obowiązuje i jest widoczny dla wszystkich |
| **override** | ręczna korekta jednego slotu opublikowanego grafiku |
| **zamiana (swap)** | wniosek o zastępstwo na konkretny dzień i rolę |
| **2X** | podwójna stawka punktowa za sobotę, niedzielę lub święto ustawowe |
| **soczewka** | kategoria bilansowana osobno: `PRIMARY`, `SECONDARY`, `11–19`, weekendy, święta |

## Cykl życia grafiku

```
draft ──► proposed ──► published ──► superseded
  ▲           │
  └───────────┘  (cofnięcie do szkicu)
```

- **draft** - świeży wynik generatora. Koordynator może poprawiać pojedyncze
  komórki, usunąć szkic albo wygenerować kolejny.
- **proposed** - szkic przekazany do akceptacji. Treść jest zamrożona.
- **published** - grafik obowiązuje. Od tego momentu widzą go wszyscy, także
  konta podglądowe, a zmiany odbywają się przez zamiany i korekty.
- **superseded** - grafik zastąpiony przez nowszą publikację pokrywającą jego
  zakres. Historia dyżurów pozostaje policzalna.

Każde przejście sprawdza oczekiwaną wersję grafiku (optimistic locking), więc
dwie osoby nie nadpiszą się nawzajem po cichu.

## Przepływ pracy w miesiącu

1. Osoby zgłaszają dostępność na nadchodzący okres.
2. Koordynator generuje szkic (maksymalnie 35 dni na jedno uruchomienie).
3. Koordynator ogląda prognozę sprawiedliwości i poprawia pojedyncze komórki.
4. Szkic idzie do akceptacji, a potem do publikacji.
5. Publikacja rozsyła powiadomienia i aktualizuje kanały ICS.
6. Pojedyncze dni zmieniają się przez zamiany albo korekty koordynatora.
7. Na koniec miesiąca koordynator pobiera raport CSV dla kadr.

## Czego aplikacja nie robi

- Nie dzwoni i nie przełącza numerów telefonu - wysyła tylko przypomnienie
  o przełączeniu.
- Nie zastępuje ewidencji czasu pracy; raport miesięczny jest wejściem do niej.
- Nie integruje się z Slackiem ani Teams; kanałem powiadomień jest e-mail,
  a model powiadomień jest przygotowany na kolejne kanały.
- Nie rozstrzyga sporów: reguły miękkie są preferencjami, nie gwarancjami.
