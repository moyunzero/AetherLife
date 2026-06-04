# ai-gateway

FastAPI NL ingress for AetherLife Phase 5.

- `GET /health`
- `POST /v1/rooms/{roomId}/chat` — ContentGuard → parse ∥ proxy to game-server
- `POST /v1/rooms/{roomId}/nl/parse` — parse-only
- `POST /v1/guard/check-reply` — output guard for game-server `done` events

```bash
uv sync --extra dev
uv run uvicorn app.main:app --reload --port 8000
uv run pytest tests -q
```

Env: `GAME_SERVER_URL`, `INTERNAL_WORKER_TOKEN`, `OPENROUTER_API_KEY`, optional `OPENAI_API_KEY`, `LLM_MOCK=1`.
