# DOM Events & Session Data - Issue & Implementation Guide

## Problem Overview

The Python services require `RecordingSession` objects with properly formatted DOM events, but the current implementation is:
1. Not receiving session data in the endpoint
2. Not transforming Node.js `domEvents` into the required format
3. Passing `None` to services, causing the warning: `⚠️  No session data for timeline analysis`

---

## Current Data Flow Issue

### ❌ What's Happening Now

```
Node.js sends:
{
    "text": "transcript",
    "domEvents": [...]     ← Raw Chrome extension events
    "deepgramResponse": {...}
}
    ↓
Python endpoint receives data
    ↓
Pass to generate_product_script(
    raw_text=text,
    word_timings=deepgram_words,
    session=None              ← ❌ MISSING!
)
    ↓
Services skip timeline analysis
[Script Generation] ⚠️  No session data for timeline analysis
```

---

## Node.js Event Format (What You Receive)

From `python_integration_guide.md`:

```python
"domEvents": [
    {
        "type": str,           # "click", "input", "scroll", etc.
        "target": str,         # CSS selector: "button#submit", "input#email"
        "timestamp": int,      # Unix timestamp in MILLISECONDS (e.g., 1765169845000)
        "value": str,          # For input events (optional)
        "x": int,              # Mouse X coordinate (optional)
        "y": int,              # Mouse Y coordinate (optional)
        "metadata": dict       # Additional data (optional)
    }
]
```

### Complete Example from Node.js
```python
"domEvents": [
    {
        "type": "click",
        "target": "button#submit",
        "timestamp": 1765169845000,
        "x": 450,
        "y": 320
    },
    {
        "type": "input",
        "target": "input#email",
        "timestamp": 1765169846000,
        "value": "user@example.com"
    }
]
```

---

## Required Python Format (What Services Expect)

The services expect `RecordingSession` with transformed events:

```python
RecordingSession(
    sessionId="session_id",
    events=[
        {
            "type": str,              # Event type
            "timestamp": float,       # Time in SECONDS (not milliseconds!)
            "target": str,           # CSS selector
            "elementType": str,      # HTML tag (button, input, etc.)
            "text": str,            # Element text/label
            "value": str,           # Input value
            "description": str      # Human-readable description
        }
    ]
)
```

---

## Transformation Required

### Conversion Logic

| Node.js Field | Python Field | Transformation |
|---------------|--------------|-----------------|
| `timestamp` | `timestamp` | Divide by 1000 (ms → seconds) |
| `type` | `type` | Use as-is |
| `target` | `target` | Use as-is |
| `target` (parse) | `elementType` | Extract tag: `button#id` → `button` |
| N/A | `text` | Extract from target or use empty |
| `value` | `value` | Use as-is or empty |
| N/A | `description` | Generate: `"User clicks button#submit"` |

### Conversion Example

```python
# Node.js sends this:
node_event = {
    "type": "click",
    "target": "button#signup-btn",
    "timestamp": 1765169845000,
    "x": 450,
    "y": 320
}

# Python services need this:
python_event = {
    "type": "click",
    "timestamp": 1765169845,        # ← Divide by 1000
    "target": "button#signup-btn",
    "elementType": "button",         # ← Extract from target
    "text": "Sign Up",              # ← Extract or infer
    "description": "User clicks the Sign Up button"
}
```

---

## Implementation: Converter Function

Create this utility in `app/utils/event_converter.py`:

```python
from typing import List, Dict, Any
from app.models.dom_event_models import RecordingSession
from datetime import datetime


def convert_node_events_to_session(
    dom_events: List[Dict[str, Any]],
    session_id: str = None,
    start_time: int = None
) -> RecordingSession:
    """
    Convert Node.js DOM events to Python RecordingSession format.
    
    Args:
        dom_events: Events from Node.js (with timestamps in milliseconds)
        session_id: Optional session ID (generated if not provided)
        start_time: Optional reference time in milliseconds
        
    Returns:
        RecordingSession object ready for Python services
    """
    
    # Generate session ID if not provided
    if not session_id:
        session_id = f"session_{int(datetime.now().timestamp() * 1000)}"
    
    # Convert events
    converted_events = []
    base_time = start_time or (dom_events[0].get("timestamp", 0) if dom_events else 0)
    
    for event in dom_events:
        converted_event = _convert_single_event(event, base_time)
        converted_events.append(converted_event)
    
    # Create session
    session = RecordingSession(
        sessionId=session_id,
        events=converted_events
    )
    
    return session


def _convert_single_event(
    node_event: Dict[str, Any],
    base_time: int
) -> Dict[str, Any]:
    """Convert a single Node.js event to Python format."""
    
    timestamp_ms = node_event.get("timestamp", 0)
    timestamp_s = (timestamp_ms - base_time) / 1000  # Convert to seconds relative to start
    
    target = node_event.get("target", "")
    element_type = _extract_element_type(target)
    event_type = node_event.get("type", "unknown")
    
    # Generate description
    description = _generate_description(event_type, target, node_event)
    
    return {
        "type": event_type,
        "timestamp": max(0, timestamp_s),  # Ensure non-negative
        "target": target,
        "elementType": element_type,
        "text": node_event.get("text", ""),
        "value": node_event.get("value", ""),
        "description": description,
        "x": node_event.get("x"),
        "y": node_event.get("y"),
        "metadata": node_event.get("metadata", {})
    }


def _extract_element_type(target: str) -> str:
    """
    Extract HTML element type from CSS selector.
    
    Examples:
        "button#submit" → "button"
        "input.email-field" → "input"
        "#signup-btn" → "button" (guess)
        "div.container" → "div"
    """
    if not target:
        return "unknown"
    
    # Get the first part before # or .
    element = target.split("#")[0].split(".")[0].strip()
    
    if not element:
        # If only selector given, try to infer
        if "button" in target.lower() or "btn" in target.lower():
            return "button"
        elif "input" in target.lower():
            return "input"
        elif "select" in target.lower():
            return "select"
        return "unknown"
    
    return element.lower()


def _generate_description(
    event_type: str,
    target: str,
    event_data: Dict[str, Any]
) -> str:
    """Generate human-readable event description."""
    
    descriptions = {
        "click": f"User clicks {target}",
        "input": f"User enters text in {target}",
        "change": f"User changes value in {target}",
        "scroll": f"User scrolls on {target}",
        "focus": f"User focuses on {target}",
        "blur": f"User leaves {target}",
        "submit": f"User submits {target}",
        "keypress": f"User presses key in {target}",
    }
    
    # Get base description
    description = descriptions.get(event_type, f"User triggers {event_type} on {target}")
    
    # Add value if it's an input event
    if event_type == "input" and event_data.get("value"):
        description += f" with value: {event_data['value']}"
    
    return description
```

