-- Add rharbold1986@gmail.com as admin with manage_rulings permission
-- Grant manage_registrations to all existing admins to lock down the registrations page

-- Add rharbold as admin with manage_rulings only
INSERT INTO public.admin_users (user_id, permissions)
SELECT id, ARRAY['manage_rulings']
FROM auth.users WHERE email = 'rharbold1986@gmail.com'
ON CONFLICT (user_id) DO UPDATE SET permissions = ARRAY['manage_rulings'];

-- Grant manage_registrations to all existing admins (except rharbold)
UPDATE public.admin_users
SET permissions = array_append(permissions, 'manage_registrations')
WHERE user_id != (SELECT id FROM auth.users WHERE email = 'rharbold1986@gmail.com')
  AND NOT ('manage_registrations' = ANY(permissions));
