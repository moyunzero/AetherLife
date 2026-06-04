from fastapi import APIRouter

from app.models.requests import ParseBody
from app.services.parse import parse_intent

router = APIRouter(prefix="/v1/rooms", tags=["nl"])


@router.post("/{room_id}/nl/parse")
async def nl_parse(room_id: str, body: ParseBody):
    del room_id  # room context not used for parse-only endpoint
    parsed, err = await parse_intent(body.message.strip())
    return {"ok": True, "parsedIntent": parsed, "parseError": err}
