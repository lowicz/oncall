---
name: On-call
description: Sterownia dyżurów - ciemna, gęsta, z jednym błękitem działania i trzema kolorami ról.
colors:
  night-navy: "#061228"
  control-navy: "#0B1F42"
  control-navy-2: "#122A52"
  control-navy-3: "#1B3765"
  line: "rgba(163, 181, 201, 0.16)"
  line-strong: "rgba(163, 181, 201, 0.34)"
  ink: "#F4F6FA"
  ink-muted: "#A3B5C9"
  ink-dim: "#93ABC1"
  action-blue: "#2870ED"
  action-ink: "#FFFFFF"
  signal-blue: "#65B8FF"
  signal-soft: "rgba(101, 184, 255, 0.16)"
  danger-red: "#BC3B51"
  primary-teal: "#65CDCF"
  secondary-violet: "#B17EAD"
  secondary-text: "#D5A8D2"
  late-salmon: "#FFB196"
  role-ink: "#0B1F42"
  ok-green: "#6CD99D"
  ok-soft: "rgba(108, 217, 157, 0.14)"
  warn-salmon: "#FFB196"
  warn-soft: "rgba(255, 177, 150, 0.14)"
  warn-text: "#FFB196"
  bad-pink: "#EB4C79"
  bad-text: "#FF8AAA"
  bad-soft: "rgba(235, 76, 121, 0.16)"
  today-wash: "rgba(101, 184, 255, 0.12)"
  weekend-wash: "rgba(163, 181, 201, 0.10)"
typography:
  display:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "32px"
    fontWeight: 700
    lineHeight: "36px"
  headline:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: "28px"
  title:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: "24px"
  section:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: "24px"
  body:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "21px"
  label:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: "16px"
  mono:
    fontFamily: "Geist Mono Variable, Geist Mono, ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
rounded:
  marker: "3px"
  xs: "4px"
  sm: "6px"
  md: "8px"
  control: "10px"
  lg: "12px"
  sheet: "16px"
  pill: "999px"
spacing:
  xxs: "2px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "48px"
components:
  button-default:
    backgroundColor: "{colors.control-navy}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "8px 18px"
    height: "40px"
  button-primary:
    backgroundColor: "{colors.action-blue}"
    textColor: "{colors.action-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "8px 18px"
    height: "40px"
  button-danger:
    backgroundColor: "{colors.danger-red}"
    textColor: "{colors.action-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "8px 18px"
    height: "40px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "8px 18px"
    height: "40px"
  button-small:
    rounded: "{rounded.pill}"
    typography: "{typography.label}"
    padding: "5px 14px"
    height: "32px"
  input:
    backgroundColor: "{colors.control-navy}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "40px"
  chip:
    backgroundColor: "{colors.control-navy}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "5px 12px"
  status-badge:
    backgroundColor: "{colors.control-navy-3}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "1px 9px 1px 8px"
  role-mark:
    backgroundColor: "{colors.primary-teal}"
    textColor: "{colors.role-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "2px 0"
    width: "32px"
  nav-link:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "8px 14px"
  nav-link-active:
    backgroundColor: "{colors.action-ink}"
    textColor: "{colors.control-navy}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "8px 14px"
  panel:
    backgroundColor: "{colors.control-navy}"
    rounded: "{rounded.lg}"
    padding: "12px 14px"
  dialog:
    backgroundColor: "{colors.control-navy}"
    rounded: "{rounded.lg}"
    padding: "16px"
    width: "540px"
  side-panel:
    backgroundColor: "{colors.control-navy}"
    padding: "16px 20px"
    width: "360px"
  toast:
    backgroundColor: "{colors.control-navy-3}"
    textColor: "{colors.ink}"
    typography: "{typography.mono}"
    rounded: "{rounded.md}"
    padding: "9px 12px"
    width: "380px"
  now-strip:
    backgroundColor: "{colors.action-blue}"
    textColor: "{colors.action-ink}"
    padding: "10px 16px"
