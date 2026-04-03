"""Twilio voice integration: TwiML, outbound calls, media-stream WebSocket, status callbacks."""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import uuid
from datetime import datetime
from urllib.parse import urlencode
from xml.sax.saxutils import escape

from fastapi import APIRouter, Depends, Form, HTTPException, WebSocket
from fastapi.responses import Response
from twilio.rest import Client as TwilioClient

from app.core.audio import (
    _build_call_context,
    _end_twilio_call_if_active,
    _live_run_config,
    _resolve_twilio_call_identity,
)
from app.core.dependencies import (
    APP_NAME,
    get_firestore_service,
    get_runner,
    get_session_service,
)
from app.services.firestore_service import FirestoreService

try:
    import audioop
except ImportError:
    audioop = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/twilio/twiml")
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

    host = os.environ.get("SERVICE_URL", "https://med-voice-backend-979008310984.europe-west1.run.app")
    query_params: dict = {"patient_id": resolved_patient_id or patient_id}
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


@router.post("/twilio/call")
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
        twiml_query: dict = {"patient_id": patient_id}
        if call_id:
            twiml_query["call_id"] = call_id
        if report_id:
            twiml_query["report_id"] = report_id
        twiml_url = f"{host}/api/twilio/twiml?{urlencode(twiml_query)}"
        logger.info(
            "Triggering Twilio call: to=%s patient_id=%s call_id=%s report_id=%s",
            to_number,
            patient_id,
            call_id,
            report_id,
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


@router.websocket("/twilio/stream")
async def twilio_voice_stream(
    websocket: WebSocket,
    patient_id: str = "test_patient_1",
    call_id: str | None = None,
    report_id: str | None = None,
):
    """Handles Twilio Media Stream WebSocket (mu-law 8kHz ↔ PCM 24kHz)."""
    await websocket.accept()
    logger.info("Twilio Media Stream WebSocket connected.")

    if audioop is None:
        logger.error("audioop is unavailable; Twilio media streaming is disabled in this runtime.")
        await websocket.close(code=1011)
        return

    from google.adk.agents.live_request_queue import LiveRequestQueue  # noqa: PLC0415
    from google.genai import types as genai_types  # noqa: PLC0415

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
        "Twilio stream identity resolved: resolved_patient_id=%s call_id=%s resolved_report_id=%s",
        p_id,
        call_id,
        resolved_report_id,
    )
    live_request_queue = LiveRequestQueue()

    session_id = call_id or f"twilio_{uuid.uuid4().hex[:8]}"
    user_id = p_id
    stream_sid: str | None = None

    try:
        session = await session_service.get_session(
            app_name=APP_NAME, user_id=user_id, session_id=session_id
        )
        if not session:
            await session_service.create_session(
                app_name=APP_NAME, user_id=user_id, session_id=session_id
            )
            logger.info("Created new session for Twilio: %s", session_id)
            if not call_id:
                firestore_service.save_call(session_id, {
                    "patientId": user_id,
                    "reportId": report_id or "",
                    "status": "ACTIVE",
                    "createdAt": datetime.utcnow().isoformat(),
                    "type": "INBOUND",
                })

        run_config = _live_run_config()
        call_context = _build_call_context(
            firestore_service,
            call_id=session_id,
            patient_id=user_id,
            report_id=resolved_report_id,
        )
        live_request_queue.send_content(genai_types.Content(
            role="user",
            parts=[genai_types.Part.from_text(
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
            )],
        ))

        async def twilio_upstream() -> None:
            nonlocal stream_sid
            logger.info("Starting Twilio upstream receiver...")
            try:
                while True:
                    data = await websocket.receive_text()
                    packet = json.loads(data)

                    if packet["event"] == "start":
                        stream_sid = packet["start"]["streamSid"]
                        logger.info("Twilio Stream started: %s", stream_sid)
                        if call_id:
                            firestore_service.update_call_status(
                                session_id,
                                status="CONNECTED",
                                startedAt=datetime.utcnow().isoformat(),
                                twilioStreamSid=stream_sid,
                            )

                    elif packet["event"] == "media":
                        if not stream_sid:
                            stream_sid = packet.get("streamSid")

                        # mu-law 8kHz → PCM 16-bit → resample 24kHz → Gemini
                        mu_law_data = base64.b64decode(packet["media"]["payload"])
                        pcm_data = audioop.ulaw2lin(mu_law_data, 2)
                        resampled_data, _ = audioop.ratecv(pcm_data, 2, 1, 8000, 24000, None)
                        live_request_queue.send_realtime(
                            genai_types.Blob(mime_type="audio/pcm;rate=24000", data=resampled_data)
                        )

                    elif packet["event"] == "stop":
                        logger.info("Twilio stream stopped.")
                        twilio_call_sid = (
                            (firestore_service.get_call(session_id) or {}).get("twilioCallSid")
                            if call_id
                            else None
                        )
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
                logger.error("Error in Twilio upstream: %s", e)

        async def twilio_downstream() -> None:
            logger.info("Starting Twilio downstream (Gemini → Twilio)...")
            try:
                async for event in runner.run_live(
                    user_id=user_id,
                    session_id=session_id,
                    live_request_queue=live_request_queue,
                    run_config=run_config,
                ):
                    logger.info("Twilio ADK Event: %s", type(event).__name__)
                    if hasattr(event, "content") and event.content:
                        for part in event.content.parts:
                            if part.inline_data:
                                pcm_bytes = part.inline_data.data
                                if pcm_bytes:
                                    # Gemini 24kHz → resample 8kHz → mu-law → Twilio
                                    downsampled_pcm, _ = audioop.ratecv(
                                        pcm_bytes, 2, 1, 24000, 8000, None
                                    )
                                    mu_law_response = audioop.lin2ulaw(downsampled_pcm, 2)
                                    await websocket.send_json({
                                        "event": "media",
                                        "streamSid": stream_sid,
                                        "media": {
                                            "payload": base64.b64encode(mu_law_response).decode("utf-8")
                                        },
                                    })
            except Exception as e:
                logger.error("Error in Twilio downstream: %s", e)

        await asyncio.gather(twilio_upstream(), twilio_downstream())

    except Exception as e:
        logger.error("Twilio WebSocket error: %s", e)
    finally:
        twilio_call_sid = (
            (firestore_service.get_call(session_id) or {}).get("twilioCallSid") if call_id else None
        )
        _end_twilio_call_if_active(twilio_call_sid)
        if call_id:
            firestore_service.update_call_status(
                session_id,
                status="COMPLETED",
                endedAt=datetime.utcnow().isoformat(),
            )
        live_request_queue.close()


@router.post("/twilio/status")
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
    extra: dict = {}
    if mapped_status == "CONNECTED":
        extra["startedAt"] = datetime.utcnow().isoformat()
    if mapped_status in {"COMPLETED", "FAILED"}:
        extra["endedAt"] = datetime.utcnow().isoformat()
    if CallDuration:
        extra["callDurationSeconds"] = CallDuration
    extra["twilioStatus"] = CallStatus

    fs.update_call_status(call_id, status=mapped_status, **extra)
    return {"status": "ok", "call_id": call_id, "mapped_status": mapped_status}
