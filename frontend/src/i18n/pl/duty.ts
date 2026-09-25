import { pluralPl } from '../../lib/plural'

/** The dashboard ("Teraz") and the strip of current duties above every screen. */
export const duty = {
  nowStrip: {
    region: 'Dyżur teraz',
    until: (when: string) => `do ${when}`,
    untilWithLeft: (when: string, left: string) => `do ${when} · ${left}`,
    hoursMinutes: (hours: number, minutes: number) => `${hours} h ${minutes} min`,
    minutes: (minutes: number) => `${minutes} min`,
    asOf: (time: string) => `Stan z ${time}`,
    asOfInline: (time: string) => `stan z ${time}`,
    notApplicable: 'nie dotyczy',
    unstaffed: 'brak obsady',
    holiday: (name: string) => `święto · ${name}`,
    dayOff: 'dzień wolny · 2X',
    offline: 'brak połączenia',
  },
  /** One role's duty as a card on a phone: who, until when, how to reach them, who is next. */
  card: {
    roleNow: (role: string) => `${role} · teraz`,
    override: 'korekta',
    dayOffRate: '2X',
    notApplicable: (reason: string) => `nie dotyczy: ${reason}`,
    holiday: (name: string) => `święto - ${name}`,
    dayOff: 'dzień wolny',
    unassigned: 'Brak przydziału',
    allDay: 'całą dobę',
    call: (phone: string) => `Zadzwoń ${phone}`,
    sms: 'SMS',
    email: 'E-mail',
    next: (role: string) => `Następny ${role}:`,
    nobody: 'nikt nie odbierze tej roli',
  },
  /** The subtitle under today's date: the state of the published schedule. */
  published: (until: string, version: number | null) => `Opublikowany grafik do ${until}${version ? ` · wersja ${version}` : ''}`,
  notPublished: 'Grafik na ten okres nie jest opublikowany',
  todayIs: (what: string) => `dziś ${what}, stawka 2X`,
  todayHoliday: (name: string) => `święto: ${name}`,
  todayDayOff: 'dzień wolny',
  readOnly: 'tylko odczyt',
  /** The ICS export and the generator actions are `schedule.actions`, shared with the schedule screen. */
  reportAvailability: 'Zgłoś dostępność',
  notPublishedYet: 'Grafik na ten okres nie został jeszcze opublikowany.',
  notPublishedCoordinator: 'Wygeneruj i opublikuj grafik w Generatorze, żeby dyżury pojawiły się tutaj.',
  notPublishedMember: 'Koordynator jeszcze nie opublikował grafiku na ten okres.',
  nextOwnDuty: 'Twój następny dyżur:',
  swapsWaiting: (count: number) => `${pluralPl(count, ['zamiana czeka', 'zamiany czekają', 'zamian czeka'])} na Ciebie`,
  openSwaps: 'Otwórz zamiany',
  openFairness: 'Otwórz raport sprawiedliwości',
  fairnessMet: 'Kryterium sprawiedliwości spełnione',
  fairnessNotMet: 'Kryterium sprawiedliwości niespełnione',
  /** "Najbliższe 4 tygodnie": the heading of the schedule section while it starts today. */
  upcoming: (weeks: string) => `Najbliższe ${weeks}`,
  linkRange: 'zakres linku',
}
