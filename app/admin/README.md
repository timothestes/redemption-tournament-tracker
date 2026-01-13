# Admin System

This application uses a simple table-based approach for admin access control, following Supabase best practices.

## How It Works

- Admin users are stored in the `public.admin_users` table
- The system uses `check_admin_role()` function to verify permissions
- Row Level Security (RLS) policies control who can manage admins
- No hardcoded emails or sensitive data in the codebase

## Managing Admins

### Find a user's UUID by email:
```sql
SELECT id, email FROM auth.users WHERE email = 'user@example.com';
```

### Grant admin access:
```sql
INSERT INTO public.admin_users (user_id) 
VALUES ('your-user-uuid');
```

### Revoke admin access:
```sql
DELETE FROM public.admin_users 
WHERE user_id = 'user-uuid';
```

### View all admins:
```sql
SELECT 
  au.user_id,
  au.created_at,
  u.email
FROM public.admin_users au
JOIN auth.users u ON au.user_id = u.id;
```

**Initial Setup**: After running migrations, you'll need to manually insert your first admin using the SQL Editor in Supabase Dashboard (since no admins exist yet to grant access via RLS).

## Code Usage

Admin checks are handled by:
- Server-side: `isRegistrationAdmin()` and `requireRegistrationAdmin()` in `utils/adminUtils.ts`
- Client-side: `useIsAdmin()` hook in `hooks/useIsAdmin.ts`
- Database: `check_admin_role()` RPC function