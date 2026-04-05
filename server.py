import json
import asyncio
import queue
import threading
import sys
import subprocess
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from langchain_core.messages import AIMessage

from agent.graph import agent as compiled_graph, edit_agent as compiled_edit_graph, chat_agent as compiled_chat_graph
from agent.states import EditRequest

app = FastAPI(title="AI DevTeam Workspace")



async def event_stream(prompt: str):
    """Generator that streams SSE events from the LangGraph agent pipeline in real-time."""
    inputs = {"user_prompt": prompt}
    config = {"recursion_limit": 150}

    # Use a thread-safe queue to stream events from the sync graph to the async generator
    event_queue = queue.Queue()
    error_holder = [None]

    def run_graph():
        # Track files already sent via SSE to avoid re-sending the full
        # accumulated dict on every coder event
        sent_files = set()

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

                    # Extract current file being coded and generated files dict
                    if "coder_state" in state_update:
                        coder_state = state_update["coder_state"]
                        if hasattr(coder_state, "task_plan"):
                            current_idx = coder_state.current_step_idx
                            steps = coder_state.task_plan.implementation_steps
                            if current_idx > 0 and current_idx <= len(steps):
                                event_data["current_file"] = steps[current_idx - 1].filepath
                        
                        # Only send NEW files that haven't been sent in a previous event
                        # The generated_files dict accumulates across coder steps,
                        # so we filter to avoid duplicate writes on the Node server
                        if hasattr(coder_state, "generated_files") and coder_state.generated_files:
                            new_files = {k: v for k, v in coder_state.generated_files.items() if k not in sent_files}
                            if new_files:
                                event_data["generated_files"] = new_files
                                sent_files.update(new_files.keys())

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


async def edit_event_stream(filepath: str, existing_content: str, instruction: str):
    """Stream SSE events from the edit pipeline (Coder only, no Planner/Architect)."""
    inputs = {
        "edit_request": EditRequest(
            filepath=filepath,
            existing_content=existing_content,
            instruction=instruction,
        )
    }

    event_queue = queue.Queue()
    error_holder = [None]

    def run_edit():
        try:
            for output in compiled_edit_graph.stream(inputs, {"recursion_limit": 50}):
                for node_name, state_update in output.items():
                    event_data = {
                        "agent": "coder",
                        "status": "working",
                        "content": "",
                    }

                    if "messages" in state_update and state_update["messages"]:
                        latest_msg = state_update["messages"][-1]
                        if isinstance(latest_msg, AIMessage):
                            event_data["content"] = latest_msg.content

                    if "generated_files" in state_update:
                        event_data["generated_files"] = state_update["generated_files"]

                    if state_update.get("status") == "DONE":
                        event_data["status"] = "done"

                    event_queue.put(event_data)
        except Exception as e:
            error_holder[0] = str(e)
        finally:
            event_queue.put(None)

    thread = threading.Thread(target=run_edit, daemon=True)
    thread.start()

    while True:
        try:
            event_data = await asyncio.get_event_loop().run_in_executor(
                None, lambda: event_queue.get(timeout=0.5)
            )
        except queue.Empty:
            continue
        if event_data is None:
            break
        yield f"data: {json.dumps(event_data)}\n\n"

    if error_holder[0]:
        yield f"data: {json.dumps({'agent': 'system', 'status': 'error', 'content': f'Error: {error_holder[0]}'})}\n\n"

    yield f"data: {json.dumps({'agent': 'system', 'status': 'complete', 'content': 'Edit complete!'})}\n\n"


