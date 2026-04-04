import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendSMS, sendAppointmentReminder, sendJobCompletionNotice } from '@/lib/twilio';
import crypto from 'crypto';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Helper to decrypt API keys (AES-256-GCM)
function decryptKey(encryptedKey: string, tenantSecret: string): string {
  try {
    const [iv, authTag, encryptedData] = encryptedKey.split(':');
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      Buffer.from(tenantSecret, 'hex').slice(0, 32),
      Buffer.from(iv, 'hex')
    );
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));
    
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    throw new Error('Failed to decrypt API key');
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tenantId, messageType, data, toPhone, message } = body;

    if (!tenantId || !toPhone) {
      return NextResponse.json(
        { error: 'Missing required fields: tenantId, toPhone' },
        { status: 400 }
      );
    }

    // Fetch tenant integrations
    const { data: integration, error: integrationError } = await supabase
      .from('tenant_integrations')
      .select('encrypted_keys, encryption_key')
      .eq('tenant_id', tenantId)
      .eq('integration_type', 'twilio')
      .single();

    if (integrationError || !integration) {
      return NextResponse.json(
        { error: 'Twilio not configured for this tenant' },
        { status: 400 }
      );
    }

    // Decrypt API keys
    const encryptedKeys = JSON.parse(integration.encrypted_keys);
    const accountSid = decryptKey(encryptedKeys.accountSid, integration.encryption_key);
    const authToken = decryptKey(encryptedKeys.authToken, integration.encryption_key);
    const phoneNumber = encryptedKeys.phoneNumber; // Phone number doesn't need decryption

    // Send SMS based on message type
    let result;
    switch (messageType) {
      case 'custom':
        result = await sendSMS(
          { accountSid, authToken, phoneNumber },
          toPhone,
          message
        );
        break;

      case 'appointment_reminder':
        result = await sendAppointmentReminder(
          { accountSid, authToken, phoneNumber },
          toPhone,
          data.appointmentDate,
          data.technicianName,
          data.serviceType
        );
        break;

      case 'job_completion':
        result = await sendJobCompletionNotice(
          { accountSid, authToken, phoneNumber },
          toPhone,
          data.invoiceAmount,
          data.jobDescription
        );
        break;

      default:
        return NextResponse.json(
          { error: 'Unknown message type' },
          { status: 400 }
        );
    }

    if (result.success) {
      // Log SMS sent
      await supabase.from('sms_logs').insert({
        tenant_id: tenantId,
        recipient_phone: toPhone,
        message_type: messageType,
        status: 'sent',
        twilio_message_id: result.messageId,
      });

      return NextResponse.json({ success: true, messageId: result.messageId });
    } else {
      return NextResponse.json(
        { error: result.error },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('SMS API error:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
