from dotenv import load_dotenv
from langchain_core.globals import set_verbose, set_debug
from langchain_core.messages import AIMessage
from langchain_groq.chat_models import ChatGroq
from langgraph.constants import END
from langgraph.graph import StateGraph
import re

from agent.prompts import *
from agent.states import *

_ = load_dotenv()

set_debug(True)
set_verbose(True)

# Dual models: powerful for code generation, fast for chat/Q&A
llm_code = ChatGroq(model="llama-3.3-70b-versatile")  # Code gen, planning, architecture
llm_chat = ChatGroq(model="llama-3.1-8b-instant")     # Fast conversational responses


def planner_agent(state: dict) -> dict:
    """Converts user prompt into a structured Plan."""
    user_prompt = state["user_prompt"]

    resp = llm_code.with_structured_output(Plan, method="json_mode").invoke(
        planner_prompt(user_prompt)
    )
    
    if resp is None:
        raise ValueError("Planner did not return a valid response.")
    
    # Don't force techstack — let the Planner decide based on the prompt
    
    # Clean file paths — remove directory prefixes
    for f in resp.files:
        f.path = f.path.split("/")[-1]  # Keep only filename
    
    # Ensure at least one file exists
    if not resp.files:
        resp.files.append(File(path="main.py", purpose="Main program file"))
    
    chat_msg = f"**Project Plan Created!**\n\nI have structured the plan. Passing it to the Architect..."
    
    return {"plan": resp, "messages": [AIMessage(content=chat_msg, name="planner")]}

def architect_agent(state: dict) -> dict:
    """Creates TaskPlan from Plan."""
    plan: Plan = state["plan"]

    resp = llm_code.with_structured_output(TaskPlan, method="json_mode").invoke(
        architect_prompt(plan=plan.model_dump_json())
    )
    
    if resp is None:
        raise ValueError("Architect did not return a valid response.")

    resp.plan = plan
    
    # Clean file paths — remove directory prefixes
    for step in resp.implementation_steps:
        step.filepath = step.filepath.split("/")[-1]  # Keep only filename
    
    chat_msg = f"**Architecture Ready!**\n\nI have broken the plan down into `{len(resp.implementation_steps)}` distinct implementation steps. The Coder will now begin generating the files."
    
    return {"task_plan": resp, "messages": [AIMessage(content=chat_msg, name="architect")]}

def coder_agent(state: dict) -> dict:
    """Generates code directly as text output without file system tools."""
    coder_state: CoderState = state.get("coder_state")
    
    if coder_state is None:
        coder_state = CoderState(task_plan=state["task_plan"], current_step_idx=0)

    steps = coder_state.task_plan.implementation_steps
    if coder_state.current_step_idx >= len(steps):
        final_msg = "✅ **All tasks completed!** You can copy the code blocks above."
        return {"coder_state": coder_state, "status": "DONE", "messages": [AIMessage(content=final_msg, name="coder")]}

    current_task = steps[coder_state.current_step_idx]

    system_prompt = coder_system_prompt()
    
    # Build context from previously generated files
    context_parts = []
    if coder_state.generated_files:
        context_parts.append("PREVIOUSLY GENERATED FILES (you MUST match these IDs, classes, and function names exactly):\n")
        for filepath, code in coder_state.generated_files.items():
            context_parts.append(f"--- {filepath} ---\n{code}\n")
    
    context_str = "\n".join(context_parts)
    
    # Prompt includes explicit instructions
    user_prompt = (
        f"Task: {current_task.task_description}\n"
        f"File: {current_task.filepath}\n\n"
        f"{context_str}\n"
        f"Generate the complete code for this file.\n"
        f"Start with: ### `{current_task.filepath}`\n"
        f"Then write a single code block with the FULL file contents.\n\n"
        f"CRITICAL REQUIREMENTS:\n"
        f"1. The code must be FULLY FUNCTIONAL — it must work perfectly on the FIRST try with zero bugs.\n"
        f"2. For web projects: the UI must look PREMIUM and MODERN:\n"
        f"   - Use a dark gradient background (e.g., #0d1117 → #1a1a2e)\n"
        f"   - Import Google Fonts via @import (use 'Poppins' or 'Inter')\n"
        f"   - Use CSS Grid or Flexbox for layout, center everything properly\n"
        f"   - Add border-radius: 12-16px, box-shadow, smooth transitions\n"
        f"   - Buttons need hover effects (scale, color change) and active states\n"
        f"   - Use linear-gradient for button/accent colors — NOT flat solid colors\n"
        f"3. For interactive apps (calculator, game, dashboard):\n"
        f"   - Build the UI like a real app — use proper display/output areas, NOT raw input fields\n"
        f"   - Use event delegation or loops for repetitive elements — NOT individual addEventListener per element\n"
        f"   - Handle all edge cases (division by zero, empty input, etc.)\n"
        f"4. For console programs (Python, C, C++, Java):\n"
        f"   - Include proper error handling, clear user prompts, and formatted output\n"
        f"   - Use proper main function/entry point\n"
        f"5. NO placeholder code, NO truncation, NO '// rest of code' comments. Write EVERY single line.\n"
    )

    # Directly invoke the LLM
    response = llm_code.invoke([
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt}
    ])

    # Extract the generated code — try multiple patterns
    code = None
    # Pattern 1: standard fenced code block
    code_match = re.search(r'```\w*\s*\n([\s\S]*?)```', response.content)
    if code_match:
        code = code_match.group(1).strip()
    # Pattern 2: code block without language specifier
    if not code:
        code_match = re.search(r'```([\s\S]*?)```', response.content)
        if code_match:
            code = code_match.group(1).strip()
    # Pattern 3: if no code block found, use entire response (strip markdown headers)
    if not code:
        code = re.sub(r'^###.*\n', '', response.content).strip()

    if code:
        coder_state.generated_files[current_task.filepath] = code

    coder_state.current_step_idx += 1
    
    return {
        "coder_state": coder_state, 
        "messages": [AIMessage(content=response.content, name="coder")]
    }