---

# Design System: On-call

Zapis zastanego systemu wizualnego, odczytany z `frontend/src/tokens.css`
i `frontend/src/styles.css` (tryb skanowania Impeccable, bez wywiadu z
właścicielem). Wartości w nagłówku YAML są normatywne i odpowiadają
ciemnemu motywowi domyślnemu; motyw jasny podmienia te same nazwy zmiennych
(opis w sekcji Colors). Nazwy opisowe kolorów i „Gwiazda Północna" są
propozycją autora przeglądu, opartą na komentarzach w arkuszach.

## Overview

**Creative North Star: „Sterownia" (Control Room)**

Arkusz stylów sam nazywa się „Control Room stylesheet" (`styles.css:2`) i
to jest trafna metafora: ciemne, matowe granatowe tło, jeden pasek
sygnalizacyjny u góry mówiący, kto ma dyżur teraz, i gęsta macierz dni jako
główny instrument. Interfejs ma być czytany w sekundę przez osobę, która
właśnie dostała telefon o awarii, i operowany w skupieniu przez
koordynatora, który układa miesiąc. Nic nie jest ozdobą: kolor pojawia się
tylko tam, gdzie niesie znaczenie (rola, stan, działanie, dziś).

Gęstość jest celowa: 14 px tekstu podstawowego, 12 px etykiet, komórka
macierzy 35 px (29 px w trybie zwartym), panele z wewnętrznym odstępem
12-14 px. Pigułkowe przyciski i nawigacja (promień 999 px) są jedynym
miękkim elementem na tle prostokątnych paneli (12 px) i pól (8 px); łagodzą
pulpit, nie zmieniając jego charakteru. Światło to wariant, nie drugi
system: jasny motyw zachowuje te same nazwy, ten sam błękit działania i te
same wypełnienia ról, zmienia tylko powierzchnie i atrament.

**Key Characteristics:**
- ciemny granat domyślnie, biel jako wariant z tymi samymi tokenami;
- jeden błękit działania (`#2870ED`) na pasku „Teraz", przycisku głównym i
  aktywnej ikonie; drugi, jaśniejszy błękit sygnału (`#65B8FF`) na linkach,
  zaznaczeniach i fokusie;
- trzy stałe kolory ról: turkus `PRIMARY`, fiolet `SECONDARY`, łosoś `11–19`,
  identyczne w obu motywach, zawsze z granatowym atramentem;
- pigułki na wszystkim, co się klika (przyciski, nawigacja, chipy, odznaki),
  prostokąty na wszystkim, co się czyta (panele, pola, okna, komórki);
- Inter do tekstu, Geist Mono do dat, godzin, numerów i liczb w tabelach;
- bez cieni w ciemnym motywie poza oknami nad treścią; głębia przez
  trzy stopnie granatu (`s1`, `s2`, `s3`) i cienkie linie.

## Colors

Paleta to pięć stopni granatu, dwa błękity o różnych zadaniach, trzy
kolory ról i cztery kolory stanu; każdy ma odpowiednik w motywie jasnym pod
tą samą nazwą zmiennej.

### Primary
- **Błękit działania** (`#2870ED`, `--act`): tło paska „Teraz", przycisk
  główny, włączony segment przełącznika, ikona aktywnej pozycji nawigacji,
  pigułka „dziś" w nagłówku macierzy. W jasnym motywie bez zmian: pasek i
  szyna są granatowo-błękitne w obu motywach.
- **Błękit sygnału** (`#65B8FF`, `--sig`; w jasnym `#064EA1`): linki,
  podkreślenie aktywnej zakładki, obramowanie fokusu, zaznaczenie komórki,
  wybrany wiersz, ramka „box-sig". Oddzielony od błękitu działania, żeby
  tekst i wypełnienie zachowały kontrast każde na swoim tle.

