"""
Report tools: fetch and format clinical reports.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)

# Severity levels recognised as critical
_CRITICAL_LEVELS = {"critical", "danger", "high-risk"}

from app.models.firestore_models import ReportStatus

# ---------------------------------------------------------------------------
# DEV mock reports — used when Firestore is unavailable (local testing)
# Use these IDs in ADK Dev UI: r001, r002, r003
# ---------------------------------------------------------------------------
DEV_MOCK_REPORTS: dict[str, dict] = {
    "r001": {
        "report_type": "lab",
        "date": "2026-02-20",
        "summary_plain": (
            "Your blood test from February 20 is ready. "
            "Most values are within normal range, but a few markers need attention."
        ),
        "deviations": [
            {
                "marker": "Hemoglobin",
                "value": "9.8 g/dL",
                "reference_range": "12.0–16.0 g/dL",
                "severity": "moderate",
                "plain_text": "Your red blood cell count is below normal. This can cause fatigue and shortness of breath.",
            },
            {
                "marker": "Glucose",
                "value": "7.4 mmol/L",
                "reference_range": "3.9–6.1 mmol/L",
                "severity": "mild",
                "plain_text": "Your blood sugar is slightly elevated. This may indicate early insulin resistance.",
            },
        ],
    },
    "r002": {
        "report_type": "ecg",
        "date": "2026-02-22",
        "summary_plain": (
            "Your ECG from February 22 has been reviewed. "
            "One finding requires specialist attention."
        ),
        "deviations": [
            {
                "marker": "QT Interval",
                "value": "480 ms",
                "reference_range": "350–440 ms",
                "severity": "critical",
                "plain_text": "The electrical activity of your heart shows a prolonged interval. A cardiologist should review this urgently.",
            },
        ],
    },
    "r003": {
        "report_type": "lab",
        "date": "2026-02-18",
        "summary_plain": "Your lab results from February 18 are all within the normal reference ranges.",
        "deviations": [],
    },
}

def list_reports(patient_id: str) -> list[dict[str, Any]]:
    """
    List all clinical reports for a given patient, verified against GCS existence.
    Use this to find which reports are available for discussion.

    Args:
        patient_id: The unique ID of the patient.

    Returns:
        A list of summaries for each report found.
    """
    import os
    from google.cloud import storage
    import google.auth
    from google.auth import impersonated_credentials
    from google.auth.transport.requests import Request
    from app.services.firestore_service import FirestoreService
    
    db = FirestoreService()
    logger.info("Listing reports for patient: %s", patient_id)
    reports = db.list_reports_by_patient(patient_id)
    
    # Set up GCS client for existence checks
    bucket_name = os.environ.get("REPORTS_BUCKET")
    sa_email = os.environ.get("SERVICE_ACCOUNT_EMAIL")
    
    verified_reports = []
    
    # Optimized check: try to create a client if possible
    # In Cloud Run, we use impersonation like in server.py
    try:
        source_creds, project = google.auth.default()
        if sa_email:
            creds = impersonated_credentials.Credentials(
                source_credentials=source_creds,
                target_principal=sa_email,
                target_scopes=["https://www.googleapis.com/auth/devstorage.read_only"],
            )
            creds.refresh(Request())
            client = storage.Client(credentials=creds, project=project)
        else:
            client = storage.Client()
        bucket = client.bucket(bucket_name) if bucket_name else None
    except Exception as e:
        logger.warning(f"Failed to initialize GCS client for listing: {e}. Returning all from DB.")
        bucket = None

    for r in reports:
        gcs_path = r.get("gcsPath") or r.get("gcs_path")
        
        # If we have a bucket and a path, verify existence
        if bucket and gcs_path and gcs_path.startswith("gs://"):
            try:
                # Extract blob name from gs://bucket/blob_name
                blob_name = gcs_path.replace(f"gs://{bucket.name}/", "")
                blob = bucket.blob(blob_name)
                if not blob.exists():
                    logger.info(f"Skipping report {r.get('reportId')} as file {gcs_path} is missing from GCS.")
                    continue
            except Exception as e:
                logger.error(f"Error checking GCS existence for {gcs_path}: {e}")
        
        verified_reports.append({
            "report_id": r.get("reportId") or r.get("report_id"),
            "report_type": r.get("reportType") or r.get("report_type"),
            "date": r.get("reportDate") or r.get("report_date"),
            "summary": r.get("summaryPlain") or r.get("summary_plain"),
            "status": r.get("status"),
            "createdAt": r.get("createdAt")
        })
        
    return verified_reports


def get_report(report_id: str) -> dict[str, Any]:
    """
    Retrieve a clinical report and return a structured summary.

    Args:
        report_id: Unique report identifier.

    Returns:
        A dict with keys:
          - report_id (str)
          - report_type (str)         # "lab" | "ecg" | "imaging" | etc.
          - date (str)                # ISO date
          - summary_plain (str)       # patient-friendly explanation
          - deviations (list[dict])   # markers outside reference range
            Each deviation:
              - marker (str)
              - value (str)
              - reference_range (str)
              - severity (str)        # "normal" | "mild" | "moderate" | "critical"
              - plain_text (str)      # plain-language description
          - has_critical_marker (bool)
          - raw (dict)                # full raw data for internal use
    """
    from app.services.firestore_service import FirestoreService

    # Handle case where LLM passes a list of IDs instead of a single string
    if isinstance(report_id, list) and len(report_id) > 0:
        logger.warning("get_report received a list instead of a string: %s. Using first item.", report_id)
        report_id = report_id[0]
    elif not isinstance(report_id, str):
        logger.error("get_report received non-string report_id: %s (type: %s)", report_id, type(report_id))
        return {
            "report_id": str(report_id),
            "report_type": "unknown",
            "date": None,
            "summary_plain": "I couldn't identify the report. Please try again.",
            "deviations": [],
            "has_critical_marker": False,
            "raw": {},
        }

    db = FirestoreService()
    logger.info("Fetching report: %s", report_id)
    raw = db.get_report(report_id)

    if raw is None:
        # Fall back to dev mock data when Firestore is unavailable
        raw = DEV_MOCK_REPORTS.get(report_id)

    if raw is None:
        logger.warning("Report %s not found in Firestore or mock data.", report_id)
        return {
            "report_id": report_id,
            "report_type": "unknown",
            "date": None,
            "summary_plain": (
                "I'm sorry, I wasn't able to load your report at this moment. "
                "Please try again or contact your clinic directly."
            ),
            "deviations": [],
            "has_critical_marker": False,
            "raw": {},
        }


    deviations: list[dict] = raw.get("deviations", [])
    has_critical = any(
        d.get("severity", "").lower() in _CRITICAL_LEVELS for d in deviations
    )

    return {
        "report_id": report_id,
        "report_type": raw.get("reportType") or raw.get("report_type", "lab"),
        "date": raw.get("reportDate") or raw.get("report_date") or raw.get("date"),
        "summary_plain": raw.get("summaryPlain") or raw.get(
            "summary_plain",
            "Your report has been retrieved. Let me walk you through the key findings.",
        ),
        "deviations": deviations,
        "has_critical_marker": has_critical,
        "raw": raw,
    }


def analyze_report(report_id: str, gcs_uri: str | None = None, mime_type: str | None = None) -> dict[str, Any]:
    """
    Call Gemini to analyze the report and produce an updated summary,
    deviations list, and recommended specialty.
    Supports both text-only (fallback) and multimodal (GCS) analysis.

    Args:
        report_id: Unique report identifier.
        gcs_uri: Optional GCS URI of the report file (gs://bucket/path).
        mime_type: MIME type of the file (required if gcs_uri is provided).

    Returns:
        dict with keys:
          - summaryPlain
          - deviations (list of dicts with marker, value, range, severity, explanation)
          - recommendedSpecialty
          - ecgFlags (optional)
    """
    import json
    from google import genai
    from google.genai import types
    from app.services.firestore_service import FirestoreService

    db = FirestoreService()
    raw = db.get_report(report_id)
    
    if not raw:
        logger.warning("Cannot analyze report %s: not found in Firestore.", report_id)
        return {
            "summaryPlain": "Report not found.",
            "deviations": [],
            "recommendedSpecialty": "general practitioner",
        }

    # Use provided gcs_uri or look it up in the report document
    gcs_uri = gcs_uri or raw.get("gcsPath") or raw.get("gcs_uri")
    mime_type = mime_type or raw.get("contentType") or raw.get("content_type") or "application/pdf"

    # Prepare Gemini prompt
    prompt = """
    You are an expert medical AI reviewing a clinical report for a patient.
    Process the provided report (could be a PDF or medical image) and extract the following:
    1. A short, empathetic, patient-friendly summary (summaryPlain).
    2. A comprehensive list of clinical markers (markers). 
       Include both normal values and deviations.
       Identify units and reference ranges accurately.
    3. For items outside the normal reference range, mark them as deviations.
    4. If this is an ECG, extract any specific findings or flags (ecgFlags).
    5. The recommended medical specialty the patient should be referred to based on these findings.

    Return the result strictly as a JSON object matching this schema:
    {
        "summaryPlain": "string",
        "markers": [
            {
                "marker": "string",
                "value": "string",
                "unit": "string",
                "range": "string",
                "severity": "normal | mild | moderate | critical",
                "explanation": "patient-friendly explanation of what this marker means"
            }
        ],
        "deviations": [
            {
                "marker": "string",
                "value": "string",
                "range": "string",
                "severity": "mild | moderate | critical",
                "explanation": "why this value matters"
            }
        ],
        "ecgFlags": ["string"],
        "recommendedSpecialty": "string"
    }

    Notes:
    - If a marker is normal, severity should be "normal".
    - Deviations should be a subset of markers that are NOT normal.
    - Be precise with medical terminology but explain it simply for the patient.
    """

    contents = [prompt]
    
    if gcs_uri:
        logger.info("Analyzing report %s using GCS URI: %s", report_id, gcs_uri)
        contents.append(types.Part.from_uri(file_uri=gcs_uri, mime_type=mime_type))
    elif raw.get("extracted_text"):
        logger.info("Analyzing report %s using extracted_text fallback.", report_id)
        contents.append(f"EXTRACTED TEXT:\n{raw['extracted_text']}")
    else:
        logger.warning("Cannot analyze report %s: no source material found.", report_id)
        return {
            "summaryPlain": "I could not analyze this report because the file or text is missing.",
            "deviations": [],
            "recommendedSpecialty": "general practitioner",
        }

    try:
        # Initialize GenAI client
        client = genai.Client()
        response = client.models.generate_content(
            model="gemini-2.0-flash",
            contents=contents,
            config=types.GenerateContentConfig(
                response_mime_type="application/json"
            )
        )
        
        # Parse JSON from response
        # The SDK now supports response_mime_type="application/json" which returns clean JSON
        result = json.loads(response.text.strip())
        
        # Save analysis result to Firestore
        update_data = {
            "summaryPlain": result.get("summaryPlain"),
            "deviations": result.get("deviations", []),
            "markers": result.get("markers", []),
            "recommendedSpecialty": result.get("recommendedSpecialty"),
            "status": ReportStatus.ANALYZED,
            "analyzedAt": datetime.utcnow().isoformat()
        }
        if result.get("ecgFlags"):
            update_data["ecgFlags"] = result.get("ecgFlags")
            
        db.save_report(report_id, update_data)
        logger.info("Successfully analyzed report %s and saved to Firestore.", report_id)
        
        return result

    except Exception as exc:
        logger.error("Failed to analyze report %s with Gemini: %s", report_id, exc)
        return {
            "summaryPlain": f"Sorry, an error occurred while analyzing your report: {str(exc)}",
            "deviations": [],
            "recommendedSpecialty": "general practitioner",
        }
