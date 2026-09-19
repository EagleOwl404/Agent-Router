import { EnvParser } from '../EnvParser';
import {
  DEFAULT_KEY_COOLDOWN_BASE_MS,
  DEFAULT_KEY_MAX_CONSECUTIVE_FAILURES,
  DEFAULT_MAX_GATEWAY_KEYS_PER_USER,
  DEFAULT_MAX_GATEWAY_KEY_EXPIRY_DAYS,
  DEFAULT_MAX_KEYS_PER_PROVIDER,
  DEFAULT_MAX_PROVIDERS_PER_USER,
  DEFAULT_PROXY_MAX_ATTEMPTS,
  DEFAULT_PROXY_MAX_BODY_BYTES,
  DEFAULT_PROXY_TIMEOUT_MS,
  DEFAULT_USAGE_RETENTION_DAYS,
} from '../ConfigurationDefaults';

// Agent-Router gateway / provider limits.
class RouterLimits {
  constructor(private readonly env: unknown) {}

  public getMaxProvidersPerUser(): number {
    return EnvParser.positiveInt(this.env, 'MAX_PROVIDERS_PER_USER', DEFAULT_MAX_PROVIDERS_PER_USER);
  }

  public getMaxKeysPerProvider(): number {
    return EnvParser.positiveInt(this.env, 'MAX_KEYS_PER_PROVIDER', DEFAULT_MAX_KEYS_PER_PROVIDER);
  }

  public getMaxGatewayKeysPerUser(): number {
    return EnvParser.positiveInt(this.env, 'MAX_GATEWAY_KEYS_PER_USER', DEFAULT_MAX_GATEWAY_KEYS_PER_USER);
  }

  public getMaxGatewayKeyExpiryDays(): number {
    return EnvParser.positiveInt(this.env, 'MAX_GATEWAY_KEY_EXPIRY_DAYS', DEFAULT_MAX_GATEWAY_KEY_EXPIRY_DAYS);
  }

  public getProxyTimeoutMs(): number {
    return EnvParser.positiveInt(this.env, 'PROXY_TIMEOUT_MS', DEFAULT_PROXY_TIMEOUT_MS);
  }

  public getProxyMaxAttempts(): number {
    const raw = EnvParser.positiveInt(this.env, 'PROXY_MAX_ATTEMPTS', DEFAULT_PROXY_MAX_ATTEMPTS);
    return Math.min(Math.max(raw, 1), 8);
  }

  public getProxyMaxBodyBytes(): number {
    return EnvParser.positiveInt(this.env, 'PROXY_MAX_BODY_BYTES', DEFAULT_PROXY_MAX_BODY_BYTES);
  }

  public getKeyCooldownBaseMs(): number {
    return EnvParser.positiveInt(this.env, 'KEY_COOLDOWN_BASE_MS', DEFAULT_KEY_COOLDOWN_BASE_MS);
  }

  public getKeyMaxConsecutiveFailures(): number {
    return EnvParser.positiveInt(this.env, 'KEY_MAX_CONSECUTIVE_FAILURES', DEFAULT_KEY_MAX_CONSECUTIVE_FAILURES);
  }

  public getUsageRetentionDays(): number {
    return EnvParser.positiveInt(this.env, 'USAGE_RETENTION_DAYS', DEFAULT_USAGE_RETENTION_DAYS);
  }
}

export { RouterLimits };
