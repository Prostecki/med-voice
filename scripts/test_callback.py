import json
import sys
import urllib.request
import urllib.error

def test_callback_trigger(call_id, backend_url="http://localhost:8000"):
    """
    Manually triggers the callback endpoint on a local or remote server using urllib (zero dependencies).
    """
    url = f"{backend_url.rstrip('/')}/api/callbacks/trigger"
    payload = json.dumps({"call_id": call_id}).encode("utf-8")
    
    print(f"Sending trigger for call_id: {call_id} to {url}...")
    
    req = urllib.request.Request(url, data=payload, method="POST")
    req.add_header("Content-Type", "application/json")
    
    try:
        with urllib.request.urlopen(req) as response:
            res_data = response.read().decode("utf-8")
            print("Success!")
            print(json.dumps(json.loads(res_data), indent=2))
    except urllib.error.HTTPError as e:
        print(f"HTTP Error: {e.code}")
        print(e.read().decode("utf-8"))
    except Exception as e:
        print(f"Failed to connect to backend: {e}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python scripts/test_callback.py <call_id> [backend_url]")
        print("Example: python scripts/test_callback.py test-call-123 http://localhost:8000")
        sys.exit(1)
        
    call_id = sys.argv[1]
    backend_url = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:8000"
    
    test_callback_trigger(call_id, backend_url)
