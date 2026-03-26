# Med Voice

Med Voice is a real-time medical voice outreach system built with Google ADK, Gemini Live, and Google Cloud.

The main workflow is:

1. A doctor, nurse, or lab technician uploads a patient report from a web portal.
2. The backend stores the report, summarizes it once with Gemini, and saves the summary in Firestore.
3. A live voice agent can then call the patient through Twilio, explain the findings, answer questions, and help book a follow-up appointment.
4. If the patient is busy, the agent can schedule a callback using Cloud Tasks and automatically re-trigger the call later.

The project includes both:

- a real phone-call path using Twilio Voice
- a browser-based mock live call for low-cost testing

## Stack

### Frontend

- Next.js
- TypeScript
- Firebase App Hosting
- Firebase Auth

### Backend

- FastAPI
- Google ADK
- Gemini Live
- Vertex AI / Gemini
- Twilio Voice + Twilio Media Streams

### Google Cloud

- Cloud Run
- Cloud Firestore
- Cloud Storage
- Cloud Tasks
- Secret Manager
- Cloud Logging
- Cloud Build

### Infrastructure / Delivery

- Terraform
- GitHub Actions
- Workload Identity Federation

## Architecture

```text
Doctor / Nurse
   |
   v
Firebase App Hosting (Next.js Portal)
   |
   v
Cloud Run (FastAPI Backend + ADK Live Agent)
   |----> Cloud Storage (uploaded reports)
   |----> Firestore (patients, reports, calls, slots, appointments)
   |----> Vertex AI / Gemini (analysis + Gemini Live)
   |----> Twilio (outbound calls)
   |----> Cloud Tasks (schedule callback)
   |<---- Secret Manager (Twilio secrets)
   |----> Cloud Logging

Cloud Tasks
   |
   v
Cloud Run callback endpoint
   |
   v
Twilio
   |
   v
Patient phone
```

## Core Features

- Upload and store medical reports
- Analyze reports once and persist a summary for later use
- Real-time live voice interaction with Gemini Live
- Natural interruptible phone-call experience
- Multilingual voice responses
- Appointment slot lookup from Firestore
- Appointment booking through tool calls
- Callback scheduling using Cloud Tasks
- Mock browser live mode for testing without Twilio cost

## ADK Agent Design

The live agent is implemented as a tool-using ADK agent, not a fixed scripted flow.

The main tools used by the agent are:

- `get_patient_context(patient_id)`
- `get_report(report_id)`
- `list_reports(patient_id)`
- `list_available_slots(clinic_id, specialty, earliest_only=True)`
- `book_appointment(patient_id, report_id, slot_id)`
- `get_patient_appointments(patient_id)`
- `schedule_callback(call_id, minutes_from_now or timestamp)`

This lets the voice agent stay grounded in application data and perform real actions instead of only generating text.

## Firestore Data Model

Main collections used by the app:

- `mv_patients`
- `mv_reports`
- `mv_calls`
- `mv_providers`
- `mv_availability/{clinicId}/slots`
- `mv_appointments`
- `mv_clinics`

## Repository Layout

```text
backend/             FastAPI backend, ADK agent, tools, services
portal/              Next.js frontend
infra/terraform/     Terraform for Google Cloud infrastructure
scripts/             Seeding and utility scripts
docs/                Supporting docs and assets
```

## Local Development

Run the backend and frontend in separate terminals.

### 1. Authenticate with Google Cloud

```bash
gcloud auth login
gcloud auth application-default login
gcloud config set project <YOUR_GCP_PROJECT_ID>
```

If you are using Vertex AI locally:

```bash
export GOOGLE_GENAI_USE_VERTEXAI=1
export GOOGLE_CLOUD_PROJECT=<YOUR_GCP_PROJECT_ID>
export GOOGLE_CLOUD_LOCATION=europe-north1
export REPORTS_BUCKET=<YOUR_REPORTS_BUCKET>
export SERVICE_ACCOUNT_EMAIL=<YOUR_SERVICE_ACCOUNT_EMAIL>
```

If you want to run with an API key instead of Vertex AI:

```bash
export GEMINI_API_KEY=<YOUR_GEMINI_API_KEY>
```

### 2. Start the backend

```bash
cd backend
uv run uvicorn app.agents.med_voice_agent.server:app --reload --host 0.0.0.0 --port 8000
```

Health check:

```bash
curl http://localhost:8000/api/health
```

### 3. Start the frontend

```bash
cd portal
export NEXT_PUBLIC_API_URL=http://localhost:8000/api
export NEXT_PUBLIC_WS_URL=ws://localhost:8000/api/agents/voice
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

## Local Demo Flows

### Mock Browser Call

Use this when you want to test the live conversation without paying for Twilio calls.

1. Log in to the portal.
2. Open a patient that has an analyzed report.
3. Click `Mock Browser Call`.
4. The browser opens a WebSocket live session with the backend.
5. The agent uses the saved report summary only.

### Real Twilio Call

Use this when you want to test the actual phone flow.

Required backend env vars:

```bash
export TWILIO_ACCOUNT_SID=<YOUR_TWILIO_ACCOUNT_SID>
export TWILIO_AUTH_TOKEN=<YOUR_TWILIO_AUTH_TOKEN>
export TWILIO_FROM_NUMBER=<YOUR_TWILIO_NUMBER>
export SERVICE_URL=<YOUR_PUBLIC_BACKEND_URL>
export CLOUD_TASKS_LOCATION=europe-west1
```

Then:

1. Open a patient page in the portal.
2. Click `Call Patient`.
3. Confirm the number.
4. Twilio places the outbound call.

### Callback Flow

1. Start a Twilio call.
2. Ask the agent to call back later, for example in 2 minutes.
3. The backend stores callback state in Firestore.
4. A Cloud Task is created.
5. Cloud Tasks re-triggers the backend at the scheduled time.
6. The backend places the outbound call again.

## Seeding Providers and Slots

To create demo doctors and appointment slots in Firestore:

```bash
cd /Users/sijohnmathew/Documents/Projects/Aclarity/at_GitRepo/med-voice
export GOOGLE_CLOUD_PROJECT=<YOUR_GCP_PROJECT_ID>
uv run python scripts/seed_doctors_and_slots.py --project <YOUR_GCP_PROJECT_ID>
```

This seeds:

- provider records into `mv_providers`
- slot records into `mv_availability/{clinicId}/slots`

## Demo Credentials

If your local portal uses the seeded auth user, the default test user is:

- Email: `doctor@clinic.com`
- Password: `password123`

## Deployment

For deployment details, see:

- [DEPLOYMENT_GUIDE.md](/Users/sijohnmathew/Documents/Projects/Aclarity/at_GitRepo/med-voice/DEPLOYMENT_GUIDE.md)

## Public Repo Notes

If you make this repository public:

- do not commit local session databases
- do not commit `.env` files
- keep Twilio secrets only in Secret Manager / GitHub secrets
- keep GitHub Actions authentication scoped through Workload Identity Federation

## Hackathon Notes

This project was built for the Gemini Live Agent Challenge.

The submission-relevant highlights are:

- Gemini model usage
- Google ADK tool-based agent architecture
- real-time live voice interaction
- Google Cloud backend deployment
- callback scheduling with Cloud Tasks
- reproducible infrastructure with Terraform and GitHub Actions
