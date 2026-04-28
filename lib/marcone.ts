// Marcone Parts Supply (mSupplyAPI) client
// OAuth 2.0 Client Credentials grant. Token expires every ~20min; we cache and refresh.
// Docs: https://api.msupply.com/swagger/index.html?url=/swagger/v1/swagger.json

type CachedToken = { token: string; expiresAt: number };
let cachedToken: CachedToken | null = null;

function getEnv() {
  const baseUrl = process.env.MSUPPLY_BASE_URL;
  const clientId = process.env.MSUPPLY_CLIENT_ID;
  const clientSecret = process.env.MSUPPLY_CLIENT_SECRET;
  const customerNumber = process.env.MSUPPLY_CUSTOMER_NUMBER;
  if (!baseUrl || !clientId || !clientSecret) {
    throw new Error("Marcone credentials missing — check MSUPPLY_* env vars");
  }
  return { baseUrl, clientId, clientSecret, customerNumber };
}

export async function getMarconeToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - 30_000 > now) {
    return cachedToken.token;
  }

  const { baseUrl, clientId, clientSecret } = getEnv();
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch(`${baseUrl}AccessToken`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Marcone auth failed (${res.status}): ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  };
  return data.access_token;
}

export async function marconeFetch<T = unknown>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const { baseUrl } = getEnv();
  const token = await getMarconeToken();
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;

  const res = await fetch(`${baseUrl}${cleanPath}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  const text = await res.text();
  let data: any;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!res.ok) {
    throw new Error(`Marcone ${path} failed (${res.status}): ${typeof data === "string" ? data.slice(0, 200) : JSON.stringify(data).slice(0, 200)}`);
  }
  return data as T;
}

export function getMarconeCustomerNumber(): string | undefined {
  return process.env.MSUPPLY_CUSTOMER_NUMBER;
}

// ── Parts ────────────────────────────────────────────────────────────────
// /parts/lookup expects partNumber + lookupType ("Default" | "ByBranch" | "ByZipCode" | "ByGeoCode")
// `make` is optional but recommended — without it the API may return many matches.
export interface PartLookupParams {
  partNumber: string;
  make?: string;
  branchNumber?: string;
  tntShipToZip?: string;
  lookupType?: "Default" | "ByBranch" | "ByZipCode" | "ByGeoCode";
}

export interface PartInfo {
  make: string;
  partNumber: string;
  description: string;
  price: number;
  dealer?: number;
  retail?: number;
  list?: number;
  isDiscontinued?: boolean;
  isDropShipOnly?: boolean;
  totalWarehouseQty?: number;
  inventory?: Array<{ branchNumber?: string; quantity?: number; [k: string]: unknown }>;
  [k: string]: unknown;
}

export interface PartLookupResponse {
  transactionId?: string;
  partResults?: PartInfo[];
}

export async function lookupPart(params: PartLookupParams): Promise<PartLookupResponse> {
  const customerNumber = getMarconeCustomerNumber();
  const body = {
    custNo: customerNumber ? Number(customerNumber) : undefined,
    make: params.make,
    partNumber: params.partNumber,
    branchNumber: params.branchNumber,
    tntShipToZip: params.tntShipToZip,
    lookupType: params.lookupType || "Default",
  };
  return marconeFetch<PartLookupResponse>("parts/lookup", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ── Orders ───────────────────────────────────────────────────────────────
export interface MarconeAddress {
  name?: string;
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  zip?: string;
}

export interface PurchaseOrderItem {
  make: string;
  partNumber: string;
  quantity: number;
  warehouseNumber?: string;
  reference?: string;
}

export interface PurchaseOrderRequest {
  poNumber: string;
  warehouseNumber?: string;
  shippingMethod?: string;
  shipTo: MarconeAddress;
  purchaseOrderItems: PurchaseOrderItem[];
  internalNotes?: string;
  shippingInstructions?: string;
  orderBy?: string;
}

export interface PurchaseOrderResponse {
  transactionId?: string;
  orderNumbers?: string[];
  substitutions?: unknown[];
  status?: string;
  reason?: string;
  success?: boolean;
  errorCode?: string;
}

export async function placePurchaseOrder(req: PurchaseOrderRequest): Promise<PurchaseOrderResponse> {
  const customerNumber = getMarconeCustomerNumber();
  const body = {
    custNo: customerNumber ? Number(customerNumber) : undefined,
    poNumber: req.poNumber,
    warehouseNumber: req.warehouseNumber,
    shippingMethod: req.shippingMethod,
    shipTo: req.shipTo,
    purchaseOrderItems: req.purchaseOrderItems,
    eP_InternalNotes: req.internalNotes,
    eP_ShippingInstructions: req.shippingInstructions,
    eP_OrderBy: req.orderBy,
  };
  return marconeFetch<PurchaseOrderResponse>("orders/purchaseorder", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export interface OrderStatusResponse {
  transactionId?: string;
  orderResults?: Array<{
    orderNumber?: string;
    invoiceNumber?: string;
    poNumber?: string;
    status?: { statusCode?: string; statusDescription?: string; [k: string]: unknown };
    orderDate?: string;
    invoiceDate?: string;
    trackingNumbers?: string[];
    deliveryCharge?: number;
    salesTax?: number;
    totalCharge?: number;
    shippingMethod?: string;
    warehouse?: { warehouseNumber?: string; warehouseName?: string; [k: string]: unknown };
    orderItems?: Array<Record<string, unknown>>;
    [k: string]: unknown;
  }>;
}

export async function getOrderStatus(orderNumber: string): Promise<OrderStatusResponse> {
  const customerNumber = getMarconeCustomerNumber();
  const body = {
    custNo: customerNumber ? Number(customerNumber) : undefined,
    lookupType: "ByOrderNumber",
    orderNumber,
  };
  return marconeFetch<OrderStatusResponse>("orders/orderstatus", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export interface TrackPackageResponse {
  transactionId?: string;
  trackingNumber?: string;
  packageCount?: string;
  events?: Array<{
    dateTime?: string;
    description?: string;
    city?: string;
    state?: string;
    zip?: string;
    [k: string]: unknown;
  }>;
}

export async function trackPackage(trackingNumber: string): Promise<TrackPackageResponse> {
  const customerNumber = getMarconeCustomerNumber();
  const body = {
    custNo: customerNumber ? Number(customerNumber) : undefined,
    trackingNumber,
  };
  return marconeFetch<TrackPackageResponse>("orders/trackpackage", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