### Secondary (role)
- **Turkus PRIMARY** (`#65CDCF`, `--p-fill`), **Fiolet SECONDARY**
  (`#B17EAD`, `--sec-fill`), **Łosoś 11–19** (`#FFB196`, `--late-fill`):
  wypełnienia znaczników ról w macierzy, chipów na pasku „Teraz" i kart
  dyżuru; zawsze z **granatowym atramentem ról** (`#0B1F42`, `--role-ink`).
  Jako kolor tekstu poza chipem rola przyjmuje wersję na dane tło (`--p`,
  `--sec`, `--late`; w jasnym motywie ciemniejsze `#036A6D`, `#721C7A`,
  `#B84800`). Na niebieskim pasku „Teraz" chip jest biały, a litera w kolorze
  ciemnym roli (`--band-p`, `--band-sec`, `--band-late`).

### Tertiary (stan)
- **Zieleń OK** (`#6CD99D` / tło `rgba(108,217,157,.14)`): status
  „Opublikowany", kryterium spełnione, „Chętnie wezmę".
- **Łosoś ostrzeżenia** (`#FFB196`, kropka `#FF6130`): status ostrzegawczy,
  przekroczenie udziału, kolizja dostępności; ten sam kolor co rola `11–19`,
  rozróżniany kontekstem.
- **Róż błędu** (`#EB4C79` / tło `rgba(235,76,121,.16)`): błędy, luki w
  obsadzie, „Nie mogę", nazwa osoby z konfliktem.
- **Czerwień niebezpieczeństwa** (`#BC3B51`, `--danger`): wyłącznie
  wypełnienie przycisku niszczącego.

### Neutral
- **Granat nocny** (`#061228`, `--bg`): tło strony.
- **Granat sterowni** (`#0B1F42`, `--s1`): panele, pola, okna, szyna
  nawigacji, atrament ról.
- **Granat drugi i trzeci** (`#122A52` `--s2`, `#1B3765` `--s3`): tło
  nagłówków macierzy, hover, odznaki, toasty, tor wskaźnika.
- **Linie** (`rgba(163,181,201,.16)` i `.34`): obramowania paneli, komórek,
  przycisków.
- **Atrament** (`#F4F6FA`), **przygaszony** (`#A3B5C9`), **wyciszony**
  (`#93ABC1`): tekst główny, pomocniczy, podpisy i placeholdery.
- **Warianty tekstowe stanu**: błąd (`#FF8AAA`, `--bad-text`) i SECONDARY
  (`#D5A8D2`, `--sec-text`) są jaśniejsze od kolorów kresek i wypełnień,
  aby zachować kontrast co najmniej 4,5:1 na `s1`, `s2`, `s3` i podkładach.
  Ostrzeżenie (`#FFB196`, `--warn-text`) barwi tytuł ramki `.box-warn`; w
  jasnym motywie jest ciemniejsze od `--warn` (`#A33F00` zamiast `#B84800`).
- **Podkłady dnia**: dziś (`rgba(101,184,255,.12)`), weekend
  (`rgba(163,181,201,.10)`).
- Motyw jasny: tło `#F4F6FA`, panele `#FFFFFF`, atrament `#303030`,
  nagłówki w granacie `#0B1F42` (`--hd`), linie `#E4EAF0`/`#A3B5C9`,
  tekst przygaszony `#4B6592` i wyciszony `#4E6A88` (oba co najmniej 4,5:1
  na `s3` i na podkładzie weekendu).

### Named Rules
**Reguła jednego błękitu działania.** `--act` występuje na jednym ekranie na
pasku „Teraz", na jednym przycisku głównym i na włączonym segmencie; nigdy
na tekście i nigdy jako tło sekcji.
**Reguła stałych ról.** Wypełnienia ról nie zmieniają się między motywami
ani ekranami; rola jest rozpoznawana po kolorze, zanim ktoś przeczyta
literę.
**Reguła zera heksów w komponentach.** Kolory istnieją tylko w `tokens.css`;
`styles.css` i komponenty nazywają wyłącznie zmienne (`styles.css:7-8`,
`AGENTS.md`).

