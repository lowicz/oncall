/** The screens shown before a session exists: sign-in, password set-up, a share link. */
export const auth = {
  headline: 'Dyżury bez zgadywania.',
  login: 'Logowanie',
  username: 'Login',
  password: 'Hasło',
  showPassword: 'Pokaż hasło',
  hidePassword: 'Ukryj hasło',
  signIn: 'Zaloguj',
  signingIn: 'Logowanie…',
  sessionExpired: 'Sesja wygasła',
  signInAgain: 'Zaloguj się ponownie, aby wrócić do otwartego ekranu.',
  directoryHint: 'Masz konto firmowe? Zaloguj się loginem i hasłem domenowym (AD). ',
  forgotPassword: 'Nie pamiętasz hasła? Poproś administratora systemu o jednorazowy link resetujący.',
  /** The second way in, shown under the password form when the deployment
   *  has single sign-on; the API's redirect back names why it refused. */
  sso: {
    button: 'Zaloguj przez SSO',
    or: 'albo',
    errors: {
      unavailable: {
        title: 'Logowanie SSO jest chwilowo niedostępne',
        hint: 'Zaloguj się loginem i hasłem. Jeśli problem się powtarza, powiadom administratora.',
      },
      rejected: {
        title: 'Logowanie SSO nie powiodło się',
        hint: 'Spróbuj ponownie. Jeśli problem się powtarza, powiadom administratora.',
      },
      no_account: {
        title: 'Brak konta dla Twojego numeru pracownika',
        hint: 'Poproś administratora o konto z Twoim numerem pracownika.',
      },
      inactive: {
        title: 'Konto jest nieaktywne',
        hint: 'Skontaktuj się z administratorem.',
      },
    },
  },
  hints: {
    unauthorized: 'Jeśli konto zostało wyłączone, skontaktuj się z administratorem.',
    conflict: 'Konto wymaga poprawki po stronie administratora - skontaktuj się z nim.',
    throttled: 'Odczekaj chwilę i spróbuj ponownie.',
    other: 'Spróbuj ponownie za chwilę. Jeśli problem się powtarza, powiadom administratora.',
  },
  activateAccount: 'Aktywuj konto',
  setNewPassword: 'Ustaw nowe hasło',
  linkNoLongerWorks: 'Ten link już nie działa',
  tokenMissing: 'W linku brakuje tokenu.',
  askForNewLink: 'Poproś administratora o nowy link. Jeśli pamiętasz obecne hasło, nadal działa.',
  settingPasswordFor: (displayName: string, username: string) => `Ustawiasz hasło dla: ${displayName} (${username})`,
  passwordSet: 'Hasło zostało ustawione.',
  goToLogin: 'Przejdź do logowania',
  backToLogin: 'Wróć do logowania',
  newPassword: 'Nowe hasło',
  passwordHint: 'Co najmniej 12 znaków',
  repeatPassword: 'Powtórz hasło',
  passwordsDiffer: 'Hasła nie są identyczne',
  shareLinkBroken: 'Ten link nie działa',
  shareLinkScreen: 'Link podglądowy',
  shareLinkExplanation: 'Link mógł wygasnąć albo zostać odwołany. Poproś o nowy osobę, która go wysłała.',
  exchangingLink: 'Wymiana linku na sesję',
}
