import type { RequestContext, WaveCredentialProvider } from "./provider.js";

export class EnvTokenProvider implements WaveCredentialProvider {
  constructor(private readonly token: string) {
    if (!token) throw new Error("EnvTokenProvider requires a non-empty token");
  }
  async getToken(_req: RequestContext): Promise<string> {
    return this.token;
  }
  async getIdentity(_req: RequestContext): Promise<string> {
    return "env-default";
  }
}
