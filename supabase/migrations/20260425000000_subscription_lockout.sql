-- Subscription lockout fields
-- Tracks when paid period ends (for cancellations) and when card first failed (for grace period)

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS subscription_period_end TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_failed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tenants_subscription_period_end
  ON tenants (subscription_period_end);
