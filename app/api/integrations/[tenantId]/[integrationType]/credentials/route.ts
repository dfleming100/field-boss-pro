import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { encryptKey, decryptKey, generateEncryptionKey } from '@/lib/encryption';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * GET /api/integrations/[tenantId]/[integrationType]/credentials
 * Retrieve integration credentials (decrypted)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { tenantId: string; integrationType: string } }
) {
  try {
    const { tenantId, integrationType } = params;

    // Verify super admin access
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // In production, verify the token with Supabase auth
    // This is a simplified check

    const { data, error } = await supabase
      .from('tenant_integrations')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('integration_type', integrationType)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: 'Integration not configured' },
        { status: 404 }
      );
    }

    // Decrypt the keys before returning
    const encryptedKeys = JSON.parse(data.encrypted_keys);
    const decryptedKeys: Record<string, string> = {};
    
    for (const [name, value] of Object.entries(encryptedKeys)) {
      if (typeof value === 'string' && value.includes(':')) {
        // This is encrypted, decrypt it
        try {
          decryptedKeys[name] = decryptKey(value, data.encryption_key);
        } catch {
          decryptedKeys[name] = '[Failed to decrypt]';
        }
      } else {
        // Not encrypted (e.g., phone number)
        decryptedKeys[name] = value as string;
      }
    }

    return NextResponse.json({
      tenantId: data.tenant_id,
      type: data.integration_type,
      credentials: decryptedKeys,
      isConfigured: data.is_configured,
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/integrations/[tenantId]/[integrationType]/credentials
 * Create or update integration credentials (encrypted)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { tenantId: string; integrationType: string } }
) {
  try {
    const { tenantId, integrationType } = params;
    const body = await request.json();
    const { credentials } = body;

    if (!credentials || Object.keys(credentials).length === 0) {
      return NextResponse.json(
        { error: 'Credentials required' },
        { status: 400 }
      );
    }

    // Generate or retrieve encryption key
    let { data: existingIntegration } = await supabase
      .from('tenant_integrations')
      .select('encryption_key')
      .eq('tenant_id', tenantId)
      .eq('integration_type', integrationType)
      .single();

    const encryptionKey = existingIntegration?.encryption_key || generateEncryptionKey();

    // Encrypt all credentials
    const encryptedKeys: Record<string, string> = {};
    for (const [name, value] of Object.entries(credentials)) {
      if (typeof value === 'string') {
        // Only encrypt sensitive fields (not phone numbers, etc.)
        if (name === 'accountSid' || name === 'authToken' || name === 'apiKey') {
          encryptedKeys[name] = encryptKey(value, encryptionKey);
        } else {
          encryptedKeys[name] = value;
        }
      }
    }

    // Upsert the integration
    const { error } = await supabase
      .from('tenant_integrations')
      .upsert(
        {
          tenant_id: Number(tenantId),
          integration_type: integrationType,
          encrypted_keys: JSON.stringify(encryptedKeys),
          encryption_key: encryptionKey,
          is_configured: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'tenant_id,integration_type' }
      );

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `${integrationType} integration updated`,
      tenantId,
      type: integrationType,
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/integrations/[tenantId]/[integrationType]/credentials
 * Remove integration credentials
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { tenantId: string; integrationType: string } }
) {
  try {
    const { tenantId, integrationType } = params;

    const { error } = await supabase
      .from('tenant_integrations')
      .update({ is_configured: false })
      .eq('tenant_id', tenantId)
      .eq('integration_type', integrationType);

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `${integrationType} integration removed`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
