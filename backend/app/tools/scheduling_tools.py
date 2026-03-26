"""
Scheduling tools: callback scheduling and appointment booking.
All operations persist to Firestore (mv_* collections).
Falls back to mock data when Firestore is unavailable.
"""
from __future__ import annotations

import logging
import uuid
import os
import json
import re
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)

# ── Mock slots for dev / when Firestore has no data ───────────────────────────
_MOCK_SLOTS = [
    {
        "slotId"      : "mock-cardio-001",
        "providerName": "Dr. Sarah Thompson (Cardiologist)",
        "slotStart"   : "2026-03-17T09:30:00+00:00",
        "slotEnd"     : "2026-03-17T10:00:00+00:00",
        "clinicName"  : "Northside Medical Center",
        "isBooked"    : False,
        "specialty"   : "cardiologist",
    },
    {
        "slotId"      : "mock-cardio-002",
        "providerName": "Dr. Mark Ellis (Cardiologist)",
        "slotStart"   : "2026-03-17T13:30:00+00:00",
        "slotEnd"     : "2026-03-17T14:00:00+00:00",
        "clinicName"  : "Northside Medical Center",
        "isBooked"    : False,
        "specialty"   : "cardiologist",
    },
    {
        "slotId"      : "mock-cardio-003",
        "providerName": "Dr. Sarah Thompson (Cardiologist)",
        "slotStart"   : "2026-03-18T11:00:00+00:00",
        "slotEnd"     : "2026-03-18T11:30:00+00:00",
        "clinicName"  : "Northside Medical Center",
        "isBooked"    : False,
        "specialty"   : "cardiologist",
    },
    {
        "slotId"      : "mock-endo-001",
        "providerName": "Dr. David Klein (Endocrinologist)",
        "slotStart"   : "2026-03-17T10:30:00+00:00",
        "slotEnd"     : "2026-03-17T11:00:00+00:00",
        "clinicName"  : "Northside Medical Center",
        "isBooked"    : False,
        "specialty"   : "endocrinologist",
    },
    {
        "slotId"      : "mock-endo-002",
        "providerName": "Dr. Priya Menon (Endocrinologist)",
        "slotStart"   : "2026-03-18T14:00:00+00:00",
        "slotEnd"     : "2026-03-18T14:30:00+00:00",
        "clinicName"  : "Northside Medical Center",
        "isBooked"    : False,
        "specialty"   : "endocrinologist",
    },
    {
        "slotId"      : "mock-endo-003",
        "providerName": "Dr. David Klein (Endocrinologist)",
        "slotStart"   : "2026-03-19T09:00:00+00:00",
        "slotEnd"     : "2026-03-19T09:30:00+00:00",
        "clinicName"  : "Northside Medical Center",
        "isBooked"    : False,
        "specialty"   : "endocrinologist",
    },
]


def _coerce_minutes(minutes_from_now: Any) -> int | None:
    """Accept natural callback delays like 2, '2', or '2 minutes'."""
    if minutes_from_now is None:
        return None
    if isinstance(minutes_from_now, int):
        return minutes_from_now
    if isinstance(minutes_from_now, float):
        return int(minutes_from_now)
    if isinstance(minutes_from_now, str):
        match = re.search(r"(\d+)", minutes_from_now)
        if match:
            return int(match.group(1))
    return None


def _format_slot(raw: dict) -> dict:
    """Normalise a Firestore slot dict into agent-friendly shape."""
    start = raw.get("slotStart") or raw.get("slot_start", "")
    if hasattr(start, "isoformat"):
        start = start.isoformat()
    end = raw.get("slotEnd") or raw.get("slot_end", "")
    if hasattr(end, "isoformat"):
        end = end.isoformat()
    return {
        "slot_id"    : raw.get("slotId") or raw.get("slot_id", ""),
        "doctor_name": raw.get("providerName") or raw.get("provider_name", ""),
        "date"       : start[:10] if start else "",
        "time"       : start[11:16] if len(start) > 10 else "",
        "slot_start" : start,
        "slot_end"   : end,
        "clinic_name": raw.get("clinicName", "Northside Medical Center"),
    }


