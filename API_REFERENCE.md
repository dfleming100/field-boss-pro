# Field Service Pro - API Reference

## Base URL

```
Development: http://localhost:3000/api
Production: https://your-app.vercel.app/api
```

## Authentication

All requests include auth header:
```
Authorization: Bearer <supabase_session_token>
```

---

## SMS API

### Send SMS

**Endpoint:** `POST /api/sms/send`

**Request:**
```json
{
  "tenantId": "123",
  "toPhone": "+16505551234",
  "messageType": "custom",
  "message": "Hello! Your appointment is confirmed."
}
```

**Message Types:**
- `custom` - Arbitrary message
- `appointment_reminder` - Auto-formatted appointment reminder
- `job_completion` - Auto-formatted completion notice

**Response:**
```json
{
  "success": true,
  "messageId": "SM1234567890abcdef1234567890abcdef"
}
```

**Error:**
```json
{
  "error": "No Twilio integration configured for tenant"
}
```

---

## Integrations API

### Get Integration Credentials

**Endpoint:** `GET /api/integrations/[tenantId]/[type]`

**Params:**
- `tenantId` - Tenant ID
- `type` - Integration type: `twilio`, `vapi`, `n8n`

**Response:**
```json
{
  "tenantId": "123",
  "type": "twilio",
  "credentials": {
    "accountSid": "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "authToken": "your_auth_token",
    "phoneNumber": "+16505551234"
  },
  "isConfigured": true
}
```

### Create/Update Integration

**Endpoint:** `POST /api/integrations/[tenantId]/[type]`

**Request:**
```json
{
  "credentials": {
    "accountSid": "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "authToken": "your_auth_token",
    "phoneNumber": "+16505551234"
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "twilio integration updated",
  "tenantId": "123",
  "type": "twilio"
}
```

### Delete Integration

**Endpoint:** `DELETE /api/integrations/[tenantId]/[type]`

**Response:**
```json
{
  "success": true,
  "message": "twilio integration removed"
}
```

---

## Stripe API

### Create Connect Account

**Endpoint:** `POST /api/stripe/create-connect-account`

**Request:**
```json
{
  "tenantId": "123"
}
```

**Response:**
```json
{
  "success": true,
  "authorizationUrl": "https://connect.stripe.com/expressions/onboarding?..."
}
```

User is redirected to Stripe onboarding flow.

### Stripe Webhook

**Endpoint:** `POST /api/stripe/webhook`

**Events Handled:**
- `account.updated` - Stripe Connect account updated
- `charge.succeeded` - Payment successful
- `charge.failed` - Payment failed

---

## Database Tables & Queries

### Customers

```sql
GET /api/customers?tenantId={id}
POST /api/customers
PUT /api/customers/{id}
DELETE /api/customers/{id}
```

### Work Orders

```sql
GET /api/work-orders?tenantId={id}&status={status}
POST /api/work-orders
PUT /api/work-orders/{id}
DELETE /api/work-orders/{id}
```

### Appointments

```sql
GET /api/appointments?tenantId={id}&date={date}
POST /api/appointments
PUT /api/appointments/{id}
DELETE /api/appointments/{id}
```

### Technicians

```sql
GET /api/technicians?tenantId={id}
POST /api/technicians
PUT /api/technicians/{id}
DELETE /api/technicians/{id}
```

---

## Billing API

### Calculate Tiered Pricing

**Function:** `calculateBilling(techCount: number)`

**Example:**
```typescript
import { calculateBilling } from '@/lib/billing';

const billing = calculateBilling(5);
// Returns:
// {
//   baseFee: 99,
//   includedTechs: 3,
//   additionalTechs: 2,
//   additionalFee: 100,
//   totalMonthlyCost: 199,
//   costPerTech: 39.80
// }
```

---

## Authentication Flows

### Login

```typescript
import { useAuth } from '@/lib/AuthContext';

const { signIn } = useAuth();
const { user, error } = await signIn(email, password);
```

### Signup

```typescript
const { signUp } = useAuth();
const { user, error } = await signUp(email, password);
```

### Logout

```typescript
const { signOut } = useAuth();
await signOut();
```

### Get Current Tenant

```typescript
const { tenantUser } = useAuth();
const tenantId = tenantUser?.tenant_id;
const role = tenantUser?.role; // admin, manager, dispatcher, technician
```

---

## Error Responses

All errors return JSON with status code:

```json
{
  "error": "Error message here"
}
```

**Common Status Codes:**
- `400` - Bad request (missing parameters)
- `401` - Unauthorized (missing auth token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not found (resource doesn't exist)
- `500` - Server error

---

## Rate Limiting

No built-in rate limiting. Recommended limits:
- Customers: 100 requests/minute
- SMS: 10 requests/minute (Twilio rate limit)
- Stripe: 1 request/second

---

## Encryption

API keys stored with AES-256-GCM:

```typescript
import { encryptKey, decryptKey } from '@/lib/encryption';

const key = generateEncryptionKey(); // 64 hex chars
const encrypted = encryptKey(plaintext, key);
const plaintext = decryptKey(encrypted, key);
```

Format: `iv:authTag:encryptedData`

---

## Testing with cURL

### Send SMS

```bash
curl -X POST http://localhost:3000/api/sms/send \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "123",
    "toPhone": "+16505551234",
    "messageType": "custom",
    "message": "Test message"
  }'
```

### Get Integration

```bash
curl -X GET http://localhost:3000/api/integrations/123/twilio \
  -H "Authorization: Bearer your_token"
```

### Create Integration

```bash
curl -X POST http://localhost:3000/api/integrations/123/twilio \
  -H "Content-Type: application/json" \
  -d '{
    "credentials": {
      "accountSid": "AC...",
      "authToken": "...",
      "phoneNumber": "+1..."
    }
  }'
```

---

## Webhooks

### Stripe Webhook Signature Verification

```typescript
import Stripe from 'stripe';

const event = Stripe.webhooks.constructEvent(
  body,
  signature,
  process.env.STRIPE_WEBHOOK_SECRET
);
```

### Configure Webhooks

**Stripe Dashboard:**
1. Settings → Webhooks
2. Add endpoint: `https://your-app.vercel.app/api/stripe/webhook`
3. Events: `account.updated`, `charge.succeeded`, `charge.failed`
4. Copy signing secret to env: `STRIPE_WEBHOOK_SECRET`

---

## Performance Tips

1. Use indexes on tenant_id and status fields
2. Batch SMS sends with `sendBulkSMS()`
3. Cache customer/tech lists in React state
4. Use SWR or TanStack Query for data fetching
5. Monitor RLS policy performance in Supabase dashboard
