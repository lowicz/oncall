import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { TeamMember, api } from '../api'

/**
 * The published duties a member holds after `activeUntil`, read from the
 * calendar in five 90-day pages, with the team and the absences the
 * replacements are picked from. The rotation tab and the offboarding dialog
 * share the query, so the tab knows whether saving an exit date needs the
 * dialog and the dialog opens on data already loaded.
 */
export function useDutiesAfterExit(member: TeamMember | undefined, activeUntil: string, enabled = true) {
  const ranges = useMemo(() => {
    const start = new Date(`${activeUntil}T12:00:00`)
    if (Number.isNaN(start.getTime())) return []
    start.setDate(start.getDate() + 1)
    return Array.from({ length: 5 }, (_, index) => {
      const from = new Date(start)
      from.setDate(from.getDate() + index * 90)
      const to = new Date(from)
      to.setDate(to.getDate() + 89)
      return [from.toISOString().slice(0, 10), to.toISOString().slice(0, 10)] as const
    })
  }, [activeUntil])
  const calendar = useQuery({
    queryKey: ['offboarding', member?.id, activeUntil],
    queryFn: async () => {
      const pages = await Promise.all(ranges.map(([from, to]) => api.calendar(from, to)))
      return {
        assignments: pages.flatMap((page) => page.assignments),
        members: pages[0]?.members ?? [],
        availability: pages.flatMap((page) => page.availability),
      }
    },
    enabled: enabled && Boolean(member) && Boolean(activeUntil),
  })
  const found = calendar.data ?? { assignments: [], members: [], availability: [] }
  const duties = found.assignments.filter((item) => item.member_id === member?.id && item.service_date > activeUntil)
  return { calendar, found, duties }
}