def _normalize_specialty(specialty: str) -> str:
    specialty_lower = specialty.lower().strip()
    specialty_map = {
        "endocrinology": "endocrinologist",
        "endocrinologist": "endocrinologist",
        "cardiology": "cardiologist",
        "cardiologist": "cardiologist",
        "therapy": "therapist",
        "therapist": "therapist",
        "psychology": "psychologist",
        "psychologist": "psychologist",
        "dermatology": "dermatologist",
        "dermatologist": "dermatologist",
        "neurology": "neurologist",
        "neurologist": "neurologist",
        "pediatrics": "pediatrician",
        "pediatrician": "pediatrician",
    }
    return specialty_map.get(specialty_lower, specialty_lower)


def _mock_slots_for_specialty(specialty: str) -> list[dict]:
    normalized_specialty = _normalize_specialty(specialty)
    return [
        _format_slot(slot)
        for slot in _MOCK_SLOTS
        if slot.get("specialty") == normalized_specialty
    ]


# ─────────────────────────────────────────────────────────────────────────────

def list_available_slots(
    clinic_id: str,
    specialty: str,
    earliest_only: bool = True,
) -> dict[str, Any]:
    """
    Return available appointment slots for a given medical specialty.

    Reads from Firestore mv_availability/{clinic_id}/slots.
    Falls back to mock data if Firestore is unavailable or has no slots.

    Args:
        clinic_id:      Clinic to query.
        specialty:      Medical specialty (e.g. "cardiologist", "therapist").
        earliest_only:  If true, sorts and returns the earliest 2-3 options.

    Returns:
        dict with keys:
          - specialty (str)
          - slots (list[dict])  — each with slot_id, doctor_name, date, time
    """
    slots: list[dict] = []

    try:
        from app.services.firestore_service import FirestoreService
        db = FirestoreService()

        if clinic_id:
            db_specialty = _normalize_specialty(specialty)
            
            raw_slots = db.list_available_slots(clinic_id, db_specialty)
            logger.info("Firestore returned %d slots for %s (mapped from %s)", len(raw_slots), db_specialty, specialty)
            slots = [_format_slot(s) for s in raw_slots]
    except Exception as exc:
        logger.warning("Could not load slots from Firestore: %s", exc, exc_info=True)

    # Fallback to mock data
    if not slots:
        logger.info("Using mock slots for specialty=%s", specialty)
        slots = _mock_slots_for_specialty(specialty)

    if earliest_only:
        # Sort by slot_start as a string (ISO 8601 sorts alphabetically)
        slots.sort(key=lambda x: x.get("slot_start", ""))
        slots = slots[:3]

    return {"specialty": specialty, "slots": slots}


