import { pluralPl } from '../../lib/plural'

/** The fairness screen and the balance helpers in `src/lib/fairness.ts`. */
export const fairness = {
  deviation: {
    onShare: 'zgodnie z udziałem',
    aboveShare: (value: string) => `${value} ponad udział`,
    belowShare: (value: string) => `${value} poniżej udziału`,
  },
  title: 'Sprawiedliwość',
  subtitle: 'Kroczące 12 miesięcy dyżurów względem sprawiedliwego udziału.',
  /** "12 miesięcy do 3 paź · 4 osoby · kryterium: nikt poza ±1,0 pkt od udziału" */
  summary: (windowEnd: string, people: string, criterionPoints: string) =>
    `12 miesięcy do ${windowEnd} · ${people} · kryterium: nikt poza ±${criterionPoints} pkt od udziału`,
  people: (count: number) => pluralPl(count, ['osoba', 'osoby', 'osób']),
  criterionMet: 'spełnione',
  criterionNotMet: 'niespełnione',
  includesPlanned: 'Liczy też dyżury już zaplanowane do tego dnia.',
  rollingActual: 'Kroczące 12 miesięcy faktycznie odbytych dyżurów.',
  asOf: 'Stan na dzień',
  today: 'Dziś',
  exportCsv: 'Eksport CSV',
  loadingReport: 'Wczytywanie raportu',
  /** The lens the table sums across, and the label of the totals row. */
  total: 'Razem',
  lensCriteria: 'Kryterium odbioru na soczewkach',
  criterionChip: (points: string) => `kryterium ${points} pkt`,
  outliers: (highestName: string, highestDeviation: string, lowestName: string, lowestDeviation: string) =>
    `najwyżej: ${highestName} (${highestDeviation}), najniżej: ${lowestName} (${lowestDeviation})`,
  spreadChip: (lens: string, spread: string, verdict: string) => `${lens}: rozpiętość ${spread} · ${verdict}`,
  meets: 'spełnia',
  fails: 'nie spełnia',
  averageChip: (points: string) => `Średnia ${points} pkt / os.`,
  weekendsChip: (duties: number, people: number, perPerson: string) => `Weekendy: ${duties} / ${people} os. = ${perPerson}`,
  team: 'Zespół',
  tableLabel: 'Bilans dyżurów',
  caption: (windowStart: string, windowEnd: string, lens: string) =>
    `Okno ${windowStart} – ${windowEnd}; kolumna odchylenia pokazuje soczewkę ${lens}.`,
  columns: {
    person: 'Osoba',
    deviation: (lens: string) => `Odchylenie · ${lens}`,
    /** "pkt / udział", "zmiany / udział", "dni / udział" */
    unitShare: (unit: string) => `${unit} / udział`,
    details: 'Szczegóły',
  },
  units: {
    points: 'pkt',
    shifts: 'zmiany',
    days: 'dni',
  },
  formerMembers: 'Poza rotacją',
  notHoldingRole: 'nie pełni tej roli',
  expandRow: (name: string) => `Rozwiń: ${name}`,
  collapseRow: (name: string) => `Zwiń: ${name}`,
  note: {
    inRotationSince: (date: string) => `w rotacji od ${date}`,
    noLateShifts: 'bez zmian 11–19',
  },
  drilldown: {
    monthByMonth: (name: string, average: string) => `${name} · miesiąc po miesiącu (pkt / średnia ${average})`,
    loadingMonths: 'Wczytywanie miesięcy',
    barsLabel: (values: string) => `Punkty miesiąc po miesiącu: ${values}`,
    barTitle: (month: string, points: number) => `${month}: ${points} pkt`,
    points: (value: string) => `${value} pkt`,
    noDuties: 'Brak dyżurów w tym oknie.',
    whyHeading: 'Skąd ten wynik',
    pointsInWindow: 'Punkty w oknie',
    deviation: 'Odchylenie',
    inRotationSince: 'W rotacji od',
    generatorPlan: 'Co zrobi generator',
    plan: {
      onShare: (name: string) => `${name} jest zgodnie z udziałem; generator nie ma czego wyrównywać.`,
      moreDuties: (name: string, points: string) => `W następnym zakresie ${name} dostanie więcej dyżurów, o ${points} pkt do wyrównania.`,
      fewerDuties: (name: string, points: string) => `W następnym zakresie ${name} dostanie mniej dyżurów, o ${points} pkt do wyrównania.`,
    },
  },
  definitions: {
    points: (lateShift: string) => `Definicje: pkt = dyżury × mnożnik (1X dzień roboczy, 2X weekend i święto); ${lateShift} liczone jako zmiany.`,
    share: 'Udział liczymy tylko za dni, w których osoba należała do danej rotacji; święto w weekend liczy się raz, w soczewce „Weekendy”.',
    anchored: (lateShift: string, count: number) =>
      `Przy kotwiczeniu zmiana ${lateShift} należy do osoby pełniącej rolę on-call, więc jej punkty są już w kolumnach PRIMARY i SECONDARY; łączna liczba zmian ${lateShift} w oknie: ${count}.`,
    fullDescription: 'Pełny opis:',
    docsLink: 'docs / sprawiedliwość',
  },
  csv: {
    fileName: (asOf: string) => `sprawiedliwosc-${asOf}.csv`,
    person: 'osoba',
    inRotationSince: 'w_rotacji_od',
    totalPoints: 'razem_pkt',
    totalShare: 'razem_udzial',
    totalDeviation: 'razem_odchylenie',
    lensPoints: (lens: string) => `${lens}_pkt`,
    lensShare: (lens: string) => `${lens}_udzial`,
    lensDeviation: (lens: string) => `${lens}_odchylenie`,
  },
}
