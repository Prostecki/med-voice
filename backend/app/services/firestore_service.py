"""
Firestore Service
=================
CRUD helpers for all 7 Firestore collections.
Falls back gracefully to a no-op when running without google-cloud-firestore
(e.g. local dev without credentials).
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)


class FirestoreService:
    """Thin wrapper around Firestore for all collection operations."""

    def __init__(self) -> None:
        try:
            import os
            from google.cloud import firestore  # type: ignore
            project = os.environ.get("GOOGLE_CLOUD_PROJECT") or os.environ.get("PROJECT_ID")
            database = "med-voice-db"
            logger.info("Initializing Firestore: project=%s, database=%s", project, database)
            self._db = firestore.Client(project=project, database=database)
            self._fs = firestore
            logger.info("Firestore connected successfully")
        except Exception as exc:
            logger.error("Firestore init failed: %s", exc, exc_info=True)
            self._db = None
            self._fs = None

    # ── Helpers ──────────────────────────────────────────────────────────────

    def _col(self, *path: str):
        """Return a Firestore CollectionReference."""
        if self._db is None:
            return None
        ref = self._db
        for segment in path:
            ref = ref.collection(segment) if hasattr(ref, "collection") else ref.document(segment)
        return ref

    def _get(self, collection: str, doc_id: str) -> dict[str, Any] | None:
        if self._db is None:
            return None
        doc = self._db.collection(collection).document(doc_id).get()
        if not doc.exists:
            return None
        data = doc.to_dict() or {}
        # Inject document ID into data to satisfy Pydantic models
        id_key = collection.replace("mv_", "").rstrip("s") + "Id" # heuristic for field name
        # Correct heuristic for some models
        if collection == "mv_patients": id_key = "patientId"
        elif collection == "mv_reports": id_key = "reportId"
        elif collection == "mv_calls": id_key = "callId"
        elif collection == "mv_clinics": id_key = "clinicId"
        elif collection == "mv_users": id_key = "userId"
        elif collection == "mv_appointments": id_key = "appointmentId"
        
        if id_key not in data:
            data[id_key] = doc.id
        return data

    def _set(self, collection: str, doc_id: str, data: dict[str, Any]) -> None:
        if self._db is None:
            return
        self._db.collection(collection).document(doc_id).set(data, merge=True)

    def _list(self, collection: str, **filters) -> list[dict[str, Any]]:
        if self._db is None:
            return []
        query = self._db.collection(collection)
        for field, value in filters.items():
            # Convert snake_case filter key to camelCase to match Firestore storage
            camel = "".join(
                w.capitalize() if i else w
                for i, w in enumerate(field.split("_"))
            )
            query = query.where(camel, "==", value)
        results = []
        for doc in query.stream():
            data = doc.to_dict() or {}
            # Try to inject ID if missing
            id_key = collection.replace("mv_", "").rstrip("s") + "Id"
            if collection == "mv_patients": id_key = "patientId"
            elif collection == "mv_reports": id_key = "reportId"
            if id_key not in data:
                data[id_key] = doc.id
            results.append(data)
        return results

    # ── clinics ──────────────────────────────────────────────────────────────

    def get_clinic(self, clinic_id: str) -> dict | None:
        return self._get("mv_clinics", clinic_id)

    def save_clinic(self, clinic_id: str, data: dict) -> None:
        self._set("mv_clinics", clinic_id, data)

    # ── users ─────────────────────────────────────────────────────────────────

    def get_user(self, user_id: str) -> dict | None:
        return self._get("mv_users", user_id)

    def save_user(self, user_id: str, data: dict) -> None:
        self._set("mv_users", user_id, data)

    def list_users_by_clinic(self, clinic_id: str) -> list[dict]:
        return self._list("mv_users", clinic_id=clinic_id)

    # ── patients ──────────────────────────────────────────────────────────────

    def get_patient(self, patient_id: str) -> dict | None:
        return self._get("mv_patients", patient_id)

    def save_patient(self, patient_id: str, data: dict) -> None:
        data.setdefault("createdAt", datetime.utcnow().isoformat())
        self._set("mv_patients", patient_id, data)

    def list_patients_by_clinic(self, clinic_id: str) -> list[dict]:
        return self._list("mv_patients", clinic_id=clinic_id)

    # ── reports ───────────────────────────────────────────────────────────────

    def get_report(self, report_id: str) -> dict | None:
        return self._get("mv_reports", report_id)

    def save_report(self, report_id: str, data: dict) -> None:
        data.setdefault("createdAt", datetime.utcnow().isoformat())
        self._set("mv_reports", report_id, data)

    def list_reports_by_patient(self, patient_id: str) -> list[dict]:
        return self._list("mv_reports", patient_id=patient_id)

    # ── calls ─────────────────────────────────────────────────────────────────

    def get_call(self, call_id: str) -> dict | None:
        return self._get("mv_calls", call_id)

    def save_call(self, call_id: str, data: dict) -> None:
        self._set("mv_calls", call_id, data)

    def update_call_status(self, call_id: str, status: str, **extra) -> None:
        data = {"status": status, **extra}
        self._set("mv_calls", call_id, data)

    def list_calls_by_patient(self, patient_id: str) -> list[dict]:
        return self._list("mv_calls", patient_id=patient_id)

    # ── appointments ──────────────────────────────────────────────────────────

    def get_appointment(self, appointment_id: str) -> dict | None:
        return self._get("mv_appointments", appointment_id)

    def save_appointment(self, appointment_id: str, data: dict) -> None:
        self._set("mv_appointments", appointment_id, data)

    def list_appointments_by_clinic(self, clinic_id: str) -> list[dict]:
        return self._list("mv_appointments", clinic_id=clinic_id)

    def list_appointments_by_patient(self, patient_id: str) -> list[dict]:
        return self._list("mv_appointments", patient_id=patient_id)

    # ── availability/{clinicId}/slots ─────────────────────────────────────────

    def list_available_slots(self, clinic_id: str, specialty: str) -> list[dict]:
        """Return unbooked slots for a given clinic + specialty."""
        if self._db is None:
            return []
        slots_ref = (
            self._db
            .collection("mv_availability")
            .document(clinic_id)
            .collection("slots")
        )

        specialty_normalized = specialty.lower().strip()
        query = slots_ref.where("specialty", "==", specialty_normalized).limit(20)
        all_slots = []
        for doc in query.stream():
            data = doc.to_dict() or {}
            if "slotId" not in data:
                data["slotId"] = doc.id
            all_slots.append(data)

        if not all_slots:
            logger.info(
                "Exact specialty query returned 0 slots for clinic=%s specialty=%s. Falling back to local normalization.",
                clinic_id,
                specialty_normalized,
            )
            for doc in slots_ref.limit(100).stream():
                data = doc.to_dict() or {}
                if "slotId" not in data:
                    data["slotId"] = doc.id
                slot_specialty = str(data.get("specialty", "")).lower().strip()
                provider_name = str(data.get("providerName", "")).lower()
                if slot_specialty == specialty_normalized or specialty_normalized in provider_name:
                    all_slots.append(data)

        def _slot_is_future(slot: dict[str, Any]) -> bool:
            raw_start = slot.get("slotStart") or slot.get("slot_start")
            if not raw_start:
                return False

            if isinstance(raw_start, datetime):
                start_dt = raw_start
            else:
                try:
                    start_dt = datetime.fromisoformat(str(raw_start).replace("Z", "+00:00"))
                except ValueError:
                    return False

            if start_dt.tzinfo is None:
                start_dt = start_dt.replace(tzinfo=timezone.utc)

            return start_dt >= datetime.now(timezone.utc)

        return [
            s for s in all_slots
            if not (s.get("isBooked") or s.get("is_booked"))
            and _slot_is_future(s)
        ][:10]

    def book_slot(self, clinic_id: str, slot_id: str) -> None:
        """Mark a slot as booked."""
        if self._db is None:
            return
        (
            self._db
            .collection("mv_availability")
            .document(clinic_id)
            .collection("slots")
            .document(slot_id)
            .set({"isBooked": True}, merge=True)
        )

    # ── Session helpers (legacy — used by tools) ──────────────────────────────

    def get_session(self, session_id: str) -> dict | None:
        return self._get("sessions", session_id)

    def save_session(self, session_id: str, data: dict) -> None:
        self._set("sessions", session_id, data)
