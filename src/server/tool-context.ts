import type { Logger } from "pino";
import type { AppEnv } from "../config/env.js";
import type { AccountMappingLoader } from "../domain/tax/account-mapping-loader.js";
import type { TaxRatesLoader } from "../domain/tax/rates-loader.js";
import type { RequestContext } from "../wave/auth/provider.js";
import type { WaveClient } from "../wave/client.js";

export interface ToolContext {
  req: RequestContext;
  wave: WaveClient;
  taxRates: TaxRatesLoader;
  accountMapping: AccountMappingLoader;
  env: AppEnv;
  logger: Logger;
  identity: string;
}
