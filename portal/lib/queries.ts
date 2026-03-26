import { collection, doc, getDoc, getDocs, query, where, limit, Timestamp, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase";

// -- Models (matching Firestore) --

export interface Clinic {
    clinicId: string;
    name: string;
    address: string;
    timezone: string;
    phoneNumber: string;
}

export interface Patient {
    patientId: string;
    clinicId: string;
    fullName: string;
    phone: string;
    preferredLanguage: string;
    timezone: string;
    createdAt?: Timestamp | any;
}

export interface Report {
    reportId: string;
    report_id?: string; // Compatibility
    clinicId: string;
    patientId: string;
    reportType: "LAB" | "ECG" | "MIXED";
    report_type?: string; // Compatibility
    reportDate: string;
    date?: string; // Compatibility
    status?: "UPLOADED" | "ANALYZED" | "REVIEWED";
    createdAt?: Timestamp | null;
}

export interface Call {
    callId: string;
    clinicId: string;
    patientId: string;
    reportId: string;
    status: "QUEUED" | "CALLING" | "CONNECTED" | "COMPLETED" | "FAILED" | "CALLBACK_SCHEDULED";
    scheduledFor?: Timestamp | any;
    startedAt?: Timestamp | any;
    started_at?: Timestamp | any; // Compatibility
    endedAt?: Timestamp | any;
    ended_at?: Timestamp | any; // Compatibility
    transcript?: { role: "user" | "agent"; text: string }[];
    notes?: string;
    outcome?: string;
}

export interface Appointment {
    appointmentId: string;
    clinicId: string;
    patientId: string;
    specialty: string;
    providerName: string;
    slotStart: Timestamp | any;
    status: "PROPOSED" | "CONFIRMED" | "CANCELLED";
}

export interface Provider {
    providerId: string;
    clinicId: string;
    displayName: string;
    specialty: string;
    active: boolean;
}

export interface AvailabilitySlot {
    slotId: string;
    clinicId: string;
    specialty: string;
    providerName: string;
    slotStart: Timestamp | any;
    slotEnd: Timestamp | any;
    isBooked: boolean;
}

// -- Queries --

export async function getClinic(clinicId: string): Promise<Clinic | null> {
    const snap = await getDoc(doc(db, "mv_clinics", clinicId));
    return snap.exists() ? { ...snap.data(), clinicId: snap.id } as Clinic : null;
}

export async function getPatientsByClinic(clinicId: string): Promise<Patient[]> {
    const q = query(collection(db, "mv_patients"), where("clinicId", "==", clinicId));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ ...d.data(), patientId: d.id } as Patient));
}

export async function getPatient(patientId: string): Promise<Patient | null> {
    const snap = await getDoc(doc(db, "mv_patients", patientId));
    return snap.exists() ? { ...snap.data(), patientId: snap.id } as Patient : null;
}

export async function getReportsByPatient(patientId: string): Promise<Report[]> {
    if (!patientId) return [];
    const q = query(collection(db, "mv_reports"), where("patientId", "==", patientId));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ ...d.data(), reportId: d.id } as Report));
}

export async function getCallsByPatient(patientId: string): Promise<Call[]> {
    if (!patientId) return [];
    const q = query(collection(db, "mv_calls"), where("patientId", "==", patientId));
    const snap = await getDocs(q);
    return snap.docs.map(d => {
        const data = d.data();
        return {
            ...data,
            callId: d.id,
            startedAt: data.startedAt || data.started_at,
            endedAt: data.endedAt || data.ended_at,
            scheduledFor: data.scheduledFor || data.scheduled_for
        } as Call;
    });
}

export async function getAppointmentsByClinic(clinicId: string): Promise<Appointment[]> {
    const q = query(collection(db, "mv_appointments"), where("clinicId", "==", clinicId));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ ...d.data(), appointmentId: d.id } as Appointment));
}

export async function getProvidersByClinic(clinicId: string): Promise<Provider[]> {
    const q = query(collection(db, "mv_providers"), where("clinicId", "==", clinicId));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ ...d.data(), providerId: d.id } as Provider));
}

export async function getAvailableSlotsByClinic(clinicId: string): Promise<AvailabilitySlot[]> {
    const q = query(
        collection(db, "mv_availability", clinicId, "slots"),
        where("isBooked", "==", false),
        limit(100)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ ...d.data(), slotId: d.id } as AvailabilitySlot));
}

export async function createPatient(data: Omit<Patient, "patientId" | "createdAt">): Promise<string> {
    const docRef = await addDoc(collection(db, "mv_patients"), {
        ...data,
        createdAt: serverTimestamp()
    });
    return docRef.id;
}

export async function createCall(data: Omit<Call, "callId">): Promise<string> {
    const docRef = await addDoc(collection(db, "mv_calls"), data);
    return docRef.id;
}

// For Dashboard
export async function getRecentCalls(clinicId: string): Promise<Call[]> {
    // Note: requires composite index in real Firestore if using orderBy with where
    const q = query(
        collection(db, "mv_calls"),
        where("clinicId", "==", clinicId),
        limit(10)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ ...d.data(), callId: d.id } as Call)).sort((a, b) => {
        const timeA = a.startedAt?.toMillis?.() || 0;
        const timeB = b.startedAt?.toMillis?.() || 0;
        return timeB - timeA;
    });
}

export async function getRecentReports(clinicId: string): Promise<Report[]> {
    const q = query(
        collection(db, "mv_reports"),
        where("clinicId", "==", clinicId),
        limit(10)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ ...d.data(), reportId: d.id } as Report));
}
