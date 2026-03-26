#!/usr/bin/env node
/**
 * seed_firestore.js
 * -----------------
 * Populates Firestore with test data for all 7 collections.
 * Field names match the spec (camelCase).
 *
 * Usage:
 *   node seed_firestore.js                                             # ADC (gcloud auth)
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json node seed_firestore.js
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 node seed_firestore.js     # emulator
 */

import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { randomUUID } from "crypto";

admin.initializeApp({
    projectId: process.env.GOOGLE_CLOUD_PROJECT || "sm-gemini-playground",
});

const db = getFirestore("med-voice-db");
const now = new Date();
const later = (days = 0, hours = 0) =>
    new Date(now.getTime() + days * 86_400_000 + hours * 3_600_000);

async function set(collection, id, data) {
    await db.collection(collection).doc(id).set(data, { merge: true });
    return id;
}

// ── Pre-generate IDs so collections can cross-reference each other ────────────
const IDS = {
    clinic: randomUUID(),
    user: randomUUID(),
    // Patients
    p_critical: randomUUID(), // Emily Carter (Anemia + Critical ECG)
    p_normal: randomUUID(),   // Daniel Hughes (Healthy)
    p_mild: randomUUID(),     // Sophie Müller (Slightly high Glucose)
    p_multi: randomUUID(),    // Marcus Nilsson (History of several reports)
    // Reports for p_critical
    r_lab_emily: randomUUID(),
    r_ecg_emily: randomUUID(),
    // Reports for p_normal
    r_normal: randomUUID(),
    // Reports for p_mild
    r_mild: randomUUID(),
    // Reports for p_multi
    r_multi_1: randomUUID(),
    r_multi_2: randomUUID(),
    // Other
    call1: randomUUID(),
    appt1: randomUUID(),
};

console.log("🌱  Seeding Firestore with comprehensive test cases...\n");

// ── 1. mv_clinics ─────────────────────────────────────────────────────────────
await set("mv_clinics", IDS.clinic, {
    clinicId: IDS.clinic,
    name: "Med-Voice Primary Care",
    address: "123 Medical Blvd, Stockholm, 111 22",
    timezone: "Europe/Stockholm",
    phoneNumber: "+46 8 123 45 67",
});
console.log(`  ✓ clinic        ${IDS.clinic}`);

const USER_EMAIL = "doctor@clinic.com";
const USER_PASSWORD = "password123";

let authUid = IDS.user;
try {
    const existing = await getAuth().getUserByEmail(USER_EMAIL);
    authUid = existing.uid;
    console.log(`  - Found existing auth user: ${authUid}`);
    await getAuth().updateUser(authUid, { password: USER_PASSWORD });
} catch (e) {
    if (e.code === "auth/user-not-found") {
        await getAuth().createUser({
            uid: authUid,
            email: USER_EMAIL,
            password: USER_PASSWORD,
            displayName: "Dr. Anders Svensson",
        });
        console.log(`  ✓ Created auth user     ${USER_EMAIL}`);
    } else {
        throw e;
    }
}

await set("mv_users", authUid, {
    userId: authUid,
    clinicId: IDS.clinic,
    role: "ADMIN",
    displayName: "Dr. Anders Svensson",
});
console.log(`  ✓ user profile  ${authUid}`);

// ── 3. mv_patients ────────────────────────────────────────────────────────────
const patients = [
    { id: IDS.p_critical, fullName: "Emily Carter", phone: "+44 7700 900001", lang: "en" },
    { id: IDS.p_normal, fullName: "Daniel Hughes", phone: "+44 7700 900002", lang: "en" },
    { id: IDS.p_mild, fullName: "Sophie Müller", phone: "+44 7700 900003", lang: "en" },
    { id: IDS.p_multi, fullName: "Marcus Nilsson", phone: "+46 70 123 45 67", lang: "sv" },
];

for (const p of patients) {
    await set("mv_patients", p.id, {
        patientId: p.id,
        clinicId: IDS.clinic,
        fullName: p.fullName,
        phone: p.phone,
        preferredLanguage: p.lang,
        createdAt: now,
    });
    console.log(`  ✓ patient       ${p.id}  (${p.fullName})`);
}

// ── 4. mv_reports ─────────────────────────────────────────────────────────────

// CASE 1: Emily Carter — Critical/Moderate findings
await set("mv_reports", IDS.r_lab_emily, {
    reportId: IDS.r_lab_emily,
    clinicId: IDS.clinic,
    patientId: IDS.p_critical,
    reportType: "LAB",
    reportDate: "2026-02-20",
    summaryPlain: "Blood test shows moderate anemia and slightly elevated glucose.",
    extractedText: "Patient: Emily Carter. Results: Hemoglobin 9.8 g/dL (Normal: 12-16). Glucose 7.4 mmol/L (Normal: 4-6).",
    deviations: [
        { marker: "Hemoglobin", value: "9.8 g/dL", referenceRange: "12-16", severity: "moderate", plainText: "Your red blood cell count is low, which might make you feel tired." },
        { marker: "Glucose", value: "7.4 mmol/L", referenceRange: "4-6", severity: "mild", plainText: "Your blood sugar is a bit high." }
    ],
    status: "pending",
    createdAt: now,
});

