from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field, ValidationError


class MoveAction(BaseModel):
    type: Literal["move"] = "move"
    x: float
    y: float


class InteractAction(BaseModel):
    type: Literal["interact"] = "interact"
    objectId: str = Field(min_length=1)


class SpeakAction(BaseModel):
    type: Literal["speak"] = "speak"
    targetId: str = Field(min_length=1)
    content: str = Field(min_length=1, max_length=2000)


class WaitAction(BaseModel):
    type: Literal["wait"] = "wait"
    durationMs: int = Field(ge=1, le=600_000)


class TransferAction(BaseModel):
    type: Literal["transfer"] = "transfer"
    itemId: str = Field(min_length=1)
    toNpcId: str = Field(min_length=1)


NlAction = Annotated[
    Union[MoveAction, InteractAction, SpeakAction, WaitAction, TransferAction],
    Field(discriminator="type"),
]


def validate_nl_action(data: object) -> tuple[dict | None, str | None]:
    try:
        if isinstance(data, dict):
            action = _parse_action_dict(data)
        else:
            return None, "expected object"
        return action.model_dump(), None
    except ValidationError as exc:
        return None, str(exc.errors()[0]["msg"] if exc.errors() else "validation failed")


def _parse_action_dict(data: dict) -> MoveAction | InteractAction | SpeakAction | WaitAction | TransferAction:
    kind = data.get("type")
    if kind == "move":
        return MoveAction.model_validate(data)
    if kind == "interact":
        return InteractAction.model_validate(data)
    if kind == "speak":
        return SpeakAction.model_validate(data)
    if kind == "wait":
        return WaitAction.model_validate(data)
    if kind == "transfer":
        return TransferAction.model_validate(data)
    raise ValidationError.from_exception_data("NlAction", [])
