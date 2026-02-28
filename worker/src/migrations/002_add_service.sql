-- Migration: Add service/purpose columns to aliases table
-- Run with: wrangler d1 migrations apply infinite-email --local

-- Add service and purpose columns to aliases (if not exists)
ALTER TABLE aliases ADD COLUMN service TEXT;
ALTER TABLE aliases ADD COLUMN purpose TEXT;

-- Add index for service filtering
CREATE INDEX IF NOT EXISTS idx_aliases_service ON aliases(service);
