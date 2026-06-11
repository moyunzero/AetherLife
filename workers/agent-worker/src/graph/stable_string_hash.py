"""Deterministic 32-bit string hash — aligned with packages/shared stableStringHash."""


def stable_string_hash(s: str) -> int:
    h = 0
    for ch in s:
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return h
