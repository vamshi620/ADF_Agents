# ADF Copilot Agents

A suite of **5 GitHub Copilot agents** that take a natural-language requirement and deliver a fully working **Azure Data Factory pipeline** — from SQL queries to deployment to testing.

> **Reference project**: `C:\VAMSHI\E2Eagent` — SQL Server connection details are taken from there.  
> **Key rule**: All SQL is **inline only** — no stored procedures anywhere.

---

## 🤖 Agents

| Agent | Invoke | What it does |
|---|---|---|
| **ADF Orchestrator** | `@adf-orchestrator` | **MAIN ENTRY POINT** — initializes session state, discovers schema, coordinates all 4 stages |
| **ADF SQL Agent** | `@adf-sql-agent` | Step 1: Generates inline T-SQL queries (SELECT/INSERT/UPDATE/DDL — NO stored procs), dry-runs each |
| **ADF Builder Agent** | `@adf-builder-agent` | Step 2: Calls `generate_adf_pipeline` to build ADF ARM template with Linked Service + Datasets + Pipeline |
| **ADF Deploy Agent** | `@adf-deploy-agent` | Step 3: Deploys ARM template to Azure ADF via REST API (azure-cli or service-principal auth) |
| **ADF Test Agent** | `@adf-test-agent` | Step 4: Triggers pipeline run, polls to completion, validates with inline SQL, generates test report |

---

## 🏗️ Architecture

```
.github/agents/           ← Agent definitions (.agent.md format)
  adf-orchestrator.agent.md
  adf-sql-agent.agent.md
  adf-builder-agent.agent.md
  adf-deploy-agent.agent.md
  adf-test-agent.agent.md

mcp-server/               ← MCP Server (Node.js + TypeScript)
  src/
    index.ts              ← Entry point — registers all 8 tools
    config.ts             ← DB + Azure config from .env
    db.ts                 ← SQL Server connection helper
    tools/
      db-schema.ts        ← get_db_schema tool
      run-sql.ts          ← run_sql tool (inline SQL only, dry-run support)
      file-system.ts      ← read_file, write_file, list_files tools
      adf-pipeline.ts     ← generate_adf_pipeline tool (builds ARM template JSON)
      adf-deploy.ts       ← deploy_to_adf tool (Azure REST API deployment)
      adf-runner.ts       ← run_adf_pipeline tool (trigger + poll pipeline run)

.vscode/mcp.json          ← Registers MCP server with VS Code Copilot
workspace/                ← Generated output (created at runtime)
  ADF_MEMORY.md           ← Shared pipeline state (created by @adf-orchestrator)
  sql/                    ← Generated SQL query files
  adf/                    ← Generated ARM template JSON files
  test-report-*.md        ← Test reports
```

---

## ⚡ Quick Start

### Prerequisites
- **Node.js** 18+ ([nodejs.org](https://nodejs.org))
- **VS Code** 1.120+ with **GitHub Copilot** and **GitHub Copilot Chat** extensions
- **SQL Server** on `localhost` with `QNXT_PLANDATA_UNV` database (Windows Auth)
- **Azure Subscription** (for deploy/test steps — placeholders work for SQL + build steps)

### 1. Configure Environment

```bash
# The .env file is pre-configured for the local SQL Server.
# Fill in Azure values when you're ready to deploy:
notepad .env
```

Edit the Azure section:
```env
AZURE_SUBSCRIPTION_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
AZURE_RESOURCE_GROUP=my-resource-group
AZURE_ADF_FACTORY_NAME=my-adf-factory
```

### 2. Build the MCP Server

```bash
cd mcp-server
npm install
npm run build
cd ..
```

### 3. Open in VS Code

```bash
code c:\adfAgents
```

VS Code will detect `.vscode/mcp.json` and register the MCP server automatically.

> **Verify**: Open Copilot Chat → click the **Tools** icon → you should see:
> `get_db_schema`, `run_sql`, `generate_adf_pipeline`, `deploy_to_adf`, `run_adf_pipeline`

---

## 💬 Usage

### Basic Usage — Start Here

```
@adf-orchestrator I need a pipeline to extract active claim records from 
QNXT_PLANDATA_UNV and load them into a staging table for reporting.
```

The orchestrator will:
1. Auto-discover the relevant schema tables
2. Initialize `ADF_MEMORY.md` with your pipeline plan
3. Show you 4 handoff buttons — click them in order

### The 4 Steps

```
📝 Step 1 — Generate SQL Queries
     ↓  (@adf-sql-agent writes inline SQL, dry-runs each query)
🏗️ Step 2 — Build ADF Pipeline
     ↓  (@adf-builder-agent calls generate_adf_pipeline → ARM JSON)
🚀 Step 3 — Deploy to Azure ADF
     ↓  (@adf-deploy-agent asks for auth method, deploys to Azure)
🧪 Step 4 — Test Pipeline Run
     ↓  (@adf-test-agent triggers run, validates rows, writes report)
```

---

## 🛠️ MCP Tools Reference

| Tool | Description |
|---|---|
| `get_db_schema` | Fetch all tables/columns/indexes from SQL Server |
| `run_sql` | Execute inline T-SQL (SELECT/DML/DDL) with dry-run support |
| `read_file` | Read any file from the workspace |
| `write_file` | Create/update files in the workspace |
| `list_files` | List workspace directory contents |
| `generate_adf_pipeline` | Build ADF ARM template JSON (inline SQL activities only, no SPs) |
| `deploy_to_adf` | Deploy Linked Service + Datasets + Pipeline to Azure ADF |
| `run_adf_pipeline` | Trigger pipeline run, poll to completion, return activity details |

---

## 🔑 Authentication Options

When deploying/running the pipeline, the agent will ask you to choose:

| Method | When to use | How to set up |
|---|---|---|
| **`azure-cli`** | Interactive / first-time | Run `az login` in terminal first |
| **`service-principal`** | Automation / CI | Set `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID` in `.env` |

---

## 📁 Output Files

```
workspace/
  ADF_MEMORY.md                        ← Pipeline state (shared by all agents)
  sql/
    001_<pipeline>_CreateStaging.sql   ← Generated SQL queries
    002_<pipeline>_RowCountCheck.sql
    003_<pipeline>_SourceExtract.sql
    004_<pipeline>_AuditLog.sql
  adf/
    <PipelineName>.json                ← ARM template (deploy-ready)
  test-report-<pipeline>-<date>.md    ← Test report
```

---

## 🔒 Security

- `.env` is in `.gitignore` — never commit real credentials
- All SQL runs inside transactions with `dryRun: true` for validation
- No stored procedures anywhere — all SQL is inline and auditable
- Azure tokens are obtained at runtime — never stored in files

---

## 🧩 Relationship to E2E Agent Project

This project is inspired by and uses the same patterns as `C:\VAMSHI\E2Eagent`.
It uses the same SQL Server (`QNXT_PLANDATA_UNV` on `localhost` with Windows Auth)
but is completely independent — no files are shared or modified in the reference project.
