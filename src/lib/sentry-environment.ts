const SENTRY_ENVIRONMENT_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

export function isValidSentryEnvironment(value: string | undefined) {
  return Boolean(value?.trim() && SENTRY_ENVIRONMENT_PATTERN.test(value.trim()));
}

/**
 * 選出第一個可安全送往監控平台的環境名稱。
 *
 * 限制字元與長度，避免未受控環境變數污染 Sentry tag 或監控查詢。
 */
export function resolveSentryEnvironment(...candidates: Array<string | undefined>) {
  for (const candidate of candidates) {
    const normalized = candidate?.trim();
    if (isValidSentryEnvironment(normalized)) {
      return normalized;
    }
  }

  return undefined;
}
