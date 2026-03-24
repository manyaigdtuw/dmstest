-- Migration: Create daily_dispensing_summary table
-- Date: 2026-03-24
-- Issue: Table exists in schema but not in production database

CREATE TABLE IF NOT EXISTS daily_dispensing_summary (
    id SERIAL PRIMARY KEY,
    drug_id INTEGER REFERENCES drugs(id) ON DELETE CASCADE,
    quantity_dispensed INTEGER NOT NULL,
    dispensing_date DATE NOT NULL DEFAULT CURRENT_DATE,
    category VARCHAR(50) CHECK (category IN ('IPD', 'OPD', 'IEC', 'OUTREACH')),
    notes TEXT,
    recorded_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    -- Ensure only one record per drug per day per category
    UNIQUE(drug_id, dispensing_date, category)
);

CREATE INDEX IF NOT EXISTS idx_dispensing_summary_date ON daily_dispensing_summary(dispensing_date);
CREATE INDEX IF NOT EXISTS idx_dispensing_summary_drug_date ON daily_dispensing_summary(drug_id, dispensing_date);
