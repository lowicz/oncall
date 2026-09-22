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

Na szerokim ekranie po lewej jest **listwa nawigacji**, od góry:

- znak `E/` z nazwą aplikacji ustawioną przez administratora (pod nią
  podtytuł, jeśli jest ustawiony),
- ekrany codzienne: **Teraz**, **Grafik**, **Moje**, **Zamiany**,
- sekcja **Koordynacja**: **Generator**, **Sprawiedliwość**, **Raport
  miesięczny**, **Import historii**,
- sekcja **Administracja**: **Osoby**, **Wydarzenia**, **Udostępnienia**,
  **Audyt**,
- na dole link **Dokumentacja**, przycisk **Paleta** (`Ctrl K`) i numer
  wersji aplikacji.

Widoczne są tylko te pozycje, do których masz uprawnienia. Liczba zamian
czekających na Twoją decyzję pojawia się jako znacznik przy pozycji „Zamiany”.

Nad treścią każdego ekranu biegnie pasek **Dyżur teraz**: kto ma dziś
`PRIMARY`, `SECONDARY` i `11–19`, z telefonem i czasem do końca dyżuru, pole
**Szukaj…** otwierające paletę poleceń oraz Twój awatar: zdjęcie z katalogu
firmowego, jeśli Twoje konto je ma, albo inicjały. Kliknięcie awatara
otwiera menu konta: nazwa i rola, motyw, gęstość macierzy, link do
dokumentacji, paleta poleceń, **Wyloguj** i na samym dole numer wersji
aplikacji, która właśnie działa (ten sam, co u dołu listwy).

Na telefonie listwa znika, a u dołu ekranu są zakładki **Teraz**, **Grafik**,
**Moje**, **Zamiany** i **Więcej**. Pod „Więcej” są pozostałe ekrany Twojej
roli, motyw, gęstość, dokumentacja, wylogowanie i numer wersji.

## Paleta poleceń

`Ctrl K` (na Macu `⌘ K`), pole **Szukaj…** albo przycisk **Paleta** otwiera
paletę. Wpisz:

- nazwisko - otworzy grafik z podświetlonym wierszem tej osoby,
- dzień (`24 wrz`, `24.09`, `24-09-2026` albo `2026-09-24`) - otworzy grafik
  z panelem tego dnia,
- nazwę ekranu albo akcję: motyw, dokumentacja, wylogowanie.

Strzałki wybierają pozycję, `Enter` ją uruchamia, `Esc` zamyka paletę.

## Motyw i gęstość

W menu konta (na telefonie na ekranie „Więcej”) wybierasz motyw: **Ciemny**
(domyślny), **Jasny** albo **Systemowy**, który podąża za ustawieniem systemu
operacyjnego. **Gęstość macierzy** zmniejsza komórki grafiku, żeby dłuższy
zakres mieścił się bez przewijania. Oba wybory zostają zapamiętane w
przeglądarce i obowiązują także w tej dokumentacji.

## Format dat

Daty w aplikacji są wyświetlane jako **`DD-MM-RRRR`**, niezależnie od ustawień
językowych komputera. Pola dat w formularzach są polami dat przeglądarki:
datę wpisujesz w układzie, który pole podpowiada, albo wybierasz dzień z
kalendarza przeglądarki. Pole nie przyjmie daty, która nie istnieje, a tam,
gdzie formularz ma zakres, pole **Do** nie pozwala wybrać dnia przed **Od**.
Miesiąc w raporcie rozliczeniowym wybiera się w taki sam sposób.

## Dostępność

Aplikacja celuje w WCAG 2.2 AA:

- wszystko działa z klawiatury, a fokus jest widoczny,
- macierz kalendarza ma alternatywę tabelaryczną i tryb dla małych ekranów,
- status jest zawsze przekazywany **tekstem**, nie samym kolorem,
- ustawienie „ogranicz animacje” w systemie jest respektowane.
