# Python Layer Implementation Instructions

## Overview

Node.js is now sending DOM events in the correct format, but Python needs to transform them from Node.js format to `RecordingSession` format for timeline analysis and RAG context building.

---

## What Node.js Sends

```json
{
  "text": "Transcribed text from Deepgram",
  "domEvents": [
    {
      "type": "click",
      "target": "button#submit",
      "timestamp": 1765169845000,
      "x": 450,
      "y": 320,
      "url": "https://airbnb.com",
      "viewport": { "width": 1920, "height": 1080 }
    }
  ],
  "deepgramResponse": {
    "text": "...",
    "timeline": [...],
    "metadata": {...},
    "raw": {...}
  },
  "metadata": {
    "sessionId": "session_1766127973297_kxan6un",
    "url": "https://airbnb.com",
    "viewport": { "width": 1920, "height": 1080 },
    "startTime": 1766127973297,
    "endTime": 1766128033297,
    "timestamp": "2025-12-19T07:36:13.297Z"
  },
  "recordingsPath": "D:\\Code\\FullStack\\Clueso_Node_layer\\recordings"
}
```

---

## What Python Services Need

```python
RecordingSession(
    sessionId="session_1766127973297_kxan6un",
    events=[
        {
            "type": "click",
            "timestamp": 0.0,              # ← Seconds from start (not milliseconds!)
            "target": "button#submit",
            "elementType": "button",       # ← Extracted from target
            "text": "",
            "value": "",
            "description": "User clicks button#submit",  # ← Generated
            "x": 450,
            "y": 320
        }
    ]
)
```

---

## Required Transformations

| Field | Node.js → Python | Transformation |
|-------|------------------|----------------|
| `timestamp` | `1765169845000` → `0.0` | Divide by 1000, make relative to start |
| `elementType` | Not provided → `"button"` | Extract from `target` selector |
| `description` | Not provided → `"User clicks button#submit"` | Generate from type + target |

---

## Implementation Steps

### Step 1: Create Event Converter Utility

**File:** `app/utils/event_converter.py`

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
        dom_events: Events from Node.js (timestamps in milliseconds)
        session_id: Session ID (generated if not provided)
        start_time: Reference time in milliseconds
        
    Returns:
        RecordingSession object ready for services
    """
    
    # Generate session ID if not provided
    if not session_id:
        session_id = f"session_{int(datetime.now().timestamp() * 1000)}"
    
    # Get base time from first event or use provided start_time
    base_time = start_time or (dom_events[0].get("timestamp", 0) if dom_events else 0)
    
    # Convert events
    converted_events = []
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
    timestamp_s = (timestamp_ms - base_time) / 1000  # Convert to seconds
    
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

### Step 2: Update `/audio-full-process` Endpoint

**File:** `app/routes/audio_routes.py` (or wherever your endpoint is)

```python
from fastapi import FastAPI, Request, HTTPException
from app.utils.event_converter import convert_node_events_to_session
from app.services.script_generation_service import generate_product_script
import logging

logger = logging.getLogger(__name__)

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
        
        logger.info(f"[Audio Process] Received {len(dom_events)} DOM events for session: {session_id}")
        
        # ✅ Convert Node.js events to RecordingSession format
        session = None
        if dom_events:
            session = convert_node_events_to_session(
                dom_events=dom_events,
                session_id=session_id,
                start_time=metadata.get("startTime")
            )
            logger.info(f"[Audio Process] ✅ Converted to RecordingSession with {len(session.events)} events")
        else:
            logger.warning("[Audio Process] ⚠️  No DOM events provided")
        
        # Extract word timings from Deepgram
        word_timings = _extract_word_timings(deepgram_response)
        
        # ✅ Pass session to services (FIXED!)
        script_result = generate_product_script(
            raw_text=transcript,
            word_timings=word_timings,
            session=session  # ← NOW PROVIDED with transformed events
        )
        
        logger.info("[Audio Process] ✅ Script generation complete")
        
        return {
            "success": True,
            "script": script_result,
            "session_id": session_id
        }
        
    except Exception as e:
        logger.error(f"[Audio Process] ❌ Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


def _extract_word_timings(deepgram_response):
    """Extract word-level timing from Deepgram response."""
    if not deepgram_response:
        return []
    
    # Deepgram response structure from Node.js:
    # {
    #   "text": "...",
    #   "timeline": [...],
    #   "metadata": {...},
    #   "raw": {...}
    # }
    
    # Extract from timeline or raw response
    timeline = deepgram_response.get("timeline", [])
    
    # Convert timeline to word timings if needed
    word_timings = []
    for segment in timeline:
        if segment.get("type") == "speech":
            word_timings.append({
                "word": segment.get("text", ""),
                "start": segment.get("start", 0),
                "end": segment.get("end", 0)
            })
    
    return word_timings
```

---

## Expected Logs After Implementation

### Before (Current - Broken):
```
[Script Generation] Step 2/5: Analyzing event timeline...
[Script Generation]   ⚠️  No session data for timeline analysis

[Script Generation] Step 3/5: Building RAG context from DOM events...
[Script Generation]   ⚠️  No DOM events available, skipping RAG context
```

### After (Fixed):
```
[Audio Process] Received 37 DOM events for session: session_1766127973297_kxan6un
[Audio Process] ✅ Converted to RecordingSession with 37 events
[Script Generation] Step 2/5: Analyzing event timeline...
[Script Generation]   ✅ Found 37 events spanning 25.5 seconds
[Script Generation]   ✅ Timeline analysis complete

[Script Generation] Step 3/5: Building RAG context from DOM events...
[Script Generation]   ✅ Built RAG context from 37 DOM events
[Script Generation]   ✅ Context includes URL: https://airbnb.com
```

---

## Testing

### Test 1: Verify Conversion

```python
# Test the converter
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

# Expected Output:
# Session ID: test_session
# Events: 2
#   - User clicks button#signup at 0.0s
#   - User enters text in input#email at 1.0s
```

### Test 2: End-to-End

1. Start Python server
2. Node.js will send recording data
3. Check Python logs for success messages
4. Verify no warnings about missing session data

---

## Checklist

- [ ] Create `app/utils/event_converter.py`
- [ ] Update `/audio-full-process` endpoint
- [ ] Import `convert_node_events_to_session` in endpoint
- [ ] Pass `session` to `generate_product_script()`
- [ ] Test with sample data
- [ ] Verify logs show success (not warnings)
- [ ] Verify AI-generated instructions appear in frontend

---

## Summary

**What Changed:**
- Python now transforms Node.js events into `RecordingSession` format
- Timestamps converted from milliseconds to seconds (relative to start)
- Element types extracted from CSS selectors
- Human-readable descriptions generated

**What Stays the Same:**
- Node.js continues sending raw Chrome extension events
- No changes to Node.js event structure required
- Deepgram integration unchanged

**Result:**
- Timeline analysis works ✅
- RAG context building works ✅
- AI-generated instructions based on actual user actions ✅
