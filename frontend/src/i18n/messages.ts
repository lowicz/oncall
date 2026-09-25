import { Language, readLanguage, useLanguage } from './language'
import { Messages, pl } from './pl'
import { en } from './en'

/**
 * Every word the interface shows, in one catalog per language.
 *
 * The Polish catalog (`./pl`) is the source of truth and the type: the
 * English one is written against `typeof pl`, so a key missing, misspelt or
 * left over in one language fails `tsc`. A value is a string, or a function
 * of the values it needs when the sentence carries a number, a name or a
 * date; there is no template language to learn. Plural forms are functions
 * too, each language applying its own rule.
 *
 * Keys are English and grouped by the screen or module that uses them; a word
 * that several screens share sits in `common`. The Polish text is exactly
 * what the interface showed before it learned English, and
 * `src/test/polish-baseline.test.tsx` checks that it still does.
 */
const catalogs: Record<Language, Messages> = { pl, en }

/** The catalog of a language, the current one by default; for code outside React. */
export function messages(language: Language = readLanguage()): Messages {
  return catalogs[language]
}

/** The catalog of the current language; the component re-renders when it changes. */
export function useMessages(): Messages {
  const [language] = useLanguage()
  return catalogs[language]
}

/** The BCP 47 tag `Intl` formats numbers and times with in the current language. */
export function locale(language: Language = readLanguage()): string {
  return language === 'en' ? 'en-GB' : 'pl-PL'
}
