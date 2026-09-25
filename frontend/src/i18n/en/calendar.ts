import type { Messages } from '../pl'

export const calendar: Messages['calendar'] = {
  memberGroups: {
    on_duty: 'On duty in the range',
    rest: 'Others',
  },
  disabledReasons: {
    alreadyHoldsRole: 'already holds this role that day',
    notEligible: 'not eligible for the role',
    unavailable: 'unavailable that day',
    otherOnCall: 'already holds the other on-call that day',
  },
}
