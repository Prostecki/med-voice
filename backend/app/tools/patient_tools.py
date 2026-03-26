"""
Patient tools: fetch patient context from Firestore.
"""
from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


def find_patient_id_by_name(full_name: str) -> dict[str, str]:
    """
    Search for a patient's ID by their full name in Firestore.
    Use this when the patient tells you their name, but you only have the name and need their patient_id.

    Args:
        full_name: The patient's full name to search for.

    Returns:
        dict with keys:
          - 'found' (bool)
          - 'patient_id' (str) if found
          - 'message' (str)
    """
    from app.services.firestore_service import FirestoreService
    db = FirestoreService()
    
    # Simple search in all patients
    patients = db._list("mv_patients")
    
    target_name = full_name.lower().strip()
    for p in patients:
        p_name = (p.get("fullName") or p.get("full_name") or "").lower().strip()
        if target_name in p_name or p_name in target_name:
            patient_id = p.get("patientId") or p.get("patient_id") or p.get("id")
            if patient_id:
                return {"found": True, "patient_id": patient_id, "message": f"Found patient ID: {patient_id}"}
                
    return {"found": False, "patient_id": "", "message": "No patient found with that name."}


def get_patient_context(patient_id: str) -> dict[str, Any]:
    """
    Retrieve patient identity and session context.

    Args:
        patient_id: Unique patient identifier (e.g. from auth token).

    Returns:
        A dict with keys:
          - patient_id (str)
          - full_name (str)
          - date_of_birth (str, ISO format)
          - pending_reports (list[str])   # report IDs awaiting review
          - last_session_state (str|None) # e.g. "callback_scheduled"
          - callback_time (str|None)
    """
    from app.services.firestore_service import FirestoreService

    db = FirestoreService()
    patient = db.get_patient(patient_id)

    if patient is None:
        # Graceful fallback so the agent can still greet the patient
        logger.warning("Patient %s not found in Firestore.", patient_id)
        return {
            "patient_id": patient_id,
            "full_name": "Unknown Patient",
            "date_of_birth": None,
            "pending_reports": [],
            "last_session_state": None,
            "callback_time": None,
        }

    return {
        "patient_id": patient_id,
        "clinic_id": patient.get("clinicId") or patient.get("clinic_id"),
        "full_name": patient.get("fullName") or patient.get("full_name", "Unknown Patient"),
        "date_of_birth": patient.get("dateOfBirth") or patient.get("date_of_birth"),
        "pending_reports": patient.get("pendingReports") or patient.get("pending_reports", []),
        "last_session_state": patient.get("lastSessionState") or patient.get("last_session_state"),
        "callback_time": patient.get("callbackTime") or patient.get("callback_time"),
    }
