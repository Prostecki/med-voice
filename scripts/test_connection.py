
import os
import sys

# Add backend to path
sys.path.append(os.path.abspath("../backend"))

# Set env manually
os.environ["GOOGLE_CLOUD_PROJECT"] = "sm-gemini-playground"

from app.services.firestore_service import FirestoreService

def test():
    svc = FirestoreService()
    print(f"Testing connection to project: {os.environ.get('GOOGLE_CLOUD_PROJECT')}")
    if svc._db:
        print("Firestore client initialized.")
        try:
            # Try to list users in the named database med-voice-db
            users = svc._db.collection("mv_users").limit(1).get()
            print(f"Successfully connected to med-voice-db.")
            print(f"Number of users found: {len(users)}")
            for u in users:
                print(f"Found user: {u.id}, clinicId: {u.to_dict().get('clinicId')}")
        except Exception as e:
            print(f"Error fetching data: {e}")
    else:
        print("Firestore client NOT initialized.")

if __name__ == "__main__":
    test()
