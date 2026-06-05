from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.guards.content import ContentGuard
from app.models.requests import ParseBody
from app.services.parse import parse_intent

router = APIRouter(prefix="/v1/rooms", tags=["nl"])
_content_guard = ContentGuard()


@router.post("/{room_id}/nl/parse")
async def nl_parse(room_id: str, body: ParseBody):
    del room_id  # room context not used for parse-only endpoint
    message = body.message.strip()
    guard = await _content_guard.check(message)
    if not guard.allowed:
        return JSONResponse(
            status_code=400,
            content={"ok": False, "code": "content_blocked", "error": "无法处理该内容"},
        )
    parsed, err = await parse_intent(message)
    return {"ok": True, "parsedIntent": parsed, "parseError": err}
