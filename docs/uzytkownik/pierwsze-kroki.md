# Pierwsze kroki

## Logowanie

1. Otwórz adres aplikacji podany przez administratora.
2. Wpisz **login** i **hasło**, potem „Zaloguj”.
3. Przycisk „Pokaż hasło” odsłania wpisywane znaki, jeśli chcesz je sprawdzić.

Jeżeli firma ma włączone logowanie z katalogu (LDAP / Active Directory), użyj
tych samych danych co do komputera. Konto powstanie przy pierwszym udanym
logowaniu.

Komunikat **„Nieprawidłowy login lub hasło”** pojawia się także wtedy, gdy konto
zostało wyłączone - w takim wypadku skontaktuj się z administratorem.

## Hasło

- Hasło musi mieć **co najmniej 12 znaków**.
- Nie ma samodzielnego „zapomniałem hasła”. Poproś administratora o
  **jednorazowy link resetujący**; otwiera on ekran ustawienia nowego hasła.
- Link do aktywacji nowego konta działa tak samo.
- Konta z katalogu nie mają hasła lokalnego - zmienia się je tam, gdzie zwykle.

## Co widzisz po zalogowaniu

Górny pasek zawiera, od lewej:

- znak firmowy `E/ ON-CALL`,
- nawigację główną: **Dyżury**, **Moje**, **Zamiany**, **Generator**,
  **Sprawiedliwość** oraz menu **Administracja** - widoczne są tylko te pozycje,
  do których masz uprawnienia,
- link **Dokumentacja**, który otwiera tę dokumentację,
- przełącznik motywu, etykietę roli, Twoją nazwę i przycisk **Wyloguj**.

Na wąskim ekranie nawigacja chowa się pod przyciskiem z trzema kreskami po
lewej stronie. W wysuwanym panelu są te same pozycje, link **Dokumentacja**,
przełącznik motywu, wylogowanie oraz Twoja nazwa i rola.

## Motyw

Ikona słońca / księżyca w prawym górnym rogu przełącza motyw ciemny i jasny.
Wybór zostaje zapamiętany w przeglądarce. Domyślny jest motyw ciemny.

## Format dat

Wszystkie pola dat czytają i przyjmują **`DD-MM-RRRR`**, niezależnie od ustawień
językowych komputera. Datę możesz:

- **wpisać** - wystarczy osiem cyfr, na przykład `31082026`; podpowiedź pod
  polem przypomina format, a niemożliwa data (jak `31-09`) zapala komunikat
  „Nieprawidłowa data” i nie zmienia wartości formularza,
- **wybrać z kalendarza** - kliknij ikonę kalendarza w polu, a potem dzień.
  Kalendarz otwiera się na miesiącu bieżącej wartości pola (dla pustego pola na
  bieżącym), zamyka się po wyborze i wpisuje datę w tym samym formacie.

Miesiąc w raporcie rozliczeniowym wybiera się analogicznie, w formacie
`MM-RRRR`.

## Dostępność

Aplikacja celuje w WCAG 2.2 AA:

- wszystko działa z klawiatury, a fokus jest widoczny,
- macierz kalendarza ma alternatywę tabelaryczną i tryb dla małych ekranów,
- status jest zawsze przekazywany **tekstem**, nie samym kolorem,
- ustawienie „ogranicz animacje” w systemie jest respektowane.
