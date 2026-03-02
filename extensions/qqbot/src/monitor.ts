/**
 * QQ Bot WebSocket 网关连接管理
 */

import WebSocket from "ws";
import { createLogger, type Logger } from "./logger.js";
import { handleQQBotDispatch } from "./bot.js";
import { resolveQQBotAccount, type QQBotPluginConfig } from "./config.js";
import { clearTokenCache, getAccessToken, getGatewayUrl } from "./client.js";

export interface MonitorQQBotOpts {
  config?: QQBotPluginConfig;
  runtime?: {
    log?: (msg: string) => void;
    error?: (msg: string) => void;
  };
  abortSignal?: AbortSignal;
  accountId?: string;
}

type GatewayPayload = {
  op?: number;
  t?: string;
  s?: number | null;
  d?: unknown;
};

const INTENTS = {
  GUILD_MESSAGES: 1 << 30,
  DIRECT_MESSAGE: 1 << 12,
  GROUP_AND_C2C: 1 << 25,
};

const DEFAULT_INTENTS =
  INTENTS.GUILD_MESSAGES | INTENTS.DIRECT_MESSAGE | INTENTS.GROUP_AND_C2C;

const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000, 20000, 30000];

type MonitorState = {
  socket: WebSocket | null;
  promise: Promise<void>;
  stop: () => void;
};

const monitorStates = new Map<string, MonitorState>();

