"""
Session service: manages in-flight conversation state and callback scheduling.
"""
from __future__ import annotations

import logging
from typing import Any

from .firestore_service import FirestoreService

logger = logging.getLogger(__name__)
_firestore = FirestoreService()


class SessionService:
    """High-level session management used by the agent tools."""

    def load(self, session_id: str) -> dict[str, Any]:
        data = _firestore.get_session(session_id)
        return data or {}

    def save(self, session_id: str, data: dict[str, Any]) -> None:
        _firestore.save_session(session_id, data)

    def mark_callback_scheduled(
        self, session_id: str, callback_time: str
    ) -> None:
        self.save(
            session_id,
            {
                "state": "callback_scheduled",
                "callback_time": callback_time,
            },
        )

    def mark_appointment_booked(
        self, session_id: str, appointment_id: str
    ) -> None:
        self.save(
            session_id,
            {
                "state": "appointment_booked",
                "appointment_id": appointment_id,
            },
        )