## Typography

**Display Font:** Inter Variable (z Inter, system-ui)
**Body Font:** Inter Variable
**Label/Mono Font:** Geist Mono Variable (z ui-monospace)

**Character:** jedna neutralna rodzina w trzech wagach (400, 600, 700) i
jedno pismo stałej szerokości do wszystkiego, co jest datą, godziną,
numerem telefonu, skrótem klawiszowym albo liczbą w kolumnie. Bez kursywy,
bez wersalików rozstrzelonych; wersaliki tylko w nazwach ról `PRIMARY` i
`SECONDARY`, które są słownikiem produktu, nie stylem.

### Hierarchy
- **Display** (700, 32/36 px): tytuł ekranu `.ph-title`, tytuł logowania,
  „duża liczba" rozpiętości w panelu sprawiedliwości; na telefonie 24/28 px.
- **Headline** (700, 24/28 px): nazwisko na karcie dyżuru `.dcard-name`.
- **Title** (700, 20/24 px): główny nagłówek sekcji `.sech-title`, tytuł
  okna i panelu bocznego.
- **Section** (600, 16/24 px): nagłówek sekcji wewnątrz panelu i miesiąc.
- **Body** (400, 14/21 px): tekst podstawowy, pola, przyciski (600), wiersze
  list, komórki tabel.
- **Label** (600, 12/16 px): etykiety pól, nagłówki tabel, chipy, odznaki,
  kroki, sekcje szyny, wszystkie podpisy.
- **Mono** (400, 12/16 px; w kolumnach liczbowych 14/21 px): daty i zakresy
  pod nazwami, numery telefonów, meta sekcji, skróty `kbd`, toasty.

### Named Rules
**Reguła skali tekstu.** Treść ma 14 px, wszystko pomocnicze 12 px,
nagłówek sekcji i miesiąca 16 px, a tytuły 20, 24 albo 32 px.
Nowy element wybiera jeden z tych stopni i nic nie schodzi poniżej 12 px.
**Reguła mono dla danych.** Co jest datą, liczbą albo identyfikatorem,
stoi w Geist Mono, żeby kolumny się wyrównywały, a oko odróżniało dane od
opisu.

## Layout

Siatka powłoki: szyna nawigacji 232 px (`--rail-w`) przyklejona do lewej,
treść `minmax(0, 1fr)`; na 901-1100 px szyna zwija się do 56 px (same
ikony), poniżej 900 px znika na rzecz pięciu zakładek dolnych
(`.tabs-bottom`) i niebieskiego paska górnego `.mob-top`. Pasek „Teraz"
(`.now`) biegnie nad treścią przez całą szerokość i zawija narzędzia pod
spód przy kontenerze węższym niż 1100 px.

Strona: odstęp 24 px (telefon 16 px), sekcje w siatce o odstępie 20 px
(telefon 12 px), tekst ciągły ograniczony do 860 px (`.page-narrow`).
Podział dwukolumnowy `.split` daje treści `1fr` i panelowi bocznemu
320/340/380 px, na telefonie jedna kolumna. Rytm odstępów: 2, 4, 6, 8, 10,
12, 14, 16, 18, 20, 24, 48 px, z wyraźną przewagą 8-14 px wewnątrz
komponentów.

Nakładki: okno modalne 540 px (małe 420, duże 760) wyśrodkowane; panel
boczny 360 px (szeroki 420) od prawej, nie-modalny na biurku; na telefonie
oba stają się arkuszami od dołu z promieniem 16 px u góry i uchwytem
36×4 px. Toasty 380 px w prawym dolnym rogu, na telefonie u góry. Paleta
poleceń 560 px, 12 vh od góry.

