-- ============================================================================
-- Add missing columns needed by n8n workflow logic
-- ============================================================================

-- work_orders: columns for outreach tracking, completion, reviews, warranty
ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS work_order_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS last_outreach_date TIMESTAMP,
  ADD COLUMN IF NOT EXISTS completed_date TIMESTAMP,
  ADD COLUMN IF NOT EXISTS review_requested BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS review_requested_date TIMESTAMP,
  ADD COLUMN IF NOT EXISTS first_outreach_date TIMESTAMP,
  ADD COLUMN IF NOT EXISTS warranty_company VARCHAR(100),
  ADD COLUMN IF NOT EXISTS warranty_wo_number VARCHAR(100),
  ADD COLUMN IF NOT EXISTS previous_status VARCHAR(50);

-- Create index for outreach queries
CREATE INDEX IF NOT EXISTS idx_wo_outreach
  ON work_orders(tenant_id, status, outreach_count);

-- Create index for review collection queries
CREATE INDEX IF NOT EXISTS idx_wo_review
  ON work_orders(tenant_id, status, review_requested, completed_date);

-- ============================================================================
-- Status change trigger function
-- Fires AFTER UPDATE when status column changes
-- Logs the change and can call Edge Functions via pg_net or webhooks
-- ============================================================================

CREATE OR REPLACE FUNCTION notify_status_change()
RETURNS TRIGGER AS $$
DECLARE
  payload JSON;
BEGIN
  -- Only fire if status actually changed
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    -- Auto-stamp completed_date when status changes to 'completed'
    IF NEW.status = 'completed' AND NEW.completed_date IS NULL THEN
      NEW.completed_date := NOW();
    END IF;

    -- Store previous status for reference
    NEW.previous_status := OLD.status;

    -- Always update updated_at
    NEW.updated_at := NOW();

    -- Build payload for webhook/edge function
    payload := json_build_object(
      'event', 'status_change',
      'work_order_id', NEW.id,
      'tenant_id', NEW.tenant_id,
      'customer_id', NEW.customer_id,
      'assigned_technician_id', NEW.assigned_technician_id,
      'work_order_number', NEW.work_order_number,
      'old_status', OLD.status,
      'new_status', NEW.status,
      'service_date', NEW.service_date,
      'job_type', NEW.job_type,
      'appliance_type', NEW.appliance_type,
      'warranty_company', NEW.warranty_company,
      'timestamp', NOW()
    );

    -- Send to pg_notify channel (Edge Functions or listeners can subscribe)
    PERFORM pg_notify('work_order_status_change', payload::text);

    -- Also insert into a status_changes log table for audit
    INSERT INTO work_order_status_log (
      work_order_id, tenant_id, old_status, new_status, changed_at
    ) VALUES (
      NEW.id, NEW.tenant_id, OLD.status, NEW.status, NOW()
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Status change audit log table
-- ============================================================================

CREATE TABLE IF NOT EXISTS work_order_status_log (
  id BIGSERIAL PRIMARY KEY,
  work_order_id BIGINT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  old_status VARCHAR(50),
  new_status VARCHAR(50) NOT NULL,
  changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_status_log_wo
  ON work_order_status_log(work_order_id, changed_at);

ALTER TABLE work_order_status_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY status_log_tenant_access ON work_order_status_log
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM tenant_users
      WHERE tenant_users.tenant_id = work_order_status_log.tenant_id
        AND tenant_users.auth_uid = auth.uid()
        AND tenant_users.is_active = true
    )
  );

-- ============================================================================
-- Attach trigger to work_orders table
-- ============================================================================

DROP TRIGGER IF EXISTS trg_work_order_status_change ON work_orders;

CREATE TRIGGER trg_work_order_status_change
  BEFORE UPDATE ON work_orders
  FOR EACH ROW
  EXECUTE FUNCTION notify_status_change();

-- ============================================================================
-- Outreach update trigger
-- Auto-sets first_outreach_date on first outreach
-- ============================================================================

CREATE OR REPLACE FUNCTION update_outreach_tracking()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.outreach_count > 0 AND OLD.outreach_count = 0 THEN
    NEW.first_outreach_date := COALESCE(NEW.first_outreach_date, NOW());
  END IF;
  IF NEW.outreach_count > OLD.outreach_count THEN
    NEW.last_outreach_date := NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_outreach_tracking ON work_orders;

CREATE TRIGGER trg_outreach_tracking
  BEFORE UPDATE ON work_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_outreach_tracking();
