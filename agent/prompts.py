def planner_prompt(user_prompt: str) -> str:
    PLANNER_PROMPT = f"""
You are the PLANNER agent. Convert the user prompt into a COMPLETE engineering project plan.
Respond with a valid JSON object with EXACTLY this structure:
{{
  "name": "AppName",
  "description": "One line description",
  "techstack": "HTML, CSS, JavaScript (vanilla, no frameworks)",
  "features": ["feature 1", "feature 2"],
  "files": [
    {{"path": "index.html", "purpose": "Main HTML file"}},
    {{"path": "styles.css", "purpose": "Stylesheet"}},
    {{"path": "app.js", "purpose": "JavaScript logic"}}
  ]
}}

RULES:
- Project MUST be vanilla HTML/CSS/JavaScript only — no frameworks, no build tools.
- Always include at minimum: index.html, styles.css, app.js.
- Flat file structure — no subdirectories.
- Focus on a FULLY FUNCTIONAL, INTERACTIVE application.

User request: {user_prompt}
    """
    return PLANNER_PROMPT


def architect_prompt(plan: str) -> str:
    ARCHITECT_PROMPT = f"""
You are the ARCHITECT agent. Given this project plan, break it down into implementation tasks.
Respond with a valid JSON object with EXACTLY this structure:
{{
  "implementation_steps": [
    {{"filepath": "index.html", "task_description": "detailed description of what to implement"}},
    {{"filepath": "styles.css", "task_description": "detailed description of what to implement"}},
    {{"filepath": "app.js", "task_description": "detailed description of what to implement"}}
  ]
}}

RULES:
- One task per file. Order: HTML first, then CSS, then JavaScript.
- File paths must be simple filenames only — no directory prefixes.
- Each task_description must be detailed enough to implement the file standalone.

Project Plan:
{plan}
    """
    return ARCHITECT_PROMPT


def coder_system_prompt() -> str:
    CODER_SYSTEM_PROMPT = """
You are the CODER agent. You generate production-ready code for web projects.

ABSOLUTE RULES — VIOLATIONS WILL BREAK THE PROJECT:
1. Output the COMPLETE code for the requested file in a single Markdown code block.
2. Precede the code block with the filename as a header: ### `filename.ext`
3. The code MUST be vanilla HTML/CSS/JavaScript — NO frameworks, NO libraries, NO build tools.
4. JavaScript MUST be browser-compatible:
   - DO NOT use `import` or `export` statements. These WILL crash in the browser.
   - DO NOT use `require()`. This is not available in browsers.
   - DO NOT use TypeScript syntax.
   - Use `document.getElementById()`, `document.querySelector()`, `addEventListener()` etc.
5. HTML files MUST include proper `<link>` tags for CSS and `<script>` tags for JS at the end of body.
6. All element IDs and class names used in JS MUST exactly match those in the HTML.
7. All CSS selectors MUST exactly match the classes/IDs used in the HTML.
8. Write the FULL file — no placeholders, no "// ... rest of code", no truncation.
9. Make the code FUNCTIONAL and INTERACTIVE — buttons must work, inputs must respond.
10. Use modern CSS for beautiful, colorful design (gradients, shadows, border-radius, animations).
    """
    return CODER_SYSTEM_PROMPT