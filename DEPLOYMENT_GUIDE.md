# Med Voice Deployment Guide

This guide explains how to deploy Med Voice cleanly on Google Cloud and how the frontend, backend, Twilio, Firestore, and callback infrastructure fit together.

## Deployment Targets

### Frontend

- Next.js app
- Hosted on Firebase App Hosting

### Backend

- FastAPI application
- Hosted on Cloud Run

### AI / Agent Runtime

- Google ADK agent running inside the backend
- Gemini Live and report analysis through Vertex AI / Gemini

### Supporting GCP Services

- Cloud Firestore
- Cloud Storage
- Cloud Tasks
- Secret Manager
- Cloud Logging

## High-Level Deployment Architecture

```text
GitHub Repo
   |
   v
GitHub Actions
   |
   |-- Workload Identity Federation auth
   |-- Cloud Build image build
   |-- Terraform apply
   v
Google Cloud
   |
   |-- Cloud Run (backend)
   |-- Cloud Tasks (callbacks)
   |-- Cloud Storage (reports)
   |-- Firestore (app data)
   |-- Secret Manager (Twilio secrets)
   |-- Logging

Firebase App Hosting
   |
   v
Next.js frontend
```

## Required Infrastructure

The Terraform configuration under `infra/terraform/` provisions the main backend resources.

Resources managed in this repo include:

- Cloud Run service
- backend service account
- Cloud Storage reports bucket
- Secret Manager secret references
- Cloud Tasks queue
- IAM bindings for backend access
- required Google APIs

## Required Runtime Configuration

The backend expects environment variables for:

### Core Google Cloud

```bash
GOOGLE_CLOUD_PROJECT
GOOGLE_CLOUD_LOCATION
REPORTS_BUCKET
SERVICE_ACCOUNT_EMAIL
SERVICE_URL
```

### Gemini / Vertex AI

```bash
GOOGLE_GENAI_USE_VERTEXAI=1
```

Or alternatively:

```bash
GEMINI_API_KEY
```

### Callback Scheduling

```bash
CALLBACK_QUEUE
CLOUD_TASKS_LOCATION
AUTO_CALL_ON_REPORT_ANALYZED
```

### CORS

```bash
CORS_ALLOWED_ORIGINS
```

### Twilio

```bash
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_FROM_NUMBER
```

## Cloud Run Deployment

### Option 1: Terraform-managed deployment through CI/CD

This repository includes a GitHub Actions workflow:

- `.github/workflows/cloud-run-deploy.yaml`

The workflow:

1. authenticates to Google Cloud using Workload Identity Federation
2. builds the backend image with Cloud Build
3. applies Terraform
4. deploys or updates the Cloud Run backend
5. updates runtime env such as `SERVICE_URL`, callback queue, CORS, and Twilio configuration

This is the recommended deployment path for the hackathon demo.

### Option 2: Manual backend deployment

If you want to deploy manually, you still need to:

1. build and push the backend image
2. provision or update infrastructure with Terraform
3. configure the Cloud Run environment variables and Secret Manager bindings

## Firebase App Hosting Deployment

The frontend is deployed separately from the backend.

The frontend needs these runtime values:

```bash
NEXT_PUBLIC_API_URL
NEXT_PUBLIC_WS_URL
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID
```

Important:

- `NEXT_PUBLIC_API_URL` must point to the deployed Cloud Run backend `/api`
- `NEXT_PUBLIC_WS_URL` must point to the backend WebSocket endpoint
- Firebase Auth authorized domains must include the hosted frontend domain

## Twilio Integration

The backend owns the Twilio integration.

Main endpoints involved:

- `/api/twilio/call`
- `/api/twilio/twiml`
- `/api/twilio/stream`
- `/api/twilio/status`

Flow:

1. backend creates outbound call with Twilio
2. Twilio requests TwiML from the backend
3. TwiML connects Twilio Media Streams to the backend WebSocket
4. Gemini Live drives the real-time phone conversation
5. status callbacks update Firestore call state

