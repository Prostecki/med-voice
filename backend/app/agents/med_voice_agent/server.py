"""Med-Voice Agent Live API — application entry point.

All route handlers live in app/api/*. This file only wires them together.
"""
from __future__ import annotations

import logging
import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Load the agent's specific .env file (keeps local-dev DX unchanged)
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

logging.basicConfig(level=logging.INFO, format="%(message)s")

from app.api.callbacks import router as callbacks_router  # noqa: E402
from app.api.patients import router as patients_router  # noqa: E402
from app.api.reports import router as reports_router  # noqa: E402
from app.api.twilio_router import router as twilio_router  # noqa: E402
from app.api.voice import router as voice_router  # noqa: E402

app = FastAPI(title="Med-Voice Agent Live API")

raw_cors_origins = os.environ.get(
    "CORS_ALLOWED_ORIGINS",
    "http://localhost:3000,https://med-voice--sm-gemini-playground.europe-west4.hosted.app",
)
origins = [o.strip() for o in raw_cors_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "app": "med-voice"}


app.include_router(patients_router, prefix="/api")
app.include_router(reports_router, prefix="/api")
app.include_router(callbacks_router, prefix="/api")
app.include_router(twilio_router, prefix="/api")
app.include_router(voice_router, prefix="/api")

if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 8001))
    uvicorn.run(app, host="0.0.0.0", port=port)
