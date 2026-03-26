import sys
import os
import json
from unittest.mock import MagicMock, patch

# Mock missing dependencies for environment-independent testing
mock_google = MagicMock()
sys.modules["google"] = mock_google
sys.modules["google.adk"] = mock_google.adk
sys.modules["google.adk.agents"] = mock_google.adk.agents
sys.modules["google.adk.agents.llm_agent"] = mock_google.adk.agents.llm_agent
sys.modules["google.adk.runners"] = mock_google.adk.runners
sys.modules["google.adk.sessions"] = mock_google.adk.sessions
sys.modules["google.adk.sessions.in_memory_session_service"] = mock_google.adk.sessions.in_memory_session_service
sys.modules["google.adk.agents.live_request_queue"] = mock_google.adk.agents.live_request_queue
sys.modules["google.adk.agents.run_config"] = mock_google.adk.agents.run_config

sys.modules["google.genai"] = mock_google.genai
sys.modules["google.genai.types"] = mock_google.genai.types
sys.modules["google.cloud"] = mock_google.cloud
sys.modules["google.cloud.firestore"] = mock_google.cloud.firestore
sys.modules["google.cloud.storage"] = mock_google.cloud.storage

mock_fastapi = MagicMock()
sys.modules["fastapi"] = mock_fastapi
sys.modules["fastapi.middleware"] = mock_fastapi.middleware
sys.modules["fastapi.middleware.cors"] = mock_fastapi.middleware.cors
mock_pydantic = MagicMock()
sys.modules["pydantic"] = mock_pydantic
sys.modules["pydantic.alias_generators"] = mock_pydantic.alias_generators
sys.modules["dotenv"] = MagicMock()

# Add backend to path
sys.path.append(os.path.join(os.path.dirname(__file__), "..", "backend"))

def test_analyze_report_logic():
    print("Testing analyze_report logic...")
    # Import inside because of sys.modules manipulation
    from app.tools.report_tools import analyze_report
    
    # Mock Firestore and GenAI
    with patch("app.services.firestore_service.FirestoreService") as mock_fs, \
         patch("google.genai.Client") as mock_genai:
        
        # Setup mock report in Firestore
        mock_db = MagicMock()
        mock_db.get_report.return_value = {
            "reportId": "test-123",
            "patientId": "p-123",
            "gcsPath": "gs://bucket/test.pdf",
            "contentType": "application/pdf"
        }
        mock_fs.return_value = mock_db
        
        # Setup mock Gemini response
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.text = json.dumps({
            "summaryPlain": "Everything looks okay.",
            "markers": [{"marker": "Hemoglobin", "value": "14.0", "unit": "g/dL", "range": "12-16", "severity": "normal"}],
            "deviations": [],
            "recommendedSpecialty": "general practitioner"
        })
        mock_client.models.generate_content.return_value = mock_response
        mock_genai.return_value = mock_client
        
        # Run analysis
        result = analyze_report("test-123")
        
        # Verifications
        assert result["summaryPlain"] == "Everything looks okay."
        assert len(result["markers"]) == 1
        mock_db.save_report.assert_called()
        print("✓ analyze_report logic validated (mocked dependencies)")

def test_server_structure():
    print("Testing server endpoint registration...")
    # This just ensures the server module can be imported and the new endpoint is defined
    from app.agents.med_voice_agent.server import app, ProcessReportRequest
    
    # Check if the endpoint is in the routes
    routes = [r.path for r in app.routes if hasattr(r, 'path')]
    assert "/api/reports/process" in routes
    print("✓ /api/reports/process endpoint registration validated")

if __name__ == "__main__":
    try:
        # Set some env vars for imports to work
        os.environ["GOOGLE_CLOUD_PROJECT"] = "test-project"
        os.environ["REPORTS_BUCKET"] = "test-bucket"
        
        test_analyze_report_logic()
        test_server_structure()
        print("\nAll logical verifications passed!")
    except Exception as e:
        print(f"\nVerification failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
