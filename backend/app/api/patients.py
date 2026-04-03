"""Patient endpoints: POST /api/patients, GET /api/patients/{patient_id}"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException

from app.core.dependencies import get_firestore_service
from app.models.firestore_models import Patient
from app.services.firestore_service import FirestoreService

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/patients", response_model=Patient)
async def create_patient(
    patient: Patient,
    fs: FirestoreService = Depends(get_firestore_service),
):
    try:
        fs.save_patient(patient.patient_id, patient.model_dump(by_alias=True))
        return patient
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/patients/{patient_id}", response_model=Patient)
async def get_patient(
    patient_id: str,
    fs: FirestoreService = Depends(get_firestore_service),
):
    try:
        logger.info("Fetching patient: %s", patient_id)
        data = fs.get_patient(patient_id)
        if not data:
            logger.warning("Patient not found: %s", patient_id)
            raise HTTPException(status_code=404, detail="Patient not found")

        # Inject ID if missing to satisfy Pydantic validation
        if "patientId" not in data and "patient_id" not in data:
            data["patientId"] = patient_id

        return Patient.model_validate(data)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error in get_patient: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
