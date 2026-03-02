/**
 * QQ Bot ChannelPlugin 实现
 */

import type { ResolvedQQBotAccount, QQBotConfig, QQBotPluginConfig } from "./types.js";
import {
  DEFAULT_ACCOUNT_ID,
  QQBotConfigJsonSchema,
  isConfigured,
  listQQBotAccountIds,
  resolveDefaultQQBotAccountId,
  resolveQQBotAccount,
} from "./config.js";
import { qqbotOutbound } from "./outbound.js";
import { monitorQQBotProvider, stopQQBotMonitor } from "./monitor.js";
import { setQQBotRuntime } from "./runtime.js";
export { DEFAULT_ACCOUNT_ID } from "./config.js";

const meta = {
  id: "qqbot",
  label: "QQ Bot",
  selectionLabel: "QQ Bot",
  docsPath: "/channels/qqbot",
  docsLabel: "qqbot",
  blurb: "QQ 开放平台机器人消息",
  aliases: ["qq"],
  order: 72,
} as const;

export const qqbotPlugin = {
  id: "qqbot",

  meta: {
    ...meta,
  },

  capabilities: {
    chatTypes: ["direct", "channel"] as const,
    media: true,
    reactions: false,
    threads: false,
    edit: false,
    reply: true,
    polls: false,
    blockStreaming: false,
  },

  messaging: {
    normalizeTarget: (raw: string): string | undefined => {
      const trimmed = raw.trim();
      if (!trimmed) return undefined;
      let value = trimmed;
      if (/^qqbot:/i.test(value)) {
        value = value.slice("qqbot:".length);
      }
      if (/^(user|group|channel):/i.test(value)) {
        return value;
      }
      if (value.startsWith("@")) {
        const next = value.slice(1).trim();
        return next ? `user:${next}` : undefined;
      }
      if (value.startsWith("#")) {
        const next = value.slice(1).trim();
        return next ? `group:${next}` : undefined;
      }
      const compact = value.replace(/\s+/g, "");
      if (/^[a-zA-Z0-9]{8,}$/.test(compact)) {
        return `user:${compact}`;
      }
      return value;
    },
    targetResolver: {
      looksLikeId: (raw: string, normalized?: string) => {
        const candidate = (normalized ?? raw).trim();
        if (!candidate) return false;
        if (/^(user|group|channel):/i.test(candidate)) return true;
        if (/^[@#]/.test(raw.trim())) return true;
        return /^[a-zA-Z0-9]{8,}$/.test(candidate);
      },
      hint: "Use user:<openid> for C2C, group:<group_openid> for groups, channel:<channel_id> for QQ channels.",
    },
    formatTargetDisplay: (params: {
      target: string;
      display?: string;
      kind?: "user" | "group" | "channel";
    }) => {
      const { target, display, kind } = params;
      if (display?.trim()) {
        const trimmed = display.trim();
        if (trimmed.startsWith("@") || trimmed.startsWith("#")) {
          return trimmed;
        }
        if (kind === "user") return `@${trimmed}`;
        if (kind === "group" || kind === "channel") return `#${trimmed}`;
        return trimmed;
      }
      return target;
    },
  },

  configSchema: QQBotConfigJsonSchema,

  reload: { configPrefixes: ["channels.qqbot"] },

  config: {
    listAccountIds: (cfg: QQBotPluginConfig): string[] => listQQBotAccountIds(cfg),
    resolveAccount: (cfg: QQBotPluginConfig, accountId?: string): ResolvedQQBotAccount =>
      resolveQQBotAccount({ cfg, accountId }),
    defaultAccountId: (cfg: QQBotPluginConfig): string => resolveDefaultQQBotAccountId(cfg),
    setAccountEnabled: (params: {
      cfg: QQBotPluginConfig;
      accountId?: string;
      enabled: boolean;
    }): QQBotPluginConfig => {
      const accountId = params.accountId ?? DEFAULT_ACCOUNT_ID;
      const useAccount = Boolean(params.cfg.channels?.qqbot?.accounts?.[accountId]);
      if (!useAccount) {
        const existing = params.cfg.channels?.qqbot ?? {};
        return {
          ...params.cfg,
          channels: {
            ...params.cfg.channels,
            qqbot: {
              ...existing,
              enabled: params.enabled,
            } as QQBotConfig,
          },
        };
      }

      return {
        ...params.cfg,
        channels: {
          ...params.cfg.channels,
          qqbot: {
            ...(params.cfg.channels?.qqbot ?? {}),
            accounts: {
              ...(params.cfg.channels?.qqbot?.accounts ?? {}),
              [accountId]: {
                ...(params.cfg.channels?.qqbot?.accounts?.[accountId] ?? {}),
                enabled: params.enabled,
              },
            },
          } as QQBotConfig,
        },
      };
    },
    deleteAccount: (params: { cfg: QQBotPluginConfig; accountId?: string }): QQBotPluginConfig => {
      const accountId = params.accountId ?? DEFAULT_ACCOUNT_ID;
      const next = { ...params.cfg };
      const current = next.channels?.qqbot;
      if (!current) return next;

      if (accountId === DEFAULT_ACCOUNT_ID) {
        const { accounts: _ignored, defaultAccount: _ignored2, ...rest } = current;
        next.channels = {
          ...next.channels,
          qqbot: { ...(rest as QQBotConfig), enabled: false },
        };
        return next;
      }

      const accounts = { ...(current.accounts ?? {}) };
      delete accounts[accountId];
      next.channels = {
        ...next.channels,
        qqbot: {
          ...(current as QQBotConfig),
          accounts: Object.keys(accounts).length > 0 ? accounts : undefined,
        },
      };
      return next;
    },
    isConfigured: (account: ResolvedQQBotAccount): boolean => isConfigured(account.config),
    describeAccount: (account: ResolvedQQBotAccount) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
    }),
    resolveAllowFrom: (params: { cfg: QQBotPluginConfig; accountId?: string }): string[] => {
      const account = resolveQQBotAccount({ cfg: params.cfg, accountId: params.accountId });
      return account.config.allowFrom ?? [];
    },
    formatAllowFrom: (params: { allowFrom: (string | number)[] }): string[] =>
      params.allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => entry.toLowerCase()),
  },

  security: {
    collectWarnings: (params: { cfg: QQBotPluginConfig }): string[] => {
      const account = resolveQQBotAccount({
        cfg: params.cfg,
        accountId: resolveDefaultQQBotAccountId(params.cfg),
      });
      const groupPolicy = account.config.groupPolicy ?? "allowlist";
      if (groupPolicy !== "open") return [];
      return [
        `- QQ groups: groupPolicy="open" allows any member to trigger (mention-gated). Set channels.qqbot.groupPolicy="allowlist" + channels.qqbot.groupAllowFrom to restrict senders.`,
      ];
    },
  },

  setup: {
    resolveAccountId: (): string => DEFAULT_ACCOUNT_ID,
    applyAccountConfig: (params: { cfg: QQBotPluginConfig }): QQBotPluginConfig => {
      const existing = params.cfg.channels?.qqbot ?? {};
      return {
        ...params.cfg,
        channels: {
          ...params.cfg.channels,
          qqbot: {
            ...existing,
            enabled: true,
          } as QQBotConfig,
        },
      };
    },
  },

  outbound: qqbotOutbound,

  gateway: {
    startAccount: async (ctx: {
      cfg: QQBotPluginConfig;
      runtime?: unknown;
      abortSignal?: AbortSignal;
      accountId: string;
      setStatus?: (status: Record<string, unknown>) => void;
      log?: { info: (msg: string) => void; error: (msg: string) => void };
    }): Promise<void> => {
      ctx.setStatus?.({ accountId: ctx.accountId });
      ctx.log?.info(`[qqbot] starting gateway for account ${ctx.accountId}`);

      if (ctx.runtime) {
        const candidate = ctx.runtime as {
          channel?: {
            routing?: { resolveAgentRoute?: unknown };
            reply?: { dispatchReplyFromConfig?: unknown };
          };
        };
        if (
          candidate.channel?.routing?.resolveAgentRoute &&
          candidate.channel?.reply?.dispatchReplyFromConfig
        ) {
          setQQBotRuntime(ctx.runtime as Record<string, unknown>);
        }
      }

      await monitorQQBotProvider({
        config: ctx.cfg,
        runtime:
          (ctx.runtime as { log?: (msg: string) => void; error?: (msg: string) => void }) ?? {
            log: ctx.log?.info ?? console.log,
            error: ctx.log?.error ?? console.error,
          },
        abortSignal: ctx.abortSignal,
        accountId: ctx.accountId,
      });
    },
    stopAccount: async (ctx: { accountId: string }): Promise<void> => {
      stopQQBotMonitor(ctx.accountId);
    },
    getStatus: () => ({ connected: true }),
  },
};