def book_appointment(
    patient_id: str,
    report_id: str,
    slot_id: str,
) -> dict[str, Any]:
    """
    Confirm and persist an appointment booking to Firestore mv_appointments.

    Args:
        patient_id:  Unique patient identifier.
        report_id:   The report ID this appointment relates to.
        slot_id:     Slot ID returned by list_available_slots.

    Returns:
        dict with keys:
          - success (bool)
          - appointment_id (str)
          - confirmation_message (str)
    """
    appointment_id = str(uuid.uuid4())

    try:
        from app.services.firestore_service import FirestoreService
        db = FirestoreService()

        # Step 1: Resolve clinic_id (prefer report, fallback to patient)
        clinic_id = None
        if report_id and report_id != "N/A":
            logger.info("Resolving clinic from report %s", report_id)
            report = db.get_report(report_id)
            if report:
                clinic_id = report.get("clinicId") or report.get("clinic_id")
        
        if not clinic_id:
            logger.info("Resolving clinic from patient %s", patient_id)
            patient = db.get_patient(patient_id)
            if patient:
                clinic_id = patient.get("clinicId") or patient.get("clinic_id")

        if not clinic_id:
            logger.warning("FAILED booking: Could not resolve clinic_id for patient %s (report_id: %s).", patient_id, report_id)
            return {"success": False, "message": "Could not identify the clinic for this appointment."}

        logger.info("Resolved clinic_id: %s", clinic_id)

        # Step 2: Fetch slot details
        slot = None
        if clinic_id and not slot_id.startswith("mock-"):
            logger.info("Fetching slot %s from clinic %s", slot_id, clinic_id)
            if db._db:
                slot_doc = db._db.collection("mv_availability").document(clinic_id).collection("slots").document(slot_id).get()
                if slot_doc.exists:
                    slot = slot_doc.to_dict()

        if not slot and not slot_id.startswith("mock-"):
            logger.warning("FAILED booking: Slot %s not found in clinic %s", slot_id, clinic_id)
            return {"success": False, "message": "Slot not found or unavailable."}
            
        if slot_id.startswith("mock-"):
            logger.info("Using mock slot %s", slot_id)
            for m in _MOCK_SLOTS:
                if m["slotId"] == slot_id:
                    slot = m
                    break
        
        if not slot:
             logger.warning("FAILED booking: No slot data found for slot_id %s", slot_id)
             return {"success": False, "message": "Slot not found."}

        # Extract slot values
        doctor_name = slot.get("providerName") or slot.get("provider_name") or "Your Doctor"
        slot_start = slot.get("slotStart") or slot.get("slot_start") or ""
        slot_end = slot.get("slotEnd") or slot.get("slot_end") or ""
        specialty = slot.get("specialty", "")
        
        if hasattr(slot_start, "isoformat"):
            slot_start = slot_start.isoformat()
        if hasattr(slot_end, "isoformat"):
            slot_end = slot_end.isoformat()

        date_str = slot_start[:10] if slot_start else "Unknown Date"
        time_str = slot_start[11:16] if len(slot_start) > 10 else "Unknown Time"
        
        # Try to resolve clinic name for a better message
        clinic_name = "the clinic"
        try:
            clinic = db.get_clinic(clinic_id)
            if clinic:
                clinic_name = clinic.get("name", "the clinic")
        except:
            pass

        logger.info("Booking appointment for patient %s with %s at %s on %s", patient_id, doctor_name, clinic_name, date_str)

        # Save appointment document
        db.save_appointment(appointment_id, {
            "appointmentId": appointment_id,
            "clinicId"     : clinic_id,
            "patientId"    : patient_id,
            "reportId"     : report_id,
            "specialty"    : specialty,
            "providerName" : doctor_name,
            "slotStart"    : slot_start,
            "slotEnd"      : slot_end,
            "status"       : "CONFIRMED",
            "createdAt"    : datetime.utcnow().isoformat()
        })

        # Mark slot as booked
        if clinic_id and not slot_id.startswith("mock-"):
            db.book_slot(clinic_id, slot_id)
            logger.info("Marked slot %s as booked", slot_id)

    except Exception as exc:
        logger.error("ERROR during booking: %s", exc, exc_info=True)
        return {"success": False, "message": "System error booking appointment."}

    confirmation = (
        f"Your appointment with {doctor_name} at {clinic_name} "
        f"on {date_str} at {time_str} has been confirmed. "
        f"Your confirmation number is {appointment_id[:8].upper()}. "
        "You'll receive an SMS reminder 24 hours before."
    )

    return {
        "success"             : True,
        "appointment_id"      : appointment_id,
        "confirmation_message": confirmation,
    }


