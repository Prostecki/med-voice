"""Audio configuration and call-context helpers extracted from server.py."""
from __future__ import annotations

import logging
import os

from google.adk.agents.run_config import RunConfig, StreamingMode, ToolThreadPoolConfig
from google.genai import types

logger = logging.getLogger(__name__)

DEFAULT_LIVE_VOICE = "Sulafat"


def _live_run_config(include_transcription: bool = False) -> RunConfig:
    config_kwargs: dict = {
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
        config_kwargs.update(
            {
                "enable_affective_dialog": True,
                "tool_thread_pool_config": ToolThreadPoolConfig(),
                "input_audio_transcription": types.AudioTranscriptionConfig(),
                "output_audio_transcription": types.AudioTranscriptionConfig(),
                "session_resumption": types.SessionResumptionConfig(),
            }
        )

    return RunConfig(**config_kwargs)


def _build_call_context(
    fs,
    call_id: str | None = None,
    patient_id: str | None = None,
    report_id: str | None = None,
) -> dict[str, str | None]:
    """Resolve patient/report context from Firestore for a given call."""
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
    clinic_id = (call.get("clinicId") if call else None) or (
        call.get("clinic_id") if call else None
    )

    if resolved_report_id:
        report = fs.get_report(resolved_report_id) or {}
        report_summary = report.get("summaryPlain") or report.get("summary_plain")
        recommended_specialty = report.get("recommendedSpecialty") or report.get(
            "recommended_specialty"
        )
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
    fs,
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
    """Force-complete a Twilio call if it is still active."""
    if not call_sid:
        return

    account_sid = os.environ.get("TWILIO_ACCOUNT_SID")
    auth_token = os.environ.get("TWILIO_AUTH_TOKEN")
    if not account_sid or not auth_token:
        return

    try:
        from twilio.rest import Client as TwilioClient  # noqa: PLC0415

        client = TwilioClient(account_sid, auth_token)
        client.calls(call_sid).update(status="completed")
    except Exception as exc:
        logger.warning("Could not force-complete Twilio call %s: %s", call_sid, exc)
