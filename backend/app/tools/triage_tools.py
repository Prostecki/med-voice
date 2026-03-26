"""
Triage tools: route patient to the appropriate medical specialty.
"""
from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

# Mapping of known report markers / conditions to recommended specialty
_SPECIALTY_MAP: dict[str, str] = {
    # Cardiology
    "troponin": "cardiologist",
    "ecg": "cardiologist",
    "bnp": "cardiologist",
    "qt_interval": "cardiologist",
    # Endocrinology
    "glucose": "endocrinologist",
    "hba1c": "endocrinologist",
    "tsh": "endocrinologist",
    "t4": "endocrinologist",
    # Hematology
    "hemoglobin": "hematologist",
    "wbc": "hematologist",
    "platelet": "hematologist",
    # Nephrology
    "creatinine": "nephrologist",
    "gfr": "nephrologist",
    "urea": "nephrologist",
    # Hepatology
    "alt": "hepatologist",
    "ast": "hepatologist",
    "bilirubin": "hepatologist",
    # General / fallback
    "default": "general practitioner",
}


def get_triage_routing(
    report_type: str,
    deviations: list[dict[str, Any]],
) -> dict[str, Any]:
    """
    Determine the appropriate specialist based on report type and deviations.

    Args:
        report_type: Type of report ("lab", "ecg", "imaging", etc.)
        deviations:  List of deviation dicts from get_report().

    Returns:
        A dict with keys:
          - recommended_specialty (str)
          - reasoning (str)              # short plain-text explanation
          - urgency (str)                # "routine" | "urgent" | "emergency"
    """
    if report_type.lower() == "ecg":
        specialty = "cardiologist"
        reasoning = "ECG results should always be reviewed by a cardiologist."
    else:
        specialty = _SPECIALTY_MAP["default"]
        reasoning = "Based on your results, a general check-up is recommended."

        for deviation in deviations:
            marker_key = deviation.get("marker", "").lower().replace(" ", "_")
            if marker_key in _SPECIALTY_MAP:
                specialty = _SPECIALTY_MAP[marker_key]
                reasoning = (
                    f"Your {deviation.get('marker', 'marker')} level is outside "
                    f"the reference range. A {specialty} would be the right specialist."
                )
                break  # Take first matched specialty; could be extended

    # Urgency based on critical flags
    has_critical = any(
        d.get("severity", "").lower() in {"critical", "danger", "high-risk"}
        for d in deviations
    )
    urgency = "urgent" if has_critical else "routine"

    return {
        "recommended_specialty": specialty,
        "reasoning": reasoning,
        "urgency": urgency,
    }
