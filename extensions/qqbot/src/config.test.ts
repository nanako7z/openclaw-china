import { describe, expect, it } from "vitest";
import {
  QQBotConfigSchema,
  listQQBotAccountIds,
  resolveDefaultQQBotAccountId,
  resolveQQBotASRCredentials,
  resolveQQBotAccount,
} from "./config.js";

describe("QQBotConfigSchema", () => {
  it("applies media defaults", () => {
    const cfg = QQBotConfigSchema.parse({});
    expect(cfg.maxFileSizeMB).toBe(100);
    expect(cfg.mediaTimeoutMs).toBe(30000);
    expect(cfg.markdownSupport).toBe(true);
  });

  it("rejects invalid media constraints", () => {
    expect(() => QQBotConfigSchema.parse({ maxFileSizeMB: 0 })).toThrow();
    expect(() => QQBotConfigSchema.parse({ mediaTimeoutMs: 0 })).toThrow();
  });

  it("resolves ASR credentials only when enabled and complete", () => {
    const disabled = QQBotConfigSchema.parse({
      asr: {
        enabled: false,
        appId: "app",
        secretId: "sid",
        secretKey: "skey",
      },
    });
    expect(resolveQQBotASRCredentials(disabled)).toBeUndefined();

    const missingSecret = QQBotConfigSchema.parse({
      asr: {
        enabled: true,
        appId: "app",
        secretId: "sid",
      },
    });
    expect(resolveQQBotASRCredentials(missingSecret)).toBeUndefined();

    const enabled = QQBotConfigSchema.parse({
      asr: {
        enabled: true,
        appId: " app ",
        secretId: " sid ",
        secretKey: " skey ",
      },
    });
    expect(resolveQQBotASRCredentials(enabled)).toEqual({
      appId: "app",
      secretId: "sid",
      secretKey: "skey",
    });
  });

  it("supports multi-account inheritance and override", () => {
    const cfg = {
      channels: {
        qqbot: {
          appId: "base-app",
          clientSecret: "base-secret",
          markdownSupport: true,
          defaultAccount: "team-a",
          accounts: {
            "team-a": {
              appId: "a-app",
              clientSecret: "a-secret",
              markdownSupport: false,
            },
            "team-b": {
              enabled: false,
            },
          },
        },
      },
    };

    expect(listQQBotAccountIds(cfg)).toEqual(["team-a", "team-b"]);
    expect(resolveDefaultQQBotAccountId(cfg)).toBe("team-a");

    const accountA = resolveQQBotAccount({ cfg, accountId: "team-a" });
    expect(accountA.configured).toBe(true);
    expect(accountA.config.markdownSupport).toBe(false);
    expect(accountA.config.appId).toBe("a-app");

    const accountB = resolveQQBotAccount({ cfg, accountId: "team-b" });
    expect(accountB.enabled).toBe(false);
    expect(accountB.configured).toBe(true);
    expect(accountB.config.appId).toBe("base-app");
  });
});
