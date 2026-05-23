---
description: Start a brand-new ADF development pipeline from scratch. This is the
  recommended entry point — invokes the orchestrator agent which coordinates all other agents.
mode: agent
model: gpt-4o
---

# New Pipeline

Start a new ADF pipeline for the following feature:

**Feature Request:** ${input:feature_request:Describe the feature you want to build}

## Instructions

Invoke `@adf-orchestrator` with this request. The orchestrator will coordinate the full workflow:
1. Requirements Analysis
2. SQL inline query generation
3. ADF ARM template build
4. Azure ADF deployment
5. Test validation & reports
6. Code Review
