-- Gen-ZSplit schema for Supabase (PostgreSQL).
-- Run this once in: Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- If you already ran an older version of this file (UUID ids, "username" column),
-- those tables have the wrong shape. Uncomment the block below to remove them first.
-- WARNING: this deletes all data in these tables.
--
-- drop table if exists public.group_activity, public.settlements, public.expense_splits,
--   public.group_expenses, public.group_members, public.groups, public.budgets,
--   public.expenses, public.users cascade;

create table public.users (
    id          bigint generated always as identity primary key,
    name        text not null,
    email       text not null unique,
    password    text not null,                 -- werkzeug password hash
    otp         text,
    otp_expiry  text,
    created_at  text not null default to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS')
);

create table public.expenses (
    id          bigint generated always as identity primary key,
    user_id     bigint not null references public.users(id) on delete cascade,
    title       text not null,
    amount      numeric(12, 2) not null check (amount > 0),
    category    text not null,
    date        date not null,
    created_at  text not null default to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS')
);
create index expenses_user_date_idx on public.expenses (user_id, date);

create table public.budgets (
    id            bigint generated always as identity primary key,
    user_id       bigint not null references public.users(id) on delete cascade,
    month         text not null,               -- 'YYYY-MM'
    budget_limit  numeric(12, 2) not null check (budget_limit >= 0),
    warning_sent  integer not null default 0,
    overflow_sent integer not null default 0,
    unique (user_id, month)
);

create table public.groups (
    id             bigint generated always as identity primary key,
    name           text not null,
    description    text not null default '',
    invite_code    text not null unique,
    password_hash  text not null,
    owner_id       bigint not null references public.users(id),
    currency       text not null default 'INR',
    created_at     text not null default to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS')
);

create table public.group_members (
    group_id   bigint not null references public.groups(id) on delete cascade,
    user_id    bigint not null references public.users(id),
    role       text not null default 'member' check (role in ('owner', 'member')),
    status     text not null default 'active' check (status in ('active', 'removed')),
    joined_at  text not null default to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS'),
    primary key (group_id, user_id)
);
create index group_members_user_idx on public.group_members (user_id);

create table public.group_expenses (
    id            bigint generated always as identity primary key,
    group_id      bigint not null references public.groups(id) on delete cascade,
    paid_by       bigint not null references public.users(id),
    title         text not null,
    amount_minor  bigint not null check (amount_minor > 0),
    category      text not null default 'Other',
    expense_date  date not null,
    split_method  text not null check (split_method in ('equal', 'exact', 'percentage')),
    notes         text not null default '',
    created_by    bigint not null references public.users(id),
    deleted_at    text,
    deleted_by    bigint references public.users(id),
    created_at    text not null default to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS')
);
create index group_expenses_group_date_idx on public.group_expenses (group_id, expense_date);

create table public.expense_splits (
    id           bigint generated always as identity primary key,
    expense_id   bigint not null references public.group_expenses(id) on delete cascade,
    group_id     bigint not null references public.groups(id) on delete cascade,
    user_id      bigint not null references public.users(id),
    share_minor  bigint not null check (share_minor >= 0),
    share_bp     integer,
    unique (expense_id, user_id)
);
create index expense_splits_group_idx on public.expense_splits (group_id);

create table public.settlements (
    id            bigint generated always as identity primary key,
    group_id      bigint not null references public.groups(id) on delete cascade,
    payer_id      bigint not null references public.users(id),
    receiver_id   bigint not null references public.users(id),
    amount_minor  bigint not null check (amount_minor > 0),
    created_by    bigint not null references public.users(id),
    created_at    text not null default to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS'),
    check (payer_id <> receiver_id)
);
create index settlements_group_idx on public.settlements (group_id);

create table public.group_activity (
    id           bigint generated always as identity primary key,
    group_id     bigint not null references public.groups(id) on delete cascade,
    actor_id     bigint references public.users(id),
    kind         text not null,
    description  text not null,
    expense_id   bigint,
    created_at   text not null default to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS')
);
create index group_activity_group_idx on public.group_activity (group_id, id);

-- Security: turn on Row Level Security with no policies. The public "anon" key
-- can then read nothing. The Flask server uses the secret / service_role key,
-- which bypasses RLS, so the app keeps working.
alter table public.users           enable row level security;
alter table public.expenses        enable row level security;
alter table public.budgets         enable row level security;
alter table public.groups          enable row level security;
alter table public.group_members   enable row level security;
alter table public.group_expenses  enable row level security;
alter table public.expense_splits  enable row level security;
alter table public.settlements     enable row level security;
alter table public.group_activity  enable row level security;