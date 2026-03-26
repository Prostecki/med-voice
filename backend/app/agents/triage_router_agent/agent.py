"""
Triage Router Agent
===================
Takes a deviations list from the report explainer.
Returns: recommended specialist specialty + urgency level (LOW / MED / HIGH).
"""
from __future__ import annotations

from google.adk.agents.llm_agent import Agent

from app.tools.triage_tools import get_triage_routing
from app.tools.patient_tools import get_patient_context

TRIAGE_ROUTER_PROMPT = """\
You are the Triage Router sub-agent inside the Med-Voice system.

YOUR ONLY JOB
-------------
Given a list of clinical deviations, determine:
1. The most appropriate medical specialty to refer the patient to.
2. The urgency level: LOW | MED | HIGH.

URGENCY DEFINITIONS
-------------------
LOW  — Routine follow-up; no immediate risk.
MED  — Should see a doctor within a week.
HIGH — Requires urgent medical attention (within 24–48 h). Inform the patient clearly.

RULES
-----
1. Call get_triage_routing(report_type, deviations) to get the initial specialty + urgency.
2. If urgency is HIGH, say clearly:
   "Based on your results, I strongly recommend seeing a specialist within the next 24–48 hours."
3. Briefly explain WHY that specialist is the right choice (1–2 sentences max, plain language).
4. NEVER diagnose. NEVER speculate beyond the deviations provided.
5. Return structured output:
   - recommended_specialty : str
   - urgency : "LOW" | "MED" | "HIGH"
   - reasoning : str  (plain, 1–2 sentences)
6. VERBAL FEEDBACK: Before calling get_triage_routing, say "Let me check the best way to move forward with these results..." to keep the conversation going.
"""

triage_router_agent = Agent(
    model="gemini-live-2.5-flash-native-audio",
    name="triage_router_agent",
    description=(
        "Evaluates clinical deviations and recommends the appropriate specialist "
        "with urgency level LOW / MED / HIGH."
    ),
    instruction=TRIAGE_ROUTER_PROMPT,
    tools=[get_triage_routing, get_patient_context],
)
