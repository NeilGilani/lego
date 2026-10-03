-- Brixel database schema. Run this once in Supabase → SQL Editor.

create table if not exists public.builds (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text not null,
  subject     text,
  description text,
  spec        jsonb not null,          -- the AI's primitive design; the model is rebuilt from it in the browser
  image_path  text,                    -- path in the private "uploads" storage bucket
  model       text,                    -- which Gemini model designed it
  is_public   boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists builds_user_created on public.builds (user_id, created_at desc);

alter table public.builds enable row level security;

drop policy if exists "builds: read own or public" on public.builds;
create policy "builds: read own or public" on public.builds
  for select using (auth.uid() = user_id or is_public);
drop policy if exists "builds: insert own" on public.builds;
create policy "builds: insert own" on public.builds
  for insert with check (auth.uid() = user_id);
drop policy if exists "builds: update own" on public.builds;
create policy "builds: update own" on public.builds
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "builds: delete own" on public.builds;
create policy "builds: delete own" on public.builds
  for delete using (auth.uid() = user_id);

-- Private bucket for uploaded photos; each user can only touch their own folder ({user_id}/...).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('uploads', 'uploads', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "uploads: read own" on storage.objects;
create policy "uploads: read own" on storage.objects
  for select using (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "uploads: insert own" on storage.objects;
create policy "uploads: insert own" on storage.objects
  for insert with check (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "uploads: delete own" on storage.objects;
create policy "uploads: delete own" on storage.objects
  for delete using (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);
