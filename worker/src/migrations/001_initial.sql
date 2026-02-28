-- Migration: Create alias management tables
-- Run with: wrangler d1 migrations apply infinite-email --local

-- Aliases table
CREATE TABLE IF NOT EXISTS aliases (
    alias TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'revoked')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    note TEXT
);

-- Rules table (allow/deny)
CREATE TABLE IF NOT EXISTS rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK(type IN ('allow_prefix', 'deny_prefix', 'allow_exact', 'deny_exact')),
    value TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(type, value)
);

-- Audit log table
CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL DEFAULT (datetime('now')),
    alias TEXT NOT NULL,
    action TEXT NOT NULL,
    ip TEXT,
    details TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_aliases_status ON aliases(status);
CREATE INDEX IF NOT EXISTS idx_audit_alias ON audit(alias);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit(ts);
