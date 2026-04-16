# 🚀 Vibe Coder: AI Agentic IDE

**Vibe Coder** is a state-of-the-art AI-powered workspace that transforms natural language prompts into fully functional code projects. Unlike static code generators, Vibe Coder uses a **multi-agent orchestration** to plan, architect, and implement software while providing a real-time collaborative editor environment.

---

## 🏗️ Architecture

The system is built on two primary pillars that communicate seamlessly:

### 1. The AI Agent Team (Backend)
Powered by **LangGraph** and **Groq (LLMs)**:
- **🧠 Planner Agent**: Analyzes the user's prompt and creates a project roadmap.
- **📐 Architect Agent**: Translates the roadmap into specific files and engineering tasks.
- **💻 Coder Agent**: Implements the logic file-by-file with multi-agent consistency.

### 2. The Smart Editor (Frontend/Node.js)
A robust workspace for reviewing and running generated code:
- **Real-time Streaming**: Code flows from agents to your editor via SSE.
- **Integrated Terminal**: Run scripts directly in a high-performance PTY terminal.
- **Live Preview**: Instantly render HTML, CSS, and JS projects in a sandbox.
- **Yjs Collaboration**: Built-in support for shared editing.

---

## ✨ Features (Latest Branch)

- **💾 Local Persistence**: Projects are automatically saved to `editor/server/user/` as they are generated.
- **⚡ Supercharged SSE**: Real-time visibility into agent logs and codebase evolution.
- **🛠️ Zero-Config Preview**: Instant live-reloading for web projects.

---

## 🐳 Containerization & Deployment

Vibe Coder is fully containerized for consistent development and scalable production hosting.

### Local Development (Docker Compose)
The easiest way to run the entire stack:
```bash
docker-compose up --build
```
This spawns:
- `fastapi`: AI Agent pipeline (Port 8000)
- `orchestrator`: Manages workspace sessions (Port 3000)
- `client`: React-based editor UI (Port 5173)

### ☁️ AWS Deployment (Production)
We host our containers on **AWS** using a scalable container-orchestration strategy:

1. **Registry (ECR)**:
   Images for `fastapi`, `orchestrator`, and `client` are pushed to **Amazon Elastic Container Registry**.
   ```bash
   aws ecr get-login-password --region <region> | docker login --username AWS --password-stdin <aws_account_id>.dkr.ecr.<region>.amazonaws.com
   ```

2. **Orchestration (ECS/Fargate)**:
   - **ECS Clusters**: Manages the lifecycle of our agent and editor services.
   - **Fargate**: Provides serverless compute for containers, eliminating EC2 management.
   - **ALB (Application Load Balancer)**: Handles traffic routing between the React client and the backend APIs.

3. **Persistent Storage (EFS)**:
   User projects in `editor/server/user/` are mounted via **Amazon EFS** to ensure data persists across container restarts and scaling events.

---

## 🚀 Getting Started

### Prerequisites
- **Python 3.10+** & **Node.js 18+**
- **Docker & Docker Compose**
- **Groq API Key** (Add to `.env`)

### Fast Startup (Native)

1. **Configure Environment**:
   ```env
   GROQ_API_KEY=your_key_here
   FASTAPI_URL=http://localhost:8000
   ```

2. **Start AI Backend**:
   `python server.py`

3. **Start Editor Server**:
   `cd editor/server && npm install && node index.js`

---

## 📂 Project Structure

```text
vibe-coder/
├── agent/            # LangGraph agent definitions
├── editor/           # Node.js collaborative workspace
│   ├── client/       # React editor UI
│   └── server/       # Express server & user storage
├── orchestrator/     # Session management logic
├── Dockerfile.python # AI Backend container spec
└── docker-compose.yml # Multi-container orchestration
```

---
*Built with ❤️ for the next generation of developers.*