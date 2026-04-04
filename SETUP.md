# Field Service Pro - Setup & Deployment Guide

A ServiceTitan competitor for small field service contractors (< 10 techs). Built with Next.js, Supabase, Stripe Connect, and Twilio.

## Tech Stack

- **Frontend**: Next.js 14, React 18, TypeScript, Tailwind CSS
- **Backend**: Next.js API Routes, Supabase (PostgreSQL)
- **Authentication**: Supabase Auth + Custom Multi-tenant Context
- **Payments**: Stripe Connect (per-tenant accounts)
- **Messaging**: Twilio (SMS), Vapi (voice AI)
- **Automation**: n8n (workflow automation)
- **Deployment**: Vercel + Supabase

## Project Structure

```
nextjs-app/
├── app/
│   ├── api/                    # API routes (Stripe, SMS, integrations)
│   ├── admin/                  # Super admin console
│   ├── dashboard/              # Tenant dashboard (billing, etc.)
│   ├── jobs/                   # Job board (work orders)
│   ├── customers/              # Customer management
│   ├── technicians/            # (Planned) Technician management
│   ├── appointments/           # (Planned) Calendar
│   └── globals.css             # Light theme styling
├── lib/
│   ├── AuthContext.tsx         # Multi-tenant auth state
│   ├── supabase.ts             # Supabase client config
│   ├── billing.ts              # Tiered pricing calculations
│   ├── twilio.ts               # Twilio SMS helpers
│   ├── encryption.ts           # AES-256 key management
│   └── vapi.ts                 # (Planned) Vapi voice integration
├── supabase/
│   ├── schema.sql              # Complete database schema
│   └── migrations/             # Migration files
└── package.json
```

## Setup Instructions

### 1. Environment Variables

Create `.env.local`:

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Stripe
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Twilio (optional, for SMS features)
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+1...

# Deployment
VERCEL_URL=https://your-app.vercel.app
```

### 2. Supabase Setup

1. Create a new Supabase project
2. Create `.sql` file from `/supabase/schema.sql`
3. Run the SQL in Supabase editor to create all tables
4. Enable Authentication (Email/Password)
5. Configure RLS policies (see schema.sql)

### 3. Database Initialization

```bash
# Initialize Supabase locally (optional)
supabase init
supabase db push

# Or deploy directly to cloud Supabase project
```

### 4. Install Dependencies

```bash
npm install
# or
yarn install
```

### 5. Run Development Server

```bash
npm run dev
# or
yarn dev
```

Visit `http://localhost:3000`

