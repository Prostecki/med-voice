#!/usr/bin/env node
/**
 * create_user.js
 * --------------
 * Creates a Firebase Auth user and a corresponding Firestore profile with a specific role.
 *
 * Usage:
 *   node create_user.js <email> <password> <displayName> <role> <clinicId>
 *
 * Example:
 *   node create_user.js admin@clinic.com password123 "Admin User" ADMIN <clinic-id>
 */

import admin from "firebase-admin";
import { getAuth } from "firebase-admin/auth";

// Initialize Firebase Admin (uses ADC by default)
admin.initializeApp({
    projectId: process.env.GOOGLE_CLOUD_PROJECT || "sm-gemini-playground",
});

const db = admin.firestore("med-voice-db");

const [, , email, password, displayName, role, clinicId] = process.argv;

if (!email || !password || !displayName || !role || !clinicId) {
    console.error("Usage: node create_user.js <email> <password> <displayName> <role> <clinicId>");
    console.error("Roles: ADMIN | STAFF");
    process.exit(1);
}

async function run() {
    console.log(`🚀 Creating user: ${email} with role: ${role}...`);

    try {
        // 1. Create or Update Auth User
        let userRecord;
        try {
            userRecord = await getAuth().getUserByEmail(email);
            await getAuth().updateUser(userRecord.uid, { password, displayName });
            console.log(`  ✓ Updated existing Auth user: ${userRecord.uid}`);
        } catch (e) {
            userRecord = await getAuth().createUser({
                email,
                password,
                displayName,
            });
            console.log(`  ✓ Created new Auth user: ${userRecord.uid}`);
        }

        // 2. Create/Update Firestore Profile in mv_users
        await db.collection("mv_users").doc(userRecord.uid).set({
            userId: userRecord.uid,
            clinicId: clinicId,
            role: role,
            displayName: displayName,
        }, { merge: true });

        console.log(`  ✓ Created/Updated Firestore profile for ${email}`);
        console.log(`\n✅ Success! User ${email} is ready with role ${role}.`);

    } catch (error) {
        console.error("\n❌ Error creating user:", error);
        process.exit(1);
    }
}

run();
