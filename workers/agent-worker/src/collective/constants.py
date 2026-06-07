"""Keep in sync with packages/shared/src/collectiveMemory.ts."""

COLLECTIVE_EVENT_KINDS = (
    "rude",
    "polite",
    "help",
    "contradict",
    "compete_object",
    "collaborate",
    "steal_attempt",
    "ignore",
    "gift",
    "praise",
    "apologize",
    "betray",
)

KIND_FIXED_DELTA: dict[str, int] = {
    "rude": -8,
    "polite": 3,
    "help": 6,
    "contradict": -10,
    "compete_object": -12,
    "collaborate": 8,
    "steal_attempt": -15,
    "ignore": -2,
    "gift": 10,
    "praise": 5,
    "apologize": 4,
    "betray": -20,
}

LOUD_KINDS = frozenset({"rude", "contradict", "steal_attempt", "compete_object", "betray"})

NPC_PERSONALITY_SEED: dict[str, int] = {
    "npc-1": -5,
    "npc-2": 0,
    "npc-3": 15,
}

DEFAULT_COLLECTIVE_WINDOW_MS = 300_000
COLLECTIVE_EVENT_TTL_MS = 7 * 24 * 60 * 60 * 1000
COLLECTIVE_WINDOW_MEAN_WEIGHT = 0.3
WITNESS_DELTA_FRACTION = 0.3
WITNESS_CHEBYSHEV_MAX = 2
LLM_REFINE_DELTA_MIN = -10
LLM_REFINE_DELTA_MAX = 10

ALL_ALLOWED_TOOLS = ("speak", "wait", "move", "interact", "transfer")
HOSTILE_ALLOWED_TOOLS = ("speak", "wait")

BAND_LABEL_ZH: dict[str, str] = {
    "hostile": "敌意",
    "wary": "戒备",
    "neutral": "平常",
    "warm": "亲近",
    "allied": "同盟",
}
