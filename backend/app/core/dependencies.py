"""Shared application singletons and constants."""
from __future__ import annotations

import os
from functools import lru_cache

from google.adk.runners import Runner
from google.adk.sessions.in_memory_session_service import InMemorySessionService

APP_NAME = "med-voice"
DEFAULT_GCP_LOCATION = "europe-north1"

os.environ.setdefault("GOOGLE_CLOUD_LOCATION", DEFAULT_GCP_LOCATION)


@lru_cache(maxsize=1)
def get_session_service() -> InMemorySessionService:
    return InMemorySessionService()


@lru_cache(maxsize=1)
def get_runner() -> Runner:
    # Lazy import avoids circular dependency at module load time
    from app.agents.med_voice_agent.agent import root_agent  # noqa: PLC0415

    return Runner(
        app_name=APP_NAME,
        agent=root_agent,
        session_service=get_session_service(),
    )


@lru_cache(maxsize=1)
def get_firestore_service():
    from app.services.firestore_service import FirestoreService  # noqa: PLC0415

    return FirestoreService()
