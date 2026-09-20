# QA suite 7

Run commands from the repository root. Start a fresh stack first:

```bash
docker compose -f docker-compose.yml -f docs/qa-suite-7/docker-compose.host4.yml up -d --build
backend/.venv/bin/python docs/qa-suite-7/rebuild_state.py --with-scenarios
```

Use `docker-compose.host2.yml` instead on a two-core host. The rebuild is destructive: it keeps only the bootstrap `admin` account and recreates all other business data. The API must be available at `http://localhost:8080`; test accounts use the password documented in `QA-REPORT-7.md`.

The script imports `history-qa7.csv` through the real preview and commit endpoints, files availability through member accounts, generates through the worker queue, and publishes through the normal transition endpoints. `--with-scenarios` also recreates the swaps, October draft, and November republication scenario from the report. Scenario operations rejected by a completed fix are reported as expected errors.

The final output lists schedule IDs. Check the first published schedule with:

```bash
backend/.venv/bin/python docs/qa-suite-7/check_rules.py SCHEDULE_ID
```
