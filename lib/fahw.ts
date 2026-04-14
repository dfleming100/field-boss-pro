/**
 * FAHW (First American Home Warranty) API Client
 *
 * Sandbox: https://webdirectbat.fahw.com
 * Swagger: https://webdirectbat.fahw.com/swagger/index.html
 *
 * Auth: POST /v1/authentication/login → Bearer token (JWT)
 * All other endpoints require Authorization: Bearer {token}
 */

// In-memory token cache keyed by tenant_id to support multi-tenant
const tokenCache: Record<number, { token: string; expiresAt: number }> = {};

export interface FAHWCredentials {
  username: string;
  password: string;
  apiUrl: string; // e.g. https://webdirectbat.fahw.com
}

// ── Auth ──

export async function getToken(creds: FAHWCredentials, tenantId: number): Promise<string> {
  const cached = tokenCache[tenantId];
  // Refresh 5 minutes before expiry
  if (cached && cached.expiresAt > Date.now() + 5 * 60 * 1000) {
    return cached.token;
  }

  const res = await fetch(`${creds.apiUrl}/v1/authentication/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: creds.username, password: creds.password }),
  });

  const data = await res.json();
  if (!res.ok || !data.AccessToken) {
    throw new Error(`FAHW login failed: ${data.ErrorDescription || res.statusText}`);
  }

  // Parse JWT exp claim to determine actual expiry
  let expiresAt = Date.now() + 55 * 60 * 1000; // default 55 min
  try {
    const payload = JSON.parse(Buffer.from(data.AccessToken.split(".")[1], "base64").toString());
    if (payload.exp) {
      expiresAt = payload.exp * 1000;
    }
  } catch {}

  tokenCache[tenantId] = { token: data.AccessToken, expiresAt };
  return data.AccessToken;
}

// ── Generic fetch wrapper ──

async function fahwFetch(
  creds: FAHWCredentials,
  tenantId: number,
  method: string,
  path: string,
  body?: any
): Promise<any> {
  const token = await getToken(creds, tenantId);
  const res = await fetch(`${creds.apiUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text, status: res.status };
  }
}

// ── Work Order Endpoints ──

/** Get all work order events (new assignments, status changes, notes, etc.) */
export function getEvents(creds: FAHWCredentials, tenantId: number) {
  return fahwFetch(creds, tenantId, "GET", "/v1/contractor/workorders/events");
}

/** List work orders with optional filters */
export function listWorkOrders(creds: FAHWCredentials, tenantId: number, filters?: {
  workOrderNumber?: string;
  status?: string;
  subStatus?: string;
  claimNumber?: string;
  policyNumber?: string;
}) {
  return fahwFetch(creds, tenantId, "POST", "/v1/contractor/workorders", filters || {});
}

/** Get single work order detail */
export function getWorkOrder(creds: FAHWCredentials, tenantId: number, workOrderId: number) {
  return fahwFetch(creds, tenantId, "GET", `/v1/contractor/workorders/${workOrderId}`);
}

/** Acknowledge a work order */
export function acknowledgeWorkOrder(creds: FAHWCredentials, tenantId: number, workOrderId: number) {
  return fahwFetch(creds, tenantId, "PUT", "/v1/contractor/workorders/acknowledge", { workOrderId });
}

/** Decline a work order */
export function declineWorkOrder(creds: FAHWCredentials, tenantId: number, workOrderId: number, reason: string, brand?: string, serviceItem?: string) {
  return fahwFetch(creds, tenantId, "PUT", "/v1/contractor/workorders/decline", {
    workOrderId, reason, brand: brand || undefined, serviceItem: serviceItem || undefined,
  });
}

// ── Status Updates ──

/** Provide status update on a work order.
 * Note: ServiceFeeCollected is a BOOLEAN (true/false), not a dollar amount.
 * WorkOrderItemId is required for completion.
 * ServiceArrivalDate format: YYYY-MM-DD
 * PartsEta format: YYYY-MM-DD */
export function provideStatus(creds: FAHWCredentials, tenantId: number, payload: {
  workOrderId: number;
  workOrderItemId?: number;
  serviceArrivalDate?: string;
  delayReason?: string;
  serviceFeeCollected?: boolean;
  completionOutcome?: string;
  nonCompletionReason?: string;
  partsEta?: string;
  cancellationReason?: string;
}) {
  // FAHW uses PascalCase field names
  return fahwFetch(creds, tenantId, "PUT", "/v1/contractor/workorders/provide-status", {
    WorkOrderId: payload.workOrderId,
    WorkOrderItemId: payload.workOrderItemId || undefined,
    ServiceArrivalDate: payload.serviceArrivalDate || undefined,
    DelayReason: payload.delayReason || undefined,
    ServiceFeeCollected: payload.serviceFeeCollected ?? undefined,
    CompletionOutcome: payload.completionOutcome || undefined,
    NonCompletionReason: payload.nonCompletionReason || undefined,
    PartsEta: payload.partsEta || undefined,
    CancellationReason: payload.cancellationReason || undefined,
  });
}

/** Mark as on my way — requires WorkOrderItemIds array */
export function onMyWay(creds: FAHWCredentials, tenantId: number, workOrderId: number, workOrderItemIds: number[]) {
  return fahwFetch(creds, tenantId, "PUT", "/v1/contractor/workorders/on-my-way", {
    WorkOrderId: workOrderId,
    WorkOrderItemIds: workOrderItemIds,
  });
}

/** Mark as unable to reach customer */
export function unableToReachCustomer(creds: FAHWCredentials, tenantId: number, workOrderId: number, reason?: string) {
  return fahwFetch(creds, tenantId, "PUT", "/v1/contractor/workorders/unable-to-reach-customer", { workOrderId, reason });
}

