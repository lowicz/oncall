import { pluralPl } from '../../lib/plural'

/** The reason "Cofnij" withdraws a request with, right after it was sent;
 *  recorded text stays Polish whatever the interface language. */
export const UNDONE_RIGHT_AFTER_SENDING = 'cofnięte zaraz po wysłaniu'

/** The swaps screen (`src/screens/Swaps.tsx`) and the points preview it shares with the schedule (`SwapImpactPreview`). */
export const swaps = {
  title: 'Zamiany',
  /** The three counts of the header, joined with " · " by the screen. */
  summary: {
    awaitingMe: (count: number) => `${pluralPl(count, ['czeka', 'czekają', 'czeka'])} na Twoją decyzję`,
    awaitingOthers: (count: number) => `${pluralPl(count, ['czeka', 'czekają', 'czeka'])} na drugą stronę`,
    awaitingCoordinator: (count: number) => `${pluralPl(count, ['czeka', 'czekają', 'czeka'])} na koordynatora`,
    /** `more`: only the newest closed requests are loaded, so the count is a floor. */
    closed: (count: number, more = false) => (more ? `${count}+ zamkniętych` : pluralPl(count, ['zamknięta', 'zamknięte', 'zamkniętych'])),
  },
  newSwap: 'Poproś o zamianę…',
  loading: 'Wczytywanie zamian…',
  inbox: {
    heading: 'Skrzynka',
    toMe: 'Do mnie',
    mine: 'Wysłane',
    inProgress: 'W toku',
    /** What "W toku" is called for a coordinator whom the policy sends requests to approve. */
    forApproval: 'Do zatwierdzenia',
    closed: 'Zamknięte',
    count: (label: string, count: number) => `${label}: ${pluralPl(count, ['sprawa', 'sprawy', 'spraw'])}`,
    emptyToMeTitle: 'Nikt Cię o nic nie prosi',
    emptyToMeDescription: 'Gdy ktoś zaproponuje Ci zamianę, zobaczysz ją tutaj i w liczniku w szynie. Własną zaczniesz przyciskiem „Poproś o zamianę…” albo z ekranu „Moje dyżury”.',
    myDuties: 'Moje dyżury',
    emptyMineTitle: 'Nie masz otwartych próśb',
    emptyMineDescription: 'Prośba o zamianę zaczyna się od Twojego dyżuru.',
    nothingToApprove: 'Nic nie czeka na zatwierdzenie',
    noneInProgress: 'Brak zamian w toku',
    noneClosed: 'Brak zamkniętych zamian',
    /** Loads the next page of closed requests. */
    showOlder: 'Pokaż starsze',
  },
  table: {
    dayRole: 'Dzień · rola',
    gives: 'Oddaje',
    takes: 'Przejmuje',
    effect: 'Skutek pkt',
    stage: 'Etap',
    actions: 'Akcje',
    /** Under an exchange, whose roles the row already names. */
    exchange: 'wymiana',
    /** The "effect" column when nobody ends up with more points. */
    noEffect: 'bez zmian',
    expired: 'termin minął',
    decide: 'Zdecyduj',
    preview: 'Podgląd',
    /** The accessible name of a row's button: "Zdecyduj: pon 14 wrz PRIMARY". */
    rowAction: (verb: string, slot: string) => `${verb}: ${slot}`,
    /** The hint beside the "effect" column, which only a coordinator who approves swaps sees. */
    effectHelp: 'Co pokazuje skutek',
    effectHint: 'Osobę, która zyska punkty, gdy zamiana trafi do grafiku. Zatwierdzenie wpisuje zamianę do grafiku i do audytu w jednym kroku.',
    /** A row on a phone: "Marek Nowak → Ty · czeka na Ciebie". */
    parties: (giver: string, taker: string) => `${giver} → ${taker}`,
    you: 'Ty',
  },
  /** Who acts next, under the status in the inbox table. */
  stage: {
    waitingForYou: 'czeka na Ciebie',
    waitingFor: (name: string) => `czeka na: ${name}`,
    acceptedWaitingForYou: (name: string) => `${name} zgadza się · czeka na Ciebie`,
    acceptedWaitingForCoordinator: (name: string) => `${name} zgadza się · czeka na koordynatora`,
    inSchedule: 'wpisana do grafiku',
    reason: (note: string) => `powód: „${note}”`,
    /** The reasons the application records itself, said in the reader's language. */
    undone: 'cofnięta zaraz po wysłaniu',
    withdrawnByAuthor: 'wycofana przez autora',
  },
  /** A swap that breaks a hard rule: what the form, the sheet and the inbox call it. */
  rules: {
    tag: 'łamie reguły',
    breaks: 'Ta zamiana łamie reguły grafiku',
    /** An exchange, both directions checked as one move. */
    exchangeClean: 'Ta wymiana nie łamie żadnej reguły',
    /** The same list on a swap already in the schedule. */
    broken: 'Świadomie złamane reguły',
    /** After the name of the person reading, in the list of who breaks what. */
    you: 'Ty',
    acknowledge: 'Rozumiem i świadomie łamię te reguły',
    whichRules: 'Które reguły można potwierdzić?',
    /** The chapter of the user documentation that lists them, after the documentation root. */
    docsPath: 'uzytkownik/zamiany.html#zamiana-łamiąca-reguły',
    acceptanceAcknowledges: 'Twoja akceptacja potwierdza to naruszenie i trafia do dziennika audytu.',
    approvalAcknowledges: 'Twoje zatwierdzenie potwierdza to naruszenie i trafia do dziennika audytu.',
  },
  steps: {
    label: 'Etap wniosku',
    filed: 'złożona',
    replacement: 'zastępca',
    coordinator: 'koordynator',
    inSchedule: 'w grafiku',
  },
  sheet: {
    title: (slot: string) => `Zamiana · ${slot}`,
    /** An exchange is named by its two days. */
    exchangeTitle: (given: string, taken: string) => `Wymiana · ${given} ⇄ ${taken}`,
    /** The two directions of an exchange, as each of the two people reads them. */
    youGet: 'Dostajesz',
    youGive: 'Oddajesz',
    fromPerson: (name: string) => `od: ${name}`,
    forPerson: (name: string) => `dla: ${name}`,
    /** And as anyone else does: the duty, and the one that comes back for it. */
    inReturn: 'W zamian',
    between: (giver: string, taker: string) => `${giver} → ${taker}`,
    gives: 'Oddaje',
    takes: 'Przejmuje',
    thatIsYou: 'to Ty',
    agreed: 'zgadza się',
    duty: 'Dyżur',
    filed: 'Złożona',
    reasonFrom: (name: string) => `Powód od: ${name}`,
    quoted: (text: string) => `„${text}”`,
    decisionReason: 'Powód decyzji',
    warnings: 'Ostrzeżenia',
    expired: 'Termin dyżuru minął.',
    immediateTitle: 'Po Twojej akceptacji zamiana trafi do grafiku od razu.',
    immediateBody: 'Koordynator nie zatwierdza zamian; dostanie tylko powiadomienie.',
    rejectionReason: 'Powód odrzucenia · widoczny dla obu stron',
    withdrawalReason: 'Powód wycofania',
    rejectionReasonHint: 'Wymagany, żeby odrzucić.',
    withdrawalReasonHint: 'Opcjonalny.',
    withdraw: 'Wycofaj',
    reject: 'Odrzuć',
    confirmReject: 'Potwierdź odrzucenie',
    cancelReject: 'Anuluj odrzucenie',
    accept: 'Akceptuj',
    approve: 'Zatwierdź i wpisz do grafiku',
  },
  toasts: {
    sentTo: (name: string) => `Wysłano do: ${name}`,
    sent: 'Wysłano prośbę o zamianę',
    dutyTaken: 'Przyjęto. Czeka na zatwierdzenie koordynatora.',
    acceptedInSchedule: 'Przyjęto. Zamiana wpisana do grafiku.',
    openDay: 'Pokaż dzień',
    inSchedule: 'Zamiana wpisana do grafiku',
    rejected: 'Odrzucono zamianę',
    withdrawn: 'Wycofano zamianę',
    undoFailed: 'Nie udało się cofnąć prośby',
  },
  compose: {
    title: 'Poproś o zamianę',
    send: 'Wyślij prośbę',
    form: 'Nowa prośba o zamianę',
    step: 'Krok',
    stepDuty: '1 dyżur',
    stepCandidate: '2 zastępca',
    stepReturn: '3 w zamian',
    stepSend: '4 wysłanie',
    myDuty: 'Mój dyżur',
    /** What the request gives of a day with two roles. */
    scope: 'Oddaję',
    wholeDuty: 'Cały dyżur',
    only: (role: string) => `Tylko ${role}`,
    wholeHint: (roles: string) => `${roles}. Jedna akceptacja zastępcy obejmuje oba.`,
    keeps: (role: string) => `${role} tego dnia zostaje u Ciebie.`,
    keepsLateShift: 'Zmiana 11–19 tego dnia zostaje u Ciebie.',
    /** Said instead of the "stays with you" line when the request splits the pair the 11-19 anchor binds. */
    splitsPair: (given: string, kept: string) => `Oddajesz tylko ${given}, a ${kept} zostaje u Ciebie. To łamie regułę pary; przed wysłaniem zaznaczysz, że wiesz.`,
    /** Said instead when the replacement cannot hold the kept role that day: the split is the tolerated exception, nothing to acknowledge. */
    splitsPairTolerated: (given: string, kept: string) => `Oddajesz tylko ${given}, a ${kept} zostaje u Ciebie. Zastępca nie może tego dnia wziąć ${kept}, więc to dozwolony wyjątek od reguły pary.`,
    noUpcomingDuties: 'Brak nadchodzących dyżurów',
    pickDuty: 'Wybierz dyżur',
    unavailableCollision: 'kolizja: nie mogę',
    replacement: 'Zastępca',
    candidatesMeta: 'od najlepszego dopasowania',
    /** The tag on the first candidate or exchange: the highlight said in words, not only in colour. */
    bestMatch: 'najlepsze dopasowanie',
    pickDutyFirst: 'Najpierw wybierz swój dyżur.',
    searching: 'Szukam dostępnych osób…',
    noCandidates: 'Brak dostępnych zastępców',
    /** The facts under the selected candidate, one sentence each. */
    onDutyThatDay: 'Ma już dyżur tego dnia.',
    /** A candidate who may not hold 11-19 takes the on-call role of the whole duty alone. */
    takesOnly: (role: string) => `Przejmie tylko ${role}, nie pełni 11–19.`,
    splitsDaysOff: 'Dzieli blok dni wolnych.',
    breaksRule: (message: string) => `Łamie regułę: ${message}`,
    aboveShare: (points: string) => `Ma już ${points} pkt powyżej sprawiedliwego udziału.`,
    belowShare: (points: string) => `Ma ${points} pkt poniżej sprawiedliwego udziału.`,
    improvesBalance: 'Zamiana poprawia bilans.',
    /** The one number on a candidate's card: the balance against the share, "-0,5 pkt". */
    points: (points: string) => `${points} pkt`,
    pointsMeaning: 'względem udziału',
    needsAcknowledgement: 'wymaga potwierdzenia',
    /** Who else learns of the violation, under the list of rules the request breaks. */
    seenWithApproval: (name: string) => `Naruszenie zobaczą ${name} i koordynator, który zatwierdza zamianę. Trafi do dziennika audytu.`,
    seenWithoutApproval: (name: string) => `Naruszenie zobaczy ${name}; po akceptacji zamiana od razu trafi do grafiku, a koordynator dostanie o niej powiadomienie. Trafi do dziennika audytu.`,
    hardRule: 'reguła twarda',
    /** The optional step: one of the replacement's duties taken in exchange. */
    inReturn: 'W zamian biorę',
    /** What the request takes of the chosen day of the replacement, when it has two roles. */
    takeScope: 'Biorę',
    inReturnMeta: (name: string) => `opcjonalnie · od: ${name}`,
    returnSearching: 'Szukam dyżurów do wzięcia w zamian…',
    noReturnDuties: (name: string) => `${name} nie ma nadchodzących dyżurów, które można wziąć w zamian.`,
    nothingInReturn: 'Nic, tylko oddaję dyżur',
    warning: 'ostrzeżenie',
    noViolations: 'bez naruszeń',
    exchangeCleanBody: 'Prośba idzie zwykłą ścieżką, bez potwierdzeń.',
    exchangeTogether: 'Oba dyżury przechodzą razem albo wcale.',
    bothSlotsWithApproval: 'Jedna akceptacja zastępcy, jedno zatwierdzenie koordynatora.',
    bothSlotsWithoutApproval: 'Jedna akceptacja zastępcy załatwia całość.',
    warningsWithApproval: 'Wyślesz mimo to - koordynator zobaczy ostrzeżenie',
    warningsWithoutApproval: 'Wyślesz mimo to - zamiana nie wymaga zatwierdzenia koordynatora',
    /** Balance and warnings, folded under one line once a replacement is picked. */
    details: 'Wpływ na bilans i ostrzeżenia',
    detailsBalance: 'Wpływ na bilans',
    /** "Ty -1 · Anna +1": the points each side ends up with. */
    detailsPoints: (name: string, change: string) => `${name} ${change}`,
    detailsWarnings: (count: number) => pluralPl(count, ['ostrzeżenie', 'ostrzeżenia', 'ostrzeżeń']),
    note: 'Powód (opcjonalnie)',
    noteHint: 'Zobaczą zastępca i koordynator.',
    /** The footer line beside a send button that cannot be pressed yet: what is missing. */
    status: {
      noSchedule: 'Brak opublikowanego grafiku.',
      pickDuty: 'Wybierz dyżur, żeby wysłać.',
      pickReplacement: 'Wybierz zastępcę, żeby wysłać.',
      hardRule: 'Ta zamiana łamie regułę twardą; wybierz inną osobę albo inny dyżur w zamian.',
      acknowledge: 'Zaznacz potwierdzenie reguł, żeby wysłać.',
    },
  },
  /** The points preview (`src/components/SwapImpactPreview.tsx`). */
  impact: {
    loading: 'Przeliczanie wpływu zamiany…',
    heading: 'Wpływ na bilans',
    dayWorth: (day: string, points: string) => `${day} to ${points}.`,
    twoPoints: '2 punkty (2X)',
    onePoint: '1 punkt',
    window: (start: string, end: string) => `Okno ${start} – ${end}.`,
    /** A swap: the person chooses to hand the duty over. */
    handsOver: 'oddaje dyżur',
    takes: 'przejmuje dyżur',
    /** Either side of an exchange: the day handed over and the day taken. */
    exchanges: (gives: string, takes: string) => `oddaje ${gives}, bierze ${takes}`,
    points: (before: string, after: string, change: string) => `punkty ${before} → ${after} (${change})`,
    /** The summary line: the deviation from balance, summed over the roles the change moves. */
    distance: 'Odchylenie',
    closer: 'bliżej równowagi',
    further: 'dalej od równowagi',
    unchanged: 'bez zmiany',
    noChange: 'Saldo tej osoby się nie zmienia.',
  },
}
