# Backend ubiquitous language

Use these terms in new code and improve older names only when the change is
contract-safe. The vocabulary below is what the code says today: phase 6e
renamed the scheduling domain's `Plan` family to `Schedule`, so the word a
reader follows from the HTTP contract through the domain to the table no
longer changes on the way.

| Preferred term | Meaning | Avoid as an interchangeable synonym |
|---|---|---|
| schedule | A roster for a bounded date range, in any lifecycle state, with the duties it holds | plan |
| schedule row | The `schedules` table row behind a schedule. Imported as `ScheduleRow` wherever both are in scope | schedule when the ORM is meant |
| draft | Editable schedule not yet proposed or published | generated plan |
| proposal | Draft submitted for publication review | pending schedule |
| publication | Operation making a schedule authoritative for its range | activation |
| duty | One person's responsibility for one role and service date | assignment when discussing domain behavior |
| slot | Pair of service date and role, independent of its holder | duty |
| team member | Person participating in the rotation | user/account |
| account | Authentication and authorization identity | team member |
| availability | Member declaration affecting scheduling eligibility/preference | calendar event |
| override | Coordinator-authored replacement of a duty holder | swap |
| swap | Requested and approved handover between members | override |
| journal | Write-side audit/notification capability attached to a use case | repository/log as a generic synonym |
| change log | Read side of the same audit trail: what happened since a draft was generated, and who a manual change replaced | journal, which only writes |
| business date | Calendar date in `Europe/Warsaw` | server-local date or UTC date |
| instant | Timezone-aware UTC timestamp | naive datetime |

Public URLs, JSON fields, persisted enum values and established Polish messages
retain their existing names unless a separate contract change is approved.
