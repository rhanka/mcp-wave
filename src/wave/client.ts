import { ClientError, GraphQLClient } from "graphql-request";
import { ToolError } from "../lib/errors.js";
import { withRetry } from "../lib/retry.js";
import type { RequestContext, WaveCredentialProvider } from "./auth/provider.js";
import { mapWaveGraphQLError } from "./errors.js";
import { getSdk, type Sdk } from "./generated/sdk.js";

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
        const fn = sdk[method] as unknown as (
          v: SdkArgs<K>,
          h?: undefined,
          s?: AbortSignal,
        ) => Promise<SdkResult<K>>;
        return await fn(vars, undefined, ctrl.signal);
      } catch (e) {
        if (ctrl.signal.aborted) {
          throw new ToolError(
            "WAVE_TIMEOUT",
            { timeoutMs: this.timeoutMs },
            "Increase timeoutMs or check Wave API latency.",
          );
        }
        if (e instanceof ClientError) {
          const first = e.response.errors?.[0];
          const status = (e.response as { status?: number }).status;
          throw mapWaveGraphQLError(first, status);
        }
        if (e instanceof ToolError) throw e;
        if (e instanceof Error) throw e;
        throw new ToolError("WAVE_CLIENT_ERROR", { value: String(e) });
      } finally {
        clearTimeout(timer);
      }
    };
    return withRetry(run, this.retry);
  }

  listBusinesses(req: RequestContext, vars: SdkArgs<"ListBusinesses">) {
    return this.call(req, "ListBusinesses", vars);
  }
  getBusinessAccountingSettings(
    req: RequestContext,
    vars: SdkArgs<"GetBusinessAccountingSettings">,
  ) {
    return this.call(req, "GetBusinessAccountingSettings", vars);
  }
  listCustomers(req: RequestContext, vars: SdkArgs<"ListCustomers">) {
    return this.call(req, "ListCustomers", vars);
  }
  getCustomer(req: RequestContext, vars: SdkArgs<"GetCustomer">) {
    return this.call(req, "GetCustomer", vars);
  }
  listInvoices(req: RequestContext, vars: SdkArgs<"ListInvoices">) {
    return this.call(req, "ListInvoices", vars);
  }
  getInvoice(req: RequestContext, vars: SdkArgs<"GetInvoice">) {
    return this.call(req, "GetInvoice", vars);
  }
  listProducts(req: RequestContext, vars: SdkArgs<"ListProducts">) {
    return this.call(req, "ListProducts", vars);
  }
  listVendors(req: RequestContext, vars: SdkArgs<"ListVendors">) {
    return this.call(req, "ListVendors", vars);
  }
  listAccounts(req: RequestContext, vars: SdkArgs<"ListAccounts">) {
    return this.call(req, "ListAccounts", vars);
  }
  getAccount(req: RequestContext, vars: SdkArgs<"GetAccount">) {
    return this.call(req, "GetAccount", vars);
  }
  listSalesTaxes(req: RequestContext, vars: SdkArgs<"ListSalesTaxes">) {
    return this.call(req, "ListSalesTaxes", vars);
  }

  // ----- Mutations -----

  invoiceCreate(req: RequestContext, vars: SdkArgs<"InvoiceCreate">) {
    return this.call(req, "InvoiceCreate", vars);
  }
  invoicePatch(req: RequestContext, vars: SdkArgs<"InvoicePatch">) {
    return this.call(req, "InvoicePatch", vars);
  }
  invoiceSend(req: RequestContext, vars: SdkArgs<"InvoiceSend">) {
    return this.call(req, "InvoiceSend", vars);
  }
  invoiceDelete(req: RequestContext, vars: SdkArgs<"InvoiceDelete">) {
    return this.call(req, "InvoiceDelete", vars);
  }
  invoiceMarkSent(req: RequestContext, vars: SdkArgs<"InvoiceMarkSent">) {
    return this.call(req, "InvoiceMarkSent", vars);
  }
  invoicePaymentCreateManual(req: RequestContext, vars: SdkArgs<"InvoicePaymentCreateManual">) {
    return this.call(req, "InvoicePaymentCreateManual", vars);
  }
  customerCreate(req: RequestContext, vars: SdkArgs<"CustomerCreate">) {
    return this.call(req, "CustomerCreate", vars);
  }
  customerPatch(req: RequestContext, vars: SdkArgs<"CustomerPatch">) {
    return this.call(req, "CustomerPatch", vars);
  }
  customerDelete(req: RequestContext, vars: SdkArgs<"CustomerDelete">) {
    return this.call(req, "CustomerDelete", vars);
  }
  productCreate(req: RequestContext, vars: SdkArgs<"ProductCreate">) {
    return this.call(req, "ProductCreate", vars);
  }
  productPatch(req: RequestContext, vars: SdkArgs<"ProductPatch">) {
    return this.call(req, "ProductPatch", vars);
  }
  productArchive(req: RequestContext, vars: SdkArgs<"ProductArchive">) {
    return this.call(req, "ProductArchive", vars);
  }
  moneyTransactionCreate(req: RequestContext, vars: SdkArgs<"MoneyTransactionCreate">) {
    return this.call(req, "MoneyTransactionCreate", vars);
  }
}
