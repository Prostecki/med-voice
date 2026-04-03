"""Report, slot and appointment endpoints."""
from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.dependencies import get_firestore_service
from app.models.firestore_models import AvailabilitySlot, ReportStatus
from app.services.firestore_service import FirestoreService
from app.tools.report_tools import analyze_report
from app.tools.scheduling_tools import book_appointment

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class SignedUrlRequest(BaseModel):
    filename: str
    content_type: str
    patient_id: str
    clinic_id: str


class ProcessReportRequest(BaseModel):
    patient_id: str
    clinic_id: str
    gcs_path: str
    filename: str
    content_type: str


class BookingRequest(BaseModel):
    patient_id: str
    report_id: str
    slot_id: str
    clinic_id: str


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/reports/upload-url")
async def get_upload_url(req: SignedUrlRequest):
    """Generate a signed URL for GCS upload using IAM impersonation."""
    try:
        from google.auth import impersonated_credentials
        from google.auth.transport.requests import Request
        from google.cloud import storage
        import google.auth

        bucket_name = os.environ.get("REPORTS_BUCKET")
        sa_email = os.environ.get("SERVICE_ACCOUNT_EMAIL")

        if not bucket_name or not sa_email:
            logger.warning("Missing REPORTS_BUCKET or SERVICE_ACCOUNT_EMAIL env vars")
            return {
                "url": f"https://storage.googleapis.com/mock-bucket/{req.filename}?token=stub",
                "gcsPath": f"gs://mock-bucket/{req.filename}",
            }

        source_creds, project = google.auth.default()
        creds = impersonated_credentials.Credentials(
            source_credentials=source_creds,
            target_principal=sa_email,
            target_scopes=["https://www.googleapis.com/auth/devstorage.read_write"],
        )
        creds.refresh(Request())

        client = storage.Client(credentials=creds, project=project)
        bucket = client.bucket(bucket_name)
        blob = bucket.blob(f"uploads/{req.patient_id}/{req.filename}")

        url = blob.generate_signed_url(
            version="v4",
            expiration=timedelta(minutes=15),
            method="PUT",
            content_type=req.content_type,
            service_account_email=sa_email,
        )
        return {"url": url, "gcsPath": f"gs://{bucket_name}/{blob.name}"}
    except Exception as e:
        logger.error(f"Error generating signed URL: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Could not generate upload URL")


@router.post("/reports/process")
async def process_report(
    req: ProcessReportRequest,
    fs: FirestoreService = Depends(get_firestore_service),
):
    """Create a report record and trigger Gemini analysis."""
    report_id = f"r-{uuid.uuid4().hex[:8]}"

    report_data = {
        "reportId": report_id,
        "patientId": req.patient_id,
        "clinicId": req.clinic_id,
        "reportName": req.filename,
        "contentType": req.content_type,
        "gcsPath": req.gcs_path,
        "status": ReportStatus.UPLOADED,
        "reportDate": datetime.utcnow().date().isoformat(),
        "reportType": "lab",
    }
    try:
        fs.save_report(report_id, report_data)
        result = analyze_report(report_id, gcs_uri=req.gcs_path, mime_type=req.content_type)
        response: dict = {"report_id": report_id, "analysis": result}

        if os.environ.get("AUTO_CALL_ON_REPORT_ANALYZED", "0") == "1":
            patient = fs.get_patient(req.patient_id)
            to_number = patient.get("phone") if patient else None
            if to_number:
                call_id = f"c-{uuid.uuid4().hex[:8]}"
                fs.save_call(call_id, {
                    "callId": call_id,
                    "clinicId": req.clinic_id,
                    "patientId": req.patient_id,
                    "reportId": report_id,
                    "status": "QUEUED",
                    "createdAt": datetime.utcnow().isoformat(),
                    "notes": "Auto-triggered after report analysis",
                })
                # Lazy import to avoid circular dependency
                from app.api.twilio_router import trigger_outbound_call  # noqa: PLC0415
                twilio_result = await trigger_outbound_call(
                    to_number=to_number,
                    patient_id=req.patient_id,
                    call_id=call_id,
                    report_id=report_id,
                    clinic_id=req.clinic_id,
                )
                response["auto_call"] = {"call_id": call_id, "twilio": twilio_result}
            else:
                response["auto_call"] = {"status": "skipped", "reason": "patient has no phone"}

        return response
    except Exception as e:
        logger.error(f"Processing error: {e}")
        return {"report_id": report_id, "status": ReportStatus.UPLOADED, "error": str(e)}


@router.post("/reports/{report_id}/review")
async def mark_report_reviewed(
    report_id: str,
    fs: FirestoreService = Depends(get_firestore_service),
):
    """Mark a report as reviewed by medical staff."""
    try:
        fs.save_report(report_id, {"status": ReportStatus.REVIEWED})
        return {"status": "success", "report_id": report_id, "new_status": ReportStatus.REVIEWED}
    except Exception as e:
        logger.error(f"Review error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/reports/{report_id}/analyze")
async def trigger_report_analysis(
    report_id: str,
    fs: FirestoreService = Depends(get_firestore_service),
):
    """Manually trigger Gemini analysis of a report."""
    try:
        result = analyze_report(report_id)
        return {"status": "success", "summary": result.get("summaryPlain"), "details": result}
    except Exception as e:
        logger.error(f"Analysis error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/patients/{patient_id}/reports")
async def list_patient_reports(patient_id: str):
    """List reports for a patient, verified against GCS existence."""
    try:
        from app.tools.report_tools import list_reports  # noqa: PLC0415
        return list_reports(patient_id)
    except Exception as e:
        logger.error(f"Error listing reports: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/slots", response_model=list[AvailabilitySlot])
async def get_slots(
    clinic_id: str,
    specialty: str,
    fs: FirestoreService = Depends(get_firestore_service),
):
    try:
        slots_data = fs.list_available_slots(clinic_id, specialty)
        validated_slots = []
        for s in slots_data:
            if "slotId" not in s and "slot_id" not in s:
                pass
            validated_slots.append(AvailabilitySlot.model_validate(s))
        return validated_slots
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/appointments")
async def confirm_booking(req: BookingRequest):
    try:
        result = book_appointment(req.patient_id, req.report_id, req.slot_id)
        if not result.get("success"):
            raise HTTPException(status_code=400, detail=result.get("message", "Booking failed"))
        return {"status": "confirmed", "message": result.get("confirmation_message"), "details": result}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