export async function monitorQQBotProvider(opts: MonitorQQBotOpts = {}): Promise<void> {
  const { config, runtime, abortSignal, accountId = "default" } = opts;
  const logger = createLogger("qqbot", {
    log: runtime?.log,
    error: runtime?.error,
  });

  const existing = monitorStates.get(accountId);
  if (existing) {
    return existing.promise;
  }

  const account = resolveQQBotAccount({
    cfg: config ?? {},
    accountId,
  });
  if (!account.configured) {
    throw new Error("QQBot not configured (missing appId or clientSecret)");
  }
  const qqCfg = account.config;

  let socket: WebSocket | null = null;
  let stopFn: (() => void) | null = null;

  const promise = new Promise<void>((resolve, reject) => {
    let stopped = false;
    let reconnectAttempt = 0;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let sessionId: string | null = null;
    let lastSeq: number | null = null;
    let connecting = false;

    const clearTimers = () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const cleanupSocket = () => {
      clearTimers();
      if (socket) {
        try {
          if (socket.readyState === WebSocket.OPEN) {
            socket.close();
          }
        } catch {
          // ignore
        }
      }
      socket = null;
    };

    const finish = (err?: unknown) => {
      if (stopped) return;
      stopped = true;
      abortSignal?.removeEventListener("abort", onAbort);
      cleanupSocket();
      monitorStates.delete(accountId);
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    };

    const onAbort = () => {
      logger.info("abort signal received, stopping gateway");
      finish();
    };

    stopFn = () => {
      logger.info("stop requested");
      finish();
    };

    const scheduleReconnect = (reason: string) => {
      if (stopped) return;
      if (reconnectTimer) return;
      const delay =
        RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
      reconnectAttempt += 1;
      logger.warn(`[reconnect] ${reason}; retry in ${delay}ms`);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void connect();
      }, delay);
    };

    const startHeartbeat = (intervalMs: number) => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }
      heartbeatTimer = setInterval(() => {
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        const payload = JSON.stringify({ op: 1, d: lastSeq });
        socket.send(payload);
      }, intervalMs);
    };

    const sendIdentify = (token: string) => {
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      const payload = {
        op: 2,
        d: {
          token: `QQBot ${token}`,
          intents: DEFAULT_INTENTS,
          shard: [0, 1],
        },
      };
      socket.send(JSON.stringify(payload));
    };

    const sendResume = (token: string, session: string, seq: number) => {
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      const payload = {
        op: 6,
        d: {
          token: `QQBot ${token}`,
          session_id: session,
          seq,
        },
      };
      socket.send(JSON.stringify(payload));
    };

    const handleGatewayPayload = async (payload: GatewayPayload) => {
      if (typeof payload.s === "number") {
        lastSeq = payload.s;
      }

      switch (payload.op) {
        case 10: {
          const hello = payload.d as { heartbeat_interval?: number } | undefined;
          const interval = hello?.heartbeat_interval ?? 30000;
          startHeartbeat(interval);

          const token = await getAccessToken(qqCfg.appId as string, qqCfg.clientSecret as string, {
            cacheKey: accountId,
          });
          if (sessionId && typeof lastSeq === "number") {
            sendResume(token, sessionId, lastSeq);
          } else {
            sendIdentify(token);
          }
          return;
        }
        case 11:
          return;
        case 7:
          cleanupSocket();
          scheduleReconnect("server requested reconnect");
          return;
        case 9:
          sessionId = null;
          lastSeq = null;
          clearTokenCache(accountId);
          cleanupSocket();
          scheduleReconnect("invalid session");
          return;
        case 0: {
          const eventType = payload.t ?? "";
          if (eventType === "READY") {
            const ready = payload.d as { session_id?: string } | undefined;
            if (ready?.session_id) {
              sessionId = ready.session_id;
            }
            reconnectAttempt = 0;
            logger.info("gateway ready");
            return;
          }
          if (eventType === "RESUMED") {
            reconnectAttempt = 0;
            logger.info("gateway resumed");
            return;
          }
          if (eventType) {
            await handleQQBotDispatch({
              eventType,
              eventData: payload.d,
              cfg: opts.config,
              accountId,
              logger,
            });
          }
          return;
        }
        default:
          return;
      }
    };

    const connect = async () => {
      if (stopped || connecting) return;
      connecting = true;

      try {
        cleanupSocket();
        const token = await getAccessToken(qqCfg.appId as string, qqCfg.clientSecret as string, {
          cacheKey: accountId,
        });
        const gatewayUrl = await getGatewayUrl(token);
        logger.info(`connecting gateway: ${gatewayUrl}`);

        const ws = new WebSocket(gatewayUrl);
        socket = ws;

        ws.on("open", () => {
          logger.info("gateway socket opened");
        });

        ws.on("message", (data) => {
          const raw = typeof data === "string" ? data : data.toString();
          let payload: GatewayPayload;
          try {
            payload = JSON.parse(raw) as GatewayPayload;
          } catch (err) {
            logger.warn(`failed to parse gateway payload: ${String(err)}`);
            return;
          }
          void handleGatewayPayload(payload).catch((err) => {
            logger.error(`gateway dispatch error: ${String(err)}`);
          });
        });

        ws.on("close", (code, reason) => {
          logger.warn(`gateway socket closed (${code}) ${String(reason)}`);
          cleanupSocket();
          scheduleReconnect("socket closed");
        });

        ws.on("error", (err) => {
          logger.error(`gateway socket error: ${String(err)}`);
        });
      } catch (err) {
        logger.error(`gateway connect failed: ${String(err)}`);
        cleanupSocket();
        scheduleReconnect("connect failed");
      } finally {
        connecting = false;
      }
    };

    if (abortSignal?.aborted) {
      finish();
      return;
    }

    abortSignal?.addEventListener("abort", onAbort, { once: true });
    void connect();
  });

  monitorStates.set(accountId, {
    socket,
    promise,
    stop: () => {
      stopFn?.();
    },
  });

  return promise;
}

export function stopQQBotMonitor(accountId?: string): void {
  if (!accountId) {
    for (const state of monitorStates.values()) {
      state.stop();
    }
    return;
  }
  monitorStates.get(accountId)?.stop();
}

export function isQQBotMonitorActive(accountId?: string): boolean {
  if (accountId) {
    return monitorStates.has(accountId);
  }
  return monitorStates.size > 0;
}
