create or replace function public.jarvis_disconnect_device()
returns void language sql security definer set search_path = public, pg_temp as $$
  update public.jarvis_devices set revoked_at=now() where user_id=auth.uid();
$$;
revoke all on function public.jarvis_disconnect_device() from public, anon;
grant execute on function public.jarvis_disconnect_device() to authenticated;
