# Data migration rules

## Role partial unique indexes

Prisma schema cannot declare partial unique indexes (PostgreSQL `CREATE UNIQUE INDEX ... WHERE ...`).

The `Role` model relies on two manually-managed partial unique indexes:

- `Role_scope_name_system_key`
- `Role_scope_schoolId_name_key`

Rule: every future migration must be reviewed before application to ensure Prisma does not generate a `DROP INDEX` for either of these indexes. If such a `DROP INDEX` appears, remove it from the migration SQL.

## Manual SQL in migrations

Rule: any migration that contains SQL added manually must be applied with `npx prisma migrate deploy`, never with `npx prisma migrate dev`.

Workflow for future migrations:

- Generate with `npx prisma migrate dev --create-only`.
- Review `migration.sql`.
- Remove any `DROP INDEX` that targets `Role_scope_name_system_key` or `Role_scope_schoolId_name_key`.
- Apply with `npx prisma migrate deploy`.
