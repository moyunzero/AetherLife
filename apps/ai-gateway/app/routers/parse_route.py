from fastapi import APIRouter

from app.guards.content import ContentGuard
from app.guards.responses import guard_denied_response
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
        return guard_denied_response(guard)
    parsed, err = await parse_intent(message)
    return {"ok": True, "parsedIntent": parsed, "parseError": err}
