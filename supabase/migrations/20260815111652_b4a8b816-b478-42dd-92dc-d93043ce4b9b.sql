INSERT INTO public.user_roles (user_id, role)
VALUES ('235b555f-0303-4dcb-8fa6-3db546fdae1e', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;