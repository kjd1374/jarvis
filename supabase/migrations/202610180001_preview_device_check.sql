-- A connected runner may confirm that a preview viewer remains an approved
-- device in this private installation. No device rows or approval codes leak.
create or replace function public.jarvis_preview_device_allowed(p_device uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.jarvis_current_owner() is not null and exists (
    select 1 from public.jarvis_devices d
    where d.user_id = p_device and d.approved_at is not null and d.revoked_at is null
  );
$$;
revoke all on function public.jarvis_preview_device_allowed(uuid) from public, anon;
grant execute on function public.jarvis_preview_device_allowed(uuid) to authenticated;
