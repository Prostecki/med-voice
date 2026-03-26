import json
import asyncio
import os
import base64
import logging
import uuid
from datetime import datetime, timedelta
from functools import lru_cache
from urllib.parse import urlencode
from xml.sax.saxutils import escape
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

from google.genai import types

try:
    import audioop
except ImportError:
    # Python 3.13+ removal of audioop
    audioop = None
    logging.warning("audioop not found. Mu-law encoding/decoding will be disabled.")

from twilio.rest import Client as TwilioClient
from fastapi.responses import Response

from google.adk.runners import Runner
from google.adk.sessions.in_memory_session_service import InMemorySessionService
from google.adk.agents.live_request_queue import LiveRequestQueue
from google.adk.agents.run_config import RunConfig, StreamingMode, ToolThreadPoolConfig

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(message)s')
logger = logging.getLogger(__name__)

# Suppress verbose logs from external libraries
# logging.getLogger("google").setLevel(logging.WARNING)
# logging.getLogger("websockets").setLevel(logging.WARNING)
# logging.getLogger("uvicorn").setLevel(logging.WARNING)

# Load the agent's specific .env file
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

# Import the root ADK agent
from .agent import root_agent
from ...models.firestore_models import Patient, Report, AvailabilitySlot, Appointment, ReportType, ReportStatus
from ...services.firestore_service import FirestoreService
from ...tools.report_tools import analyze_report
from ...tools.scheduling_tools import list_available_slots, book_appointment, schedule_callback

# Constants
APP_NAME = "med-voice"
DEFAULT_GCP_LOCATION = "europe-north1"
DEFAULT_LIVE_VOICE = "Sulafat"

os.environ.setdefault("GOOGLE_CLOUD_LOCATION", DEFAULT_GCP_LOCATION)


def _live_run_config(include_transcription: bool = False) -> RunConfig:
    config_kwargs = {
        "streaming_mode": StreamingMode.BIDI,
        "response_modalities": [types.Modality.AUDIO],
        "speech_config": types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(
                    voice_name=DEFAULT_LIVE_VOICE
                )
            )
        ),
        "realtime_input_config": types.RealtimeInputConfig(
            automatic_activity_detection=types.AutomaticActivityDetection(
                start_of_speech_sensitivity=types.StartSensitivity.START_SENSITIVITY_LOW
            )
        ),
    }

    if include_transcription:
        config_kwargs.update({
            "enable_affective_dialog": True,
            "tool_thread_pool_config": ToolThreadPoolConfig(),
            "input_audio_transcription": types.AudioTranscriptionConfig(),
            "output_audio_transcription": types.AudioTranscriptionConfig(),
            "session_resumption": types.SessionResumptionConfig(),
        })

    return RunConfig(**config_kwargs)

app = FastAPI(title="Med-Voice Agent Live API")

