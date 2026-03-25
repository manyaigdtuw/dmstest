-- Migration: Add IEC category to drugs table
-- Date: 2026-03-24
-- Issue: Analytics queries check for category='IEC' but the CHECK constraint only allowed ('IPD', 'OPD', 'OUTREACH', NULL)

-- First, drop the existing constraint
ALTER TABLE drugs DROP CONSTRAINT IF EXISTS drugs_category_check;

-- Add the updated constraint with IEC included
ALTER TABLE drugs ADD CONSTRAINT drugs_category_check
    CHECK (category IN ('IPD', 'OPD', 'IEC', 'OUTREACH', NULL));

-- Also update order_items table if it has the same constraint
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_category_check;

ALTER TABLE order_items ADD CONSTRAINT order_items_category_check
    CHECK (category IN ('IPD', 'OPD', 'IEC', 'OUTREACH', NULL));

-- Update daily_dispensing_summary table constraint
ALTER TABLE daily_dispensing_summary DROP CONSTRAINT IF EXISTS daily_dispensing_summary_category_check;

ALTER TABLE daily_dispensing_summary ADD CONSTRAINT daily_dispensing_summary_category_check
    CHECK (category IN ('IPD', 'OPD', 'IEC', 'OUTREACH', NULL));


-- Add batch_no column to daily_dispensing_summary table
ALTER TABLE daily_dispensing_summary 
ADD COLUMN IF NOT EXISTS batch_no VARCHAR(100);

-- Create an index for better performance
CREATE INDEX IF NOT EXISTS idx_daily_dispensing_batch_no 
ON daily_dispensing_summary(batch_no);