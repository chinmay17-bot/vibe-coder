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

llm = ChatGroq(model="openai/gpt-oss-120b")


def planner_agent(state: dict) -> dict:
    """Converts user prompt into a structured Plan."""
    user_prompt = state["user_prompt"]

    resp = llm.with_structured_output(Plan, method="json_mode").invoke(
        planner_prompt(user_prompt)
    )
    
    if resp is None:
        raise ValueError("Planner did not return a valid response.")
    
    # Force vanilla tech stack (Fix #6)
    resp.techstack = "HTML, CSS, JavaScript (vanilla, no frameworks)"
    
    # Clean file paths — remove directory prefixes (Fix #5)
    for f in resp.files:
        f.path = f.path.split("/")[-1]  # Keep only filename
    
    chat_msg = f"**Project Plan Created!**\n\nI have structured the plan. Passing it to the Architect..."
    
    return {"plan": resp, "messages": [AIMessage(content=chat_msg, name="planner")]}

def architect_agent(state: dict) -> dict:
    """Creates TaskPlan from Plan."""
    plan: Plan = state["plan"]

    resp = llm.with_structured_output(TaskPlan, method="json_mode").invoke(
        architect_prompt(plan=plan.model_dump_json())
    )
    
    if resp is None:
        raise ValueError("Architect did not return a valid response.")

    resp.plan = plan
    
    # Clean file paths — remove directory prefixes (Fix #5)
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
    
    # Build context from previously generated files (Fix #2)
    context_parts = []
    if coder_state.generated_files:
        context_parts.append("PREVIOUSLY GENERATED FILES (you MUST match these IDs, classes, and function names exactly):\n")
        for filepath, code in coder_state.generated_files.items():
            context_parts.append(f"--- {filepath} ---\n{code}\n")
    
    context_str = "\n".join(context_parts)
    
    # Prompt includes explicit instructions to avoid export/import (Fix #1)
    user_prompt = (
        f"Task: {current_task.task_description}\n"
        f"File: {current_task.filepath}\n\n"
        f"{context_str}\n"
        f"Generate the complete code for this file.\n"
        f"Start with: ### `{current_task.filepath}`\n"
        f"Then write a single code block with the FULL file contents.\n"
        f"CRITICAL: No import/export statements. Plain vanilla browser JavaScript only."
    )

    # Directly invoke the LLM
    response = llm.invoke([
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt}
    ])

    # Extract the generated code and store it for future context (Fix #2)
    code_match = re.search(r'```\w*\s*\n([\s\S]*?)```', response.content)
    if code_match:
        coder_state.generated_files[current_task.filepath] = code_match.group(1).strip()

    coder_state.current_step_idx += 1
    
    return {
        "coder_state": coder_state, 
        "messages": [AIMessage(content=response.content, name="coder")]
    }


# Graph setup
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