await set("mv_reports", IDS.r_ecg_emily, {
    reportId: IDS.r_ecg_emily,
    clinicId: IDS.clinic,
    patientId: IDS.p_critical,
    reportType: "ECG",
    reportDate: "2026-02-22",
    summaryPlain: "Urgent: Your ECG shows a significantly prolonged QT interval.",
    extractedText: "ECG findings for Emily Carter: Heart rate 72 bpm. QT Interval 480ms (Normal: <440ms). ST segment normal.",
    deviations: [
        { marker: "QT Interval", value: "480 ms", referenceRange: "350-440", severity: "critical", plainText: "Your heart's electrical timing is longer than it should be. This requires urgent specialist review." }
    ],
    status: "pending",
    createdAt: now,
});

// CASE 2: Daniel Hughes — Perfectly Healthy
await set("mv_reports", IDS.r_normal, {
    reportId: IDS.r_normal,
    clinicId: IDS.clinic,
    patientId: IDS.p_normal,
    reportType: "LAB",
    reportDate: "2026-02-25",
    summaryPlain: "All your lab results are within normal limits. No action needed.",
    extractedText: "Lab Report Summary: Daniel Hughes. Hemoglobin 14.2 g/dL. Glucose 5.1 mmol/L. Cholesterol 4.2 mmol/L. All findings normal.",
    deviations: [],
    status: "reviewed",
    createdAt: now,
});

// CASE 3: Sophie Müller — Mild Thyroid/Glucose (Endocrinology referral test)
await set("mv_reports", IDS.r_mild, {
    reportId: IDS.r_mild,
    clinicId: IDS.clinic,
    patientId: IDS.p_mild,
    reportType: "LAB",
    reportDate: "2026-02-28",
    summaryPlain: "Your thyroid markers are slightly outside the range.",
    extractedText: "Sophie Müller. TSH 5.2 mIU/L (Normal: 0.4-4.0). T4 Normal. Iron Normal.",
    deviations: [
        { marker: "TSH", value: "5.2 mIU/L", referenceRange: "0.4-4.0", severity: "mild", plainText: "Your thyroid stimulating hormone is slightly elevated, suggesting a minor imbalance." }
    ],
    status: "pending",
    createdAt: now,
});

// CASE 4: Marcus Nilsson — Multiple reports (Historical review test)
for (let i = 1; i <= 2; i++) {
    const rId = i === 1 ? IDS.r_multi_1 : IDS.r_multi_2;
    await set("mv_reports", rId, {
        reportId: rId,
        clinicId: IDS.clinic,
        patientId: IDS.p_multi,
        reportType: i === 1 ? "LAB" : "ECG",
        reportDate: `2026-01-1${i}`,
        summaryPlain: `Historical report ${i} for Marcus.`,
        extractedText: `Archived data for Marcus Nilsson, 2026-01. Everything was fine back then.`,
        deviations: [],
        status: "reviewed",
        createdAt: now,
    });
}
console.log(`  ✓ 6 reports created across 4 cases`);

// ── 5. mv_calls ───────────────────────────────────────────────────────────────
await set("mv_calls", IDS.call1, {
    callId: IDS.call1,
    clinicId: IDS.clinic,
    patientId: IDS.p_critical,
    status: "COMPLETED",
    startedAt: later(-1),
    endedAt: later(-1, 0.1),
    transcript: [{ role: "agent", text: "Hello Emily, I'm calling to discuss your recent results." }],
    notes: "Patient was informed about ECG findings.",
});

// ── 6. mv_appointments ────────────────────────────────────────────────────────
await set("mv_appointments", IDS.appt1, {
    appointmentId: IDS.appt1,
    clinicId: IDS.clinic,
    patientId: IDS.p_multi,
    specialty: "general practitioner",
    providerName: "Dr. Anders Svensson",
    slotStart: later(2, 10),
    slotEnd: later(2, 10.5),
    status: "CONFIRMED",
});

// ── 7. mv_availability ────────────────────────────────────────────────────────
const specialties = [
    { key: "cardiologist", providers: ["Dr. Sarah Thompson", "Dr. Mark Ellis"] },
    { key: "endocrinologist", providers: ["Dr. Anna Fischer"] },
    { key: "general practitioner", providers: ["Dr. Anders Svensson"] },
];

let slotCount = 0;
for (const spec of specialties) {
    for (let j = 0; j < 5; j++) {
        const slotId = randomUUID();
        await db.collection("mv_availability").doc(IDS.clinic).collection("slots").doc(slotId).set({
            slotId: slotId,
            clinicId: IDS.clinic,
            specialty: spec.key,
            providerName: spec.providers[0],
            slotStart: later(2 + j, 9 + j),
            slotEnd: later(2 + j, 9.5 + j),
            isBooked: false,
        });
        slotCount++;
    }
}
console.log(`  ✓ ${slotCount} availability slots (Cardio, Endo, GP)`);

console.log(`
✅  Seed complete! New test cases:
  1. Emily Carter (${IDS.p_critical}) -> Critical ECG + Anemia (Complex Triage)
  2. Daniel Hughes (${IDS.p_normal}) -> Normal Lab (Happy Path)
  3. Sophie Müller (${IDS.p_mild}) -> Mild TSH (Regular Referral)
  4. Marcus Nilsson (${IDS.p_multi}) -> Multiple History (Selection Test)

Credentials: doctor@clinic.com / password123
`);
process.exit(0);
