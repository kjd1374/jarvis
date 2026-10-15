-- Review/apply separately in production. Local validation uses synthetic users only.
create table if not exists public.jarvis_spaces (
  owner_id uuid not null references auth.users(id) on delete cascade,
  space text not null check (space in ('company', 'personal')),
  data jsonb not null,
  revision bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (owner_id, space)
);
alter table public.jarvis_spaces enable row level security;
revoke all on public.jarvis_spaces from anon, authenticated;
grant select on public.jarvis_spaces to authenticated;
drop policy if exists jarvis_owner_read on public.jarvis_spaces;
create policy jarvis_owner_read on public.jarvis_spaces for select to authenticated using (owner_id = (select auth.uid()));

create or replace function public.jarvis_save_space(p_space text, p_data jsonb, p_expected_revision bigint)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare v_owner uuid := auth.uid(); v_revision bigint; v_key text;
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

insert into storage.buckets(id,name,public,file_size_limit) values('jarvis-workspace-files','jarvis-workspace-files',false,20971520) on conflict(id) do nothing;
drop policy if exists jarvis_files_read on storage.objects;
drop policy if exists jarvis_files_insert on storage.objects;
create policy jarvis_files_read on storage.objects for select to authenticated using(bucket_id='jarvis-workspace-files' and (storage.foldername(name))[1]=(select auth.uid())::text and (storage.foldername(name))[2] in ('company','personal'));
create policy jarvis_files_insert on storage.objects for insert to authenticated with check(bucket_id='jarvis-workspace-files' and (storage.foldername(name))[1]=(select auth.uid())::text and (storage.foldername(name))[2] in ('company','personal'));
