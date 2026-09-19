import type {
  CodexDeviceSessionDAO,
  GatewayKeyDAO,
  ProviderDAO,
  ProviderKeyDAO,
  UsageLedgerDAO,
  UserDAO,
} from '@agent-router/backend-data/dao';
import type { D1Queryable } from '@agent-router/backend-data/utils';
import type { Token } from '@agent-router/backend-runtime/di';
import type { AppConfiguration } from '@agent-router/backend-runtime/config';
import type { AccessAuthService } from '../auth/AccessAuthService';
import type { CodexOAuthService } from '../codex/CodexOAuthService';
import type { CodexTokenService } from '../codex/CodexTokenService';
import type { GatewayKeyService } from '../gateway/GatewayKeyService';
import type { ProviderService } from '../provider/ProviderService';
import type { ProviderKeyService } from '../provider/ProviderKeyService';
import type { RouterService } from '../router/RouterService';
import type { UsageService } from '../usage/UsageService';
import type { UserService } from '../user/UserService';

interface RequestScopeEnvShape {
  DB: D1Queryable;
  AES_ENCRYPTION_KEY_SECRET?: { get(): Promise<string> };
}

interface RequestKeysShape {
  masterKey: string;
}

const Tokens = {
  Env: Symbol('Env') as Token<RequestScopeEnvShape>,
  Db: Symbol('Db') as Token<D1Queryable>,
  Keys: Symbol('Keys') as Token<() => Promise<RequestKeysShape>>,
  AppConfig: Symbol('AppConfig') as Token<AppConfiguration>,
  UserDAO: Symbol('UserDAO') as Token<() => Promise<UserDAO>>,
  GatewayKeyDAO: Symbol('GatewayKeyDAO') as Token<() => Promise<GatewayKeyDAO>>,
  ProviderDAO: Symbol('ProviderDAO') as Token<() => Promise<ProviderDAO>>,
  ProviderKeyDAO: Symbol('ProviderKeyDAO') as Token<() => Promise<ProviderKeyDAO>>,
  CodexDeviceSessionDAO: Symbol('CodexDeviceSessionDAO') as Token<() => Promise<CodexDeviceSessionDAO>>,
  UsageLedgerDAO: Symbol('UsageLedgerDAO') as Token<() => Promise<UsageLedgerDAO>>,
  AccessAuthService: Symbol('AccessAuthService') as Token<AccessAuthService>,
  CodexOAuthService: Symbol('CodexOAuthService') as Token<CodexOAuthService>,
  CodexTokenService: Symbol('CodexTokenService') as Token<CodexTokenService>,
  GatewayKeyService: Symbol('GatewayKeyService') as Token<GatewayKeyService>,
  ProviderService: Symbol('ProviderService') as Token<ProviderService>,
  ProviderKeyService: Symbol('ProviderKeyService') as Token<ProviderKeyService>,
  RouterService: Symbol('RouterService') as Token<RouterService>,
  UsageService: Symbol('UsageService') as Token<UsageService>,
  UserService: Symbol('UserService') as Token<UserService>,
} satisfies Record<string, Token<unknown>>;

export { Tokens };
