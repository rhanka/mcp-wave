import type { RequestContext, WaveCredentialProvider } from "./provider.js";

export class MockProvider implements WaveCredentialProvider {
  constructor(private readonly token = "mock-token") {}
  async getToken(_req: RequestContext): Promise<string> {
    return this.token;
  }
  async getIdentity(_req: RequestContext): Promise<string> {
    return "mock";
  }
}
