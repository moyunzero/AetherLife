"""Psycopg connect kwargs safe for Supabase transaction pooler (port 6543)."""

# PgBouncer transaction mode cannot reuse prepared statements across backend swaps.
PG_CONNECT_KWARGS = {"prepare_threshold": None}
