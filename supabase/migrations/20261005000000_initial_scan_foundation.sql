begin;

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  domain text not null check (char_length(domain) between 1 and 253),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function public.touch_project_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

create trigger projects_touch_updated_at
before update on public.projects
for each row execute function public.touch_project_updated_at();

create table public.scans (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  started_at timestamptz,
  completed_at timestamptz,
  crawler_version text not null check (char_length(crawler_version) between 1 and 60),
  page_limit integer not null check (page_limit between 1 and 100),
  pages_discovered integer not null default 0 check (pages_discovered between 0 and 10000),
  pages_scanned integer not null default 0 check (pages_scanned between 0 and 100),
  error_count integer not null default 0 check (error_count >= 0),
  created_at timestamptz not null default now()
);

create table public.crawl_pages (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references public.scans (id) on delete cascade,
  url text not null check (char_length(url) between 8 and 2048),
  normalized_url text not null check (char_length(normalized_url) between 8 and 2048),
  canonical_url text check (canonical_url is null or char_length(canonical_url) <= 2048),
  status_code integer check (status_code is null or status_code between 100 and 599),
  content_type text check (content_type is null or char_length(content_type) <= 255),
  title text check (title is null or char_length(title) <= 300),
  h1 text check (h1 is null or char_length(h1) <= 180),
  headings jsonb not null default '[]'::jsonb check (jsonb_typeof(headings) = 'array'),
  depth integer check (depth is null or depth >= 0),
  word_count integer check (word_count is null or word_count >= 0),
  indexability boolean,
  robots text check (robots is null or char_length(robots) <= 500),
  meta_robots text check (meta_robots is null or char_length(meta_robots) <= 500),
  content_hash text check (content_hash is null or char_length(content_hash) <= 128),
  discovered_at timestamptz,
  crawled_at timestamptz,
  created_at timestamptz not null default now(),
  unique (scan_id, normalized_url),
  unique (scan_id, id)
);

create table public.findings (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references public.scans (id) on delete cascade,
  page_id uuid,
  category text not null check (char_length(category) between 1 and 80),
  type text not null check (char_length(type) between 1 and 100),
  severity text not null check (severity in ('critical', 'warning', 'info', 'high', 'medium', 'low')),
  title text not null check (char_length(title) between 1 and 300),
  description text not null check (char_length(description) <= 4000),
  evidence jsonb not null default '{}'::jsonb,
  confidence numeric(4, 3) check (confidence is null or confidence between 0 and 1),
  recommendation text not null check (char_length(recommendation) <= 2000),
  created_at timestamptz not null default now(),
  constraint findings_page_same_scan_fk foreign key (scan_id, page_id)
    references public.crawl_pages (scan_id, id) on delete cascade
);

create index projects_user_created_idx on public.projects (user_id, created_at desc);
create index projects_domain_idx on public.projects (domain);
create index scans_project_created_idx on public.scans (project_id, created_at desc);
create index scans_status_idx on public.scans (status);
create index crawl_pages_scan_idx on public.crawl_pages (scan_id);
create index crawl_pages_normalized_url_idx on public.crawl_pages (normalized_url);
create index findings_scan_created_idx on public.findings (scan_id, created_at desc);
create index findings_page_idx on public.findings (page_id) where page_id is not null;

alter table public.projects enable row level security;
alter table public.scans enable row level security;
alter table public.crawl_pages enable row level security;
alter table public.findings enable row level security;

revoke all on public.projects, public.scans, public.crawl_pages, public.findings from anon;
grant select, insert, update, delete on public.projects, public.scans, public.crawl_pages, public.findings to authenticated;

create policy projects_select_own on public.projects
  for select to authenticated using (user_id = (select auth.uid()));
create policy projects_insert_own on public.projects
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy projects_update_own on public.projects
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy projects_delete_own on public.projects
  for delete to authenticated using (user_id = (select auth.uid()));

create policy scans_select_own on public.scans
  for select to authenticated using (
    exists (
      select 1 from public.projects p
      where p.id = scans.project_id and p.user_id = (select auth.uid())
    )
  );
create policy scans_insert_own on public.scans
  for insert to authenticated with check (
    exists (
      select 1 from public.projects p
      where p.id = scans.project_id and p.user_id = (select auth.uid())
    )
  );
create policy scans_update_own on public.scans
  for update to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = scans.project_id and p.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.id = scans.project_id and p.user_id = (select auth.uid())
    )
  );
create policy scans_delete_own on public.scans
  for delete to authenticated using (
    exists (
      select 1 from public.projects p
      where p.id = scans.project_id and p.user_id = (select auth.uid())
    )
  );

create policy crawl_pages_select_own on public.crawl_pages
  for select to authenticated using (
    exists (
      select 1 from public.scans s
      join public.projects p on p.id = s.project_id
      where s.id = crawl_pages.scan_id and p.user_id = (select auth.uid())
    )
  );
create policy crawl_pages_insert_own on public.crawl_pages
  for insert to authenticated with check (
    exists (
      select 1 from public.scans s
      join public.projects p on p.id = s.project_id
      where s.id = crawl_pages.scan_id and p.user_id = (select auth.uid())
    )
  );
create policy crawl_pages_update_own on public.crawl_pages
  for update to authenticated
  using (
    exists (
      select 1 from public.scans s
      join public.projects p on p.id = s.project_id
      where s.id = crawl_pages.scan_id and p.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.scans s
      join public.projects p on p.id = s.project_id
      where s.id = crawl_pages.scan_id and p.user_id = (select auth.uid())
    )
  );
create policy crawl_pages_delete_own on public.crawl_pages
  for delete to authenticated using (
    exists (
      select 1 from public.scans s
      join public.projects p on p.id = s.project_id
      where s.id = crawl_pages.scan_id and p.user_id = (select auth.uid())
    )
  );

create policy findings_select_own on public.findings
  for select to authenticated using (
    exists (
      select 1 from public.scans s
      join public.projects p on p.id = s.project_id
      where s.id = findings.scan_id and p.user_id = (select auth.uid())
    )
  );
create policy findings_insert_own on public.findings
  for insert to authenticated with check (
    exists (
      select 1 from public.scans s
      join public.projects p on p.id = s.project_id
      where s.id = findings.scan_id and p.user_id = (select auth.uid())
    )
  );
create policy findings_update_own on public.findings
  for update to authenticated
  using (
    exists (
      select 1 from public.scans s
      join public.projects p on p.id = s.project_id
      where s.id = findings.scan_id and p.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.scans s
      join public.projects p on p.id = s.project_id
      where s.id = findings.scan_id and p.user_id = (select auth.uid())
    )
  );
create policy findings_delete_own on public.findings
  for delete to authenticated using (
    exists (
      select 1 from public.scans s
      join public.projects p on p.id = s.project_id
      where s.id = findings.scan_id and p.user_id = (select auth.uid())
    )
  );

commit;
