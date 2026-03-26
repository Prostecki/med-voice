"""
Firestore Data Models
=====================
Pydantic v2 models mirroring Firestore schema.

Naming convention
-----------------
- Python fields : snake_case  (e.g. full_name, clinic_id)
- Firestore / JSON keys : camelCase  (e.g. fullName, clinicId)

The `alias_generator=to_camel` config handles the mapping automatically:
  - model.model_dump(by_alias=True)  → camelCase dict  (for Firestore writes)
  - Model.model_validate(firestore_dict)  → snake_case attrs in Python
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


# ── Shared config ─────────────────────────────────────────────────────────────

class FirestoreModel(BaseModel):
    """Base class: camelCase aliases for Firestore, snake_case in Python."""
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,   # allow both snake and camel on input
        use_enum_values=True,
    )


# ── Enums ─────────────────────────────────────────────────────────────────────

class UserRole(str, Enum):
    ADMIN   = "ADMIN"
    STAFF   = "STAFF"
    AUDITOR = "AUDITOR"


class ReportType(str, Enum):
    LAB   = "LAB"
    ECG   = "ECG"
    MIXED = "MIXED"


class ReportStatus(str, Enum):
    UPLOADED = "UPLOADED"
    ANALYZED = "ANALYZED"
    REVIEWED = "REVIEWED"


class CallStatus(str, Enum):
    QUEUED              = "QUEUED"
    CALLING             = "CALLING"
    CONNECTED           = "CONNECTED"
    COMPLETED           = "COMPLETED"
    FAILED              = "FAILED"
    CALLBACK_SCHEDULED  = "CALLBACK_SCHEDULED"


class AppointmentStatus(str, Enum):
    PROPOSED  = "PROPOSED"
    CONFIRMED = "CONFIRMED"
    CANCELLED = "CANCELLED"


# ── clinics/{clinicId} ────────────────────────────────────────────────────────

class Clinic(FirestoreModel):
    """clinics/{clinicId}"""
    clinic_id   : str
    name        : str
    address     : str
    timezone    : str           # e.g. "Europe/London"
    phone_number: str


# ── users/{userId} ────────────────────────────────────────────────────────────

class User(FirestoreModel):
    """users/{userId}"""
    user_id     : str
    clinic_id   : str
    role        : UserRole
    display_name: str


# ── patients/{patientId} ──────────────────────────────────────────────────────

class Patient(FirestoreModel):
    """patients/{patientId}"""
    patient_id        : str
    clinic_id         : str
    full_name         : str
    phone             : str
    preferred_language: str = "en"
    created_at        : datetime = Field(default_factory=datetime.utcnow)


# ── reports/{reportId} ────────────────────────────────────────────────────────

class Deviation(FirestoreModel):
    marker         : str
    value          : str
    reference_range: str
    severity       : str        # "normal" | "mild" | "moderate" | "critical"
    plain_text     : str


class Report(FirestoreModel):
    """reports/{reportId}"""
    report_id       : str
    clinic_id       : str
    patient_id      : str
    report_type     : ReportType
    report_date     : str                   # ISO date e.g. "2026-02-20"
    gcs_path        : str                   # gs://bucket/path
    status          : ReportStatus = ReportStatus.UPLOADED
    extracted_text  : str | None = None
    structured_values: dict[str, Any] = Field(default_factory=dict)
    deviations      : list[Deviation] = Field(default_factory=list)
    summary_plain   : str = ""
    created_by      : str = ""
    created_at      : datetime = Field(default_factory=datetime.utcnow)


# ── calls/{callId} ────────────────────────────────────────────────────────────

class Call(FirestoreModel):
    """calls/{callId}"""
    call_id      : str
    clinic_id    : str
    patient_id   : str
    report_id    : str
    status       : CallStatus = CallStatus.QUEUED
    scheduled_for: datetime | None = None
    started_at   : datetime | None = None
    ended_at     : datetime | None = None
    transcript   : list[dict[str, str]] = Field(default_factory=list)
    notes        : str = ""


# ── appointments/{appointmentId} ──────────────────────────────────────────────

class Appointment(FirestoreModel):
    """appointments/{appointmentId}"""
    appointment_id: str
    clinic_id     : str
    patient_id    : str
    report_id     : str
    specialty     : str
    provider_name : str
    slot_start    : datetime
    slot_end      : datetime
    status        : AppointmentStatus = AppointmentStatus.PROPOSED


# ── availability/{clinicId}/slots/{slotId} ────────────────────────────────────

class AvailabilitySlot(FirestoreModel):
    """availability/{clinicId}/slots/{slotId}"""
    slot_id      : str
    clinic_id    : str
    specialty    : str
    provider_name: str
    slot_start   : datetime
    slot_end     : datetime
    is_booked    : bool = False
