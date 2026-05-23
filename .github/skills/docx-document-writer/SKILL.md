---
name: docx-document-writer
description: >
  Use when calling generate_word_doc to produce any Word document — requirements
  docs, code review reports, or test reports. Defines the standard section
  structures, formatting rules, and content templates for each document type.
---

# Word Document Writing Skill

## General Rules

- **Never** produce a document with fewer than 4 sections — always include Summary, Scope, Details, Recommendations
- Use `level: 1` for major chapters, `level: 2` for sections, `level: 3` for sub-sections
- Use `table` wherever there are 3+ items with consistent attributes (don't use flat text for tabular data)
- Start bullet content lines with `- ` for bulleted lists
- Start numbered items with `1.`, `2.` etc. for ordered lists
- Always include the date in the document `filename` (format: `YYYY-MM-DD`)

---

## Document Type: Requirements Document

### Required Sections (in order)

```
level 1: "Executive Summary"
  → 2-3 sentences: what, why, who benefits

level 1: "Scope"  
  → bullet list: In Scope items
  → bullet list: Out of Scope items

level 1: "Functional Requirements"
  → numbered list: FR-001, FR-002... each testable and specific

level 1: "Database Impact Analysis"
  → table: { headers: ["Table", "Action", "Affected Columns", "Notes"],
              rows: [["Orders", "MODIFY", "Status, UpdatedAt", "Add new status code"]] }

level 1: "Data Flow"
  → numbered steps describing data movement

level 1: "Business Rules"
  → numbered list of all constraints and validations

level 1: "Acceptance Criteria"
  → Each criterion in Given/When/Then format as bullet points

level 1: "Open Questions"
  → numbered list of unresolved items
```

### Filename Convention
```
requirements-<feature-slug>-<YYYY-MM-DD>.docx
Example: requirements-loyalty-points-2026-05-23.docx
```

---

## Document Type: Code Review Report

### Required Sections (in order)

```
level 1: "Review Summary"
  → table: { headers: ["Item", "Value"],
              rows: [
                ["Object Reviewed", "<name>"],
                ["Quality Score",   "<n>/100"],
                ["Recommendation",  "Approve | Request Changes | Reject"],
                ["Critical Issues", "<count>"],
                ["Major Issues",    "<count>"],
                ["Minor Issues",    "<count>"]
              ]}

level 1: "Critical Issues"  (🔴 severity)
  → table: { headers: ["#", "Issue", "Location", "Impact", "Fix"],
              rows: [...] }
  → If none: content = "No critical issues found. ✅"

level 1: "Major Issues"  (🟠 severity)
  → table: same structure as Critical

level 1: "Minor Issues"  (🟡 severity)
  → table: { headers: ["#", "Issue", "Suggestion"], rows: [...] }

level 1: "Positive Observations"  (🟢)
  → bullet list of good patterns found

level 1: "Corrected Code"
  → content with the full corrected SQL (use code fence syntax in content)

level 1: "Action Items"
  → numbered list, ordered by priority
```

### Filename Convention
```
code-review-<object-name>-<YYYY-MM-DD>.docx
Example: code-review-usp_Order_Create-2026-05-23.docx
```

---

## Document Type: Test Report

### Required Sections (in order)

```
level 1: "Test Execution Summary"
  → table: { headers: ["Metric", "Value"],
              rows: [
                ["Total Tests",     "<n>"],
                ["Passed ✅",        "<n>"],
                ["Failed ❌",        "<n>"],
                ["Errors 🔥",        "<n>"],
                ["Skipped ⏭️",       "<n>"],
                ["Duration",        "<ms>ms"],
                ["Pass Rate",       "<n>%"],
                ["Framework",       "tSQLt | Custom"],
                ["Test Database",   "<name>"]
              ]}

level 1: "Test Results Detail"
  → table: { headers: ["Test Name", "Status", "Duration (ms)", "Error Message"],
              rows: [...one row per test case...] }

level 1: "Failure Analysis"
  → For each failed/errored test: sub-heading with test name,
    then: Root Cause, SQL location, Suggested Fix (numbered list)

level 1: "Deployment Log"
  → numbered steps: what was deployed, rows affected, any warnings

level 1: "Coverage Summary"
  → bullet list: which stored procs/tables were covered

level 1: "Recommendations"
  → numbered list: what to fix before production
```

### Filename Convention
```
test-report-<feature-slug>-<YYYY-MM-DD>.docx
Example: test-report-orders-feature-2026-05-23.docx
```
