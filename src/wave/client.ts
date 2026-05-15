import { ClientError, GraphQLClient } from "graphql-request";
import { ToolError } from "../lib/errors.js";
import { withRetry } from "../lib/retry.js";
import type { RequestContext, WaveCredentialProvider } from "./auth/provider.js";
import { mapWaveGraphQLError } from "./errors.js";
import { type Sdk, getSdk } from "./generated/sdk.js";

export interface WaveClientOptions {
  endpoint: string;
  provider: WaveCredentialProvider;
  timeoutMs?: number;
  retry?: { retries?: number; minTimeout?: number; maxTimeout?: number };
}

type SdkMethod = keyof Sdk;
type SdkArgs<K extends SdkMethod> = Parameters<Sdk[K]>[0];
type SdkResult<K extends SdkMethod> = Awaited<ReturnType<Sdk[K]>>;

export class WaveClient {
  private readonly endpoint: string;
  private readonly provider: WaveCredentialProvider;
  private readonly timeoutMs: number;
  private readonly retry: WaveClientOptions["retry"];

  constructor(opts: WaveClientOptions) {
    this.endpoint = opts.endpoint;
    this.provider = opts.provider;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.retry = opts.retry ?? {};
  }

  private async sdkFor(req: RequestContext): Promise<Sdk> {
    const token = await this.provider.getToken(req);
    const gql = new GraphQLClient(this.endpoint, {
      headers: { authorization: `Bearer ${token}` },
    });
    return getSdk(gql);
  }

  private async call<K extends SdkMethod>(
    req: RequestContext,
    method: K,
    vars: SdkArgs<K>,
  ): Promise<SdkResult<K>> {
    const run = async (): Promise<SdkResult<K>> => {
      const sdk = await this.sdkFor(req);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
      try {
        const fn = sdk[method] as unknown as (v: SdkArgs<K>) => Promise<SdkResult<K>>;
        return await fn(vars);
      } catch (e) {
        if (e instanceof ClientError) {
          const first = e.response.errors?.[0];
          throw mapWaveGraphQLError(first);
        }
        if (e instanceof ToolError) throw e;
        throw new ToolError("WAVE_CLIENT_ERROR", { message: String(e) });
      } finally {
        clearTimeout(timer);
      }
    };
    return withRetry(run, this.retry);
  }

  listBusinesses(req: RequestContext, vars: SdkArgs<"ListBusinesses">) {
    return this.call(req, "ListBusinesses", vars);
  }
  listCustomers(req: RequestContext, vars: SdkArgs<"ListCustomers">) {
    return this.call(req, "ListCustomers", vars);
  }
  getCustomer(req: RequestContext, vars: SdkArgs<"GetCustomer">) {
    return this.call(req, "GetCustomer", vars);
  }
}
