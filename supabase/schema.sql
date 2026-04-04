-- Field Service Pro Complete Database Schema
-- Multi-tenant SaaS for field service contractors

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "hstore";

-- ============================================================================
-- TENANTS (Organizations)
-- ============================================================================

CREATE TABLE IF NOT EXISTS tenants (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  owner_id UUID NOT NULL,
  plan VARCHAR(50) DEFAULT 'professional', -- professional, enterprise, etc.
  stripe_connect_account_id VARCHAR(255),
  max_technicians INT DEFAULT 10,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- TENANT USERS (Multi-tenant user accounts)
-- ============================================================================

CREATE TABLE IF NOT EXISTS tenant_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id BIGINT NOT NULL,
  auth_uid UUID NOT NULL, -- Supabase auth user ID
  user_email VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL, -- admin, manager, dispatcher, technician
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  UNIQUE(tenant_id, auth_uid),
  UNIQUE(tenant_id, user_email)
);

-- ============================================================================
-- CUSTOMERS
-- ============================================================================

CREATE TABLE IF NOT EXISTS customers (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  customer_name VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  email VARCHAR(255),
  service_address VARCHAR(255),
  city VARCHAR(100),
  state VARCHAR(2),
  zip VARCHAR(10),
  notes TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  INDEX idx_tenant_customer (tenant_id, customer_name)
);

-- ============================================================================
-- ZIPS (Service area ZIP codes)
-- ============================================================================

CREATE TABLE IF NOT EXISTS zips (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  zip_code VARCHAR(10) NOT NULL,
  service_area VARCHAR(100),
  is_available BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  UNIQUE(tenant_id, zip_code)
);

-- ============================================================================
-- TECHNICIANS
-- ============================================================================

CREATE TABLE IF NOT EXISTS technicians (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  tech_name VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  email VARCHAR(255),
  skills VARCHAR(500), -- comma-separated or JSON
  service_zip_start VARCHAR(10),
  service_zip_end VARCHAR(10),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  INDEX idx_tenant_tech (tenant_id, is_active)
);

-- ============================================================================
-- TECHNICIAN ROUTES (Daily service territories)
-- ============================================================================

CREATE TABLE IF NOT EXISTS tech_routes (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  technician_id BIGINT NOT NULL,
  route_name VARCHAR(100),
  start_date DATE,
  end_date DATE,
  assigned_zips TEXT, -- JSON array of ZIP codes
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (technician_id) REFERENCES technicians(id) ON DELETE CASCADE
);

-- ============================================================================
-- ZIP ROUTING RULES
-- ============================================================================

CREATE TABLE IF NOT EXISTS zip_routing_rules (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  zip_code VARCHAR(10) NOT NULL,
  assigned_technician_id BIGINT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_technician_id) REFERENCES technicians(id) ON DELETE SET NULL
);

-- ============================================================================
-- DAYS OFF (Technician availability)
-- ============================================================================

CREATE TABLE IF NOT EXISTS days_off (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  technician_id BIGINT NOT NULL,
  date_off DATE NOT NULL,
  reason VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (technician_id) REFERENCES technicians(id) ON DELETE CASCADE
);

-- ============================================================================
-- TECHNICIAN DAILY CAPACITY
-- ============================================================================

CREATE TABLE IF NOT EXISTS tech_daily_capacity (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  technician_id BIGINT NOT NULL,
  date DATE NOT NULL,
  max_appointments INT DEFAULT 8,
  max_repairs INT DEFAULT 5,
  current_appointments INT DEFAULT 0,
  current_repairs INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (technician_id) REFERENCES technicians(id) ON DELETE CASCADE,
  UNIQUE(technician_id, date)
);

-- ============================================================================
-- WINDOW SETS (Service time windows)
-- ============================================================================

