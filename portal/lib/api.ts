const API_BASE = process.env.NEXT_PUBLIC_API_URL || "https://med-voice-backend-979008310984.europe-west1.run.app/api";

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
        headers: { "Content-Type": "application/json" },
        ...options,
    });
    if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
    return res.json();
}

// ── Patients ──────────────────────────────────────────────────────────────
export const getPatients = () => apiFetch<Patient[]>("/patients");
export const getPatient = (id: string) => apiFetch<Patient>(`/patients/${id}`);
export const createPatient = (data: Partial<Patient>) =>
    apiFetch<Patient>("/patients", { method: "POST", body: JSON.stringify(data) });

// ── Reports ───────────────────────────────────────────────────────────────
export const getUploadUrl = (data: { filename: string; content_type: string; patient_id: string; clinic_id: string }) =>
    apiFetch<{ url: string; gcsPath: string }>("/reports/upload-url", {
        method: "POST",
        body: JSON.stringify(data),
    });

export const processReport = (data: {
    patient_id: string;
    clinic_id: string;
    gcs_path: string;
    filename: string;
    content_type: string;
}) =>
    apiFetch<{ report_id: string; analysis: any }>("/reports/process", {
        method: "POST",
        body: JSON.stringify(data),
    });

export const getPatientReports = (patientId: string) => 
    apiFetch<Report[]>(`/patients/${patientId}/reports`);

// ── Calls ─────────────────────────────────────────────────────────────────
export const triggerTwilioCall = (
    toNumber: string,
    patientId: string,
    callId?: string,
    reportId?: string,
    clinicId?: string,
) =>
    apiFetch<{ status: string; call_sid: string }>(
        `/twilio/call?to_number=${encodeURIComponent(toNumber)}&patient_id=${encodeURIComponent(patientId)}${callId ? `&call_id=${encodeURIComponent(callId)}` : ""}${reportId ? `&report_id=${encodeURIComponent(reportId)}` : ""}${clinicId ? `&clinic_id=${encodeURIComponent(clinicId)}` : ""}`,
        {
        method: "POST",
    });

export const scheduleCallback = (data: {
    patientId: string;
    clinicId: string;
    reportId: string;
    scheduledAt: string;
}) =>
    apiFetch<{ status: string; call_id: string }>("/callbacks/schedule", {
        method: "POST",
        body: JSON.stringify({
            patient_id: data.patientId,
            clinic_id: data.clinicId,
            report_id: data.reportId,
            scheduled_at: data.scheduledAt,
        }),
    });

// ── Appointments ──────────────────────────────────────────────────────────
export const getAppointments = () => apiFetch<Appointment[]>("/appointments");

// ── Types ─────────────────────────────────────────────────────────────────
export interface Patient {
    id: string;
    fullName: string;
    dateOfBirth: string;
    phone: string;
    clinicId: string;
    pendingReports: string[];
}

export interface Report {
    report_id: string;
    reportId?: string; // Compatibility
    report_type: string;
    reportType?: string; // Compatibility
    date: string;
    reportDate?: string; // Compatibility
    summary?: string;
    status: string;
    createdAt?: any;
}

export interface Appointment {
    id: string;
    patient_id: string;
    patient_name: string;
    doctor_name: string;
    specialty: string;
    date: string;
    time: string;
    clinic_name: string;
    status: "upcoming" | "completed" | "cancelled";
}
