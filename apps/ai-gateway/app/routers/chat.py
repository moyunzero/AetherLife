import asyncio
import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from app.guards.content import ContentGuard
from app.models.requests import ChatBody
from app.services.parse import parse_intent
from app.services.proxy import proxy_chat

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/v1/rooms", tags=["chat"])
_content_guard = ContentGuard()


@router.post("/{room_id}/chat")
async def room_chat(room_id: str, body: ChatBody):
    message = body.message.strip()
    guard = await _content_guard.check(message)
    if not guard.allowed:
        logger.info("event=content_blocked room=%s reason=%s", room_id, guard.reason)
        return JSONResponse(
            status_code=400,
            content={"ok": False, "code": "content_blocked", "error": "无法处理该内容"},
        )

    async def safe_parse() -> tuple[dict | None, str | None]:
        try:
            return await parse_intent(message)
        except Exception as exc:
            return None, str(exc)

    try:
        proxy_result, (parsed_intent, parse_error) = await asyncio.gather(
            proxy_chat(room_id, message, body.npcId),
            safe_parse(),
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail={"ok": False, "error": str(exc)}) from exc

    job_id = proxy_result.get("jobId")
    if not job_id:
        raise HTTPException(status_code=502, detail={"ok": False, "error": "missing jobId from game-server"})

    return {
        "ok": True,
        "jobId": job_id,
        "parsedIntent": parsed_intent,
        "parseError": parse_error,
    }