def schedule_callback(call_id: str, minutes_from_now: int | str | None = None, timestamp: str | None = None) -> dict[str, Any]:
    """
    Schedule a callback when the patient is busy or needs more time.
    Persists a CALLBACK_SCHEDULED call record to Firestore mv_calls.
    It expects either `minutes_from_now` or `timestamp`.

    Args:
        call_id:          Unique call identifier.
        minutes_from_now: Delay in minutes before the callback is triggered.
        timestamp:        ISO-8601 datetime timestamp for the callback.

    Returns:
        dict with keys:
          - success (bool)
          - callback_id (str)
          - scheduled_time (str)
          - message (str)
    """
    try:
        from app.services.firestore_service import FirestoreService
        from datetime import datetime, timedelta
        
        db = FirestoreService()
        logger.info(
            "schedule_callback invoked: call_id=%s minutes_from_now=%r timestamp=%r",
            call_id,
            minutes_from_now,
            timestamp,
        )
        
        callback_minutes = _coerce_minutes(minutes_from_now)

        # Calculate preferred time. Default to a short callback for spoken requests
        # that do not provide a clean structured value.
        if callback_minutes is not None:
            preferred_time = (datetime.utcnow() + timedelta(minutes=callback_minutes)).isoformat()
        elif timestamp:
            preferred_time = timestamp
        else:
            callback_minutes = 2
            preferred_time = (datetime.utcnow() + timedelta(minutes=callback_minutes)).isoformat()
        
        # Fetch the existing call to verify and update
        call = db.get_call(call_id)
        if not call:
            logger.warning("Could not find call %s to schedule callback.", call_id)
            return {"success": False, "message": f"Could not find call {call_id}."}

        db.update_call_status(
            call_id,
            status="CALLBACK_SCHEDULED",
            scheduledFor=preferred_time,
            notes=f"Callback requested by patient for {preferred_time}"
        )
        logger.info(
            "Callback state persisted: call_id=%s scheduled_for=%s callback_minutes=%r",
            call_id,
            preferred_time,
            callback_minutes,
        )
        
        # Enqueue GCP Cloud Task for the callback
        project = os.environ.get("GOOGLE_CLOUD_PROJECT")
        location = os.environ.get("CLOUD_TASKS_LOCATION") or os.environ.get("GOOGLE_CLOUD_LOCATION", "europe-north1")
        queue = os.environ.get("CALLBACK_QUEUE", "callback-queue")
        service_url = os.environ.get("SERVICE_URL")
        sa_email = os.environ.get("SERVICE_ACCOUNT_EMAIL")

        if project and service_url and sa_email:
            from google.cloud import tasks_v2
            from google.protobuf import timestamp_pb2
            
            client = tasks_v2.CloudTasksClient()
            parent = client.queue_path(project, location, queue)
            logger.info(
                "Preparing Cloud Task callback: call_id=%s parent=%s queue=%s location=%s service_url=%s",
                call_id,
                parent,
                queue,
                location,
                service_url,
            )
            
            # Construct the task
            # Target endpoint: POST /api/callbacks/trigger
            url = f"{service_url.rstrip('/')}/api/callbacks/trigger"
            payload = {"call_id": call_id}
            
            task = {
                "http_request": {
                    "http_method": tasks_v2.HttpMethod.POST,
                    "url": url,
                    "headers": {"Content-Type": "application/json"},
                    "body": json.dumps(payload).encode(),
                    "oidc_token": {
                        "service_account_email": sa_email,
                        "audience": service_url,
                    },
                }
            }
            
            # Schedule time
            dt = datetime.fromisoformat(preferred_time.replace("Z", "+00:00"))
            timestamp_proto = timestamp_pb2.Timestamp()
            timestamp_proto.FromDatetime(dt)
            task["schedule_time"] = timestamp_proto
            logger.info(
                "Creating Cloud Task now: call_id=%s callback_url=%s schedule_time=%s",
                call_id,
                url,
                preferred_time,
            )
            
            response = client.create_task(request={"parent": parent, "task": task})
            db.save_call(call_id, {"callbackTaskName": response.name})
            logger.info(
                "Cloud Task created successfully: call_id=%s task_name=%s schedule_time=%s queue=%s location=%s",
                call_id,
                response.name,
                preferred_time,
                queue,
                location,
            )
        else:
            missing = []
            if not project: missing.append("GOOGLE_CLOUD_PROJECT")
            if not service_url: missing.append("SERVICE_URL")
            if not sa_email: missing.append("SERVICE_ACCOUNT_EMAIL")
            logger.error(
                "Cloud Task callback aborted: call_id=%s missing_env=%s",
                call_id,
                ", ".join(missing),
            )
            return {"success": False, "message": f"Cloud Task env missing: {', '.join(missing)}"}
        
    except Exception as exc:
        logger.warning(
            "Cloud Task callback failed: call_id=%s error=%s",
            call_id,
            exc,
            exc_info=True,
        )
        return {"success": False, "message": "An internal error occurred while scheduling callback."}

    return {
        "success": True,
        "callback_id": call_id,
        "scheduled_time": preferred_time,
        "message": f"Callback scheduled successfully for {preferred_time}."
    }


