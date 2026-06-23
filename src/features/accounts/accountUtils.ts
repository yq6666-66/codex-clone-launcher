import type { CodexAccount } from '../../shared/types';

export function isApiKeyAccount(account: CodexAccount): boolean {
  return Boolean(account.has_openai_api_key) || account.auth_mode === 'api_key' || account.auth_mode === 'apikey';
}

export function accountLabel(account: CodexAccount): string {
  return account.account_name || account.email || account.id;
}
