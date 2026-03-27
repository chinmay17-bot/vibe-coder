def planner_prompt(user_prompt: str) -> str:
    PLANNER_PROMPT = f"""
You are the PLANNER agent. Convert the user prompt into a COMPLETE engineering project plan.

IMPORTANT RULES:
- The generated project MUST be a vanilla HTML/CSS/JavaScript project that runs directly in a browser.
- DO NOT use any frameworks (React, Vue, Angular, etc.) or build tools (Webpack, Vite, etc.).
- DO NOT use ES modules (import/export). All JS must use plain <script> tags.
- The project MUST have at minimum: index.html, styles.css, and app.js.
- Keep the file structure flat — no subdirectories unless absolutely necessary.
- The index.html must link to styles.css and app.js correctly.
- Focus on creating a FULLY FUNCTIONAL, INTERACTIVE application — not just a visual mockup.
- Make the design colorful, modern, and visually appealing with CSS.

User request:
{user_prompt}
    """
    return PLANNER_PROMPT


def architect_prompt(plan: str) -> str:
    ARCHITECT_PROMPT = f"""
You are the ARCHITECT agent. Given this project plan, break it down into explicit engineering tasks.

RULES:
- For each FILE in the plan, create ONE implementation task (do not split a single file into multiple tasks).
- Order tasks so that HTML is generated FIRST, then CSS, then JavaScript.
- In each task description:
    * Specify exactly what to implement in full detail.
    * For HTML: describe the complete DOM structure, all elements, classes, IDs, and data attributes.
    * For CSS: describe all styles, colors, layouts, animations, responsive design.
    * For JS: describe all functions, event listeners, logic, DOM queries, and state management.
    * Include the FULL integration details: which IDs/classes the JS will query, which CSS classes style which elements.
- File paths MUST be simple filenames (e.g., "index.html", "styles.css", "app.js") — NO directory prefixes.
- Each task must be completely self-contained with enough detail that a developer could implement it without seeing the other files.

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