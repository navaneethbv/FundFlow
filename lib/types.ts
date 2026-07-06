/** Database row shapes used across server code (subset of columns we read). */

export interface PlaidItemRow {
  id: string;
  user_id: string;
  plaid_item_id: string;
  institution_id: string | null;
  institution_name: string | null;
  access_token_ciphertext: string;
  access_token_iv: string;
  access_token_tag: string;
  sync_cursor: string | null;
  status: "active" | "disconnected" | "error";
  error_code: string | null;
}

export interface AccountRow {
  id: string;
  user_id: string;
  plaid_item_id: string;
  plaid_account_id: string;
  name: string | null;
  official_name: string | null;
  mask: string | null;
  type: string | null;
  subtype: string | null;
  current_balance: number | null;
  available_balance: number | null;
  credit_limit: number | null;
  iso_currency_code: string | null;
}

export interface TransactionRow {
  id: string;
  user_id: string;
  account_id: string;
  plaid_transaction_id: string;
  amount: number;
  iso_currency_code: string | null;
  date: string;
  authorized_date: string | null;
  name: string | null;
  merchant_name: string | null;
  pfc_primary: string | null;
  pfc_detailed: string | null;
  payment_channel: string | null;
  pending: boolean;
}
