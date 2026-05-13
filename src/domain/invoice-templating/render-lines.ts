import { ToolError } from "../../lib/errors.js";
import type { ClientProfile } from "../client-profiles/schema.js";

export interface RenderedLine {
  description: string;
  quantity: number;
  unit_price: number;
  product_id?: string;
  tax_codes: string[];
}

export interface RenderLinesInput {
  profile: ClientProfile;
  quantity: number;
  period_label?: string;
  override_unit_price?: number;
}

export function renderLines(input: RenderLinesInput): RenderedLine[] {
  const unit_price = input.override_unit_price ?? input.profile.hourly_rate;
  if (unit_price === undefined) {
    throw new ToolError(
      "MISSING_RATE",
      { alias: input.profile.alias },
      "Set hourly_rate in the client profile or pass override_unit_price.",
    );
  }

  const baseDesc = input.profile.default_description ?? `${input.profile.alias} services`;
  const description = input.period_label ? `${baseDesc} — ${input.period_label}` : baseDesc;
  const line: RenderedLine = {
    description,
    quantity: input.quantity,
    unit_price,
    tax_codes: [...input.profile.default_taxes],
  };

  if (input.profile.default_product_id !== undefined) {
    line.product_id = input.profile.default_product_id;
  }

  return [line];
}