def edit_coder_agent(state: dict) -> dict:
    """Handles editing an existing file — skips Planner & Architect."""
    edit_request = state["edit_request"]
    
    system_prompt = coder_system_prompt()
    user_prompt = coder_edit_prompt(
        filepath=edit_request.filepath,
        existing_content=edit_request.existing_content,
        instruction=edit_request.instruction,
    )
    
    response = llm_code.invoke([
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt}
    ])
    
    # Extract code from the response
    code_match = re.search(r'```\w*\s*\n([\s\S]*?)```', response.content)
    generated_files = {}
    if code_match:
        generated_files[edit_request.filepath] = code_match.group(1).strip()
    
    return {
        "generated_files": generated_files,
        "status": "DONE",
        "messages": [AIMessage(content=response.content, name="coder")]
    }


# ── Generate Mode Graph (Planner → Architect → Coder loop) ──
graph = StateGraph(dict)

graph.add_node("planner", planner_agent)
graph.add_node("architect", architect_agent)
graph.add_node("coder", coder_agent)

graph.add_edge("planner", "architect")
graph.add_edge("architect", "coder")
graph.add_conditional_edges(
    "coder",
    lambda s: "END" if s.get("status") == "DONE" else "coder",
    {"END": END, "coder": "coder"}
)

graph.set_entry_point("planner")
agent = graph.compile()


# ── Edit Mode Graph (single Coder node, no Planner/Architect) ──
edit_graph = StateGraph(dict)
edit_graph.add_node("edit_coder", edit_coder_agent)
edit_graph.add_edge("edit_coder", END)
edit_graph.set_entry_point("edit_coder")
edit_agent = edit_graph.compile()


# ── Chat Mode: conversational AI for Q&A, explanations, general questions ──

# Keywords that indicate the user wants to MODIFY existing code (not just ask a question)
MODIFY_KEYWORDS = re.compile(
    r'\b(add|change|modify|update|fix|improve|refactor|remove|replace|implement|'
    r'include|insert|delete|convert|transform|enhance|optimize|rewrite|redesign|'
    r'make it|can you|could you|please add|put|set|enable|disable|toggle|switch|'
    r'dark mode|light mode|responsive|animation|style|color|theme)\b',
    re.IGNORECASE,
)


def is_code_modification(message: str, has_file_context: bool) -> bool:
    """Detect if the user's chat message is asking to modify/improve code."""
    # Must have a file open to modify
    if not has_file_context:
        return False
    return bool(MODIFY_KEYWORDS.search(message))


def chat_agent_node(state: dict) -> dict:
    """Handles conversational chat — answers questions, explains code, gives guidance.
    
    Smart model switching:
    - Code modification requests → uses 70B model + extracts code for auto-apply
    - General questions → uses 8B model for fast responses
    """
    message = state.get("message", "")
    file_context = state.get("file_context", None)
    file_tree = state.get("file_tree", None)

    has_file = bool(file_context and file_context.get("path"))
    wants_code_change = is_code_modification(message, has_file)

    prompt = chat_prompt(message, file_context, file_tree, is_code_modification=wants_code_change)

    # Smart model selection
    model = llm_code if wants_code_change else llm_chat

    response = model.invoke([
        {"role": "user", "content": prompt}
    ])

    result = {
        "response": response.content,
        "messages": [AIMessage(content=response.content, name="assistant")],
    }

    # Extract generated code for auto-apply (only in code modification mode)
    if wants_code_change:
        generated_files = {}
        
        # Normalize line endings (Windows \r\n → \n)
        content = response.content.replace('\r\n', '\n')
        
        # Extract code block — handle various AI output formats
        code_match = re.search(r'```\w*\s*\n([\s\S]*?)```', content)
        
        print(f"[Chat-AutoApply] wants_code_change=True")
        print(f"[Chat-AutoApply] file_context.path = {file_context.get('path', '(none)')}")
        print(f"[Chat-AutoApply] code_match found = {code_match is not None}")
        
        if code_match:
            code = code_match.group(1).strip()
            print(f"[Chat-AutoApply] extracted code length = {len(code)}")
            
            if len(code) > 10:  # Minimum viable code
                # Always use the currently open file path — the AI header
                # often has just the filename (e.g. "index.html") without the
                # directory, which would create a duplicate file at the root.
                raw_path = file_context.get("path", "")
                filepath = raw_path.lstrip("/")
                
                print(f"[Chat-AutoApply] raw_path = '{raw_path}', cleaned = '{filepath}'")
                
                if filepath:
                    generated_files[filepath] = code
                    print(f"[Chat-AutoApply] ✅ Will write {len(code)} chars to: {filepath}")
                else:
                    print(f"[Chat-AutoApply] ❌ No filepath available, skipping auto-apply")
        else:
            print(f"[Chat-AutoApply] ❌ No code block found in AI response")
            print(f"[Chat-AutoApply] Response preview: {content[:200]}")

        if generated_files:
            result["generated_files"] = generated_files

    return result


chat_graph_builder = StateGraph(dict)
chat_graph_builder.add_node("chat", chat_agent_node)
chat_graph_builder.add_edge("chat", END)
chat_graph_builder.set_entry_point("chat")
chat_agent = chat_graph_builder.compile()

