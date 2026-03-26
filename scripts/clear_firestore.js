import admin from "firebase-admin";

admin.initializeApp({
    projectId: process.env.GOOGLE_CLOUD_PROJECT || "sm-gemini-playground",
});

const db = admin.firestore("med-voice-db");

async function deleteCollection(collectionPath, batchSize = 100) {
    const collectionRef = db.collection(collectionPath);
    const query = collectionRef.orderBy('__name__').limit(batchSize);

    return new Promise((resolve, reject) => {
        deleteQueryBatch(db, query, resolve).catch(reject);
    });
}

async function deleteQueryBatch(db, query, resolve) {
    const snapshot = await query.get();

    const batchSize = snapshot.size;
    if (batchSize === 0) {
        resolve();
        return;
    }

    const batch = db.batch();
    snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
    });
    await batch.commit();

    process.nextTick(() => {
        deleteQueryBatch(db, query, resolve);
    });
}

async function clearAll() {
    console.log("🧹 Clearing Firestore data...");

    const collections = [
        "mv_clinics",
        "mv_users",
        "mv_patients",
        "mv_reports",
        "mv_calls",
        "mv_appointments",
        "mv_availability"
    ];

    for (const coll of collections) {
        process.stdout.write(`  - Deleting ${coll}... `);
        await deleteCollection(coll);
        console.log("Done");
    }

    // Also delete any nested slots in mv_availability specifically
    process.stdout.write(`  - Deleting mv_availability/*/slots... `);
    const slotsQuery = db.collectionGroup('slots');
    const slotsSnapshot = await slotsQuery.get();
    if (!slotsSnapshot.empty) {
        const batch = db.batch();
        slotsSnapshot.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
        console.log(`Done (${slotsSnapshot.size} deleted)`);
    } else {
        console.log("Done (0 deleted)");
    }

    console.log("✅ Database cleared!");
}

clearAll().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
