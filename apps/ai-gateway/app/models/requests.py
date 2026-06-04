from pydantic import BaseModel, Field


class ParseBody(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    npcId: str | None = None


class ChatBody(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    npcId: str


class CheckReplyBody(BaseModel):
    text: str = Field(min_length=1, max_length=8000)
    toolCalls: list[dict] | None = None
