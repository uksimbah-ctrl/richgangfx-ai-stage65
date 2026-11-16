export type Tick = {
  ask: number;
  bid: number;
  epoch: number;
  pip_size: number;
  quote: number;
  symbol: string;
};

export type ActiveSymbol = {
  underlying_symbol: string;
  underlying_symbol_name?: string;
  market?: string;
  submarket?: string;
  subgroup?: string;
  exchange_is_open?: number;
  is_trading_suspended?: number;
  pip_size?: number;
  trade_count?: number;
};

export type Account = {
  account_id: string;
  balance: number;
  currency: string;
  group?: string;
  status?: string;
  account_type: "demo" | "real";
};

export type DerivError = { code?: string; message?: string };

export type DerivMsg = {
  msg_type?: string;
  req_id?: number;
  error?: DerivError;
  echo_req?: Record<string, unknown>;
  subscription?: { id?: string };
  tick?: Tick;
  active_symbols?: ActiveSymbol[];
  history?: { prices?: number[]; times?: number[] };
  pip_size?: number;
  proposal?: Proposal;
  buy?: Record<string, unknown>;
  sell?: Record<string, unknown>;
  proposal_open_contract?: OpenContract;
  contracts_for?: { available?: RawContract[] };
  balance?: { balance?: number; currency?: string };
  profit_table?: { transactions?: BrokerRow[] };
  [key: string]: unknown;
};

export type Proposal = {
  id?: string;
  ask_price?: number | string;
  payout?: number | string;
  spot?: number | string;
  longcode?: string;
  multiplier?: number;
  validation_params?: { stake?: { min?: string; max?: string } };
};

export type OpenContract = {
  contract_id?: number | string;
  contract_type?: string;
  underlying_symbol?: string;
  buy_price?: number | string;
  payout?: number | string;
  profit?: number | string;
  bid_price?: number | string;
  current_spot?: number | string;
  status?: string;
  is_sold?: number | boolean;
  longcode?: string;
  currency?: string;
};

export type RawContract = {
  contract_type?: string;
  contract_category?: string;
  min_contract_duration?: string;
  max_contract_duration?: string;
  multiplier_range?: number[];
  growth_rate_range?: number[];
  growth_rate_barrier_offsets?: number[];
  barrier?: string;
  barrier_choices?: string[];
  last_digit_range?: number[];
};

export type BrokerRow = {
  transaction_id?: number;
  contract_id?: number;
  underlying_symbol?: string;
  contract_type?: string;
  buy_price?: number | string;
  sell_price?: number | string;
  payout?: number | string;
  purchase_time?: number;
  sell_time?: number;
  shortcode?: string;
};

export const PUBLIC_WS = "wss://api.derivws.com/trading/v1/options/ws/public";
export const API_BASE = "https://api.derivws.com";
