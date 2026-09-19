# Backend ubiquitous language

Use these terms in new code and improve older names only when the change is
contract-safe.

| Preferred term | Meaning | Avoid as an interchangeable synonym |
|---|---|---|
| schedule | Persisted roster for a bounded date range, in any lifecycle state | plan |
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
| business date | Calendar date in `Europe/Warsaw` | server-local date or UTC date |
| instant | Timezone-aware UTC timestamp | naive datetime |

Public URLs, JSON fields, persisted enum values and established Polish messages
retain their existing names unless a separate contract change is approved.
