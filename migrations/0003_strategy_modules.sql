create table if not exists strategy_module (
  module_id text primary key,
  version integer not null,
  document text not null,
  updated_at timestamptz not null default now()
);
