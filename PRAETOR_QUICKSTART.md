# Praetor Quick-Start (Dev Mode)

## Run the API in dev mode

No Supabase project needed. `PRAETOR_DEV_MODE=1` wires in an in-memory store
and auth bypass so you can test charters end-to-end from a single command.

```bash
PRAETOR_DEV_MODE=1 ANTHROPIC_API_KEY=sk-ant-... npx praetor serve
```

The server boots on port **8788** by default. Override with `--port`:

```bash
PRAETOR_DEV_MODE=1 ANTHROPIC_API_KEY=sk-ant-... npx praetor serve --port 3000
```

---

## Hit the API

Any `Authorization: Bearer <anything>` header authenticates as `dev-user` in
dev mode. No real token needed.

```bash
# Create a mission
curl -X POST http://localhost:8788/api/v1/missions \
  -H "Authorization: Bearer dev:any" \
  -H "Content-Type: application/json" \
  -d '{"goal":"hello world"}'

# List missions
curl http://localhost:8788/api/v1/missions \
  -H "Authorization: Bearer dev:any"

# Health check (no auth required)
curl http://localhost:8788/health
```

---

## When to flip back

Dev mode is local-only. Before shipping to production:

1. Unset `PRAETOR_DEV_MODE` (or remove it from the env entirely).
2. Provide real Supabase credentials:
   - `SUPABASE_URL` — your project URL (e.g. `https://xxxx.supabase.co`)
   - `SUPABASE_SERVICE_ROLE_KEY` — service-role secret from the Supabase dashboard
3. All data written in dev mode is **not persisted** and will be lost on restart.
   Run migrations against your Supabase project before switching.
