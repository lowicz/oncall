# Administracja

Ekrany używane od czasu do czasu są w listwie nawigacji w sekcjach
**Koordynacja** (import historii, raport miesięczny) i **Administracja**
(osoby, wydarzenia, udostępnienia, audyt); na telefonie pod zakładką
**Więcej**. Widoczność pozycji zależy od roli - patrz
[Role i dostęp](../produkt/role-i-dostep.md).

## Osoby (`/osoby`, administrator)

Pod tytułem jest bilans kont: ile ich jest, ile osób w rotacji, kto wchodzi
do niej i kiedy, ile kont wyłączono i ile oczekuje na aktywację. Tabela **Konta** ma kolumny, które
administrator naprawdę czyta: osoba z e-mailem, login z numerem pracownika,
rola konta, rotacja (`W ROTACJI` z datą wejścia i kwalifikacjami, `OD 12 PAŹ`
dla osoby, która dopiero wchodzi, `zakończona`, „poza rotacją”), telefon
(brak u osoby w rotacji jest czerwony, bo pasek „Dyżur teraz” go potrzebuje)
i sposób logowania (lokalne albo LDAP / AD, a przy koncie lokalnym bez
hasła znacznik `OCZEKUJE NA AKTYWACJĘ` - patrz niżej). W nagłówku sekcji jest
pole wyszukiwania (osoba, login, numer, telefon) i filtry **Wszystkie**, **W
rotacji**, **Poza rotacją**, **Wyłączone**, **Oczekujące**. **Eksport CSV** zapisuje widoczne
wiersze, **Nowe konto** otwiera panel zakładania konta lokalnego.

Kliknięcie osoby (albo **Otwórz**) otwiera panel z trzema zakładkami:

- **Konto** - imię, nazwisko, login (bez zmian), numer pracownika, e-mail i
  telefon; telefon jest wymagany dla osób w rotacji, bo pokazuje go pasek
  „Dyżur teraz” i karta dyżurnego,
- **Rotacja** - stan rotacji, **kwalifikacje dyżurowe** jako chipy (zdjęcie
  chipa kończy okres roli z dniem wczorajszym, więc opublikowany grafik
  zostaje, a generator pomija rolę od następnego uruchomienia; dodanie chipa
  otwiera okres od dziś), „Wejście od” i „Wyjście do” oraz lista **okresów
  kwalifikacji** z możliwością edycji dat i dodania okresu,
- **Dostęp** - rola konta, przełącznik „Konto włączone” i, dla konta
  lokalnego, **jednorazowy link** resetu hasła albo - dopóki konto czeka na
  aktywację - nowy link aktywacyjny.

Konto bez rotacji ma na zakładce Rotacja przycisk **Dodaj do rotacji** z datą
wejścia. Link aktywacyjny nowego konta pokazuje się raz, po utworzeniu; link
przekaż osobie bezpiecznym kanałem.

### Konta oczekujące na aktywację

Nowe konto lokalne nie ma hasła, dopóki osoba nie otworzy linku aktywacyjnego
i go nie ustawi; do tego czasu nie może się zalogować, choć konto jest
włączone. Takie konto ma w kolumnie „Logowanie” znacznik `OCZEKUJE NA
AKTYWACJĘ` z terminem linku: żółty i „link aktywacyjny ważny do …”, póki link
działa, czerwony i „link aktywacyjny wygasł …” (albo „brak ważnego linku
aktywacyjnego”), gdy już nie działa. Ten sam znacznik jest w nagłówku panelu
osoby, a filtr **Oczekujące** pokazuje tylko takie konta. Znacznik jest niezależny od wyłączenia: konto wyłączone
przed aktywacją ma oba. Konta z katalogu (LDAP / AD) i konta, które mają już
hasło, nigdy go nie mają. Eksport CSV podaje ten stan w kolumnie `aktywacja`.

Na zakładce **Dostęp** takiego konta jest ramka „Oczekuje na aktywację” z
terminem linku i przyciskiem **Wygeneruj nowy link aktywacyjny**. Po
potwierdzeniu panel pokazuje nowy link, ważny 24 godziny; wcześniejsze linki
aktywacyjne tej osoby przestają działać, a w audycie zostaje wpis
„Wygenerowano link aktywacyjny”. Przycisk jest nieaktywny dla konta
wyłączonego - najpierw je włącz. Konto, które ma już hasło, dostaje zamiast
tego reset hasła (link ważny godzinę). Jak każdy link do konta, nowy link
przekaż osobie bezpiecznym kanałem; aplikacja go nie wysyła.

Numer pracownika ma znaczenie przy katalogu (LDAP / AD): musi zgadzać się z
`employeeNumber`, żeby konto lokalne powiązało się automatycznie przy pierwszym
logowaniu z katalogu.

Panel pilnuje niezapisanych zmian: przycisk **Zapisz** podaje ich liczbę, a
próba zamknięcia wypisze, co zostanie utracone. Zmiana roli i wyłączenie konta
wymagają dodatkowego potwierdzenia.

### Wyjście z rotacji

Ustawienie „Wyjście do” kończy rotację. Historia dyżurów **zostaje** i nadal
liczy się w raportach; kończy się tylko przydzielanie nowych dyżurów po tej
dacie. Dyżury już opublikowane po tej dacie trzeba przepisać - panel pokazuje
wtedy ostrzeżenie „Skutek dla grafiku” z przyciskiem **Przepisz przyszłe
dyżury i zakończ rotację…**, który dla każdego takiego dyżuru wybiera zastępcę.

### Usunięcie konta i danych osobowych

Przycisk **Usuń konto…** w stopce panelu otwiera czerwony arkusz z listą
skutków: konto zostaje wyłączone natychmiast, dane osobowe usunięte, historia
dyżurów i punkty zostają dla sprawiedliwości, a opublikowane dyżury tej osoby
po dziś pozostaną bez obsady. Operację potwierdza się, **wpisując login**
osoby; do tego czasu przycisk jest nieaktywny. Nie da się jej cofnąć.

## Wydarzenia kalendarza (`/wydarzenia`, administrator)

Warstwa informacyjna nanoszona na macierz: nazwa, zakres dat i kolor.

Wydarzenia **nie zmieniają grafiku, stawek ani raportów**. Służą do zaznaczenia
kontekstu, na przykład okna zmian produkcyjnych albo zamrożenia.

Pola „Pokaż od” i „Pokaż do” zawężają listę poniżej; „Od” i „Do” w formularzu
to zakres samego wydarzenia.

**Usuń** - tu i w panelu dnia na grafiku - pyta o potwierdzenie; usuniętego
wydarzenia nie da się przywrócić.

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

**Odwołanie działa natychmiast** po potwierdzeniu - trwające sesje z tego
linku przestają działać, a odwołanego linku nie da się przywrócić.

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
