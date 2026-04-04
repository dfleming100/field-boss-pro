-- Add auth_uid column to tenant_users table
-- This migration adds the missing auth_uid column for proper user authentication

ALTER TABLE tenant_users ADD COLUMN IF NOT EXISTS auth_uid UUID;

-- Add unique constraint on tenant_id + auth_uid
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'tenant_users_tenant_id_auth_uid_key'
    ) THEN
        ALTER TABLE tenant_users ADD CONSTRAINT tenant_users_tenant_id_auth_uid_key UNIQUE (tenant_id, auth_uid);
    END IF;
END $$;