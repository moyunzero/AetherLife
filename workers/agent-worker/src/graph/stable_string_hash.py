"""Deterministic 32-bit string hash — aligned with packages/shared stableStringHash."""


def stable_string_hash(s: str) -> int:
    """
    Compute a deterministic 32-bit hash of the input string.
    
    Parameters:
        s (str): Input string to hash.
    
    Returns:
        int: 32-bit unsigned hash value in the range 0 to 4294967295.
    """
    h = 0
    for ch in s:
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return h
