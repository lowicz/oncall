# On-call documentation

On-call lays out and publishes the team's duty schedule: who is `PRIMARY`,
who is `SECONDARY` and who covers the `11–19` shift each day. The documentation
is in English, the same language as the application interface, so that the
names of screens, buttons and statuses in the text are exactly the ones you see
on screen.

The documentation has three parts.

## Product documentation

What the application is, which rules it enforces and why the result looks the
way it does. Read it before you start agreeing duty rules with anyone.

- [Product overview](produkt/przeglad.md) - scope, concepts and the main flows.
- [Roles and access](produkt/role-i-dostep.md) - what each role sees and can do.
- [Schedule model](produkt/model-grafiku.md) - duties, coverage, eligibility,
  availability, days off and the 2X rate.
- [Schedule generator](produkt/generator.md) - hard rules, soft weights,
  rotation modes and the acceptance criterion.
- [Fairness](produkt/sprawiedliwosc.md) - how points and share are calculated.
- [Integrations](produkt/integracje.md) - e-mail notifications, ICS feeds,
  share links and the monthly report.

## User documentation

A guide screen by screen, task by task.

- [First steps](uzytkownik/pierwsze-kroki.md) - signing in, password, theme,
  navigation.
- [Now and Schedule](uzytkownik/dyzury.md) - who is on duty now and the people × days matrix.
- [My duties and availability](uzytkownik/dostepnosc.md) - filing “Unavailable”,
  “Prefer not” and “Willing”.
- [Swaps](uzytkownik/zamiany.md) - request, acceptance, approval.
- [Generating a schedule](uzytkownik/generowanie-grafiku.md) - for the coordinator.
- [Administration](uzytkownik/administracja.md) - people, events, import,
  reports, share links and audit.
- [Troubleshooting](uzytkownik/rozwiazywanie-problemow.md) - messages
  and what to do about them.

## Deployment

- [Running the application](wdrozenie/uruchomienie.md) - Docker Compose and Podman Compose,
  images from the registry or building from the repository.
- [Systemd (Podman Compose)](wdrozenie/systemd.md) - user unit,
  linger and starting the stack after a machine restart.
- [Releases and versions](wdrozenie/wydania.md) - version number, update,
  rollback, verifying image provenance, what CI checks.
- [TLS](wdrozenie/tls.md) - certificate, key and CA as three separate files.
- [Directory sign-in](wdrozenie/ldap.md) - LDAP / Active Directory,
  the directory certificate and sign-in diagnostics from the API log.

## Historical documents

The earlier contents of the `docs/` directory - plans, QA reports, screenshots and
test scripts - have been kept unchanged in `archive/docs/`.
They describe the state of the project at the time they were written and are not updated.
