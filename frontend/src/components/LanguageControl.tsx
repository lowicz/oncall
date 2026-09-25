import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { LANGUAGES, Language, languageNames, useLanguage, useMessages } from '../i18n'
import { MenuRadioGroup, Segmented } from '../ui'

/**
 * Choosing the interface language. Beside re-rendering every screen, the
 * change asks the API for everything again: refusals, validation messages
 * and holiday names come from the server in the language of the request, so
 * what is cached from before the switch is in the wrong words.
 */
export function useLanguageSwitch(): [Language, (language: Language) => void] {
  const [language, setLanguage] = useLanguage()
  const queryClient = useQueryClient()
  const change = useCallback((next: Language) => {
    if (next === language) return
    setLanguage(next)
    void queryClient.invalidateQueries()
  }, [language, setLanguage, queryClient])
  return [language, change]
}

const options = LANGUAGES.map((language) => ({ value: language, label: languageNames[language] }))

/** The language as a segmented control: on the sign-in screen and the More screen. */
export function LanguageSegmented({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  const t = useMessages()
  const [language, change] = useLanguageSwitch()
  return <Segmented<Language> size={size} label={t.theme.language} value={language} onChange={change} options={options} />
}

/** The language as a radio group inside the account menu. */
export function LanguageMenuRadio() {
  const t = useMessages()
  const [language, change] = useLanguageSwitch()
  return <MenuRadioGroup<Language> label={t.theme.language} value={language} onChange={change} options={options} />
}
