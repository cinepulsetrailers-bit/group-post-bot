
-- Profiles (single-user app but keep RLS-scoped)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "own profile select" on public.profiles for select using (auth.uid() = id);
create policy "own profile update" on public.profiles for update using (auth.uid() = id);
create policy "own profile insert" on public.profiles for insert with check (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  return new;
end;
$$;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Bridge config (one row per user)
create table public.bridge_config (
  user_id uuid primary key references auth.users(id) on delete cascade,
  base_url text not null default '',
  shared_secret text not null default '',
  webhook_secret text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.bridge_config enable row level security;
create policy "own bridge select" on public.bridge_config for select using (auth.uid() = user_id);
create policy "own bridge upsert" on public.bridge_config for insert with check (auth.uid() = user_id);
create policy "own bridge update" on public.bridge_config for update using (auth.uid() = user_id);

-- Telegram groups (dialogs)
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tg_chat_id bigint not null,
  title text not null,
  username text,
  is_selected boolean not null default false,
  synced_at timestamptz not null default now(),
  unique(user_id, tg_chat_id)
);
alter table public.groups enable row level security;
create policy "own groups all" on public.groups for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Posts (composed content)
create type public.post_status as enum ('draft','queued','sending','sent','failed');
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null default '',
  media_url text,
  media_type text,
  status public.post_status not null default 'draft',
  scheduled_at timestamptz,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
alter table public.posts enable row level security;
create policy "own posts all" on public.posts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index posts_due_idx on public.posts (scheduled_at) where status = 'queued';

-- Targets per post
create table public.post_targets (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  tg_chat_id bigint not null,
  tg_message_id bigint,
  status text not null default 'pending',
  error text,
  sent_at timestamptz
);
alter table public.post_targets enable row level security;
create policy "own targets all" on public.post_targets for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Messages (in + out)
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tg_chat_id bigint not null,
  tg_message_id bigint not null,
  chat_title text,
  from_name text,
  from_id bigint,
  text text,
  media_url text,
  direction text not null check (direction in ('in','out')),
  reply_to_tg_id bigint,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id, tg_chat_id, tg_message_id, direction)
);
alter table public.messages enable row level security;
create policy "own messages all" on public.messages for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index messages_chat_idx on public.messages (user_id, tg_chat_id, created_at desc);

-- Storage bucket for media
insert into storage.buckets (id, name, public) values ('media', 'media', true) on conflict do nothing;
create policy "media public read" on storage.objects for select using (bucket_id = 'media');
create policy "media auth upload" on storage.objects for insert to authenticated with check (bucket_id = 'media' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "media auth delete" on storage.objects for delete to authenticated using (bucket_id = 'media' and auth.uid()::text = (storage.foldername(name))[1]);

-- Realtime for messages
alter publication supabase_realtime add table public.messages;
