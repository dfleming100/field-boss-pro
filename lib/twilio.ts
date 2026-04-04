/**
 * Twilio SMS Integration
 * Handles SMS sending for Field Service Pro
 * 
 * Setup:
 * 1. Create Twilio account at twilio.com
 * 2. Get Account SID, Auth Token, and Phone Number
 * 3. Store in super admin integration settings
 * 4. Use this handler to send SMS via Twilio API
 */

import twilio from 'twilio';

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  phoneNumber: string;
}

export async function sendSMS(
  config: TwilioConfig,
  toPhone: string,
  message: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const client = twilio(config.accountSid, config.authToken);
    
    const result = await client.messages.create({
      body: message,
      from: config.phoneNumber,
      to: toPhone,
    });

    return {
      success: true,
      messageId: result.sid,
    };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
    };
  }
}

export async function sendBulkSMS(
  config: TwilioConfig,
  recipients: Array<{ phone: string; message: string }>
): Promise<{ success: number; failed: number; errors: string[] }> {
  const results = { success: 0, failed: 0, errors: [] as string[] };

  for (const { phone, message } of recipients) {
    const result = await sendSMS(config, phone, message);
    if (result.success) {
      results.success++;
    } else {
      results.failed++;
      results.errors.push(`${phone}: ${result.error}`);
    }
  }

  return results;
}

export async function sendAppointmentReminder(
  config: TwilioConfig,
  customerPhone: string,
  appointmentDate: string,
  technicianName: string,
  serviceType: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const message = `Hi! Reminder: ${technicianName} is scheduled to come for ${serviceType} on ${appointmentDate}. Reply STOP to opt-out.`;
  return sendSMS(config, customerPhone, message);
}

export async function sendJobCompletionNotice(
  config: TwilioConfig,
  customerPhone: string,
  invoiceAmount: number,
  jobDescription: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const message = `Thank you! Your ${jobDescription} service has been completed. Total: $${invoiceAmount}. Invoice sent via email.`;
  return sendSMS(config, customerPhone, message);
}
