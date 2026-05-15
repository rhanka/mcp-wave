import { createHash } from "node:crypto";
import { ToolError } from "../../lib/errors.js";
import type { RequestContext, WaveCredentialProvider } from "./provider.js";

const BEARER_RE = /^bearer\s+(.+)$/i;

export class BearerHeaderProvider implements WaveCredentialProvider {
  async getToken(req: RequestContext): Promise<string> {
    const value = req.headers?.get("authorization");
    const match = value?.match(BEARER_RE);
    const token = match?.[1]?.trim();
    if (!token) {
      throw new ToolError(
        "AUTH_BEARER_MISSING",
        {},
        "Pass the Wave token as 'Authorization: Bearer <token>' header.",
      );
    }
    return token;
  }

  async getIdentity(req: RequestContext): Promise<string> {
    const token = await this.getToken(req);
    const hash = createHash("sha256").update(token).digest("hex").slice(0, 12);
    return `bearer:${hash}`;
  }
}