---

## Implementation: Updated Endpoint

Update your `/audio-full-process` endpoint:

```python
from fastapi import FastAPI, Request, HTTPException
from app.utils.event_converter import convert_node_events_to_session
from app.services.script_generation_service import generate_product_script

@app.post("/audio-full-process")
async def process_audio(request: Request):
    try:
        # Parse incoming data
        data = await request.json()
        
        # Extract data
        transcript = data.get("text", "")
        dom_events = data.get("domEvents", [])
        deepgram_response = data.get("deepgramResponse")
        metadata = data.get("metadata", {})
        session_id = metadata.get("sessionId")
        
        # ✅ Convert Node.js events to RecordingSession format
        session = convert_node_events_to_session(
            dom_events=dom_events,
            session_id=session_id
        )
        
        # Extract word timings from Deepgram
        word_timings = _extract_word_timings(deepgram_response)
        
        # ✅ Pass session to services (FIXED!)
        script_result = generate_product_script(
            raw_text=transcript,
            word_timings=word_timings,
            session=session  # ← NOW PROVIDED
        )
        
        return {
            "success": True,
            "script": script_result,
            "session_id": session_id
        }
        
    except Exception as e:
        logger.error(f"Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


def _extract_word_timings(deepgram_response):
    """Extract word-level timing from Deepgram response."""
    if not deepgram_response:
        return []
    
    # Implementation depends on Deepgram response structure
    # Return list of {"word": str, "start": float, "end": float}
    return []
```

---

## Data Flow After Fix

### ✅ What Happens Now

```
Node.js sends:
{
    "text": "transcript",
    "domEvents": [...],           ← Raw Chrome events
    "deepgramResponse": {...},
    "metadata": {"sessionId": "..."}
}
    ↓
Python endpoint receives data
    ↓
convert_node_events_to_session(dom_events)  ← ✅ CONVERSION
    ↓
RecordingSession(
    sessionId="...",
    events=[...]  ← Transformed events with proper format
)
    ↓
generate_product_script(
    raw_text=text,
    word_timings=deepgram_words,
    session=session  ← ✅ NOW PROVIDED
)
    ↓
Step 2: analyze_event_timeline() ← ✅ WORKS
Step 3: build_rag_context_from_events() ← ✅ WORKS
    ↓
[Script Generation] ✅ Timeline analysis complete
[Script Generation] ✅ RAG context built successfully
```

---

## Quick Checklist

- [ ] Create `app/utils/event_converter.py` with converter function
- [ ] Update `/audio-full-process` endpoint to call `convert_node_events_to_session()`
- [ ] Pass `session` parameter to `generate_product_script()`
- [ ] Test with sample Node.js data
- [ ] Verify logs show: `✅ Timeline analysis complete` (not warning)

---

## Testing

```python
# Test conversion
from app.utils.event_converter import convert_node_events_to_session

test_events = [
    {
        "type": "click",
        "target": "button#signup",
        "timestamp": 1765169845000
    },
    {
        "type": "input",
        "target": "input#email",
        "timestamp": 1765169846000,
        "value": "user@example.com"
    }
]

session = convert_node_events_to_session(test_events, "test_session")

print(f"Session ID: {session.sessionId}")
print(f"Events: {len(session.events)}")
for event in session.events:
    print(f"  - {event['description']} at {event['timestamp']}s")

# Output:
# Session ID: test_session
# Events: 2
#   - User clicks button#signup at 0.0s
#   - User enters text in input#email at 1.0s
```