## Callback Scheduling with Cloud Tasks

Cloud Tasks is used for delayed callback calls.

Important deployment detail:

- Cloud Run / Gemini runtime can use `europe-north1`
- Cloud Tasks queue may be deployed in `europe-west1`

That is why the backend uses:

```bash
CLOUD_TASKS_LOCATION
```

instead of assuming the same region as Gemini / Cloud Run.

Callback flow:

1. live agent calls `schedule_callback(...)`
2. backend writes `CALLBACK_SCHEDULED` state to Firestore
3. backend creates a Cloud Task
4. Cloud Task invokes `/api/callbacks/trigger`
5. backend triggers Twilio outbound call again

## Firestore Requirements

The backend expects a Firestore database containing:

- patients
- reports
- calls
- providers
- availability slots
- appointments

Important collections:

```text
mv_patients
mv_reports
mv_calls
mv_providers
mv_availability/{clinicId}/slots
mv_appointments
mv_clinics
```

## Seeding Demo Data

To seed providers and availability:

```bash
uv run python scripts/seed_doctors_and_slots.py --project <YOUR_GCP_PROJECT_ID>
```

This creates:

- provider records
- future free appointment slots

## Security Notes

### Workload Identity Federation

GitHub Actions authenticates to Google Cloud using Workload Identity Federation.

That means:

- no long-lived service account keys are stored in the repo
- GitHub secrets only contain the WIF provider and service account identity references
- trust is enforced in Google Cloud IAM

### Secrets

Twilio secrets should stay in Secret Manager and GitHub Actions secrets.

Do not commit:

- `.env` files
- service account JSON keys
- local ADK session databases

## Verification Checklist

After deployment, verify:

- Cloud Run health endpoint works:

```bash
curl https://<YOUR_BACKEND_URL>/api/health
```

- frontend can load patient pages without CORS errors
- report upload succeeds
- report analysis result is written to Firestore
- Twilio outbound call connects successfully
- callback scheduling creates a Cloud Task
- Cloud Task triggers a follow-up call
- booked appointments appear in Firestore and in the UI

## Troubleshooting

### CORS issues

Check:

- `CORS_ALLOWED_ORIGINS` on Cloud Run
- frontend API and WebSocket URLs
- Firebase hosted domain configuration

### Twilio says “an error has occurred”

Check:

- TwiML XML formatting
- `SERVICE_URL`
- Twilio credentials
- Twilio `FROM` number
- Twilio Media Stream endpoint

### Callback did not trigger

Check:

- `CLOUD_TASKS_LOCATION`
- `CALLBACK_QUEUE`
- Cloud Tasks queue region
- service account permissions for OIDC task invocation

### Patient/report mismatch in Twilio calls

Check:

- `call_id` in Firestore
- `patientId` stored on the call record
- `reportId` stored on the call record
- Twilio stream identity resolution logs

### Availability lookup returns no slots

Check:

- `mv_availability/{clinicId}/slots`
- specialty normalization
- future slot timestamps
- `isBooked` flags

## Files to Review During Deployment

- `.github/workflows/cloud-run-deploy.yaml`
- `infra/terraform/compute.tf`
- `infra/terraform/tasks.tf`
- `infra/terraform/variables.tf`
- `infra/terraform/secrets.tf`
- `portal/apphosting.yaml`
- `backend/app/agents/med_voice_agent/server.py`

## Recommended Demo Deployment Setup

For the hackathon demo:

- keep the frontend on Firebase App Hosting
- keep the backend on Cloud Run
- use Firestore-backed reports, calls, slots, and appointments
- use real Twilio outbound calls
- keep `Mock Browser Call` available for low-cost development testing
- keep callback flow enabled through Cloud Tasks

This gives you the strongest combination of:

- live agent experience
- real telephony
- real cloud infrastructure
- clear reproducibility for judges