def cancel_appointment(appointment_id: str) -> dict[str, Any]:
    """
    Cancel an existing appointment in Firestore.

    Args:
        appointment_id: The ID of the appointment to cancel.

    Returns:
        dict with keys:
          - success (bool)
          - message (str)
    """
    try:
        from app.services.firestore_service import FirestoreService
        db = FirestoreService()

        appointment = db.get_appointment(appointment_id)
        if not appointment:
            return {"success": False, "message": f"Appointment {appointment_id} not found."}

        # Update status to CANCELLED
        db.save_appointment(appointment_id, {"status": "CANCELLED"})

        # (Optional) Mark slot as available again
        clinic_id = appointment.get("clinicId") or appointment.get("clinic_id")
        slot_id = appointment.get("slotId") or appointment.get("slot_id")
        if clinic_id and slot_id and not slot_id.startswith("mock-"):
            if db._db:
                db._db.collection("mv_availability").document(clinic_id).collection("slots").document(slot_id).set({"isBooked": False}, merge=True)

        return {"success": True, "message": f"Appointment {appointment_id} has been cancelled."}
    except Exception as exc:
        logger.warning("Could not cancel appointment: %s", exc)
        return {"success": False, "message": "An error occurred while cancelling the appointment."}


def get_patient_appointments(patient_id: str) -> dict[str, Any]:
    """
    List all current and upcoming appointments for a patient.

    Args:
        patient_id: Unique patient identifier.

    Returns:
        A dict with the list of appointments.
    """
    try:
        from app.services.firestore_service import FirestoreService
        db = FirestoreService()
        
        raw_appointments = db.list_appointments_by_patient(patient_id)
        
        # Simplify and sort by date for easier verbal list
        appointments = []
        for appt in raw_appointments:
            # We want to show only active appointments
            if appt.get("status") == "CANCELLED":
                continue
            
            # Firestore might return native datetime objects (DatetimeWithNanoseconds)
            # which are not subscriptable like strings.
            slot_start = appt.get("slotStart") or appt.get("slot_start", "")
            if hasattr(slot_start, "isoformat"):
                slot_start = slot_start.isoformat()
            
            appointments.append({
                "appointment_id": appt.get("appointmentId") or appt.get("appointment_id"),
                "doctor": appt.get("providerName") or appt.get("provider_name"),
                "specialty": appt.get("specialty"),
                "date": slot_start[:10] if slot_start else "",
                "time": slot_start[11:16] if len(slot_start) > 10 else "",
                "status": appt.get("status")
            })
            
        # Sort by date
        appointments.sort(key=lambda x: x["date"])
        
        return {
            "patient_id": patient_id,
            "appointments": appointments,
            "total_count": len(appointments)
        }
    except Exception as exc:
        logger.warning("Could not list appointments for patient %s: %s", patient_id, exc)
        return {"success": False, "message": "Failed to retrieve appointments."}