CREATE TABLE IF NOT EXISTS window_sets (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  name VARCHAR(100) NOT NULL,
  windows JSONB, -- Array of {start_time, end_time, label}
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- ============================================================================
-- WORK ORDERS (Jobs/Service requests)
-- ============================================================================

CREATE TABLE IF NOT EXISTS work_orders (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  customer_id BIGINT NOT NULL,
  assigned_technician_id BIGINT,
  job_type VARCHAR(100), -- 'repair', 'service', 'maintenance', 'inspection'
  appliance_type VARCHAR(100), -- 'refrigerator', 'washer', 'dryer', etc.
  description TEXT,
  status VARCHAR(50) DEFAULT 'draft', -- draft, ready_to_schedule, scheduled, in_progress, completed, canceled
  outreach_count INT DEFAULT 0,
  service_date DATE,
  estimated_duration_minutes INT,
  review_text TEXT,
  review_rating INT,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
  FOREIGN KEY (assigned_technician_id) REFERENCES technicians(id) ON DELETE SET NULL,
  INDEX idx_tenant_status (tenant_id, status),
  INDEX idx_tenant_date (tenant_id, service_date)
);

-- ============================================================================
-- APPOINTMENTS (Scheduled service windows)
-- ============================================================================

CREATE TABLE IF NOT EXISTS appointments (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  work_order_id BIGINT NOT NULL,
  technician_id BIGINT NOT NULL,
  appointment_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  window_set_id BIGINT,
  status VARCHAR(50) DEFAULT 'scheduled', -- scheduled, en_route, arrived, completed, canceled
  confirmation_status VARCHAR(50) DEFAULT 'pending', -- pending, confirmed, no_show
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (work_order_id) REFERENCES work_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (technician_id) REFERENCES technicians(id) ON DELETE RESTRICT,
  FOREIGN KEY (window_set_id) REFERENCES window_sets(id) ON DELETE SET NULL,
  INDEX idx_tenant_date (tenant_id, appointment_date),
  INDEX idx_technician_date (technician_id, appointment_date)
);

-- ============================================================================
-- INTEGRATIONS (Twilio, Vapi, n8n, etc.)
-- ============================================================================

CREATE TABLE IF NOT EXISTS tenant_integrations (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  integration_type VARCHAR(50) NOT NULL, -- 'twilio', 'vapi', 'n8n', etc.
  encrypted_keys JSONB NOT NULL, -- Stores encrypted API keys
  encryption_key TEXT NOT NULL, -- AES-256 key for decryption
  is_configured BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  UNIQUE(tenant_id, integration_type)
);

-- ============================================================================
-- SMS LOGS (Audit trail)
-- ============================================================================

CREATE TABLE IF NOT EXISTS sms_logs (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  recipient_phone VARCHAR(20) NOT NULL,
  message_type VARCHAR(50), -- 'appointment_reminder', 'job_completion', 'custom', etc.
  status VARCHAR(20) DEFAULT 'pending', -- 'sent', 'failed', 'bounced', etc.
  twilio_message_id TEXT, -- SID from Twilio
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  INDEX idx_tenant_created (tenant_id, created_at)
);

-- ============================================================================
-- LEAD FORMS (For future lead capture)
-- ============================================================================

CREATE TABLE IF NOT EXISTS lead_forms (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  fields JSONB, -- Dynamic form fields
  webhook_url TEXT, -- n8n webhook endpoint
  is_active BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- ============================================================================
-- LEADS (Captured leads from forms)
-- ============================================================================

CREATE TABLE IF NOT EXISTS leads (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  lead_form_id BIGINT,
  customer_name VARCHAR(255),
  customer_email VARCHAR(255),
  customer_phone VARCHAR(20),
  service_type VARCHAR(100),
  message TEXT,
  status VARCHAR(20) DEFAULT 'new', -- 'new', 'contacted', 'converted', 'archived'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (lead_form_id) REFERENCES lead_forms(id) ON DELETE SET NULL,
  INDEX idx_tenant_status (tenant_id, status)
);

-- ============================================================================
-- ADMIN SETTINGS (Super admin control)
-- ============================================================================

CREATE TABLE IF NOT EXISTS admin_settings (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  setting_key VARCHAR(100) NOT NULL,
  setting_value JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  UNIQUE(tenant_id, setting_key)
);

-- ============================================================================
-- ENABLE ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE zips ENABLE ROW LEVEL SECURITY;
ALTER TABLE technicians ENABLE ROW LEVEL SECURITY;
ALTER TABLE tech_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE zip_routing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE days_off ENABLE ROW LEVEL SECURITY;
ALTER TABLE tech_daily_capacity ENABLE ROW LEVEL SECURITY;
ALTER TABLE window_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_settings ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- RLS HELPER FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION can_access_tenant(tenant_id BIGINT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM tenant_users
    WHERE tenant_id = $1
    AND id = auth.uid()
    AND is_active = TRUE
  );
END;
$$ LANGUAGE PLPGSQL SECURITY DEFINER;

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

-- Tenants: Users can see only their own tenant
CREATE POLICY "tenants_user_access"
  ON tenants
  FOR SELECT
  USING (can_access_tenant(id));

-- Tenant Users: Can see own tenant's users
CREATE POLICY "tenant_users_access"
  ON tenant_users
  FOR SELECT
  USING (can_access_tenant(tenant_id));

-- Customers: Read/Write for all tenant users
CREATE POLICY "customers_access"
  ON customers
  FOR ALL
  USING (can_access_tenant(tenant_id));

-- Zips: Read for all, write for admins
CREATE POLICY "zips_read"
  ON zips
  FOR SELECT
  USING (can_access_tenant(tenant_id));

CREATE POLICY "zips_admin"
  ON zips
  FOR INSERT
  WITH CHECK (
    can_access_tenant(tenant_id) AND
    (SELECT role FROM tenant_users WHERE id = auth.uid() AND tenant_id = zips.tenant_id LIMIT 1) = 'admin'
  );

-- Technicians: Read for all, write for admins
CREATE POLICY "technicians_read"
  ON technicians
  FOR SELECT
  USING (can_access_tenant(tenant_id));

CREATE POLICY "technicians_admin"
  ON technicians
  FOR INSERT
  WITH CHECK (
    can_access_tenant(tenant_id) AND
    (SELECT role FROM tenant_users WHERE id = auth.uid() AND tenant_id = technicians.tenant_id LIMIT 1) = 'admin'
  );

-- Work Orders: Full access for tenant users
CREATE POLICY "work_orders_access"
  ON work_orders
  FOR ALL
  USING (can_access_tenant(tenant_id));

-- Appointments: Full access for tenant users
CREATE POLICY "appointments_access"
  ON appointments
  FOR ALL
  USING (can_access_tenant(tenant_id));

-- Integrations: Admin access only
CREATE POLICY "integrations_admin"
  ON tenant_integrations
  FOR ALL
  USING (
    can_access_tenant(tenant_id) AND
    (SELECT role FROM tenant_users WHERE id = auth.uid() AND tenant_id = tenant_integrations.tenant_id LIMIT 1) = 'admin'
  );

-- SMS Logs: Read for admins/dispatchers
CREATE POLICY "sms_logs_read"
  ON sms_logs
  FOR SELECT
  USING (can_access_tenant(tenant_id));

CREATE POLICY "sms_logs_insert"
  ON sms_logs
  FOR INSERT
  WITH CHECK (true);

-- Lead Forms: Admin only
CREATE POLICY "lead_forms_admin"
  ON lead_forms
  FOR ALL
  USING (
    can_access_tenant(tenant_id) AND
    (SELECT role FROM tenant_users WHERE id = auth.uid() AND tenant_id = lead_forms.tenant_id LIMIT 1) = 'admin'
  );

-- Leads: Read for admins, insert for anyone
CREATE POLICY "leads_read"
  ON leads
  FOR SELECT
  USING (can_access_tenant(tenant_id));

CREATE POLICY "leads_insert"
  ON leads
  FOR INSERT
  WITH CHECK (true);

-- Admin Settings: Super admin only
CREATE POLICY "admin_settings_access"
  ON admin_settings
  FOR ALL
  USING (
    can_access_tenant(tenant_id) AND
    (SELECT role FROM tenant_users WHERE id = auth.uid() AND tenant_id = admin_settings.tenant_id LIMIT 1) = 'admin'
  );

-- ============================================================================
-- CREATE INDICES FOR PERFORMANCE
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_tenant_users_tenant ON tenant_users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_customers_tenant ON customers(tenant_id, customer_name);
CREATE INDEX IF NOT EXISTS idx_technicians_tenant ON technicians(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_work_orders_tenant ON work_orders(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_work_orders_date ON work_orders(tenant_id, service_date);
CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(tenant_id, appointment_date);
CREATE INDEX IF NOT EXISTS idx_appointments_tech ON appointments(technician_id, appointment_date);
CREATE INDEX IF NOT EXISTS idx_tenant_integrations_type ON tenant_integrations(tenant_id, integration_type);
CREATE INDEX IF NOT EXISTS idx_sms_logs_status ON sms_logs(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_admin_settings_key ON admin_settings(tenant_id, setting_key);
