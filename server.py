import json
import asyncio
import queue
import threading
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, StreamingResponse
from pathlib import Path
from langchain_core.messages import AIMessage

from agent.graph import agent as compiled_graph

app = FastAPI(title="AI DevTeam Workspace")

# Serve static files (frontend)
STATIC_DIR = Path(__file__).parent / "static"
STATIC_DIR.mkdir(exist_ok=True)


@app.get("/", response_class=HTMLResponse)
async def index():
    """Serve the main HTML page."""
    index_file = STATIC_DIR / "index.html"
    return index_file.read_text(encoding="utf-8")


async def event_stream(prompt: str):
    """Generator that streams SSE events from the LangGraph agent pipeline in real-time."""
    inputs = {"user_prompt": prompt}
    config = {"recursion_limit": 150}

    # Use a thread-safe queue to stream events from the sync graph to the async generator
    event_queue = queue.Queue()
    error_holder = [None]

    def run_graph():
        try:
            for output in compiled_graph.stream(inputs, config):
                for node_name, state_update in output.items():
                    agent_name = node_name.lower()

                    event_data = {
                        "agent": agent_name,
                        "status": "working",
                        "content": "",
                        "files": [],
                    }

                    # Extract message content
                    if "messages" in state_update and state_update["messages"]:
                        latest_msg = state_update["messages"][-1]
                        if isinstance(latest_msg, AIMessage):
                            event_data["content"] = latest_msg.content

                    # Extract plan info for planner
                    if agent_name == "planner" and "plan" in state_update:
                        plan = state_update["plan"]
                        event_data["plan"] = {
                            "name": plan.name,
                            "description": plan.description,
                            "techstack": plan.techstack,
                            "features": plan.features,
                            "files": [{"path": f.path, "purpose": f.purpose} for f in plan.files],
                        }

                    # Extract task plan for architect
                    if agent_name == "architect" and "task_plan" in state_update:
                        task_plan = state_update["task_plan"]
                        event_data["task_plan"] = {
                            "steps": [
                                {"filepath": s.filepath, "task": s.task_description}
                                for s in task_plan.implementation_steps
                            ]
                        }

                    # Check if coder is done
                    if "status" in state_update and state_update["status"] == "DONE":
                        event_data["status"] = "done"

                    # Extract current file being coded
                    if "coder_state" in state_update:
                        coder_state = state_update["coder_state"]
                        if hasattr(coder_state, "task_plan"):
                            current_idx = coder_state.current_step_idx
                            steps = coder_state.task_plan.implementation_steps
                            if current_idx > 0 and current_idx <= len(steps):
                                event_data["current_file"] = steps[current_idx - 1].filepath

                    event_queue.put(event_data)
        except Exception as e:
            error_holder[0] = str(e)
        finally:
            event_queue.put(None)  # Sentinel to signal completion

    # Start graph in background thread
    thread = threading.Thread(target=run_graph, daemon=True)
    thread.start()

    # Yield events as they arrive from the queue
    while True:
        try:
            # Check queue with short timeout to keep the async generator responsive
            event_data = await asyncio.get_event_loop().run_in_executor(
                None, lambda: event_queue.get(timeout=0.5)
            )
        except queue.Empty:
            continue

        if event_data is None:
            break

        yield f"data: {json.dumps(event_data)}\n\n"

    # Send error if any
    if error_holder[0]:
        yield f"data: {json.dumps({'agent': 'system', 'status': 'error', 'content': f'Error: {error_holder[0]}'})}\n\n"

    # Send completion event
    yield f"data: {json.dumps({'agent': 'system', 'status': 'complete', 'content': 'All agents have finished!'})}\n\n"


@app.post("/api/generate")
async def generate(request: Request):
    """Accept a prompt and stream agent responses as SSE."""
    body = await request.json()
    prompt = body.get("prompt", "")

    if not prompt:
        return {"error": "No prompt provided"}

    return StreamingResponse(
        event_stream(prompt),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# Mount static files AFTER defining routes so "/" isn't overridden
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
