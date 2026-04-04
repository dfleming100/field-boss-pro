# Field Service Pro - Next.js Frontend

Modern Supabase + Next.js 14 SaaS application with multi-tenant support, auth, and Stripe Connect integration.

## Architecture

```
nextjs-app/
├── app/                      # Next.js App Router
│   ├── layout.tsx           # Root layout with AuthProvider
│   ├── page.tsx             # Index (redirects to login/dashboard)
│   ├── login/               # Login page
│   ├── signup/              # Signup & email confirmation
│   ├── onboard/             # 2-step tenant onboarding
│   └── dashboard/           # Protected dashboard (coming soon)
├── lib/
│   ├── supabase.ts          # Supabase client + admin
│   └── AuthContext.tsx      # React auth context (useAuth hook)
├── public/                  # Static assets
├── .env.local.example       # Environment variables template
├── package.json
├── next.config.js
├── tailwind.config.ts
├── tsconfig.json
└── middleware.ts            # Route protection + auth checks

```

## Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
```bash
cp .env.local.example .env.local
```

**Fill in your Supabase credentials:**
- `NEXT_PUBLIC_SUPABASE_URL` - Your Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Anon key (safe for browser)
- `SUPABASE_SERVICE_ROLE_KEY` - Service role (server-only)

### 3. Deploy Supabase Schema
```bash
# Using supabase CLI
supabase link --project-ref your-project
supabase db push < ../supabase/schema.sql
```

Or paste the SQL directly in Supabase console:
- Settings → SQL Editor → New Query
- Paste contents of `supabase/schema.sql`
- Run

### 4. Run Development Server
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Key Flows

### User Onboarding

1. **Signup** (`/signup`)
   - Create account with email/password
   - Supabase sends confirmation email

2. **Email Confirmation**
   - User clicks link in email
   - Email verified in Supabase auth

3. **Tenant Onboarding** (`/onboard`)
   - Step 1: Create organization
     - Tenant record created in `tenants` table
     - Current user added as admin to `tenant_users` table
   - Step 2: Setup overview
     - Ready to access dashboard

4. **Dashboard** (`/dashboard`)
   - Protected route (RLS verified)
   - User sees their tenant's data only

### Authentication

- `AuthContext` wraps entire app
- `useAuth()` hook provides:
  - `user` - Supabase auth user
  - `tenantUser` - Current tenant user record
  - `session` - Auth session
  - `signUp()`, `signIn()`, `signOut()` - Auth methods
  - `loading`, `error` - State management

### Row-Level Security (RLS)

All data queries automatically scoped to user's tenant via:
1. `can_access_tenant()` helper function
2. RLS policies on all tables filter by tenant_id
3. User's tenant_id verified from JWT

**Example:** User can only see customers in their tenant
```sql
-- Supabase RLS policy
create policy "customers tenant read" on customers 
  for select using (can_access_tenant(tenant_id));
```

## Core Components

### useAuth Hook
```tsx
const { user, tenantUser, signIn, signOut, loading } = useAuth();

if (loading) return <div>Loading...</div>;
if (!user) return <Redirect to="/login" />;

return <Dashboard user={tenantUser} />;
```

### Protected Pages
```tsx
"use client";

export default function Page() {
  const { user } = useAuth();
  
  if (!user) return <Redirect to="/login" />;
  return <Content />;
}
```

## Production Deployment

### Deploy to Vercel

```bash
# 1. Push code to GitHub
git push origin main

# 2. In Vercel dashboard:
#    - Connect GitHub repo
#    - Add environment variables (from .env.local)
#    - Deploy

# 3. After deployment, add Vercel URL to Supabase allowed redirect URLs:
#    Settings → Auth → Redirect URLs
#    Add: https://your-domain.vercel.app/**
```

### Environment Variables (Production)

Set in Vercel dashboard:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

## Next Steps

After deploying, build out:
1. **Step 3**: Core field service UI (job board, customer list, dispatch)
2. **Step 4**: Stripe Connect setup (per-tenant billing)
3. **Step 5**: GitHub + Vercel CI/CD pipeline

## API Endpoints (to add)

- `POST /api/auth/signup` - Custom signup
- `POST /api/auth/signin` - Custom signin  
- `POST /api/tenants` - Create organization
- `GET /api/jobs` - List work orders (RLS scoped)
- `POST /api/stripe/connect` - Stripe Connect account setup

## Troubleshooting

**Stuck at login?**
- Check `.env.local` has correct Supabase keys
- Verify email is confirmed in auth
- Check browser console for errors

**RLS denying access?**
- Ensure `tenant_users` record exists for user
- Confirm `auth_uid` matches session user ID
- Check RLS policy allows your role

**Redirect loops?**
- Clear cookies: `Application → Storage → Clear Site Data`
- Ensure auth state syncing in AuthContext

## Support

For Supabase issues: https://supabase.io/docs
For Next.js docs: https://nextjs.org/docs
