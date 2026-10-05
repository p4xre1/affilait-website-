begin;

-- Security Events: privacy-safe technical telemetry for security attribution and audit
create table public.security_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (char_length(event_type) between 1 and 80),
  severity text not null check (severity in ('info', 'low', 'medium', 'high', 'critical')),
  request_id text not null check (char_length(request_id) <= 64),
  project_id uuid references public.projects (id) on delete set null,
  user_id uuid references auth.users (id) on delete set null,
  source_component text not null check (char_length(source_component) between 1 and 80),
  action text not null check (char_length(action) between 1 and 80),
  result text not null check (char_length(result) between 1 and 80),
  metadata_safe jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata_safe) = 'object'),
  created_at timestamptz not null default now()
);

create index security_events_user_idx on public.security_events (user_id, created_at desc) where user_id is not null;
create index security_events_project_idx on public.security_events (project_id, created_at desc) where project_id is not null;
create index security_events_type_idx on public.security_events (event_type, created_at desc);

alter table public.security_events enable row level security;
revoke all on public.security_events from anon;
grant select, insert on public.security_events to authenticated;

create policy security_events_select_own on public.security_events
  for select to authenticated using (user_id = (select auth.uid()));

create policy security_events_insert_own on public.security_events
  for insert to authenticated with check (user_id = (select auth.uid()));

-- Domain Verifications: single-use, unguessable, time-bounded ownership challenges
create table public.domain_verifications (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  domain text not null check (char_length(domain) between 1 and 253),
  challenge_type text not null check (challenge_type in ('dns_txt', 'html_meta', 'file_token')),
  challenge_token text not null check (char_length(challenge_token) between 16 and 128),
  status text not null default 'pending' check (status in ('pending', 'verified', 'expired', 'failed')),
  expires_at timestamptz not null,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create index domain_verifications_project_idx on public.domain_verifications (project_id, created_at desc);
create unique index domain_verifications_token_idx on public.domain_verifications (challenge_token);

alter table public.domain_verifications enable row level security;
revoke all on public.domain_verifications from anon;
grant select, insert, update, delete on public.domain_verifications to authenticated;

create policy domain_verifications_select_own on public.domain_verifications
  for select to authenticated using (
    exists (
      select 1 from public.projects p
      where p.id = domain_verifications.project_id and p.user_id = (select auth.uid())
    )
  );

create policy domain_verifications_insert_own on public.domain_verifications
  for insert to authenticated with check (
    exists (
      select 1 from public.projects p
      where p.id = domain_verifications.project_id and p.user_id = (select auth.uid())
    )
  );

create policy domain_verifications_update_own on public.domain_verifications
  for update to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = domain_verifications.project_id and p.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.id = domain_verifications.project_id and p.user_id = (select auth.uid())
    )
  );

create policy domain_verifications_delete_own on public.domain_verifications
  for delete to authenticated using (
    exists (
      select 1 from public.projects p
      where p.id = domain_verifications.project_id and p.user_id = (select auth.uid())
    )
  );

commit;
