"""
Report Explainer Agent
======================
Receives extracted report text + structured values.
Produces a patient-friendly explanation and a structured deviations list.

Contract
--------
Input  (via conversation):
  - report_type : str  — "lab" | "ecg" | "imaging"
  - extracted_text : str  — raw text from PDF/OCR
  - structured_values : dict  — {marker: value} optional pre-parsed values

Output (returned in conversation):
  - summary_plain : str  — plain-language summary for the patient
  - deviations : list[dict] — each with keys:
      marker, value, reference_range, severity, plain_text
"""
from __future__ import annotations

from google.adk.agents.llm_agent import Agent

from app.tools.report_tools import get_report
from app.tools.patient_tools import get_patient_context

REPORT_EXPLAINER_PROMPT = """\
You are the Report Explainer sub-agent inside the Med-Voice system.

YOUR ONLY JOB
-------------
Given a clinical report (lab or ECG), translate it into simple, empathetic
language that a non-medical patient can fully understand.

RULES
-----
1. Fetch the report using get_report(report_id).
2. Use the "summary_plain" field as the base.
3. For **each deviation**:
   - State the marker name in plain language (e.g. "haemoglobin" → "red blood cell count").
   - Say whether it is LOW or HIGH, and by how much roughly.
   - Give a one-sentence real-life meaning (e.g. "This can sometimes cause fatigue.").
   - Quote its plain_text field if available.
4. Group critical markers first, then moderate, then mild.
5. End with a reassuring closing sentence that sets expectations.
6. NEVER use medical jargon without immediate plain-language translation.
7. NEVER diagnose or speculate beyond the data.
8. NEVER attempt to delegate or transfer control to other agents. Your task ends when you have provided the explanation for the report.
9. ALWAYS add: "This information is to help you talk to your doctor — not a medical conclusion."
10. VERBAL FEEDBACK: When starting, just say "Okay, let's look at that report..." or "I've got the results here." Don't repeat what the user just said (e.g., dont say "Yes please").
11. Directness: Start explaining the data immediately after the brief acknowledgement.

OUTPUT FORMAT
-------------
Return in conversational prose, as if speaking to the patient over the phone.
"""

report_explainer_agent = Agent(
    model="gemini-live-2.5-flash-native-audio",
    name="report_explainer_agent",
    description=(
        "Explains clinical lab/ECG reports in plain, empathetic language. "
        "Input: report_id. Output: plain-language summary + deviations list."
    ),
    instruction=REPORT_EXPLAINER_PROMPT,
    tools=[get_report, get_patient_context],
)