Macierz: tabela z przyklejoną kolumną nazwisk 170 px i przyklejonym
dwuwierszowym nagłówkiem (miesiące 24 px, dni 40 px); komórki kwadratowe
35 px (29 px zwarte), szersze przy krótszych zakresach (48 px do 14 dni);
wiersz osoby 48 px; przewijanie w obrębie 70 vh.

## Elevation & Depth

System jest w zasadzie płaski. W ciemnym motywie głębię dają trzy stopnie
granatu (tło -> `s1` panel -> `s2` nagłówek/hover -> `s3` odznaka/toast)
i linie o przezroczystości 16 % i 34 %; cień pojawia się tylko pod
elementami, które naprawdę leżą nad treścią: okno modalne i paleta
(`--shadow`: `0 30px 60px -30px rgba(2,8,24,.8)`), menu, popover, tooltip
i toast (`--shadow-sm`: `0 10px 30px -12px rgba(2,8,24,.7)`), panel boczny
(własny cień w lewo). W motywie jasnym białe panele tracą obramowanie i
dostają jeden wspólny, delikatny cień (`0 2px 8px rgba(33,65,108,.08)`).

### Shadow Vocabulary
- **Nad treścią** (`--shadow`): okno modalne, paleta poleceń.
- **Obok treści** (`--shadow-sm`): menu, popover, tooltip, toast, białe
  panele w jasnym motywie.
- **Panel boczny** (`-30px 0 50px -40px rgba(0,0,0,.7)`): jedyny cień
  skierowany w bok.

### Named Rules
**Reguła płaskiego spoczynku.** Panel w ciemnym motywie nie ma cienia;
ma linię. Cień oznacza „to leży nad stroną i zniknie".
**Reguła wewnętrznej ramki.** Zaznaczenie i fokus w macierzy i kalendarzu
to `box-shadow: inset 0 0 0 2px`, nie zewnętrzna poświata, żeby siatka nie
drgała.

## Shapes

Dwa języki form: pigułka (999 px) dla wszystkiego interaktywnego i
etykietowego (przyciski, przyciski ikonowe 40/32 px, przełącznik
segmentowy, chipy, tagi, odznaki statusu, pozycje nawigacji, licznik przy
nawigacji, wskaźnik obciążenia) oraz prostokąt o małym promieniu dla
pojemników i pól: pola 8 px (`--r`), panele, okna, menu, popovery 12 px
(`--r-lg`), wiersze decyzji 10 px, znaczniki ról i chipy ról 6 px,
znaczniki dostępności 3 px, `kbd` 4 px, arkusze na telefonie 16 px u góry.
Ramki są cienkie (1 px) w
kolorze linii; stan „na" zmienia kolor ramki na sygnał (`--sig-line`),
stan zły na róż. Kafelek dnia w kalendarzu dostępności to 40 px wysokości
z promieniem 8 px. Awatar jest kołem. Wyróżnienie z lewej (3 px) jest
sygnaturą kart dyżuru (`.dcard::before`) i ramek informacyjnych (`.box`).

## Components

### Buttons
- **Shape:** pigułka (999 px), minimalna wysokość 40 px, tekst 600 14/21 px,
  odstęp 8×18 px; mała 32 px, 12/16 px, 5×14 px; ikona 24 px z ujemnym
  marginesem, żeby nie podnosić przycisku.
- **Domyślny:** tło `s1`, ramka `line2`, atrament główny; hover `s2`.
- **Główny:** błękit działania, biały tekst, bez ramki; hover
  `brightness(.95)`.
- **Niebezpieczny:** czerwień `--danger`, biały tekst; wyłącznie dla
  czynności nieodwracalnych.
- **Ghost:** bez tła i ramki, tekst przygaszony; hover tło `s2`.
- **Ikonowy** (`.ib`): koło 40 px (32 px małe), ramka `line`, kolor
  przygaszony; stan „on" w błękicie sygnału.
