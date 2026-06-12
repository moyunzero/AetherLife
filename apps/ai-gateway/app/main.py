import os

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from app.routers import chat, guard, parse_route

app = FastAPI(title="aetherlife-ai-gateway")

app.include_router(chat.router)
app.include_router(parse_route.router)
app.include_router(guard.router)


@app.get("/health")
def health():
    return {"status": "ok", "service": "ai-gateway"}


@app.exception_handler(Exception)
async def unhandled_exception_handler(_request, exc):
    if os.getenv("NODE_ENV") == "production":
        return JSONResponse(status_code=500, content={"ok": False, "error": "internal server error"})
    return JSONResponse(status_code=500, content={"ok": False, "error": str(exc)})
