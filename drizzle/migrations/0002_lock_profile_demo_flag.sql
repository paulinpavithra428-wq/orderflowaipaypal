REVOKE ALL ON public.profiles FROM anon;
REVOKE ALL ON public.profiles FROM authenticated;
GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE (business_name) ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;