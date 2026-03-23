from dotenv import load_dotenv
from langchain_core.globals import set_verbose, set_debug
from langchain_core.messages import AIMessage
from langchain_groq.chat_models import ChatGroq
from langgraph.constants import END
from langgraph.graph import StateGraph

from agent.prompts import *
from agent.states import *
# Notice: We removed the tool imports and create_react_agent!

_ = load_dotenv()

set_debug(True)
set_verbose(True)

llm = ChatGroq(model="openai/gpt-oss-120b")

def planner_agent(state: dict) -> dict:
    """Converts user prompt into a structured Plan."""
    user_prompt = state["user_prompt"]
    resp = llm.with_structured_output(Plan).invoke(
        planner_prompt(user_prompt)
    )
    if resp is None:
        raise ValueError("Planner did not return a valid response.")
    
    # Format a friendly message for the UI
    chat_msg = f"**Project Plan Created!**\n\nI have structured the plan. Passing it to the Architect..."
    
    return {"plan": resp, "messages": [AIMessage(content=chat_msg, name="planner")]}

def architect_agent(state: dict) -> dict:
    """Creates TaskPlan from Plan."""
    plan: Plan = state["plan"]
    resp = llm.with_structured_output(TaskPlan).invoke(
        architect_prompt(plan=plan.model_dump_json())
    )
    if resp is None:
        raise ValueError("Architect did not return a valid response.")

    resp.plan = plan
    
    # Format a friendly message for the UI
    chat_msg = f"**Architecture Ready!**\n\nI have broken the plan down into `{len(resp.implementation_steps)}` distinct implementation steps. The Coder will now begin generating the files."
    
    return {"task_plan": resp, "messages": [AIMessage(content=chat_msg, name="architect")]}

def coder_agent(state: dict) -> dict:
    """Generates code directly as text output without file system tools."""
    coder_state: CoderState = state.get("coder_state")
    
    if coder_state is None:
        coder_state = CoderState(task_plan=state["task_plan"], current_step_idx=0)

    steps = coder_state.task_plan.implementation_steps
    if coder_state.current_step_idx >= len(steps):
        # We are done!
        final_msg = "✅ **All tasks completed!** You can copy the code blocks above."
        return {"coder_state": coder_state, "status": "DONE", "messages": [AIMessage(content=final_msg, name="coder")]}

    current_task = steps[coder_state.current_step_idx]

    system_prompt = coder_system_prompt()
    user_prompt = (
        f"Task: {current_task.task_description}\n"
        f"File: {current_task.filepath}\n\n"
        "Generate the complete code for this file and wrap it in a Markdown block as instructed."
    )

    # Directly invoke the LLM (no tools needed!)
    response = llm.invoke([
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt}
    ])

    coder_state.current_step_idx += 1
    
    # Return the LLM's Markdown output as a message for the UI
    return {
        "coder_state": coder_state, 
        "messages": [AIMessage(content=response.content, name="coder")]
    }


# Graph setup remains exactly the same!
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
