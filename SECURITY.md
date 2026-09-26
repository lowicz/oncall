# Security Policy

## Supported versions

Only the latest released version of Oncall receives security fixes. Releases
follow semantic versioning, and published container images are immutable.
Upgrade to the latest release before reporting a problem that may already have
been fixed.

## Reporting a vulnerability

Do not disclose a suspected vulnerability in a public issue, discussion, or
pull request. Report it privately through this repository's
[GitHub security advisory form](https://github.com/lowicz/oncall/security/advisories/new).

Include enough information to reproduce and assess the issue when possible:

- the affected version and deployment configuration;
- the vulnerability's impact and required preconditions;
- clear reproduction steps or a minimal proof of concept; and
- any known mitigations or suggested fixes.

This project is maintained largely by one person. Reports are handled on a
best-effort basis, with no guaranteed acknowledgement or resolution time. The
maintainer will aim to confirm receipt, investigate, coordinate a fix, and
credit the reporter when appropriate, but availability and issue complexity
will affect the timeline.

Please keep the report and related details private until a fix and disclosure
plan have been agreed.

## Existing safeguards

The repository already uses CodeQL advanced setup, dependency review, and
Renovate-managed dependency updates. Release container images include software
bills of materials, provenance and attestations, and are signed with Cosign.

Automated checks cannot cover every design flaw, business-logic vulnerability,
deployment interaction, or newly discovered attack. Please report anything
suspicious even if it appears to fall within an area covered by automation.
