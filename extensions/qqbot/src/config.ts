import { z } from "zod";

export const DEFAULT_ACCOUNT_ID = "default";

const optionalCoercedString = z.preprocess(
  (value) => {
    if (value === undefined || value === null) return undefined;
    const next = String(value).trim();
    return next;
  },
  z.string().min(1).optional()
);

export const QQBotAccountSchema = z.object({
  enabled: z.boolean().optional().default(true),
  name: optionalCoercedString,
  appId: optionalCoercedString,
  clientSecret: optionalCoercedString,
  asr: z
    .object({
      enabled: z.boolean().optional().default(false),
      appId: optionalCoercedString,
      secretId: optionalCoercedString,
      secretKey: optionalCoercedString,
    })
    .optional(),
  markdownSupport: z.boolean().optional().default(true),
  dmPolicy: z.enum(["open", "pairing", "allowlist"]).optional().default("open"),
  groupPolicy: z.enum(["open", "allowlist", "disabled"]).optional().default("open"),
  requireMention: z.boolean().optional().default(true),
  allowFrom: z.array(z.string()).optional(),
  groupAllowFrom: z.array(z.string()).optional(),
  historyLimit: z.number().int().min(0).optional().default(10),
  textChunkLimit: z.number().int().positive().optional().default(1500),
  replyFinalOnly: z.boolean().optional().default(false),
  maxFileSizeMB: z.number().positive().optional().default(100),
  mediaTimeoutMs: z.number().int().positive().optional().default(30000),
});

export const QQBotConfigSchema = QQBotAccountSchema.extend({
  defaultAccount: optionalCoercedString,
  accounts: z.record(QQBotAccountSchema).optional(),
});

export const QQBotConfigJsonSchema = {
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      enabled: { type: "boolean" },
      name: { type: "string" },
      appId: { type: "string" },
      clientSecret: { type: "string" },
      asr: {
        type: "object",
        additionalProperties: false,
        properties: {
          enabled: { type: "boolean" },
          appId: { type: "string" },
          secretId: { type: "string" },
          secretKey: { type: "string" },
        },
      },
      markdownSupport: { type: "boolean" },
      dmPolicy: { type: "string", enum: ["open", "pairing", "allowlist"] },
      groupPolicy: { type: "string", enum: ["open", "allowlist", "disabled"] },
      requireMention: { type: "boolean" },
      allowFrom: { type: "array", items: { type: "string" } },
      groupAllowFrom: { type: "array", items: { type: "string" } },
      historyLimit: { type: "integer", minimum: 0 },
      textChunkLimit: { type: "integer", minimum: 1 },
      replyFinalOnly: { type: "boolean" },
      maxFileSizeMB: { type: "number", exclusiveMinimum: 0 },
      mediaTimeoutMs: { type: "integer", minimum: 1 },
      defaultAccount: { type: "string" },
      accounts: {
        type: "object",
        additionalProperties: {
          type: "object",
          additionalProperties: false,
          properties: {
            enabled: { type: "boolean" },
            name: { type: "string" },
            appId: { type: "string" },
            clientSecret: { type: "string" },
            asr: {
              type: "object",
              additionalProperties: false,
              properties: {
                enabled: { type: "boolean" },
                appId: { type: "string" },
                secretId: { type: "string" },
                secretKey: { type: "string" },
              },
            },
            markdownSupport: { type: "boolean" },
            dmPolicy: { type: "string", enum: ["open", "pairing", "allowlist"] },
            groupPolicy: { type: "string", enum: ["open", "allowlist", "disabled"] },
            requireMention: { type: "boolean" },
            allowFrom: { type: "array", items: { type: "string" } },
            groupAllowFrom: { type: "array", items: { type: "string" } },
            historyLimit: { type: "integer", minimum: 0 },
            textChunkLimit: { type: "integer", minimum: 1 },
            replyFinalOnly: { type: "boolean" },
            maxFileSizeMB: { type: "number", exclusiveMinimum: 0 },
            mediaTimeoutMs: { type: "integer", minimum: 1 },
          },
        },
      },
    },
  },
} as const;

export type QQBotConfig = z.infer<typeof QQBotConfigSchema>;
export type QQBotAccountConfig = z.infer<typeof QQBotAccountSchema>;