- **Fokus:** wspólny `outline: 2px solid var(--focus)` z odsunięciem 2 px;
  wyłączony: `opacity: .5`.
- **Segmentowy** (`.seg`): pigułka z ramką, przyciski 32 px, włączony
  w błękicie działania, warianty z tonem dostępności (róż, szary, zieleń) na
  tle o 20 % krycia.

### Chips
- **Style:** pigułka 12/16 px 600, odstęp 5×12 px, tło `s1`, ramka `line2`,
  kropka 8 px z lewej; tony `warn`, `bad`, `ok`, `sig` zmieniają kropkę i
  ramkę.
- **State:** chip-przycisk ciemnieje na hover; chip filtra
  (`.filter-chip`) ma tło i ramkę sygnału i przycisk usunięcia.
- **Odznaka statusu** (`.st`): pigułka z kropką, tło według stanu (szkic
  `s3`, do akceptacji `sig-soft`, opublikowany `ok-bg`, ostrzeżenie,
  błąd).
- **Tag** (`.tag`): pigułka bez kropki, tło `s3`, tekst przygaszony.

### Cards / Containers
- **Corner Style:** 12 px (`--r-lg`).
- **Background:** `s1`, ramka 1 px `line`; w jasnym motywie biel bez ramki z
  cieniem `--shadow-sm`.
- **Shadow Strategy:** brak w spoczynku (sekcja Elevation).
- **Internal Padding:** 12×14 px (`.panel-padded`); pasek narzędzi 8×10 px z
  dolną linią.
- **Karta dyżuru** (`.dcard`): jak panel plus pasek 3 px z lewej w kolorze
  roli, nazwisko 24/28 px, okno dyżuru w mono.
- **Ramka informacyjna** (`.box`): lewy pasek 3 px, tło `s2`, tekst
  12/16 px; tony `warn`, `bad`, `ok`, `sig` barwią pasek, tło i tytuł.

### Inputs / Fields
- **Style:** 40 px wysokości, ramka 1 px `line2`, promień 8 px, tło `s1`,
  tekst 14/21 px; etykieta 600 12/16 px przygaszona nad polem, podpowiedź
  wyciszona i błąd różowy pod polem (12/16 px); wymagane oznaczone różową
  gwiazdką.
- **Focus:** ramka w błękicie sygnału i poświata 3 px `sig-soft`, bez
  outline.
- **Error / Disabled:** `aria-invalid` daje różową ramkę; wyłączone
  `opacity: .6`.
- **Natywne:** daty, miesiące i godziny w Geist Mono; `<select>` z własną
  strzałką `.sel-wrap::after`; pole wyboru z `accent-color` sygnału.

### Navigation
- **Szyna** (`.rail`): granat sterowni, 232 px, pozycje-pigułki 8×14 px
  500; hover białe 8 %; aktywna biała z granatowym tekstem 600 i ikoną w
  błękicie działania; licznik w łososiu z granatowym tekstem; nagłówki
  sekcji 600 12 px przygaszone; stopka ze skrótami.
- **Pasek „Teraz"** (`.now`): błękit działania, biały tekst, sloty z białą
  linią 24 %, chipy ról białe, telefon w mono, wyszukiwarka jako pigułka z
  białą ramką 40 %.
- **Zakładki** (`.tab`, `.sech-link`): tekst 600 14 px, podkreślenie 1.5 px
  przezroczyste, wybrana 2 px w błękicie sygnału; licznik w `s3`.
- **Telefon:** pasek górny w błękicie działania, pięć zakładek dolnych
  (ikona nad etykietą 12 px, aktywna biała), bezpieczny margines dolny.

### Overlays
- **Okno** (`.dialog-popup`): 540 px, `s1`, ramka `line2`, 12 px, odstęp
  16 px, tytuł 20/24 px (w oknie `danger` różowy), opis przygaszony,
  akcje wyrównane do prawej; backdrop czerń 45 %.
