---
name: sql-test-patterns
description: >
  Use when writing, generating, or reviewing SQL Server unit tests. Provides
  templates for both tSQLt and custom usp_Test_* test procedures, covering
  happy-path, edge cases, boundary values, and error handling scenarios.
  Use whenever the unit-test-agent needs to create new test procedures.
---

# SQL Unit Testing Patterns – Skill

## Test Procedure Naming

```
[dbo].[usp_Test_<Suite>_<Scenario>]

Examples:
  usp_Test_Customer_Insert_HappyPath
  usp_Test_Customer_Insert_NullEmail
  usp_Test_Customer_Insert_DuplicateEmail
  usp_Test_Order_Create_InsufficientBalance
  usp_Test_OrderItem_Delete_CascadeCheck
```

---

## Standard Test Procedure Template (Custom Framework)

```sql
CREATE OR ALTER PROCEDURE [dbo].[usp_Test_<Suite>_<Scenario>]
AS
BEGIN
    SET NOCOUNT ON;

    -- ── ARRANGE ─────────────────────────────────────────────
    -- Use large negative IDs to avoid collisions with production data
    DECLARE @TestId    INT = -99999;
    DECLARE @TestEmail NVARCHAR(256) = N'test.only.do.not.use@test.invalid';
    DECLARE @Expected  NVARCHAR(500);
    DECLARE @Actual    NVARCHAR(500);

    -- Clean up any leftovers from previous test run
    DELETE FROM [dbo].[YourTable] WHERE Id = @TestId;

    -- ── ACT ─────────────────────────────────────────────────
    BEGIN TRY
        EXEC [dbo].[usp_YourProcedure]
            @Id    = @TestId,
            @Email = @TestEmail;
    END TRY
    BEGIN CATCH
        -- If this path should NOT throw, it is a FAIL
        SELECT
            'FAIL'              AS Status,
            ERROR_MESSAGE()     AS ErrorMessage,
            'No exception'      AS Expected,
            ERROR_MESSAGE()     AS Actual;
        -- Cleanup even on failure
        DELETE FROM [dbo].[YourTable] WHERE Id = @TestId;
        RETURN;
    END CATCH

    -- ── ASSERT ──────────────────────────────────────────────
    SET @Expected = '1';
    SELECT @Actual = CAST(COUNT(*) AS NVARCHAR) FROM [dbo].[YourTable] WHERE Id = @TestId;

    -- ── REPORT ──────────────────────────────────────────────
    IF @Actual = @Expected
        SELECT 'PASS'  AS Status, NULL             AS ErrorMessage, @Expected AS Expected, @Actual AS Actual;
    ELSE
        SELECT 'FAIL'  AS Status,
               'Expected ' + @Expected + ' row(s), got ' + @Actual AS ErrorMessage,
               @Expected AS Expected, @Actual AS Actual;

    -- ── CLEANUP ─────────────────────────────────────────────
    -- ALWAYS clean up test data (idempotent teardown)
    DELETE FROM [dbo].[YourTable] WHERE Id = @TestId;
END
GO
```

---

## Test Coverage Checklist

For EVERY stored procedure or table, generate these test cases:

### Insert / Create Procedures
- [ ] **Happy Path** – Valid input, row is created, ID returned
- [ ] **Required Field Null** – Pass NULL for each NOT NULL column → expect error
- [ ] **Duplicate Prevention** – Insert same unique key twice → expect error (if unique constraint exists)
- [ ] **FK Violation** – Pass non-existent FK ID → expect error
- [ ] **Boundary: Max Length** – Pass string at exact max length → expect success
- [ ] **Boundary: Over Max** – Pass string over max length → expect truncation error
- [ ] **Audit Columns** – Verify `CreatedAt` is auto-populated (not NULL after insert)
- [ ] **Soft Delete Default** – Verify `IsDeleted = 0` after insert

### Update Procedures
- [ ] **Happy Path** – Valid update, row is changed
- [ ] **Record Not Found** – Update non-existent ID → expect 0 rows affected / error
- [ ] **No-Op Update** – Update with same values → expect success, no error
- [ ] **UpdatedAt Refresh** – Verify `UpdatedAt` is refreshed after update

### Delete / Soft-Delete Procedures
- [ ] **Happy Path Soft Delete** – Record marked `IsDeleted = 1`, not physically removed
- [ ] **Cascade Effect** – Verify child records handled correctly
- [ ] **Already Deleted** – Delete already-deleted record → expect graceful handling
- [ ] **Record Not Found** – Delete non-existent ID → expect 0 rows / error

### Query / Get Procedures
- [ ] **Happy Path** – Returns correct data for valid ID
- [ ] **Not Found** – Returns empty result / NULL for non-existent ID
- [ ] **Filters** – Each WHERE clause condition tested independently
- [ ] **Soft Delete Filter** – Deleted records should NOT appear in results

### Error Handling
- [ ] **RAISERROR/THROW surfaces** – Verify that user-facing errors have meaningful messages
- [ ] **Transaction Rollback** – Force failure mid-transaction → verify all changes rolled back

---

## tSQLt Patterns (When tSQLt Is Installed)

### Create a Test Class
```sql
EXEC tSQLt.NewTestClass 'TestCustomer';
GO
```

### tSQLt Test Procedure
```sql
CREATE OR ALTER PROCEDURE [TestCustomer].[test Insert HappyPath]
AS
BEGIN
    -- Arrange: fake the table to isolate from real data
    EXEC tSQLt.FakeTable 'dbo.Customers';

    -- Act
    EXEC dbo.usp_Customer_Insert
        @FirstName = 'Test',
        @LastName  = 'User',
        @Email     = 'test@example.com';

    -- Assert
    EXEC tSQLt.AssertEquals 1, (SELECT COUNT(*) FROM dbo.Customers);
END
GO
```

### Run Specific Test Class
```sql
EXEC tSQLt.Run 'TestCustomer';
```

### Run All Tests
```sql
EXEC tSQLt.RunAll;
```

---

## Test Data Conventions

| Convention | Rule |
|---|---|
| Test IDs | Always use negative integers: `-99999`, `-99998` |
| Test emails | `test.only.<name>@test.invalid` |
| Test names | `'TEST_DO_NOT_USE_<name>'` |
| Test amounts | Extreme values: `0`, `0.01`, `9999999.99`, `-1` |
| Cleanup | Delete test records by ID in EVERY test (in BEGIN/CATCH and at end) |
| Idempotency | Tests must be safe to run multiple times without manual reset |

---

## Parallel-Safe Testing

Always clean up BEFORE the test as well as after:
```sql
-- Pre-cleanup (ensures clean state even if last run failed)
DELETE FROM [dbo].[Customers] WHERE CustomerId = @TestId;

-- ... test ...

-- Post-cleanup
DELETE FROM [dbo].[Customers] WHERE CustomerId = @TestId;
```
