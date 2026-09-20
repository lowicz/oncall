# Etapy implementacji - QA-REPORT-4 i problem blokujący

Każdy etap ma osobny plik ze stanem („done", „in_progress", „pending").
Kolejny model przed podjęciem pracy czyta najpierw ten plik, potem plik danego etapu.

## Indeks

| Etap | Plik | Stan | Ostatnia zmiana |
| --- | --- | --- | --- |
| N1. Odblokowanie solvera | `STAGE-N1.md` | done | 2026-09-06 |
| N2. Jakość rozwiązania | `STAGE-N2.md` | in_progress | 2026-09-06 |
| N3. Integralność danych | `STAGE-N3.md` | done | 2026-09-06 |
| N4. Domknięcie średnich | `STAGE-N4.md` | done | 2026-09-06 |
| N5. Drobne | `STAGE-N5.md` | done | 2026-09-06 |
| BD-01. Twarda niedostępność w cyklu szkicu | `STAGE-BLOCKING.md` | done | 2026-09-06 |

## Jak wznawiać

1. Skopiuj etap do własnej sesji: przeczytaj `archive/docs/QA-REPORT-4.md` (rozdział 11
   zawiera plan naprawczy w punktach) oraz plik etapu.
2. Wykonaj pozostałe punkty, aktualizując na bieżąco plik etapu.
3. Komendy weryfikacji: `cd backend && uv run --extra dev python -m pytest tests/test_scheduler.py -q`
   i pełna paczka `uv run --extra dev python -m pytest -q` (solver bywa ciężki:
   zwykle ~2 min dla samych testów solvera).
