# ADF Copilot Agents

A complete, agentic framework for generating, deploying, and testing Azure Data Factory pipelines entirely through conversational AI using GitHub Copilot.

This project uses the **Model Context Protocol (MCP)** to give Copilot access to your local SQL Server and Azure environment. 

> **Core Philosophy**: Zero Stored Procedures. All SQL is generated inline for total transparency and audibility. All deployments and tests are executed manually on demand.

---

## 🏗️ Architecture

The framework consists of **6 specialized agents**, **10 MCP tools**, and a system of **skills, hooks, and prompts** to guide the LLM safely and reliably.

### 🤖 The Agents (6-Stage Pipeline)

| Agent | Role | Output |
|---|---|---|
| `@adf-orchestrator` | Coordinates the entire pipeline build process. | Prompts & State Management |
| `@adf-requirements-agent` | Analyzes schema impact and gathers requirements. | `requirements-*.docx` |
| `@adf-sql-agent` | Generates inline T-SQL for extraction and transformation. | `workspace/sql/*.sql` |
| `@adf-code-review-agent` | Reviews generated SQL for performance and standards. | `code-review-*.docx` |
| `@adf-builder-agent` | Builds the ADF ARM template JSON structure. | `workspace/adf/*.json` |
| `@adf-deploy-agent` | Pushes Linked Services, Datasets, and Pipelines to Azure. | Deployment URL |
| `@adf-test-agent` | Triggers a pipeline run, polls completion, and validates. | `test-report-*.docx`, `*.csv` |

### 🛠️ The MCP Tools (Node.js Server)

| Tool | Capability |
|---|---|
| `get_db_schema` | Fetches SQL Server tables, columns, PKs, FKs, and indexes. |
| `run_sql` | Executes inline T-SQL. Enforces `dryRun` safety before real execution. |
| `generate_adf_pipeline` | Builds ADF ARM templates with `SqlServerTable` and inline query activities. |
| `deploy_to_adf` | Deploys ARM templates to Azure via the Management REST API. |
| `run_adf_pipeline` | Triggers manual runs and polls for activity execution metrics. |
| `generate_word_doc` | Produces styled `.docx` files for formal reporting. |
| `save_csv` | Generates `.csv` exports of test executions or data samples. |
| `read_file` / `write_file` / `list_files` | Manages the local `workspace/` state files. |

### 🧠 Skills, Hooks & Prompts

- **Skills**: Reusable instructions for the LLM. Includes `docx-document-writer` (styling rules), `schema-analysis` (how to interpret DBs), and `sql-test-patterns` (how to write unit tests).
- **Hooks**: Intercepts actions. `dry-run-enforcer` blocks destructive SQL without a dry run. `audit-logger` logs every DB interaction. `session-context` provides a welcome banner.
- **Prompts**: `/new-pipeline` starts a fresh pipeline build. `/generate-unit-tests` spins up a dedicated test suite.

---

## 🚀 Setup & Installation

### 1. Configure the Environment
Copy `.env.example` to `.env` and fill in your details:
```env
# SQL Server
DB_SERVER=localhost
DB_NAME=QNXT_PLANDATA_UNV
DB_DRIVER=msnodesqlv8 # Uses Windows Authentication by default

# Azure Environment (For Deployment)
AZURE_SUBSCRIPTION_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
AZURE_RESOURCE_GROUP=my-resource-group
AZURE_ADF_FACTORY_NAME=my-adf-factory
```

### 2. Install and Build the MCP Server
```bash
cd mcp-server
npm install
npm run build
```

### 3. Open in VS Code
Open the root directory in VS Code. The `.vscode/mcp.json` file will automatically register the server with GitHub Copilot.

---

## 💬 Usage

Start a conversation with Copilot Chat:

1. Type `/new-pipeline` and hit enter.
2. Tell it what you want to build: *"I need to extract active claims from QNXT_PLANDATA_UNV into a daily staging table."*
3. The orchestrator will initialize the pipeline and present you with a **"Step 1" button**.
4. Click the buttons sequentially to progress through Requirements -> SQL Gen -> Code Review -> Build -> Deploy -> Test.
5. All outputs (SQL, JSON, DOCX, CSV) are safely written to the `workspace/` folder.

---

## 🔒 Security & Authentication

- **SQL**: Uses Windows Authentication (`msnodesqlv8`). No credentials hardcoded.
- **Azure Deployment**: Supports both `azure-cli` (relies on `az login`) and `service-principal` (uses `.env` secrets).
- **Telemetry**: All agent operations are logged to `logs/agent-audit.log`.
