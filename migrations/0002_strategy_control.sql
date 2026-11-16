create table if not exists strategy_profile (
  contract_type text primary key,
  version integer not null,
  document text not null,
  updated_at timestamptz not null default now()
);

create table if not exists strategy_audit (
  id bigserial primary key,
  contract_type text not null,
  version integer not null,
  action text not null,
  document text not null,
  created_at timestamptz not null default now()
);

create table if not exists strategy_preset (
  name text primary key,
  document text not null,
  updated_at timestamptz not null default now()
);
