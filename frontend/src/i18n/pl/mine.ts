import { pluralPl } from '../../lib/plural'

/** The member's own screen (`src/screens/Mine.tsx`): duties, the availability calendar, points, swaps, the ICS feeds. */
export const mine = {
  title: 'Moje dyżury',
  outsideRotation: 'poza rotacją',
  dutiesInLast90Days: (count: number) => `${pluralPl(count, ['dyżur', 'dyżury', 'dyżurów'])} w ostatnich 90 dniach`,
  next: 'następny:',
  noDutyIn60Days: 'brak w najbliższych 60 dniach',
  exportIcs: 'Subskrypcja ICS',
  proposeSwap: 'Zaproponuj zamianę',
  duties: {
    heading: 'Najbliższe dyżury',
    meta: (count: number) => `najbliższe 60 dni · ${count}`,
    schedule: 'Grafik',
    loading: 'Wczytywanie dyżurów…',
    emptyTitle: 'Brak nadchodzących dyżurów',
    emptyDescription: 'W najbliższych 60 dniach nie masz przydzielonego dyżuru.',
    details: 'Szczegóły',
    swap: 'Zamień',
    ongoing: 'trwa',
    /** The duty a colleague holds on the same day, spelled out in full. */
    partnerRoles: { primary: 'Primary', secondary: 'Secondary', late_shift: '11–19' },
    afterCorrection: 'po korekcie',
    collision: 'kolizja',
    showCollision: (day: string) => `Kolizja z Twoją niedostępnością ${day}: pokaż w kalendarzu`,
  },
  calendar: {
    label: (month: string) => `Kalendarz dostępności, ${month}`,
    reason: (note: string) => `powód: ${note}`,
    filedBy: (name: string) => `wpis: ${name}`,
    duty: (roles: string) => `dyżur: ${roles}`,
    dutyCollision: 'kolizja z dyżurem',
    entryTitle: (kind: string, note: string) => `${kind}: ${note}`,
    /** The letter a painted day carries, the initial of the kind's name. */
    marks: {
      unavailable: 'N',
      prefer_not: 'W',
      prefer: 'C',
    },
  },
  availability: {
    heading: 'Moja dostępność',
    headingFor: (name: string) => `Dostępność: ${name}`,
    person: 'Osoba',
    myself: (name: string) => `Ja (${name})`,
    pickPerson: 'Wskaż osobę',
    brush: 'Zaznaczam jako',
    brushes: {
      unavailable: 'nie mogę',
      prefer_not: 'wolę nie',
      prefer: 'chętnie',
      clear: 'Wyczyść zaznaczenie',
    },
    previousMonth: 'Poprzedni miesiąc',
    nextMonth: 'Następny miesiąc',
    pickTitle: 'Wybierz osobę',
    pickDescription: 'Twoje konto nie jest w rotacji. Wskaż osobę, w imieniu której chcesz zgłosić dostępność.',
    howTo: 'Kliknij dzień albo przeciągnij po kilku. Zapisujemy od razu.',
    /** Said on a device with a keyboard and a mouse only; a phone has no Shift. */
    howToShift: 'Shift+klik zaznacza zakres.',
    /** The phone, where the first tap starts a range and the second closes it. */
    howToTouch: 'Dotknij pierwszego i ostatniego dnia zakresu (jeden dzień: dwa razy ten sam). Zapisujemy od razu.',
    legend: {
      link: 'Legenda',
      title: 'Legenda kalendarza',
      duty: 'Kropka: masz w tym dniu dyżur.',
      collision: 'Bursztynowa obwódka: wpis „nie mogę” w dniu z dyżurem.',
    },
    note: 'Powód do kolejnych wpisów',
    noteHint: 'Opcjonalny · widzą koordynatorzy i administratorzy.',
    /** A range started by a tap on the phone, waiting for its last day. */
    range: {
      from: (day: string) => `Zakres: od ${day}`,
      closeToSave: (kind: string) => `Dotknij ostatni dzień, żeby zapisać „${kind}” dla całego zakresu.`,
      closeToClear: 'Dotknij ostatni dzień, żeby wyczyścić cały zakres.',
    },
    /** A duty on a day filed as "unavailable": the entry does not lift it. */
    collision: {
      title: (days: number, duties: number, roles: string, day: string) => (days === 1
        ? `Masz dyżur ${roles} ${day}, a zgłaszasz „nie mogę”`
        : `Masz ${pluralPl(duties, ['dyżur', 'dyżury', 'dyżurów'])} w dni „nie mogę”`),
      titleFor: (name: string, days: number, duties: number, roles: string, day: string) => (days === 1
        ? `${name} ma dyżur ${roles} ${day}, a wpis to „nie mogę”`
        : `${name} ma ${pluralPl(duties, ['dyżur', 'dyżury', 'dyżurów'])} w dni „nie mogę”`),
      askForSwap: (count: number): string => (count === 1
        ? 'Wpis nie zdejmuje dyżuru. Poproś kogoś o zamianę tego dnia.'
        : 'Wpis nie zdejmuje dyżurów. Poproś kogoś o zamianę tych dni.'),
      fixInSchedule: (count: number): string => (count === 1
        ? 'Wpis nie zdejmuje dyżuru. Zmień obsadę tego dnia w grafiku.'
        : 'Wpis nie zdejmuje dyżurów. Zmień obsadę tych dni w grafiku.'),
      requestSwap: (day: string) => `Poproś o zamianę · ${day}`,
      openDay: (day: string) => `Otwórz dzień · ${day}`,
    },
    /** "Wpisujesz w imieniu: <b>name</b> · dostanie o tym powiadomienie…" - the name sits between the two parts. */
    onBehalfBefore: 'Wpisujesz w imieniu:',
    onBehalfAfter: 'dostanie o tym powiadomienie i może wpis usunąć.',
    notInRotation: 'Twoje konto nie jest w rotacji - wskaż osobę, w imieniu której wpisujesz.',
    cleared: (range: string) => `Wyczyszczono: ${range}`,
    saved: (range: string, kind: string) => `Zapisano: ${range} „${kind}”`,
    undo: 'Cofnij',
    undoFailed: (range: string) => `Nie cofnięto: ${range}. Spróbuj ponownie.`,
    /** The title of the toast; the server's own words follow as its description. */
    notSaved: (range: string) => `Nie zapisano: ${range}. Spróbuj ponownie.`,
  },
  points: {
    heading: 'Moje punkty',
    headingCompact: 'Punkty',
    period: 'Okres',
    twelveMonths: '12 mies.',
    thisMonth: 'Ten miesiąc',
    loading: 'Wczytywanie punktów…',
    emptyTitle: 'Brak punktów',
    emptyDescription: 'Twoje konto nie ma jeszcze dyżurów w oknie 12 miesięcy.',
    withinCompact: (threshold: string) => `w normie (±${threshold})`,
    outsideCompact: (threshold: string) => `poza normą (±${threshold})`,
    againstFairShare: 'względem średniej zespołu',
    within: 'W normie',
    outside: 'Poza normą',
    /** The member's number against the team average, in words. */
    aboveAverage: (points: string) => `Masz o ${points} pkt więcej niż średnia zespołu.`,
    belowAverage: (points: string) => `Masz o ${points} pkt mniej niż średnia zespołu.`,
    atAverage: 'Masz tyle punktów, ile wynosi średnia zespołu.',
    norm: (points: string) => `Norma to ±${points} pkt od średniej.`,
    generatorEvensOut: 'Generator wyrówna to w kolejnym zakresie.',
    generatorFewer: 'Generator da Ci mniej dyżurów w kolejnym zakresie.',
    generatorMore: 'Generator da Ci więcej dyżurów w kolejnym zakresie.',
    loadingMonths: 'Wczytywanie miesięcy…',
    table: 'Punkty miesiąc po miesiącu',
    month: 'Miesiąc',
    pts: 'Pkt',
    dutiesShort: 'Dyż.',
    weekendsShort: 'Week.',
    noDutiesInPeriod: 'Brak dyżurów w tym okresie.',
    fileAvailability: 'Zgłoś dostępność',
    fullReport: 'Pełny raport sprawiedliwości',
  },
  swaps: {
    heading: 'Zamiany',
    all: 'Wszystkie',
    loading: 'Wczytywanie zamian…',
    emptyTitle: 'Brak zamian z Twoim udziałem',
    emptyDescription: 'Zamianę zaczniesz od dyżuru na liście powyżej.',
    decide: 'Zdecyduj',
    /** The status as the badge of a row abbreviates it. */
    short: {
      pending_replacement: 'oczekuje',
      pending_coordinator: 'oczekuje',
      approved: 'wpisana',
      rejected: 'odrzucona',
      cancelled: 'wycofana',
    },
    /** `arrow` points one way for a hand-over and both ways for an exchange. */
    youTo: (name: string, arrow: string) => `Ty ${arrow} ${name}`,
    toYou: (name: string, arrow: string) => `${name} ${arrow} Ty`,
    /** The same lines read aloud, where an arrow glyph means nothing. */
    youToSpoken: (name: string, exchange: boolean) => (exchange ? `Zamiana: Ty i ${name}` : `Przekazujesz dyżur, przejmuje go ${name}`),
    toYouSpoken: (name: string, exchange: boolean) => (exchange ? `Zamiana: ${name} i Ty` : `${name} przekazuje Ci dyżur`),
    askedYou: 'prośba do Ciebie · odpowiedz',
    waitingFor: (name: string, since: string) => `czeka na: ${name} · ${since}`,
    waitingForYourApproval: 'czeka na Twoje zatwierdzenie',
    waitingForCoordinator: 'czeka na koordynatora',
    inSchedule: 'wpisana do grafiku',
    settledWithNote: (status: string, note: string) => `${status} · „${note}”`,
  },
  /** The person's own number (`PhoneSection`): what the "Now" strip shows and what the call forwarding dials. */
  phone: {
    heading: 'Mój telefon',
    label: 'Numer telefonu',
    hint: 'Format: +48 i dziewięć cyfr (same cyfry uzupełnimy prefiksem). Widzą go zalogowane osoby na pasku „Teraz” i na karcie dyżurnego.',
    fix: 'Popraw numer: +48 i dziewięć cyfr.',
    required: 'Wymagany dla osób w rotacji.',
    save: 'Zapisz numer',
    saved: 'Zapisano numer telefonu',
  },
  feeds: {
    title: 'Subskrypcja ICS',
    onlyYourDuties: 'tylko Twoje dyżury',
    explanation: 'Adres ICS pokazuje wyłącznie Twoje dyżury i aktualizuje się po zamianach. Dodaj go w swojej aplikacji kalendarza.',
    newSubscription: 'Nowa subskrypcja',
    defaultLabel: 'Mój kalendarz',
    labelField: 'Nazwa subskrypcji',
    labelPlaceholder: 'np. telefon…',
    create: 'Utwórz adres ICS',
    createdOnce: 'Nowy adres ICS. Zapisz go teraz, nie pokażemy go ponownie.',
    loading: 'Wczytywanie subskrypcji…',
    emptyTitle: 'Nie masz jeszcze subskrypcji',
    emptyDescription: 'Pierwszy adres utworzysz powyżej.',
    revoked: 'odwołana',
    revoke: 'Odwołaj',
    createdOn: (date: string) => `utworzono ${date}`,
    lastUsed: (date: string) => `ostatnie użycie ${date}`,
    neverUsed: 'jeszcze nieużyta',
    showRevoked: 'Pokaż odwołane',
    revokeTitle: 'Odwołać subskrypcję ICS?',
    revokeConfirm: 'Odwołaj subskrypcję',
    revokeDescription: (label: string) =>
      `Adres „${label}” przestanie działać w aplikacjach kalendarza, które go używają. Odwołanego adresu nie da się przywrócić - trzeba będzie utworzyć nowy.`,
  },
}