- **Panel boczny** (`.panel-popup`): 360 px od prawej, trzy strefy (nagłówek
  18×20×12 px z linią, treść 16×20 px, stopka 12×20 px z linią); modalny ma
  uchwyt.
- **Toast** (`.toast`): `s3`, ramka `line2`, 8 px, 12/16 px, kropka stanu
  z lewej, miejsce na przycisk z prawej; wjazd 8 px z zanikaniem 0,2 s.
- **Popover / menu / tooltip:** `s1`/`s3`, 12 px (tooltip 6 px),
  `--shadow-sm`, pozycje menu 8×10 px z podświetleniem `s2`.

### Macierz dyżurów (komponent sygnaturowy)
Tabela `table.m` o komórkach `--cell` (35 px, zwarte 29 px) z przyklejoną
kolumną nazwisk 170 px i nagłówkiem dwuwierszowym; komórka to przycisk
`.cell` bez ramki, hover `s2`, zaznaczenie wewnętrzną ramką 2 px w kolorze
fokusu. Wewnątrz znaczniki ról `.rm` (32×20 px, 6 px, 700 12 px, wypełnienie
roli, atrament granatowy) z kropką/rombem korekty, znacznik dostępności
`.am` (22 px, 3 px) i kropka wydarzenia 5 px w prawym górnym rogu. Weekend
ma podkład szary 10 % (8 % w jasnym motywie), dziś błękitny 12 % i pigułkę z numerem dnia w błękicie
działania, luka w obsadzie podkład różowy. W przyklejonym nagłówku każdy
podkład leży na nieprzezroczystym `s2`. Początek tygodnia to lewa linia
2 px.

## Do's and Don'ts

### Do:
- **Do** bierz każdy kolor ze zmiennej w `tokens.css` i każdy napis z
  `src/i18n/pl/`; komponent nie zna heksa ani polskiego słowa.
- **Do** używaj pigułki dla elementu, który się klika albo etykietuje, i
  prostokąta 8/12 px dla pojemnika, który się czyta.
- **Do** pisz daty, godziny, numery i liczby w kolumnach w Geist Mono,
  formatem DD-MM-RRRR i przecinkiem dziesiętnym (`lib/dates.ts`,
  `lib/numbers.ts`).
- **Do** zachowuj skalę 12 px dla treści pomocniczej, 14 px dla treści,
  16 px dla nagłówka sekcji i miesiąca oraz 20/24/32 px dla tytułów.
- **Do** oznaczaj rolę kolorem wypełnienia z granatowym atramentem, w obu
  motywach tak samo.
- **Do** sygnalizuj stan kropką w pigułce (`.st`, `.chip`) albo lewym
  paskiem 3 px (`.box`, `.dcard`, `.list-row-warn`), nie zmianą całego tła
  sekcji.
- **Do** projektuj każdy ekran w trzech szerokościach: ≤900 px (zakładki
  dolne, arkusze od dołu), 901-1100 px (szyna 56 px), >1100 px.

### Don't:
- **Don't** nie dodawaj cienia panelowi w spoczynku w ciemnym motywie; cień
  jest zarezerwowany dla nakładek.
- **Don't** nie używaj błękitu działania jako koloru tekstu ani tła sekcji;
  tekstowy błękit to `--sig`.
- **Don't** nie wprowadzaj drugiego akcentu, gradientów (poza radialnym tłem
  logowania) ani ikon kolorowych; ikony są monochromatyczne 24 px.
- **Don't** nie dodawaj biblioteki komponentów ani własnych selektorów dat;
  pola są natywne (`AGENTS.md`).
- **Don't** nie zapisuj liczb ani nazw dni w komponencie; wszystko przez
  `lib/numbers.ts` i `lib/dates.ts`.
- **Don't** nie różnicuj tego samego stanu różnymi kolorami na różnych
  ekranach; `ok`/`warn`/`bad`/`sig` to cały słownik stanu.
