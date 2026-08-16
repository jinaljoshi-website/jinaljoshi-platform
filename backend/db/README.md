# Database

**The live Railway database is the source of truth.** There is no migration
framework here — tables and columns are altered directly in Railway's SQL
editor, and that is what the application runs against.

## schema.sql

`schema.sql` is a **generated snapshot**, not a hand-written file. Do not edit it
by hand and do not treat it as authoritative. Regenerate it after any schema
change (see below), so what is committed keeps describing what actually exists.

It exists for one reason: if the database were ever lost, this is what rebuilds
the structure. Nothing else in the repository can.

### Why it is generated rather than written

It used to be hand-maintained, and drifted badly. By August 2026 it described 17
tables when the application was reading about fifty, and named the configuration
table `app_config` when every query in the codebase reads `platform_config`.
Missing from it entirely were `gifted_grants`, `bonus_offers`, `invoices`,
`invoice_receipts`, `direct_messages`, `photographers`, `daily_selfies` and some
thirty more.

Anyone running it against a fresh database in good faith would have produced a
platform that failed on the first request — and the file gave no sign of being
out of date. A generated file cannot drift in that way, because regenerating it
is one command rather than an act of memory.

## Regenerating

From the project root, with the Railway connection string:

```bash
pg_dump --schema-only --no-owner --no-privileges \
        "$DATABASE_URL" > backend/db/schema.sql
```

`DATABASE_URL` is in the Railway service under Variables. Take it from there
rather than storing it anywhere in the repository.

If `pg_dump` reports a server version mismatch, the local client is older than
the server. On macOS:

```bash
brew install libpq
brew link --force libpq
```

Then check `pg_dump --version` matches or exceeds the Postgres version Railway
reports.

## Restoring

Against an empty database:

```bash
psql "$DATABASE_URL" < backend/db/schema.sql
```

This restores structure only — no rows. `--schema-only` is deliberate: a dump
carrying data would put real fans' email addresses, message history and payment
records into the repository.

For data, use Railway's own backups rather than anything kept here.

## After restoring

The application refuses to price anything it has no configuration for, so a
structurally correct but empty database will start and then fail on the first
purchase. `platform_config` needs populating before the platform works —
`checkPricingConfig()` in `backend/lib/config.js` lists every required key and
reports the missing ones at boot.