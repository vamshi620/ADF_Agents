---
name: schema-analysis
description: >
  Use when analyzing, describing, or summarizing a SQL Server database schema
  returned by the get_db_schema tool. Guides structured interpretation of tables,
  relationships, constraints, and indexes. Use before writing requirements,
  SQL implementations, or code reviews.
---

# Schema Analysis Skill

When you receive schema data from `get_db_schema`, follow this structured analysis process:

## Step 1 – Inventory the Schema

Build a mental model by scanning:
- **Total tables**: count and group by domain (e.g., `Customer*`, `Order*`, `Product*`)
- **Primary keys**: identify identity columns vs natural keys
- **Foreign keys**: map all relationships (parent → child chains)
- **Nullable columns**: flag nullable PKs or FKs as potential data quality issues
- **Missing indexes**: identify FK columns without indexes (query performance risk)

## Step 2 – Identify Domain Clusters

Group tables into logical domains. Example:
```
Customer Domain:   Customers, CustomerAddresses, CustomerContacts
Order Domain:      Orders, OrderItems, OrderStatus
Product Domain:    Products, ProductCategories, ProductPricing
```

## Step 3 – Map Relationships

Build a relationship summary:
```
Customers (1) ──── (M) Orders
Orders    (1) ──── (M) OrderItems
Products  (1) ──── (M) OrderItems
```

Note:
- **Cascade rules**: are FKs set to CASCADE DELETE/UPDATE?
- **Orphan risk**: child tables without enforced FKs
- **Circular references**: tables that reference each other

## Step 4 – Flag Schema Health Issues

Look for these common problems:

| Issue | Example | Severity |
|---|---|---|
| Missing audit columns | No `CreatedAt`/`UpdatedAt` | Major |
| VARCHAR instead of NVARCHAR | `VARCHAR(255)` for names | Minor |
| DATETIME instead of DATETIME2 | `OrderDate DATETIME` | Minor |
| No soft-delete column | Missing `IsDeleted BIT` | Minor |
| FK without index | `Orders.CustomerId` no index | Major |
| Nullable PK | `Id INT NULL` | Critical |
| No PK defined | Table with no primary key | Critical |
| Overly wide VARCHAR(MAX) | `Notes NVARCHAR(MAX)` on every row | Minor |

## Step 5 – Summarize for Agent Context

When incorporating schema into your response, format it as:

```
DATABASE: <DatabaseName>
TABLES: <count>

Key Entities:
- <TableName> (<column>:<type>, <column>:<type>...) [PK: <col>]
  └── References: <parent table> via <FK col>
  └── Referenced by: <child table> via <col>

Schema Flags:
- ⚠️ <issue description>
- ✅ <good pattern observed>
```

## Step 6 – Relevance Filter

Only include schema tables **relevant to the current request** in your context.
- For a requirements request about "Orders": include `Orders`, `OrderItems`, `Customers`
- For a review of a `Product` stored procedure: include `Products`, `ProductCategories`

This prevents overwhelming the AI context with irrelevant tables.
