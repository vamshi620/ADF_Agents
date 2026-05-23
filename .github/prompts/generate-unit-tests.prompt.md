---
description: Generates a complete set of unit test stored procedures for a given
  stored procedure or table, covering all standard test scenarios from the sql-test-patterns skill.
mode: agent
model: gpt-4o
---

# Generate Unit Tests

Generate a complete unit test suite for: **${input:object_name:Enter stored procedure or table name}**

## Instructions

1. Call `get_db_schema` to fetch schema for the relevant tables
2. Apply the `sql-test-patterns` skill to determine which test cases to create
3. Generate test stored procedures covering all standard cases
4. Use negative IDs and idempotent cleanup
