export const SCHEMA_SQL = `
create table if not exists users (
  id         text primary key,
  nickname   text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists wallets (
  user_id  text primary key references users(id),
  currency text not null default 'coin',
  balance  bigint not null default 0,
  version  integer not null default 0
);

create table if not exists ledger (
  id            bigserial primary key,
  user_id       text not null,
  currency      text not null,
  delta         bigint not null,
  balance_after bigint not null,
  biz_type      text not null,
  biz_id        text not null,
  created_at    timestamptz not null default now()
);

-- 账本幂等：同一业务单据对同一用户只能入账一次
create unique index if not exists ledger_idempotent
  on ledger (biz_type, biz_id, user_id);

create table if not exists game_records (
  settlement_id text primary key,
  room_id       text not null,
  game_id       text not null,
  round         integer not null,
  seed          text not null,
  winners       text[] not null default '{}',
  detail        jsonb not null,
  created_at    timestamptz not null default now()
);

create index if not exists game_records_game_idx on game_records (game_id, created_at desc);
`;
