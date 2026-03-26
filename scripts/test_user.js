import admin from "firebase-admin";
import { getAuth } from "firebase-admin/auth";
admin.initializeApp({ projectId: "sm-gemini-playground" });
async function check() {
  const user = await getAuth().getUserByEmail("doctor@clinic.com");
  console.log("Auth UID:", user.uid);
  const snap = await admin.firestore("med-voice-db").collection("mv_users").doc(user.uid).get();
  console.log("In mv_users?", snap.exists);
  if (snap.exists) console.log(snap.data());
}
check().catch(console.error);
