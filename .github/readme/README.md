# README images

`schedule-dark.png` is the hero image of the repository README: the "Schedule"
screen of a local checkout, dark theme, English interface, on the demo seed
with English names. It is re-shot by hand when the interface changes enough to
make it stale:

```bash
docker compose -f docker-compose.contract.yml -p oncall-shot up -d
cd backend && export ONCALL_DATABASE_URL=postgresql+asyncpg://oncall_contract:oncall_contract@127.0.0.1:55432/oncall_contract
uv run alembic upgrade head
ONCALL_ADMIN_USERNAME=admin ONCALL_ADMIN_PASSWORD='local-demo-password' uv run python -m oncall.seed_admin
ONCALL_DEMO_PASSWORD='local-demo-password' ONCALL_DEMO_NAMES='Anna Carter,Mark Brown,Olivia Reed,Peter Hale' uv run python -m oncall.seed_demo
ONCALL_APP_SUBTITLE='Infrastructure team' uv run uvicorn oncall.main:app --port 8000   # and `npm run dev` in frontend/
```

In the browser at a 1905 px wide window: set `localStorage` `oncall-language`
to `en` and `oncall-theme` to `dark`, sign in as `admin`, open `/grafik`, take a
screenshot and crop the top-left 1440 x 440 px. Afterwards
`docker compose -f docker-compose.contract.yml -p oncall-shot down`.
