/**
 * QQ Bot 出站适配器
 */

import { resolveQQBotAccount } from "./config.js";
import {
  getAccessToken,
  sendC2CInputNotify,
  sendC2CMessage,
  sendGroupMessage,
  sendChannelMessage,
} from "./client.js";
import { sendFileQQBot } from "./send.js";
import type { QQBotPluginConfig, QQBotSendResult } from "./types.js";

type TargetKind = "c2c" | "group" | "channel";

function stripPrefix(value: string, prefix: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

function parseTarget(to: string): { kind: TargetKind; id: string } {
  let raw = to.trim();
  raw = stripPrefix(raw, "qqbot:");

  if (raw.startsWith("group:")) {
    return { kind: "group", id: raw.slice("group:".length) };
  }
  if (raw.startsWith("channel:")) {
    return { kind: "channel", id: raw.slice("channel:".length) };
  }
  if (raw.startsWith("user:")) {
    return { kind: "c2c", id: raw.slice("user:".length) };
  }
  if (raw.startsWith("c2c:")) {
    return { kind: "c2c", id: raw.slice("c2c:".length) };
  }

  return { kind: "c2c", id: raw };
}

function resolveOutboundAccount(params: {
  cfg: QQBotPluginConfig;
  accountId?: string;
}): { accountId: string; config: ReturnType<typeof resolveQQBotAccount>["config"]; error?: string } {
  const account = resolveQQBotAccount({
    cfg: params.cfg,
    accountId: params.accountId,
  });
  if (!account.configured) {
    return {
      accountId: account.accountId,
      config: account.config,
      error: "QQBot not configured (missing appId/clientSecret)",
    };
  }
  return { accountId: account.accountId, config: account.config };
}

export const qqbotOutbound = {
  deliveryMode: "direct" as const,
  textChunkLimit: 1500,
  chunkerMode: "markdown" as const,

  sendText: async (params: {
    cfg: QQBotPluginConfig;
    accountId?: string;
    to: string;
    text: string;
    replyToId?: string;
  }): Promise<QQBotSendResult> => {
    const { cfg, to, text, replyToId, accountId } = params;
    const resolved = resolveOutboundAccount({ cfg, accountId });
    if (resolved.error) {
      return { channel: "qqbot", error: resolved.error };
    }

    const qqCfg = resolved.config;
    const target = parseTarget(to);
    const accessToken = await getAccessToken(qqCfg.appId as string, qqCfg.clientSecret as string, {
      cacheKey: resolved.accountId,
    });
    const markdown = qqCfg.markdownSupport ?? true;

    try {
      if (target.kind === "group") {
        const result = await sendGroupMessage({
          accessToken,
          groupOpenid: target.id,
          content: text,
          messageId: replyToId,
          markdown,
        });
        return { channel: "qqbot", messageId: result.id, timestamp: result.timestamp };
      }
      if (target.kind === "channel") {
        const result = await sendChannelMessage({
          accessToken,
          channelId: target.id,
          content: text,
          messageId: replyToId,
        });
        return { channel: "qqbot", messageId: result.id, timestamp: result.timestamp };
      }

      const result = await sendC2CMessage({
        accessToken,
        openid: target.id,
        content: text,
        messageId: replyToId,
        markdown,
      });
      return { channel: "qqbot", messageId: result.id, timestamp: result.timestamp };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { channel: "qqbot", error: message };
    }
  },

  sendMedia: async (params: {
    cfg: QQBotPluginConfig;
    accountId?: string;
    to: string;
    text?: string;
    mediaUrl?: string;
    replyToId?: string;
  }): Promise<QQBotSendResult> => {
    const { cfg, to, mediaUrl, text, replyToId, accountId } = params;
    if (!mediaUrl) {
      const fallbackText = text?.trim() ?? "";
      if (!fallbackText) {
        return { channel: "qqbot", error: "mediaUrl is required for sendMedia" };
      }
      return qqbotOutbound.sendText({ cfg, accountId, to, text: fallbackText, replyToId });
    }

    const resolved = resolveOutboundAccount({ cfg, accountId });
    if (resolved.error) {
      return { channel: "qqbot", error: resolved.error };
    }
    const qqCfg = resolved.config;

    const target = parseTarget(to);
    if (target.kind === "channel") {
      const fallbackText = text?.trim() ? `${text}\n${mediaUrl}` : mediaUrl;
      return qqbotOutbound.sendText({ cfg, accountId, to, text: fallbackText, replyToId });
    }

    try {
      const result = await sendFileQQBot({
        cfg: qqCfg,
        target: { kind: target.kind, id: target.id },
        mediaUrl,
        messageId: replyToId,
        accountId: resolved.accountId,
      });
      return { channel: "qqbot", messageId: result.id, timestamp: result.timestamp };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { channel: "qqbot", error: message };
    }
  },

  sendTyping: async (params: {
    cfg: QQBotPluginConfig;
    accountId?: string;
    to: string;
    replyToId?: string;
    inputSecond?: number;
  }): Promise<QQBotSendResult> => {
    const { cfg, to, replyToId, inputSecond, accountId } = params;
    const resolved = resolveOutboundAccount({ cfg, accountId });
    if (resolved.error) {
      return { channel: "qqbot", error: resolved.error };
    }
    const qqCfg = resolved.config;

    const target = parseTarget(to);
    if (target.kind !== "c2c") {
      return { channel: "qqbot" };
    }

    try {
      const accessToken = await getAccessToken(qqCfg.appId as string, qqCfg.clientSecret as string, {
        cacheKey: resolved.accountId,
      });
      await sendC2CInputNotify({
        accessToken,
        openid: target.id,
        messageId: replyToId,
        inputSecond,
      });
      return { channel: "qqbot" };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { channel: "qqbot", error: message };
    }
  },
};
