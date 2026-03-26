#!/usr/bin/env node
/**
 * seed_slots.js
 * -------------
 * Populates Firestore with 150+ future appointment slots.
 * Spans across 30 days and all 6 specialties.
 */

import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { randomUUID } from "crypto";

admin.initializeApp({
    projectId: process.env.GOOGLE_CLOUD_PROJECT || "sm-gemini-playground",
});

const db = getFirestore("med-voice-db");

// Look for the clinic ID from the database or use a known one
const clinicSnap = await db.collection("mv_clinics").get();
if (clinicSnap.empty) {
    console.error("❌ No clinics found. Please run seed_firestore.js first.");
    process.exit(1);
}
const clinicId = clinicSnap.docs[0].id;
const clinicName = clinicSnap.docs[0].data().name;

console.log(`🌱 Seeding slots for clinic: ${clinicName} (${clinicId})...`);

const specialties = [
    { key: "cardiologist", providers: ["Dr. Sarah Thompson", "Dr. Mark Ellis"] },
    { key: "endocrinologist", providers: ["Dr. Anna Fischer", "Dr. David Klein"] },
    { key: "general practitioner", providers: ["Dr. Anders Svensson", "Dr. Maria Lopez"] },
    { key: "hematologist", providers: ["Dr. Elena Rossi", "Dr. John Miller"] },
    { key: "nephrologist", providers: ["Dr. Yuki Tanaka", "Dr. Liam O'Connor"] },
    { key: "hepatologist", providers: ["Dr. Fatima Al-Zahra", "Dr. Jean-Pierre Dupont"] },
];

const now = new Date();
let totalSlots = 0;

// Generate slots for the next 30 days
for (let day = 0; day < 30; day++) {
    // Skip weekends for more realism
    const date = new Date(now);
    date.setDate(now.getDate() + day);
    if (date.getDay() === 0 || date.getDay() === 6) continue;

    for (const spec of specialties) {
        // Every day, 2-3 random slots per specialty
        const numSlots = Math.floor(Math.random() * 2) + 2; 

        for (let s = 0; s < numSlots; s++) {
            const slotId = randomUUID();
            const provider = spec.providers[Math.floor(Math.random() * spec.providers.length)];
            
            // Random hour between 9:00 and 16:00
            const hour = 9 + Math.floor(Math.random() * 8);
            const minute = Math.random() > 0.5 ? 0 : 30;

            const slotStart = new Date(date);
            slotStart.setHours(hour, minute, 0, 0);
            
            const slotEnd = new Date(slotStart);
            slotEnd.setMinutes(slotStart.getMinutes() + 30);

            await db.collection("mv_availability").doc(clinicId).collection("slots").doc(slotId).set({
                slotId: slotId,
                clinicId: clinicId,
                specialty: spec.key,
                providerName: provider,
                slotStart: slotStart.toISOString(),
                slotEnd: slotEnd.toISOString(),
                isBooked: false,
                createdAt: now.toISOString(),
            });
            totalSlots++;
        }
    }
    process.stdout.write(".");
}

console.log(`\n✅ Successfully seeded ${totalSlots} availability slots across 30 days.`);
process.exit(0);
