import type { AppEnv } from "../../config/env.js";
import { BearerHeaderProvider } from "./bearer-passthrough.js";
import { EnvTokenProvider } from "./env-token.js";
import { MockProvider } from "./mock.js";
import type { WaveCredentialProvider } from "./provider.js";

export function selectProvider(env: AppEnv): WaveCredentialProvider {
  switch (env.WAVE_AUTH_MODE) {
    case "env_token":
      if (!env.WAVE_API_TOKEN) {
        throw new Error(
          "WAVE_API_TOKEN required for env_token mode (parseEnv should have caught this)",
        );
      }
      return new EnvTokenProvider(env.WAVE_API_TOKEN);
    case "bearer_passthrough":
      return new BearerHeaderProvider();
    case "mock":
      return new MockProvider(env.WAVE_API_TOKEN ?? "mock-token");
  }
}
