-- Login-free personal workspace: sessions identify devices, and only a
-- separately approved device can read or write the one private installation.
create table if not exists public.jarvis_installation (
  singleton boolean primary key default true check (singleton),
  workspace_id uuid not null unique default gen_random_uuid()
);
create table if not exists public.jarvis_devices (
  user_id uuid primary key references auth.users(id) on delete cascade,
  request_code text not null unique default upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  revoked_at timestamptz
);
alter table public.jarvis_installation enable row level security;
alter table public.jarvis_devices enable row level security;
revoke all on public.jarvis_installation, public.jarvis_devices from public, anon, authenticated;
insert into public.jarvis_installation(singleton) values(true) on conflict do nothing;

-- Refuse a blind migration of any pre-existing owner data. Fresh production
-- has no workspace rows; a nonempty installation needs its own reviewed plan.
do $$ begin
  if exists(select 1 from public.jarvis_spaces) then
    raise exception 'existing_workspace_review_required';
  end if;
end $$;
alter table public.jarvis_spaces drop constraint if exists jarvis_spaces_owner_id_fkey;
alter table public.jarvis_spaces add constraint jarvis_spaces_owner_id_fkey
  foreign key(owner_id) references public.jarvis_installation(workspace_id) on delete restrict;

create or replace function public.jarvis_current_owner()
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select i.workspace_id from public.jarvis_installation i
  where i.singleton and exists (
    select 1 from public.jarvis_devices d
    where d.user_id = auth.uid() and d.approved_at is not null and d.revoked_at is null
  );
$$;
create or replace function public.jarvis_device_status()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('request_code',d.request_code,'owner_id',public.jarvis_current_owner())
  from public.jarvis_devices d where d.user_id=auth.uid();
$$;
create or replace function public.jarvis_register_device()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  insert into public.jarvis_devices(user_id) values(auth.uid()) on conflict(user_id) do nothing;
  return public.jarvis_device_status();
end $$;
revoke all on function public.jarvis_current_owner(), public.jarvis_device_status(), public.jarvis_register_device() from public, anon;
grant execute on function public.jarvis_current_owner(), public.jarvis_device_status(), public.jarvis_register_device() to authenticated;

drop policy if exists jarvis_owner_read on public.jarvis_spaces;
create policy jarvis_owner_read on public.jarvis_spaces for select to authenticated
  using(owner_id = public.jarvis_current_owner());
create or replace function public.jarvis_save_space(p_space text, p_data jsonb, p_expected_revision bigint)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare v_owner uuid := public.jarvis_current_owner(); v_revision bigint; v_key text;
begin
  if v_owner is null then raise exception 'authentication_required'; end if;
  if p_space is null or p_space not in ('company', 'personal') or p_expected_revision is null or p_expected_revision < 0 then raise exception 'invalid_scope'; end if;
  if p_data->>'activeSpace' is distinct from p_space or p_data->>'version' is distinct from '1' then raise exception 'invalid_scope'; end if;
  foreach v_key in array array['projects','tasks','conversations','contexts','documents','notes','services','sourceRecords','requests','syncEvents'] loop
    if jsonb_typeof(p_data->v_key) is distinct from 'array' then raise exception 'invalid_payload'; end if;
    if exists (select 1 from jsonb_array_elements(p_data->v_key) entry where entry->>'space' is distinct from p_space) then raise exception 'mixed_scope'; end if;
  end loop;
  if jsonb_typeof(p_data->'messages') is distinct from 'array' or jsonb_typeof(p_data->'contextRevisions') is distinct from 'array' then raise exception 'invalid_payload'; end if;
  if exists (select 1 from jsonb_array_elements(p_data->'messages') m where not exists (select 1 from jsonb_array_elements(p_data->'conversations') c where c->>'id'=m->>'conversationId')) then raise exception 'invalid_message_scope'; end if;
  if exists (select 1 from jsonb_array_elements(p_data->'contextRevisions') r where not exists (select 1 from jsonb_array_elements(p_data->'contexts') c where c->>'id'=r->>'contextId')) then raise exception 'invalid_context_scope'; end if;
  if p_space='personal' and exists (select 1 from jsonb_array_elements(p_data->'services') s where s->>'connector'='v4') then raise exception 'v4_company_only'; end if;
  insert into public.jarvis_spaces(owner_id,space,data,revision) values(v_owner,p_space,p_data,0) on conflict do nothing;
  select revision into v_revision from public.jarvis_spaces where owner_id=v_owner and space=p_space for update;
  if v_revision <> p_expected_revision then raise exception 'revision_conflict'; end if;
  update public.jarvis_spaces set data=p_data,revision=revision+1,updated_at=now() where owner_id=v_owner and space=p_space returning revision into v_revision;
  return v_revision;
end $$;
revoke all on function public.jarvis_save_space(text,jsonb,bigint) from public, anon;
grant execute on function public.jarvis_save_space(text,jsonb,bigint) to authenticated;


drop policy if exists jarvis_files_read on storage.objects;
drop policy if exists jarvis_files_insert on storage.objects;
create policy jarvis_files_read on storage.objects for select to authenticated
  using(bucket_id='jarvis-workspace-files' and (storage.foldername(name))[1]=public.jarvis_current_owner()::text
    and (storage.foldername(name))[2] in ('company','personal'));
create policy jarvis_files_insert on storage.objects for insert to authenticated
  with check(bucket_id='jarvis-workspace-files' and (storage.foldername(name))[1]=public.jarvis_current_owner()::text
    and (storage.foldername(name))[2] in ('company','personal'));