raw_cors_origins = os.environ.get(
    "CORS_ALLOWED_ORIGINS",
    "http://localhost:3000,https://med-voice--sm-gemini-playground.europe-west4.hosted.app",
)
origins = [origin.strip() for origin in raw_cors_origins.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@lru_cache(maxsize=1)
def get_session_service() -> InMemorySessionService:
    return InMemorySessionService()

@lru_cache(maxsize=1)
def get_runner() -> Runner:
    return Runner(
        app_name=APP_NAME,
        agent=root_agent,
        session_service=get_session_service()
    )

@lru_cache(maxsize=1)
def get_firestore_service() -> FirestoreService:
    return FirestoreService()

# ── REST Endpoints ─────────────────────────────────────────────────────────────

@app.get("/api/health")
async def health_check():
    return {"status": "ok", "app": APP_NAME}

@app.post("/api/patients", response_model=Patient)
async def create_patient(patient: Patient, fs: FirestoreService = Depends(get_firestore_service)):
    try:
        fs.save_patient(patient.patient_id, patient.model_dump(by_alias=True))
        return patient
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/patients/{patient_id}", response_model=Patient)
async def get_patient(patient_id: str, fs: FirestoreService = Depends(get_firestore_service)):
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

class CallbackTriggerRequest(BaseModel):
    call_id: str


class ScheduleCallbackRequest(BaseModel):
    patient_id: str
    clinic_id: str
    report_id: str
    scheduled_at: str


def _build_call_context(
    fs: FirestoreService,
    call_id: str | None = None,
    patient_id: str | None = None,
    report_id: str | None = None,
) -> dict[str, str | None]:
    call = fs.get_call(call_id) if call_id else None

    resolved_patient_id = (
        patient_id
        or (call.get("patientId") if call else None)
        or (call.get("patient_id") if call else None)
    )
    resolved_report_id = (
        report_id
        or (call.get("reportId") if call else None)
        or (call.get("report_id") if call else None)
    )

    report_summary = None
    recommended_specialty = None
    clinic_id = (call.get("clinicId") if call else None) or (call.get("clinic_id") if call else None)

    if resolved_report_id:
        report = fs.get_report(resolved_report_id) or {}
        report_summary = report.get("summaryPlain") or report.get("summary_plain")
        recommended_specialty = report.get("recommendedSpecialty") or report.get("recommended_specialty")
        clinic_id = clinic_id or report.get("clinicId") or report.get("clinic_id")

    if resolved_patient_id and not clinic_id:
        patient = fs.get_patient(resolved_patient_id) or {}
        clinic_id = patient.get("clinicId") or patient.get("clinic_id")

    return {
        "call_id": call_id,
        "patient_id": resolved_patient_id,
        "report_id": resolved_report_id,
        "clinic_id": clinic_id,
        "report_summary": report_summary,
        "recommended_specialty": recommended_specialty,
    }


def _resolve_twilio_call_identity(
    fs: FirestoreService,
    patient_id: str | None = None,
    call_id: str | None = None,
    report_id: str | None = None,
) -> tuple[str | None, str | None]:
    """Prefer Firestore call context over request defaults for Twilio flows."""
    call = fs.get_call(call_id) if call_id else None
    resolved_patient_id = (
        (call.get("patientId") if call else None)
        or (call.get("patient_id") if call else None)
        or patient_id
    )
    resolved_report_id = (
        (call.get("reportId") if call else None)
        or (call.get("report_id") if call else None)
        or report_id
    )
    return resolved_patient_id, resolved_report_id


def _end_twilio_call_if_active(call_sid: str | None) -> None:
    if not call_sid:
        return

    account_sid = os.environ.get("TWILIO_ACCOUNT_SID")
    auth_token = os.environ.get("TWILIO_AUTH_TOKEN")
    if not account_sid or not auth_token:
        return

    try:
        client = TwilioClient(account_sid, auth_token)
        client.calls(call_sid).update(status="completed")
    except Exception as exc:
        logger.warning("Could not force-complete Twilio call %s: %s", call_sid, exc)

@app.post("/api/reports/upload-url")
async def get_upload_url(req: SignedUrlRequest):
    """Generate a signed URL for GCS upload using IAM impersonation."""
    try:
        from google.cloud import storage
        import google.auth
        from google.auth import impersonated_credentials
        from google.auth.transport.requests import Request
        from datetime import timedelta
        
        bucket_name = os.environ.get("REPORTS_BUCKET")
        sa_email = os.environ.get("SERVICE_ACCOUNT_EMAIL")
        
        if not bucket_name or not sa_email:
            logger.warning("Missing REPORTS_BUCKET or SERVICE_ACCOUNT_EMAIL env vars")
            # Fallback for demo if env not set
            return {"url": f"https://storage.googleapis.com/mock-bucket/{req.filename}?token=stub", "gcsPath": f"gs://mock-bucket/{req.filename}"}
            
        # 1. Get source credentials (Compute Engine default on Cloud Run)
        source_creds, project = google.auth.default()
        
        # 2. Create impersonated credentials delegating to the backend SA
        # This allows the backend to "sign" via IAM API call
        creds = impersonated_credentials.Credentials(
            source_credentials=source_creds,
            target_principal=sa_email,
            target_scopes=["https://www.googleapis.com/auth/devstorage.read_write"],
        )
        
        # 3. Refresh is needed to prepare the creds for signing
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

@app.post("/api/reports/process")
async def process_report(req: ProcessReportRequest, fs: FirestoreService = Depends(get_firestore_service)):
    """Create a report record and trigger analysis."""
    report_id = f"r-{uuid.uuid4().hex[:8]}"
    
    # 1. Create Firestore record
    report_data = {
        "reportId": report_id,
        "patientId": req.patient_id,
        "clinicId": req.clinic_id,
        "reportName": req.filename,
        "contentType": req.content_type,
        "gcsPath": req.gcs_path,
        "status": ReportStatus.UPLOADED,
        "reportDate": datetime.utcnow().date().isoformat(),
        "reportType": "lab" # Default, Gemini will refine this
    }
    try:
        fs.save_report(report_id, report_data)
        
        # 2. Trigger analysis (asynchronous analysis would be better, but for hackathon we'll do it sync)
        result = analyze_report(report_id, gcs_uri=req.gcs_path, mime_type=req.content_type)
        response = {"report_id": report_id, "analysis": result}

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

@app.post("/api/reports/{report_id}/review")
async def mark_report_reviewed(report_id: str, fs: FirestoreService = Depends(get_firestore_service)):
    """Mark a report as reviewed by medical staff."""
    try:
        fs.save_report(report_id, {"status": ReportStatus.REVIEWED})
        return {"status": "success", "report_id": report_id, "new_status": ReportStatus.REVIEWED}
    except Exception as e:
        logger.error(f"Review error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/reports/{report_id}/analyze")
async def trigger_report_analysis(report_id: str, fs: FirestoreService = Depends(get_firestore_service)):
    """Manually trigger Gemini analysis of a report."""
    try:
        # The analyze_report tool handles Gemini call and Firestore update
        result = analyze_report(report_id)
        return {"status": "success", "summary": result.get("summaryPlain"), "details": result}
    except Exception as e:
        logger.error(f"Analysis error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/patients/{patient_id}/reports")
async def list_patient_reports(patient_id: str):
    """List reports for a patient, verified against GCS existence."""
    try:
        from ...tools.report_tools import list_reports
        reports = list_reports(patient_id)
        return reports
    except Exception as e:
        logger.error(f"Error listing reports: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/slots", response_model=list[AvailabilitySlot])
async def get_slots(clinic_id: str, specialty: str, fs: FirestoreService = Depends(get_firestore_service)):
    try:
        slots_data = fs.list_available_slots(clinic_id, specialty)
        validated_slots = []
        for s in slots_data:
            # Handle possible missing slotId in document body
            if "slotId" not in s and "slot_id" not in s:
                # If we don't have the ID segment here, we might need to 
                # adjust list_available_slots to include it, or accept it's missing.
                # For now, let's assume we want to avoid the crash.
                pass
            validated_slots.append(AvailabilitySlot.model_validate(s))
        return validated_slots
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class BookingRequest(BaseModel):
    patient_id: str
    report_id: str
    slot_id: str
    clinic_id: str

@app.post("/api/appointments")
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

@app.post("/api/callbacks/trigger")
async def trigger_callback(req: CallbackTriggerRequest, fs: FirestoreService = Depends(get_firestore_service)):
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
            
        logger.info("Cloud Task: Triggering outbound callback to %s (patient: %s)", to_number, patient_id)
        report_id = call.get("reportId") or call.get("report_id")
        clinic_id = call.get("clinicId") or call.get("clinic_id")
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


@app.post("/api/callbacks/schedule")
async def create_scheduled_callback(req: ScheduleCallbackRequest, fs: FirestoreService = Depends(get_firestore_service)):
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
            raise HTTPException(status_code=400, detail=result.get("message", "Failed to schedule callback"))
        return {"status": "scheduled", "call_id": call_id, "details": result}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error creating scheduled callback: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

# ── Twilio Voice Integration ──────────────────────────────────────────────────

@app.post("/api/twilio/twiml")
async def get_twilio_twiml(
    patient_id: str = "test_patient_1",
    call_id: str | None = None,
    report_id: str | None = None,
):
    """Returns TwiML to connect the call to our Media Stream."""
    firestore_service = get_firestore_service()
    resolved_patient_id, resolved_report_id = _resolve_twilio_call_identity(
        firestore_service,
        patient_id=patient_id,
        call_id=call_id,
        report_id=report_id,
    )

    # We use the public URL of this service
    host = os.environ.get("SERVICE_URL", "https://med-voice-backend-979008310984.europe-west1.run.app")
    query_params = {"patient_id": resolved_patient_id or patient_id}
    if call_id:
        query_params["call_id"] = call_id
    if resolved_report_id:
        query_params["report_id"] = resolved_report_id
    ws_url = host.replace("https://", "wss://") + f"/api/twilio/stream?{urlencode(query_params)}"
    xml_safe_ws_url = escape(ws_url, {'"': "&quot;"})
    logger.info(
        "Generating TwiML stream URL: patient_id=%s call_id=%s report_id=%s ws_url=%s",
        resolved_patient_id,
        call_id,
        resolved_report_id,
        ws_url,
    )
    
    twiml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say>Connecting to Med Voice Agent...</Say>
    <Connect>
        <Stream url="{xml_safe_ws_url}" />
    </Connect>
</Response>"""
    return Response(content=twiml, media_type="application/xml")

@app.post("/api/twilio/call")
async def trigger_outbound_call(
    to_number: str,
    patient_id: str = "test_patient_1",
    call_id: str | None = None,
    report_id: str | None = None,
    clinic_id: str | None = None,
):
    """Triggers an outbound call using Twilio API."""
    account_sid = os.environ.get("TWILIO_ACCOUNT_SID")
    auth_token = os.environ.get("TWILIO_AUTH_TOKEN")
    from_number = os.environ.get("TWILIO_FROM_NUMBER")
    host = os.environ.get("SERVICE_URL", "https://med-voice-backend-979008310984.europe-west1.run.app")
    
    if not all([account_sid, auth_token, from_number]):
        raise HTTPException(status_code=500, detail="Twilio credentials not configured")
        
    try:
        fs = get_firestore_service()
        if call_id:
            fs.save_call(call_id, {
                "patientId": patient_id,
                "reportId": report_id or "",
                "clinicId": clinic_id or "",
                "status": "CALLING",
                "startedAt": datetime.utcnow().isoformat(),
            })

        client = TwilioClient(account_sid, auth_token)
        twiml_query = {"patient_id": patient_id}
        if call_id:
            twiml_query["call_id"] = call_id
        if report_id:
            twiml_query["report_id"] = report_id
        twiml_url = f"{host}/api/twilio/twiml?{urlencode(twiml_query)}"
        logger.info(
            "Triggering Twilio call: to=%s patient_id=%s call_id=%s report_id=%s twiml_url=%s",
            to_number,
            patient_id,
            call_id,
            report_id,
            twiml_url,
        )
        call = client.calls.create(
            to=to_number,
            from_=from_number,
            url=twiml_url,
            status_callback=f"{host}/api/twilio/status",
            status_callback_event=["initiated", "answered", "completed"],
        )
        if call_id:
            fs.save_call(call_id, {"twilioCallSid": call.sid, "status": "CALLING"})
        return {"status": "queued", "call_sid": call.sid}
    except Exception as e:
        logger.error(f"Error triggering call: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.websocket("/api/twilio/stream")
async def twilio_voice_stream(
    websocket: WebSocket,
    patient_id: str = "test_patient_1",
    call_id: str | None = None,
    report_id: str | None = None,
):
    """Handles Twilio Media Stream WebSocket (mu-law 8kHz)."""
    await websocket.accept()
    logger.info("Twilio Media Stream WebSocket connected.")

    if audioop is None:
        logger.error("audioop is unavailable; Twilio media streaming is disabled in this runtime.")
        await websocket.close(code=1011)
        return
    
    runner = get_runner()
    session_service = get_session_service()
    firestore_service = get_firestore_service()
    
    resolved_patient_id, resolved_report_id = _resolve_twilio_call_identity(
        firestore_service,
        patient_id=patient_id,
        call_id=call_id,
        report_id=report_id,
    )
    p_id = resolved_patient_id or patient_id
    logger.info(
        "Twilio stream identity resolved: request_patient_id=%s resolved_patient_id=%s call_id=%s report_id=%s resolved_report_id=%s",
        patient_id,
        p_id,
        call_id,
        report_id,
        resolved_report_id,
    )
    live_request_queue = LiveRequestQueue()
    
    # Twilio specific session IDs
    session_id = call_id or f"twilio_{uuid.uuid4().hex[:8]}"
    user_id = p_id # In production, derive from the Twilio 'From' number
    
    # State for the stream
    stream_sid = None
    
    try:
        # 0. Ensure session exists
        session = await session_service.get_session(app_name=APP_NAME, user_id=user_id, session_id=session_id)
        if not session:
            await session_service.create_session(app_name=APP_NAME, user_id=user_id, session_id=session_id)
            logger.info(f"Created new session for Twilio: {session_id}")
            
            if not call_id:
                firestore_service.save_call(session_id, {
                    "patientId": user_id,
                    "reportId": report_id or "",
                    "status": "ACTIVE",
                    "createdAt": datetime.utcnow().isoformat(),
                    "type": "INBOUND"
                })
                logger.info(f"Persisted call record to Firestore: {session_id}")

        # Twilio config: mu-law 8kHz
        run_config = _live_run_config()

        call_context = _build_call_context(
            firestore_service,
            call_id=session_id,
            patient_id=user_id,
            report_id=resolved_report_id,
        )
        live_request_queue.send_content(types.Content(
            role="user",
            parts=[types.Part.from_text(
                text=(
                    "System Context: This is an outbound medical follow-up call. "
                    f"Patient ID: {call_context['patient_id']}. "
                    f"Call ID: {call_context['call_id']}. "
                    f"Report ID: {call_context['report_id']}. "
                    f"Clinic ID: {call_context['clinic_id']}. "
                    f"Recommended specialty: {call_context['recommended_specialty'] or 'unknown'}. "
                    f"Report summary: {call_context['report_summary'] or 'No summary available'}. "
                    "Start with the exact line: Hello, I am Natasha. I am calling from Med Voice. Is it a good time to talk? "
                    "Wait for the patient's answer before moving forward. If the patient speaks in another language, switch to that language immediately."
                )
            )]
        ))

        async def twilio_upstream():
            nonlocal stream_sid
            logger.info("Starting Twilio upstream receiver...")
            try:
                while True:
                    data = await websocket.receive_text()
                    packet = json.loads(data)
                    
                    if packet["event"] == "start":
                        stream_sid = packet["start"]["streamSid"]
                        logger.info(f"Twilio Stream started: {stream_sid}. Config: {packet.get('start')}")
                        if call_id:
                            firestore_service.update_call_status(
                                session_id,
                                status="CONNECTED",
                                startedAt=datetime.utcnow().isoformat(),
                                twilioStreamSid=stream_sid,
                            )
                    
                    elif packet["event"] == "media":
                        if not stream_sid:
                            # Log first media packet if start was missed
                            stream_sid = packet.get("streamSid")
                            if stream_sid: logger.info(f"Received media for stream: {stream_sid} (start event likely missed)")

                        # 1. Decode mu-law 8kHz from Twilio
                        mu_law_data = base64.b64decode(packet["media"]["payload"])
                        # logger.debug(f"Received {len(mu_law_data)} bytes of mu-law")
                        
                        # 2. Convert mu-law to linear PCM (16-bit)
                        pcm_data = audioop.ulaw2lin(mu_law_data, 2)
                        
                        # 3. Resample from 8kHz to 24kHz (Gemini preference in this app)
                        # state is needed for resampling but we ignore it for small chunks
                        resampled_data, _ = audioop.ratecv(pcm_data, 2, 1, 8000, 24000, None)
                        
                        audio_blob = types.Blob(
                            mime_type="audio/pcm;rate=24000",
                            data=resampled_data
                        )
                        live_request_queue.send_realtime(audio_blob)
                    
                    elif packet["event"] == "stop":
                        logger.info("Twilio stream stopped.")
                        twilio_call_sid = (firestore_service.get_call(session_id) or {}).get("twilioCallSid") if call_id else None
                        _end_twilio_call_if_active(twilio_call_sid)
                        if call_id:
                            firestore_service.update_call_status(
                                session_id,
                                status="COMPLETED",
                                endedAt=datetime.utcnow().isoformat(),
                                notes="Twilio media stream completed",
                            )
                        break
            except Exception as e:
                logger.error(f"Error in Twilio upstream: {e}")

        async def twilio_downstream():
            logger.info("Starting Twilio downstream (Gemini -> Twilio)...")
            try:
                async for event in runner.run_live(
                    user_id=user_id,
                    session_id=session_id,
                    live_request_queue=live_request_queue,
                    run_config=run_config
                ):
                    logger.info(f"Twilio ADK Event: {type(event).__name__}")
                    
                    if hasattr(event, "content") and event.content:
                        for part in event.content.parts:
                            if part.inline_data:
                                pcm_bytes = part.inline_data.data
                                if pcm_bytes:
                                    logger.info(f"Sending {len(pcm_bytes)} bytes of audio to Twilio")
                                    # 1. Resample from 24kHz back to 8kHz
                                    downsampled_pcm, _ = audioop.ratecv(pcm_bytes, 2, 1, 24000, 8000, None)
                                    
                                    # 2. Convert linear PCM to mu-law 8kHz
                                    mu_law_response = audioop.lin2ulaw(downsampled_pcm, 2)
                                    
                                    # 3. Send to Twilio
                                    await websocket.send_json({
                                        "event": "media",
                                        "streamSid": stream_sid,
                                        "media": {
                                            "payload": base64.b64encode(mu_law_response).decode('utf-8')
                                        }
                                    })
                                    
            except Exception as e:
                logger.error(f"Error in Twilio downstream: {e}")

        await asyncio.gather(twilio_upstream(), twilio_downstream())

    except Exception as e:
        logger.error(f"Twilio WebSocket error: {e}")
    finally:
        twilio_call_sid = (firestore_service.get_call(session_id) or {}).get("twilioCallSid") if call_id else None
        _end_twilio_call_if_active(twilio_call_sid)
        if call_id:
            firestore_service.update_call_status(
                session_id,
                status="COMPLETED",
                endedAt=datetime.utcnow().isoformat(),
            )
        live_request_queue.close()


@app.post("/api/twilio/status")
async def twilio_status_callback(
    CallSid: str | None = Form(default=None),
    CallStatus: str | None = Form(default=None),
    CallDuration: str | None = Form(default=None),
    fs: FirestoreService = Depends(get_firestore_service),
):
    if not CallSid:
        return {"status": "ignored"}

    matching_calls = fs._list("mv_calls")
    call = next((item for item in matching_calls if item.get("twilioCallSid") == CallSid), None)
    if not call:
        return {"status": "skipped", "reason": "call not found"}

    call_id = call.get("callId") or call.get("call_id")
    if not call_id:
        return {"status": "skipped", "reason": "call id missing"}

    status_map = {
        "initiated": "CALLING",
        "ringing": "CALLING",
        "answered": "CONNECTED",
        "in-progress": "CONNECTED",
        "completed": "COMPLETED",
        "busy": "COMPLETED",
        "no-answer": "COMPLETED",
        "canceled": "COMPLETED",
        "failed": "FAILED",
    }
    mapped_status = status_map.get((CallStatus or "").lower(), "CALLING")
    extra = {}
    if mapped_status == "CONNECTED":
        extra["startedAt"] = datetime.utcnow().isoformat()
    if mapped_status in {"COMPLETED", "FAILED"}:
        extra["endedAt"] = datetime.utcnow().isoformat()
    if CallDuration:
        extra["callDurationSeconds"] = CallDuration
    extra["twilioStatus"] = CallStatus

    fs.update_call_status(call_id, status=mapped_status, **extra)
    return {"status": "ok", "call_id": call_id, "mapped_status": mapped_status}


@app.websocket("/api/agents/voice")
async def voice_agent_endpoint(
    websocket: WebSocket,
    session_id: str = "default_session",
    user_id: str = "default_user",
    call_id: str | None = None,
    report_id: str | None = None,
):
    await websocket.accept()
    logger.info(f"Frontend WebSocket connected. User: {user_id}, Session: {session_id}")

    # Check for authentication
    use_vertex = os.environ.get("GOOGLE_GENAI_USE_VERTEXAI") == "1"
    if not os.environ.get("GEMINI_API_KEY") and not use_vertex:
        logger.error("No GEMINI_API_KEY or Vertex AI config found.")
        await websocket.close(code=1011)
        return

    runner = get_runner()
    session_service = get_session_service()
    live_request_queue = LiveRequestQueue()
    firestore_service = get_firestore_service()
    websocket_closed = False

    async def safe_send_json(payload: dict) -> bool:
        nonlocal websocket_closed
        if websocket_closed:
            return False
        try:
            await websocket.send_json(payload)
            return True
        except (WebSocketDisconnect, RuntimeError):
            websocket_closed = True
            return False

    try:
        # Create session if it doesn't exist
        session = await session_service.get_session(app_name=APP_NAME, user_id=user_id, session_id=session_id)
        if not session:
            await session_service.create_session(app_name=APP_NAME, user_id=user_id, session_id=session_id)

        # Stable audio settings (16kHz is reliable)
        run_config = _live_run_config(include_transcription=True)

        call_context = _build_call_context(
            firestore_service,
            call_id=call_id or session_id,
            patient_id=user_id,
            report_id=report_id,
        )
        live_request_queue.send_content(types.Content(
            role="user",
            parts=[types.Part.from_text(
                text=(
                    "System Context: This is a mock browser call for testing the same medical call flow. "
                    f"Patient ID: {call_context['patient_id']}. "
                    f"Call ID: {call_context['call_id'] or session_id}. "
                    f"Report ID: {call_context['report_id']}. "
                    f"Clinic ID: {call_context['clinic_id']}. "
                    f"Recommended specialty: {call_context['recommended_specialty'] or 'unknown'}. "
                    f"Report summary: {call_context['report_summary'] or 'No summary available'}. "
                    "Use the stored report summary only. Do not re-analyze the original PDF. "
                    "Start with the exact line: Hello, I am Natasha. I am calling from Med Voice. Is it a good time to talk? "
                    "Wait for the patient's answer before moving forward. If the patient speaks in another language, switch to that language immediately."
                )
            )]
        ))

        async def upstream_task() -> None:
            """Receives JSON formatted messages from the frontend WebSocket and converts to ADK queue requests."""
            nonlocal websocket_closed
            try:
                while True:
                    data = await websocket.receive_text()
                    msg = json.loads(data)

                    # 1. PCM Audio input from frontend mic
                    if msg.get("type") == "realtime_input":
                        b64_data = msg.get("data") # PCM16 base64
                        if b64_data:
                            pcm_bytes = base64.b64decode(b64_data)
                            audio_blob = types.Blob(
                                mime_type="audio/pcm;rate=24000",
                                data=pcm_bytes
                            )
                            live_request_queue.send_realtime(audio_blob)

                    # 2. Text input from frontend
                    elif msg.get("type") == "client_content":
                        text = msg.get("text")
                        if text:
                            logger.info(f"[Client]: {text}")
                            content = types.Content(
                                role="user",
                                parts=[types.Part.from_text(text=text)]
                            )
                            live_request_queue.send_content(content)

            except WebSocketDisconnect:
                logger.info("Client disconnected.")
                websocket_closed = True
            except Exception as e:
                websocket_closed = True
                logger.error(f"Error in upstream_task: {e}", exc_info=True)

        async def downstream_task() -> None:
            """Receives Event stream from ADK Runner and maps audio/text parts back to frontend JSON format."""
            try:
                logger.info("Starting ADK live stream generator...")
                async for event in runner.run_live(
                    user_id=user_id,
                    session_id=session_id,
                    live_request_queue=live_request_queue,
                    run_config=run_config
                ):
                    # Log event type for general activity
                    logger.info(f"Received ADK Event: {type(event).__name__}")

                    # 1. Handle Content (Model Turn - Audio/Text/ToolCalls)
                    if hasattr(event, "content") and event.content:
                        for part in event.content.parts:
                            if part.inline_data:
                                audio_bytes = part.inline_data.data
                                if audio_bytes:
                                    logger.info(f"[Model Audio]: {len(audio_bytes)} bytes sent")
                                    if not await safe_send_json({
                                        "type": "audio",
                                        "data": base64.b64encode(audio_bytes).decode('utf-8')
                                    }):
                                        return
                            elif part.text:
                                logger.info(f"[Model Text]: {part.text}")
                                if not await safe_send_json({
                                    "type": "text",
                                    "text": part.text
                                }):
                                    return
                            elif part.function_call:
                                logger.info(f"[Model Tool Call]: {part.function_call.name}")

                    # 2. Handle User Input Transcription
                    if hasattr(event, "input_transcription") and event.input_transcription:
                        logger.info(f"[User Transcript]: {event.input_transcription}")
                        # When the user starts speaking, interrupt playback on frontend
                        if event.input_transcription.text and not event.input_transcription.finished:
                            logger.info("User speaking detected — sending interrupt to frontend.")
                            if not await safe_send_json({"type": "interrupt"}):
                                return

                    # 3. Handle Model Output Transcription
                    if hasattr(event, "output_transcription") and event.output_transcription:
                        logger.info(f"[Model Transcript]: {event.output_transcription}")

                    # 6. Handle Interruption (explicit flag from Gemini)
                    if getattr(event, "interrupted", False):
                        logger.info("Interruption detected! Signaling frontend to clear audio.")
                        if not await safe_send_json({"type": "interrupt"}):
                            return

                    # Handle Tool Call events
                    if hasattr(event, "tool_call") and event.tool_call:
                        for fc in event.tool_call.function_calls:
                            logger.info(f"[ADK Tool Call Event]: {fc.name}({fc.args})")

            except asyncio.CancelledError:
                pass
            except (WebSocketDisconnect, RuntimeError):
                websocket_closed = True
            except Exception as e:
                from google.genai import errors
                if isinstance(e, errors.APIError) and "1000" in str(e):
                    logger.info("Gemini session ended gracefully (1000).")
                else:
                    logger.error(f"Error in downstream_task: {e}", exc_info=True)

        # Run both tasks concurrently
        await asyncio.gather(upstream_task(), downstream_task())

    except Exception as e:
        logger.error(f"Gemini connection error: {e}")
    finally:
        websocket_closed = True
        # Gracefully shut down the queue
        live_request_queue.close()
        try:
            await websocket.close(code=1011)
        except Exception:
            pass

if __name__ == "__main__":
    import uvicorn
    # Use the 'app' object directly instead of a string to avoid ModuleNotFoundError
    # Explicitly disable reload for Cloud Run
    port = int(os.environ.get("PORT", 8001))
    uvicorn.run(app, host="0.0.0.0", port=port)
