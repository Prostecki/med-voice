"""Callback scheduling and trigger endpoints."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.dependencies import get_firestore_service
from app.services.firestore_service import FirestoreService
from app.tools.scheduling_tools import schedule_callback

logger = logging.getLogger(__name__)
router = APIRouter()


class CallbackTriggerRequest(BaseModel):
    call_id: str


class ScheduleCallbackRequest(BaseModel):
    patient_id: str
    clinic_id: str
    report_id: str
    scheduled_at: str


@router.post("/callbacks/trigger")
async def trigger_callback(
    req: CallbackTriggerRequest,
    fs: FirestoreService = Depends(get_firestore_service),
):
    """Trigger an outbound call for a scheduled callback (called by Cloud Tasks)."""
    try:
        logger.info("Cloud Task received for call_id: %s", req.call_id)
        call = fs.get_call(req.call_id)
        if not call:
            logger.warning("Cloud Task: Call record %s not found", req.call_id)
            return {"status": "skipped", "reason": "call not found"}

        patient_id = call.get("patientId") or call.get("patient_id")
        patient = fs.get_patient(patient_id)
        if not patient:
            logger.warning("Cloud Task: Patient %s not found", patient_id)
            return {"status": "skipped", "reason": "patient not found"}

        to_number = patient.get("phone")
        if not to_number:
            logger.warning("Cloud Task: Patient %s has no phone number", patient_id)
            return {"status": "skipped", "reason": "no phone number"}

        logger.info(
            "Cloud Task: Triggering outbound callback to %s (patient: %s)",
            to_number,
            patient_id,
        )
        report_id = call.get("reportId") or call.get("report_id")
        clinic_id = call.get("clinicId") or call.get("clinic_id")

        # Lazy import to avoid potential circular dependency
        from app.api.twilio_router import trigger_outbound_call  # noqa: PLC0415

        result = await trigger_outbound_call(
            to_number=to_number,
            patient_id=patient_id,
            call_id=req.call_id,
            report_id=report_id,
            clinic_id=clinic_id,
        )

        fs.update_call_status(
            req.call_id,
            status="CALLING",
            callbackTriggeredAt=datetime.utcnow().isoformat(),
            notes="Callback initiated by Cloud Tasks",
        )

        return {"status": "triggered", "twilio": result}
    except Exception as e:
        logger.error("Error in trigger_callback: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/callbacks/schedule")
async def create_scheduled_callback(
    req: ScheduleCallbackRequest,
    fs: FirestoreService = Depends(get_firestore_service),
):
    try:
        call_id = f"c-{uuid.uuid4().hex[:8]}"
        fs.save_call(call_id, {
            "callId": call_id,
            "clinicId": req.clinic_id,
            "patientId": req.patient_id,
            "reportId": req.report_id,
            "status": "QUEUED",
            "createdAt": datetime.utcnow().isoformat(),
            "notes": "Manually scheduled callback from portal",
        })
        result = schedule_callback(call_id=call_id, timestamp=req.scheduled_at)
        if not result.get("success"):
            raise HTTPException(
                status_code=400,
                detail=result.get("message", "Failed to schedule callback"),
            )
        return {"status": "scheduled", "call_id": call_id, "details": result}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error creating scheduled callback: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