@app.post("/api/edit")
async def edit_file(request: Request):
    """Accept an edit request and stream the coder response (skips Planner/Architect)."""
    body = await request.json()
    filepath = body.get("filepath", "")
    existing_content = body.get("existingContent", "")
    instruction = body.get("instruction", "")

    if not filepath or not instruction:
        return {"error": "filepath and instruction are required"}

    return StreamingResponse(
        edit_event_stream(filepath, existing_content, instruction),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


async def chat_event_stream(message: str, file_context: dict = None, file_tree: str = None):
    """Stream SSE events from the chat pipeline (conversational Q&A)."""
    inputs = {
        "message": message,
        "file_context": file_context,
        "file_tree": file_tree,
    }

    event_queue = queue.Queue()
    error_holder = [None]

    def run_chat():
        try:
            for output in compiled_chat_graph.stream(inputs, {"recursion_limit": 10}):
                for node_name, state_update in output.items():
                    event_data = {
                        "agent": "assistant",
                        "status": "working",
                        "content": state_update.get("response", ""),
                    }

                    # Pass generated files for auto-apply (from smart code modification)
                    if "generated_files" in state_update:
                        event_data["generated_files"] = state_update["generated_files"]

                    event_queue.put(event_data)
        except Exception as e:
            error_holder[0] = str(e)
        finally:
            event_queue.put(None)

    thread = threading.Thread(target=run_chat, daemon=True)
    thread.start()

    while True:
        try:
            event_data = await asyncio.get_event_loop().run_in_executor(
                None, lambda: event_queue.get(timeout=0.5)
            )
        except queue.Empty:
            continue
        if event_data is None:
            break
        yield f"data: {json.dumps(event_data)}\n\n"

    if error_holder[0]:
        yield f"data: {json.dumps({'agent': 'system', 'status': 'error', 'content': f'Error: {error_holder[0]}'})}\n\n"

    yield f"data: {json.dumps({'agent': 'assistant', 'status': 'complete', 'content': ''})}\n\n"


@app.post("/api/chat")
async def chat(request: Request):
    """Conversational AI endpoint — answers questions, explains code, gives guidance."""
    body = await request.json()
    message = body.get("message", "")
    file_context = body.get("fileContext", None)
    file_tree = body.get("fileTree", None)

    if not message:
        return {"error": "No message provided"}

    return StreamingResponse(
        chat_event_stream(message, file_context, file_tree),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


class ExecuteRequest(BaseModel):
    code: str
    language: str = "python"
    extra_files: dict[str, str] = {}


@app.post("/api/execute")
async def execute_code(req: ExecuteRequest):
    """Execute user-submitted code in a subprocess and return the output."""
    import tempfile
    import os
    import shutil

    lang = req.language.lower().strip()
    code = req.code

    interpreted = {
        "python": {"ext": ".py", "cmd": lambda f: [sys.executable, f]},
        "javascript": {"ext": ".js", "cmd": lambda f: ["node", f]},
        "js": {"ext": ".js", "cmd": lambda f: ["node", f]},
        "node": {"ext": ".js", "cmd": lambda f: ["node", f]},
    }

    compiled_langs = {"cpp", "c++", "c", "java"}
    all_supported = list(interpreted.keys()) + list(compiled_langs)

    if lang not in interpreted and lang not in compiled_langs:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported language: '{lang}'. Supported: {', '.join(all_supported)}",
        )

    tmp_dir = None
    tmp_file = None

    try:
        if lang in interpreted:
            tmp_file = tempfile.NamedTemporaryFile(
                mode="w", suffix=interpreted[lang]["ext"], delete=False, encoding="utf-8",
            )
            tmp_file.write(code)
            tmp_file.close()

            result = subprocess.run(
                interpreted[lang]["cmd"](tmp_file.name),
                capture_output=True, text=True, timeout=10,
                cwd=tempfile.gettempdir(),
            )
            return {"stdout": result.stdout, "stderr": result.stderr, "exit_code": result.returncode}

        else:
            tmp_dir = tempfile.mkdtemp(prefix="coderun_")
            ext = ".cpp" if lang in ("cpp", "c++") else ".c" if lang == "c" else ".java"
            compiler = "g++" if lang in ("cpp", "c++") else "gcc" if lang == "c" else "javac"

            # Write extra files (headers, other sources)
            for fname, fcode in req.extra_files.items():
                basename = fname.split("/")[-1].split("\\")[-1]
                with open(os.path.join(tmp_dir, basename), "w", encoding="utf-8") as f:
                    f.write(fcode)

            # Write main file
            main_file = os.path.join(tmp_dir, f"main{ext}")
            with open(main_file, "w", encoding="utf-8") as f:
                f.write(code)

            # Gather source files
            if lang in ("cpp", "c++"):
                src_files = [os.path.join(tmp_dir, f) for f in os.listdir(tmp_dir) if f.endswith((".cpp", ".cc", ".cxx"))]
            elif lang == "c":
                src_files = [os.path.join(tmp_dir, f) for f in os.listdir(tmp_dir) if f.endswith(".c")]
            else:
                src_files = [main_file]

            out_name = os.path.join(tmp_dir, "program")
            if sys.platform == "win32":
                out_name += ".exe"

            compile_cmd = [compiler, main_file] if lang == "java" else [compiler] + src_files + ["-o", out_name]

            compile_result = subprocess.run(
                compile_cmd, capture_output=True, text=True, timeout=15, cwd=tmp_dir,
            )
            if compile_result.returncode != 0:
                return {"stdout": "", "stderr": f"Compilation failed:\n{compile_result.stderr}", "exit_code": compile_result.returncode}

            if lang == "java":
                run_cmd = ["java", "-cp", tmp_dir, os.path.splitext(os.path.basename(main_file))[0]]
            else:
                run_cmd = [out_name]

            result = subprocess.run(run_cmd, capture_output=True, text=True, timeout=10, cwd=tmp_dir)
            return {"stdout": result.stdout, "stderr": result.stderr, "exit_code": result.returncode}

    except subprocess.TimeoutExpired:
        return {"stdout": "", "stderr": "⏱️ Execution timed out (10 second limit exceeded).", "exit_code": -1}
    except FileNotFoundError as e:
        raise HTTPException(status_code=500, detail=f"Runtime/compiler not found for '{lang}'. ({e})")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Execution error: {str(e)}")
    finally:
        if tmp_file and os.path.exists(tmp_file.name):
            os.unlink(tmp_file.name)
        if tmp_dir and os.path.exists(tmp_dir):
            shutil.rmtree(tmp_dir, ignore_errors=True)



if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