## Deployment to Vercel

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/your-repo.git
git push -u origin main
```

### 2. Deploy to Vercel

1. Go to [vercel.com](https://vercel.com)
2. Import your GitHub project
3. Set environment variables (from `.env.local`)
4. Deploy

### 3. Post-Deployment

- Visit your Vercel domain
- Create first super admin account via `/signup`
- Configure Stripe Connect details in admin panel
- Add Twilio credentials (optional, for SMS)

## Key Features

### Phase 1: MVP ✅
- [x] Multi-tenant authentication
- [x] Job board (work orders list + filtering)
- [x] Customer management (CRUD)
- [x] Technician setup
- [x] Billing page with tiered pricing ($99 base + 3 techs, $50 each additional)
- [x] Stripe Connect framework (stub)

### Phase 2: Customer Management
- [ ] Customer detail view with work order history
- [ ] Customer communication history
- [ ] Customer notes and preferences

### Phase 3: Technician & Scheduling
- [ ] Technician management (skills, ZIP coverage)
- [ ] Appointment calendar
- [ ] Drag-to-assign scheduling
- [ ] Route optimization

### Phase 4: Integrations
- [ ] Twilio SMS (appointment reminders, completion notices)
- [ ] Vapi voice AI (automated confirmations)
- [ ] n8n webhook triggers (lead capture, job creation)

### Phase 5: Advanced
- [ ] Invoicing & payment collection
- [ ] Photo/documentation on jobs
- [ ] Mobile technician app
- [ ] Analytics dashboard

## Database Schema

### Core Tables

- **tenants** - Organizations
- **tenant_users** - User accounts with roles (admin, manager, dispatcher, technician)
- **customers** - Service customers
- **technicians** - Field service techs
- **work_orders** - Jobs/service requests
- **appointments** - Scheduled service windows
- **zips** - Service area ZIP codes
- **days_off** - Tech availability
- **tech_daily_capacity** - Max appointments/repairs per day

### Integration Tables

- **tenant_integrations** - API keys (Twilio, Vapi, n8n)
- **sms_logs** - SMS audit trail
- **lead_forms** - Dynamic lead capture forms
- **leads** - Captured leads
- **admin_settings** - Super admin config

## API Endpoints

### Authentication
- `POST /api/auth/signup` - Create account
- `POST /api/auth/login` - Sign in
- `POST /api/auth/logout` - Sign out
- `POST /api/auth/onboard` - Onboarding flow

### Stripe
- `POST /api/stripe/create-connect-account` - Create Stripe account
- `POST /api/stripe/webhook` - Webhook handler

### Integrations
- `GET /api/integrations/[tenantId]/[type]` - Get credentials
- `POST /api/integrations/[tenantId]/[type]` - Save credentials
- `DELETE /api/integrations/[tenantId]/[type]` - Remove credentials

### SMS
- `POST /api/sms/send` - Send SMS message

## Tiered Billing

**Professional Plan:**
- $99/month base fee
- Includes up to 3 technicians
- $50/month per additional technician (4+)

**Example:**
- 1 tech: $99/month ($99 per tech)
- 3 techs: $99/month ($33 per tech)
- 4 techs: $149/month ($37.25 per tech)
- 5 techs: $199/month ($39.80 per tech)

Calculated automatically in [billing.ts](lib/billing.ts)

## Stripe Connect Setup

1. Create Stripe account at stripe.com
2. Set up Connect (for platform payments)
3. Get publishable and secret keys
4. In super admin panel:
   - Click "Connect Stripe"
   - Authorizes redirect to Stripe onboarding
   - Stripe account ID stored in `tenants.stripe_connect_account_id`

## Twilio Setup

1. Create Twilio account
2. Get Account SID, Auth Token, Phone Number
3. In super admin panel (Integrations):
   - Add Twilio credentials
   - API keys encrypted with AES-256
   - Can send SMS via `POST /api/sms/send`

## RLS Security

All tables use Row-Level Security:
- Users can only see their tenant's data
- Admins have additional permissions
- `can_access_tenant()` helper function enforces isolation
- Policies checked on every query

## Authentication Flow

1. User signs up → Supabase Auth creates account
2. Super admin assigns to tenant → `tenant_users` record created
3. User logs in → AuthContext loads `user` + `tenantUser`
4. Protected routes check `useAuth()` hook
5. All queries include `tenant_id` check for RLS

## File Organization

```
lib/
├── AuthContext.tsx       # Auth state + multi-tenant logic
├── supabase.ts           # Supabase client
├── billing.ts            # Tiered pricing math
├── twilio.ts             # SMS sending
├── encryption.ts         # AES-256 key encryption
└── vapi.ts              # Voice AI (future)

app/api/
├── auth/                 # Authentication endpoints
├── stripe/               # Payment integration
├── integrations/         # Twilio, Vapi setup
├── sms/send              # SMS sending endpoint
└── webhooks/             # Stripe, Twilio callbacks

app/
├── login/signup          # Public auth pages
├── dashboard/            # Tenant dashboard
├── admin/                # Super admin
├── jobs/                 # Work orders
├── customers/            # Customer management
└── technicians/          # (Planned) Tech management
```

## Monitoring & Debugging

**Logs:**
- SMS sent → `sms_logs` table
- Stripe events → webhook logs
- Auth errors → browser console

**Testing:**
- SMS: Use Twilio test mode with test phone numbers
- Stripe: Use test keys (pk_test_*, sk_test_*)
- Database: Query directly in Supabase dashboard

## Troubleshooting

### "Can't find module" errors
- Run `npm install` to ensure all dependencies installed
- Check Node.js version (14+)

### RLS permission denied
- Verify `tenant_users` record exists
- Check `is_active = TRUE`
- Confirm `role` is set correctly

### Stripe Connect fails
- Use publishable (pk_) and secret (sk_) keys separately
- Webhook secret must match Stripe dashboard
- Test with test keys first (pk_test_*, sk_test_*)

### SMS not sending
- Verify Twilio credentials in integrations table
- Check encryption key matches
- Confirm phone number format: +1XXXXXXXXXXXX

## Future Enhancements

- [ ] Mobile app (React Native)
- [ ] Route optimization (Google Maps API)
- [ ] Payment processing (Square, PayPal)
- [ ] Time tracking
- [ ] Photo documentation
- [ ] Customer portal (self-service)
- [ ] Advanced analytics
- [ ] Predictive maintenance

## Support

For issues or questions:
1. Check the [conversion guide](CONVERSION_GUIDE.md)
2. Review Airtable base mapping
3. Contact support@fieldservicepro.com

## License

Proprietary - All rights reserved
