-- Calm Compass schema. Paste into Supabase → SQL Editor → Run.

create table if not exists classes (
  code         text primary key,
  teacher_name text not null,
  created_at   timestamptz not null default now()
);

create table if not exists students (
  id            uuid primary key default gen_random_uuid(),
  class_code    text not null references classes(code) on delete cascade,
  name          text not null,
  school        text,
  profile       jsonb not null,          -- { emotions: [{ key, reasons: [reasonKey x4] } x4] }
  status        text not null default 'learning',  -- 'learning' | 'break'
  activity      text,                    -- calming activity the instructor picked ('audio' | 'breathe' | null = kid chooses)
  current_break uuid,
  created_at    timestamptz not null default now()
);

create table if not exists breaks (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references students(id) on delete cascade,
  class_code   text not null references classes(code) on delete cascade,
  initiated_by text not null,            -- 'instructor' | 'student'
  step         text not null default 'started', -- started | emotion | reason | size | calming | after | done
  emotion      text,
  reason       text,
  size         int,
  activity     text,
  after        text,                     -- 'better' | 'same' | 'worse'
  started_at   timestamptz not null default now(),
  ended_at     timestamptz
);

create index if not exists breaks_student_idx on breaks(student_id, started_at);
create index if not exists breaks_class_idx   on breaks(class_code, started_at);

-- Realtime: stream row changes to the portals
alter publication supabase_realtime add table students;
alter publication supabase_realtime add table breaks;

-- HACKATHON-ONLY access: anyone with the anon key can read/write.
-- Before real use with kids' data: add Supabase Auth, tie teachers to classes,
-- and replace these with per-user policies (COPPA / FERPA).
alter table classes  enable row level security;
alter table students enable row level security;
alter table breaks   enable row level security;
create policy "demo all classes"  on classes  for all using (true) with check (true);
create policy "demo all students" on students for all using (true) with check (true);
create policy "demo all breaks"   on breaks   for all using (true) with check (true);