export interface QQBotPluginConfig {
  channels?: {
    qqbot?: QQBotConfig;
  };
}

export interface ResolvedQQBotAccount {
  accountId: string;
  name?: string;
  enabled: boolean;
  configured: boolean;
  appId?: string;
  markdownSupport?: boolean;
  config: QQBotAccountConfig;
}

export function normalizeAccountId(raw?: string | null): string {
  const trimmed = String(raw ?? "").trim();
  return trimmed || DEFAULT_ACCOUNT_ID;
}

function listConfiguredAccountIds(cfg: QQBotPluginConfig): string[] {
  const accounts = cfg.channels?.qqbot?.accounts;
  if (!accounts || typeof accounts !== "object") return [];
  return Object.keys(accounts).filter(Boolean);
}

export function listQQBotAccountIds(cfg: QQBotPluginConfig): string[] {
  const ids = listConfiguredAccountIds(cfg);
  if (ids.length === 0) return [DEFAULT_ACCOUNT_ID];
  return ids.sort((a, b) => a.localeCompare(b));
}

export function resolveDefaultQQBotAccountId(cfg: QQBotPluginConfig): string {
  const qqConfig = cfg.channels?.qqbot;
  if (qqConfig?.defaultAccount?.trim()) return qqConfig.defaultAccount.trim();
  const ids = listQQBotAccountIds(cfg);
  if (ids.includes(DEFAULT_ACCOUNT_ID)) return DEFAULT_ACCOUNT_ID;
  return ids[0] ?? DEFAULT_ACCOUNT_ID;
}

function resolveAccountConfig(cfg: QQBotPluginConfig, accountId: string): QQBotAccountConfig | undefined {
  const accounts = cfg.channels?.qqbot?.accounts;
  if (!accounts || typeof accounts !== "object") return undefined;
  return accounts[accountId];
}

export function resolveQQBotAccountConfig(params: {
  cfg: QQBotPluginConfig;
  accountId?: string | null;
}): QQBotAccountConfig {
  const accountId = normalizeAccountId(params.accountId);
  const parsed = QQBotConfigSchema.safeParse(params.cfg.channels?.qqbot ?? {});
  const topLevel: Partial<QQBotConfig> = parsed.success ? parsed.data : {};
  const { accounts: _ignored, defaultAccount: _ignored2, ...base } = topLevel;
  const account = resolveAccountConfig(params.cfg, accountId) ?? {};
  return QQBotAccountSchema.parse({ ...base, ...account });
}

export function isConfigured(config: QQBotAccountConfig | undefined): boolean {
  return Boolean(config?.appId && config?.clientSecret);
}

export function resolveQQBotCredentials(
  config: QQBotAccountConfig | undefined
): { appId: string; clientSecret: string } | undefined {
  if (!config?.appId || !config?.clientSecret) return undefined;
  return { appId: config.appId, clientSecret: config.clientSecret };
}

export function resolveQQBotASRCredentials(
  config: QQBotAccountConfig | undefined
): { appId: string; secretId: string; secretKey: string } | undefined {
  const asr = config?.asr;
  if (!asr?.enabled) return undefined;
  if (!asr.appId || !asr.secretId || !asr.secretKey) return undefined;
  return {
    appId: asr.appId,
    secretId: asr.secretId,
    secretKey: asr.secretKey,
  };
}

export function resolveQQBotAccount(params: {
  cfg: QQBotPluginConfig;
  accountId?: string | null;
}): ResolvedQQBotAccount {
  const accountId = normalizeAccountId(params.accountId);
  const accountConfig = resolveQQBotAccountConfig({
    cfg: params.cfg,
    accountId,
  });
  const baseEnabled = params.cfg.channels?.qqbot?.enabled !== false;
  const enabled = baseEnabled && accountConfig.enabled !== false;
  const credentials = resolveQQBotCredentials(accountConfig);
  return {
    accountId,
    name: accountConfig.name,
    enabled,
    configured: Boolean(credentials),
    appId: credentials?.appId,
    markdownSupport: accountConfig.markdownSupport ?? true,
    config: accountConfig,
  };
}
