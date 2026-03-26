#!/usr/bin/env python3
"""Seed provider profiles and appointment slots for Med-Voice."""

from __future__ import annotations

import argparse
import os
import random
import uuid
from datetime import datetime, timedelta, timezone

from google.cloud import firestore

DATABASE_ID = "med-voice-db"

PROVIDERS = [
    {"name": "Dr. Sarah Thompson", "specialty": "cardiologist"},
    {"name": "Dr. Mark Ellis", "specialty": "cardiologist"},
    {"name": "Dr. Anna Fischer", "specialty": "endocrinologist"},
    {"name": "Dr. David Klein", "specialty": "endocrinologist"},
    {"name": "Dr. Anders Svensson", "specialty": "general practitioner"},
    {"name": "Dr. Maria Lopez", "specialty": "general practitioner"},
    {"name": "Dr. Elena Rossi", "specialty": "hematologist"},
    {"name": "Dr. John Miller", "specialty": "hematologist"},
    {"name": "Dr. Yuki Tanaka", "specialty": "nephrologist"},
    {"name": "Dr. Liam O'Connor", "specialty": "nephrologist"},
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed providers and free slots into Firestore.")
    parser.add_argument("--project", default=os.environ.get("GOOGLE_CLOUD_PROJECT", "sm-gemini-playground"))
    parser.add_argument("--clinic-id", default="")
    parser.add_argument("--days", type=int, default=21)
    parser.add_argument("--slots-per-provider", type=int, default=2)
    return parser.parse_args()


def first_clinic_id(db: firestore.Client) -> str:
    docs = list(db.collection("mv_clinics").limit(1).stream())
    if not docs:
        raise RuntimeError("No clinic found in mv_clinics. Seed the clinic first.")
    return docs[0].id


def seed_provider_docs(db: firestore.Client, clinic_id: str) -> None:
    for provider in PROVIDERS:
        provider_id = f"{provider['specialty'].replace(' ', '-')}-{provider['name'].lower().replace(' ', '-')}"
        db.collection("mv_providers").document(provider_id).set(
            {
                "providerId": provider_id,
                "clinicId": clinic_id,
                "displayName": provider["name"],
                "specialty": provider["specialty"],
                "active": True,
                "createdAt": datetime.now(timezone.utc).isoformat(),
            },
            merge=True,
        )


def slot_times(day_start: datetime, slots_per_provider: int) -> list[datetime]:
    possible_hours = [9, 10, 11, 13, 14, 15, 16]
    picks = random.sample(possible_hours, k=min(slots_per_provider, len(possible_hours)))
    return [day_start.replace(hour=hour, minute=random.choice([0, 30]), second=0, microsecond=0) for hour in picks]


def seed_slots(db: firestore.Client, clinic_id: str, days: int, slots_per_provider: int) -> int:
    total = 0
    now = datetime.now(timezone.utc)
    for offset in range(days):
        day = now + timedelta(days=offset)
        if day.weekday() >= 5:
            continue

        for provider in PROVIDERS:
            for start in slot_times(day, slots_per_provider):
                end = start + timedelta(minutes=30)
                slot_id = str(uuid.uuid4())
                db.collection("mv_availability").document(clinic_id).collection("slots").document(slot_id).set(
                    {
                        "slotId": slot_id,
                        "clinicId": clinic_id,
                        "specialty": provider["specialty"],
                        "providerName": provider["name"],
                        "slotStart": start.isoformat(),
                        "slotEnd": end.isoformat(),
                        "isBooked": False,
                        "createdAt": now.isoformat(),
                    },
                    merge=True,
                )
                total += 1
    return total


def main() -> None:
    args = parse_args()
    db = firestore.Client(project=args.project, database=DATABASE_ID)
    clinic_id = args.clinic_id or first_clinic_id(db)

    print(f"Seeding providers and slots for clinic {clinic_id} in project {args.project}")
    seed_provider_docs(db, clinic_id)
    total_slots = seed_slots(db, clinic_id, args.days, args.slots_per_provider)
    print(f"Seeded {len(PROVIDERS)} providers and {total_slots} free slots.")


if __name__ == "__main__":
    main()