/** Mark as unable to schedule */
export function unableToSchedule(creds: FAHWCredentials, tenantId: number, workOrderId: number, reason: string) {
  return fahwFetch(creds, tenantId, "PUT", "/v1/contractor/workorders/unable-to-schedule", { workOrderId, reason });
}

/** Mark job as not completed */
export function jobNotCompleted(creds: FAHWCredentials, tenantId: number, workOrderId: number, reason: string) {
  return fahwFetch(creds, tenantId, "PUT", "/v1/contractor/workorders/job-not-completed", { workOrderId, reason });
}

// ── Scheduling ──

/** Schedule an appointment */
export function scheduleAppointment(creds: FAHWCredentials, tenantId: number, payload: {
  workOrderId: number;
  appointmentDate: string;
  startTime: string;
  endTime: string;
  technicianPartyId?: number;
  appointmentType?: string;
  reason?: string;
}) {
  return fahwFetch(creds, tenantId, "PUT", "/v1/contractor/workorders/schedule-appointment", payload);
}

/** Assign technician to work order */
export function assignTechnician(creds: FAHWCredentials, tenantId: number, workOrderId: number, technicianPartyId: number) {
  return fahwFetch(creds, tenantId, "PUT", "/v1/contractor/workorders/assign-technician", { workOrderId, technicianPartyId });
}

// ── Parts ──

/** Update parts ETA */
export function partsEta(creds: FAHWCredentials, tenantId: number, workOrderId: number, partsEtaDate: string) {
  return fahwFetch(creds, tenantId, "PUT", "/v1/contractor/workorders/parts-eta", { workOrderId, partsEtaDate });
}

/** Parts ordered with no ETA */
export function partsOrderedNoEta(creds: FAHWCredentials, tenantId: number, workOrderId: number, workOrderItemIds: number[]) {
  return fahwFetch(creds, tenantId, "PUT", "/v1/contractor/workorders/parts-ordered-no-eta", { workOrderId, workOrderItemIds });
}

// ── Notes & Attachments ──

/** Create a note on a work order */
export function createNote(creds: FAHWCredentials, tenantId: number, workOrderId: number, note: string) {
  return fahwFetch(creds, tenantId, "PUT", "/v1/contractor/workorders/create-note", { workOrderId, note });
}

/** Create an attachment on a work order */
export function createAttachment(creds: FAHWCredentials, tenantId: number, payload: {
  workOrderId: number;
  documentType: string;
  description?: string;
  fileName: string;
  fileData: string; // base64
}) {
  return fahwFetch(creds, tenantId, "PUT", "/v1/contractor/workorders/create-attachment", payload);
}

/** Get all work order notes */
export function getNotes(creds: FAHWCredentials, tenantId: number) {
  return fahwFetch(creds, tenantId, "GET", "/v1/contractor/workorders/notes");
}

// ── Technicians ──

/** Get list of technicians registered with FAHW */
export function getTechnicians(creds: FAHWCredentials, tenantId: number) {
  return fahwFetch(creds, tenantId, "GET", "/v1/contractor/workorders/technicians");
}

// ── Invoices ──

/** Create contractor invoice */
export function createInvoice(creds: FAHWCredentials, tenantId: number, payload: {
  workOrderId: number;
  invoiceNumber: string;
  invoiceDate: string;
  totalAmount: number;
  laborAmount?: number;
  partsAmount?: number;
  taxAmount?: number;
  invoiceItems?: { description: string; quantity?: number; unitPrice?: number; amount?: number }[];
}) {
  return fahwFetch(creds, tenantId, "PUT", "/v1/contractor/invoices/create", payload);
}

// ── Helpers ──

/** Map FAHW work order lastAction to a Field Boss status */
export function mapFahwStatusToFieldBoss(lastAction: string, subStatus?: string): string {
  const action = (lastAction || "").toLowerCase();
  if (action.includes("completed") || action.includes("job completed")) return "Complete";
  if (action.includes("invoice")) return "Complete";
  if (action.includes("appointment") || action.includes("scheduled")) return "Scheduled";
  if (action.includes("parts") && action.includes("order")) return "Parts Ordered";
  if (action.includes("parts") && (action.includes("arrived") || action.includes("received"))) return "Parts Have Arrived";
  if (action.includes("en route") || action.includes("on my way")) return "Scheduled";
  // Cancelled WOs should NOT be "New" — they'd trigger outreach.
  // Map to Complete so the cron ignores them.
  if (action.includes("cancel")) return "Complete";
  // Only genuinely new assignments get "New" status
  if (action.includes("assigned") || action.includes("dispatched")) return "New";
  // Unknown statuses default to Complete (safe) rather than New (triggers outreach)
  return "Complete";
}

/** Map Field Boss status to a FAHW provide-status payload shape */
export function mapFieldBossToFahwStatus(fbStatus: string, extra?: {
  serviceFeeCollected?: number;
  partsEta?: string;
}) {
  switch (fbStatus) {
    case "Scheduled":
      return null; // Use scheduleAppointment endpoint instead
    case "Parts Ordered":
      return extra?.partsEta
        ? { nonCompletionReason: "I Ordered parts", partsEta: extra.partsEta }
        : { nonCompletionReason: "I Ordered parts" };
    case "Parts Have Arrived":
      return null; // No direct FAHW status — handled by scheduling a return appointment
    case "Complete":
      return {
        completionOutcome: "Completed",
        serviceFeeCollected: extra?.serviceFeeCollected ?? 0,
      };
    default:
      return null;
  }
}
