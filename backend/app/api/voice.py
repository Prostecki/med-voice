"""Browser-based mock voice WebSocket — /api/agents/voice"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from google.adk.agents.live_request_queue import LiveRequestQueue
from google.genai import types

from app.core.audio import _build_call_context, _live_run_config
from app.core.dependencies import APP_NAME, get_firestore_service, get_runner, get_session_service

logger = logging.getLogger(__name__)
router = APIRouter()


@router.websocket("/agents/voice")
async def voice_agent_endpoint(
    websocket: WebSocket,
    session_id: str = "default_session",
    user_id: str = "default_user",
    call_id: str | None = None,
    report_id: str | None = None,
):
    await websocket.accept()
    logger.info("Frontend WebSocket connected. User: %s, Session: %s", user_id, session_id)

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
        session = await session_service.get_session(
            app_name=APP_NAME, user_id=user_id, session_id=session_id
        )
        if not session:
            await session_service.create_session(
                app_name=APP_NAME, user_id=user_id, session_id=session_id
            )

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
            )],
        ))

        async def upstream_task() -> None:
            """Browser mic → ADK queue."""
            nonlocal websocket_closed
            try:
                while True:
                    data = await websocket.receive_text()
                    msg = json.loads(data)

                    if msg.get("type") == "realtime_input":
                        b64_data = msg.get("data")
                        if b64_data:
                            pcm_bytes = base64.b64decode(b64_data)
                            live_request_queue.send_realtime(
                                types.Blob(mime_type="audio/pcm;rate=24000", data=pcm_bytes)
                            )

                    elif msg.get("type") == "client_content":
                        text = msg.get("text")
                        if text:
                            logger.info("[Client]: %s", text)
                            live_request_queue.send_content(
                                types.Content(role="user", parts=[types.Part.from_text(text=text)])
                            )

            except WebSocketDisconnect:
                logger.info("Client disconnected.")
                websocket_closed = True
            except Exception as e:
                websocket_closed = True
                logger.error("Error in upstream_task: %s", e, exc_info=True)

        async def downstream_task() -> None:
            """ADK runner events → browser WebSocket."""
            try:
                logger.info("Starting ADK live stream generator...")
                async for event in runner.run_live(
                    user_id=user_id,
                    session_id=session_id,
                    live_request_queue=live_request_queue,
                    run_config=run_config,
                ):
                    logger.info("Received ADK Event: %s", type(event).__name__)

                    if hasattr(event, "content") and event.content:
                        for part in event.content.parts:
                            if part.inline_data:
                                audio_bytes = part.inline_data.data
                                if audio_bytes:
                                    logger.info("[Model Audio]: %d bytes sent", len(audio_bytes))
                                    if not await safe_send_json({
                                        "type": "audio",
                                        "data": base64.b64encode(audio_bytes).decode("utf-8"),
                                    }):
                                        return
                            elif part.text:
                                logger.info("[Model Text]: %s", part.text)
                                if not await safe_send_json({"type": "text", "text": part.text}):
                                    return
                            elif part.function_call:
                                logger.info("[Model Tool Call]: %s", part.function_call.name)

                    if hasattr(event, "input_transcription") and event.input_transcription:
                        if event.input_transcription.text and not event.input_transcription.finished:
                            logger.info("User speaking detected — sending interrupt to frontend.")
                            if not await safe_send_json({"type": "interrupt"}):
                                return

                    if hasattr(event, "output_transcription") and event.output_transcription:
                        logger.info("[Model Transcript]: %s", event.output_transcription)

                    if getattr(event, "interrupted", False):
                        logger.info("Interruption detected! Signaling frontend to clear audio.")
                        if not await safe_send_json({"type": "interrupt"}):
                            return

                    if hasattr(event, "tool_call") and event.tool_call:
                        for fc in event.tool_call.function_calls:
                            logger.info("[ADK Tool Call Event]: %s(%s)", fc.name, fc.args)

            except asyncio.CancelledError:
                pass
            except (WebSocketDisconnect, RuntimeError):
                websocket_closed = True
            except Exception as e:
                from google.genai import errors  # noqa: PLC0415

                if isinstance(e, errors.APIError) and "1000" in str(e):
                    logger.info("Gemini session ended gracefully (1000).")
                else:
                    logger.error("Error in downstream_task: %s", e, exc_info=True)

        await asyncio.gather(upstream_task(), downstream_task())

    except Exception as e:
        logger.error("Gemini connection error: %s", e)
    finally:
        websocket_closed = True
        live_request_queue.close()
        try:
            await websocket.close(code=1011)
        except Exception:
            pass
