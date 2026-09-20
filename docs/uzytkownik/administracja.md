# Administracja

Ekrany używane od czasu do czasu są w listwie nawigacji w sekcjach
**Koordynacja** (import historii, raport miesięczny) i **Administracja**
(osoby, wydarzenia, udostępnienia, audyt); na telefonie pod zakładką
**Więcej**. Widoczność pozycji zależy od roli - patrz
[Role i dostęp](../produkt/role-i-dostep.md).

## Osoby (`/osoby`, administrator)

Tabela kont z rolą, statusem, adresem e-mail i uprawnieniami; pasek nad nią
filtruje po tekście, roli i statusie, a przycisk **Nowe konto lokalne** otwiera
formularz zakładania konta. Kliknięcie wiersza otwiera panel szczegółów z
trzema zakładkami:

- **Konto** - nazwa wyświetlana, login, e-mail (opcjonalny, widoczny dla
  zalogowanych osób na karcie dyżurnego), numer kadrowy, rola i to, czy konto
  jest aktywne,
- **Rotacja** - „Wejście od” i opcjonalnie „Wyjście do”,
- **Eligibility** - okresy uprawnień: rola dyżurowa oraz „Od” i opcjonalne
  „Do”. Okresów może być wiele; każdy dotyczy jednej roli.

Stąd też generuje się **jednorazowy link** do aktywacji konta lub resetu hasła.
Link przekaż osobie bezpiecznym kanałem.

Numer kadrowy ma znaczenie przy katalogu (LDAP / AD): musi zgadzać się z
`employeeNumber`, żeby konto lokalne powiązało się automatycznie przy pierwszym
logowaniu z katalogu.

Panel pilnuje niezapisanych zmian: przy próbie zamknięcia wypisze, co zostanie
utracone.

### Wyjście z rotacji

Ustawienie „Wyjście do” kończy rotację. Historia dyżurów **zostaje** i nadal
liczy się w raportach; kończy się tylko przydzielanie nowych dyżurów po tej
dacie.

## Wydarzenia kalendarza (`/wydarzenia`, administrator)

Warstwa informacyjna nanoszona na macierz: nazwa, zakres dat i kolor.

Wydarzenia **nie zmieniają grafiku, stawek ani raportów**. Służą do zaznaczenia
kontekstu, na przykład okna zmian produkcyjnych albo zamrożenia.

Pola „Pokaż od” i „Pokaż do” zawężają listę poniżej; „Od” i „Do” w formularzu
to zakres samego wydarzenia.

## Import historii (`/import`, koordynator)

1. Pobierz szablon CSV ze strony albo użyj `examples/history.csv`.
2. Uzupełnij kolumny `service_date` (`RRRR-MM-DD`), `role` (`primary`,
   `secondary`, `late_shift`) i `assignee_name` (dokładna nazwa wyświetlana).
3. Zapisz jako **UTF-8**, maksymalnie 5000 wierszy.
4. Wgraj plik - najpierw zobaczysz **podgląd** z wykrytymi duplikatami,
   nieznanymi osobami i konfliktami.
5. Zatwierdź import.

`late_shift` jest przyjmowany **tylko w polskie dni robocze**; wiersz z tą rolą
w sobotę, niedzielę albo święto zostanie odrzucony z podaniem numeru wiersza.

Import zasila historię, z której liczą raport sprawiedliwości i generator.

## Raport miesięczny (`/raporty`, koordynator)

1. Wybierz miesiąc rozliczenia (`MM-RRRR`).
2. Obejrzyj podgląd - jeden wiersz na osobę.
3. „Pobierz CSV”.

Ekran ostrzega, jeśli opublikowany grafik nie pokrywa całego miesiąca, i podaje,
ile dni pokrywa. Opis kolumn jest w [Integracje](../produkt/integracje.md#raport-miesięczny-dla-kadr).

Każdy slot liczy się z efektywnej wersji grafiku, po korektach i zamianach.
Święto przypadające w sobotę lub niedzielę liczy się raz, jako weekend.

## Udostępnienia (`/udostepnienia`, administrator)

Linki podglądowe dla osób bez konta.

1. Podaj **Odbiorcę** (etykietę, po której poznasz, komu link służy).
2. Ustaw zakres **Grafik od** - **Grafik do**.
3. Wybierz **Ważność linku**: 1, 3, 7, 14 albo 30 dni.
4. „Utwórz link” i skopiuj adres - jest pokazywany tylko raz.

Otwarcie linku wymienia jednorazowy token na ograniczoną sesję podglądową, a
token znika z paska adresu. Sesja widzi wyłącznie opublikowany grafik przycięty
do zakresu linku.

**Odwołanie działa natychmiast** - trwające sesje z tego linku przestają
działać.

Stałą formą dostępu dla osoby spoza rotacji jest imienne konto `viewer`; link
czasowy jest wyjątkiem.

## Audyt (`/audyt`, administrator)

Dziennik istotnych operacji, najnowsze na górze, czasy w strefie
`Europe/Warsaw`.

Filtry: akcja, osoba, wyszukiwanie tekstowe oraz zakres dat. Rutynowe logowania
są domyślnie ukryte - włącza je przełącznik „Pokaż zwykłe logowania”; ekran
przypomina o tym, gdy filtrujesz po osobie lub tekście.

Wynik filtra można wyeksportować do CSV.

Zapis audytu powstaje w **tej samej transakcji** co sama zmiana, więc nie ma
zmian bez śladu. Etykieta aktora jest zapisana wprost, więc wpis przetrwa
usunięcie konta i opisze także aktora niebędącego użytkownikiem, na przykład
link podglądowy.
