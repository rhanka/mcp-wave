import { getAccountTool } from "../tools/accounts/get-account.js";
import { listAccountsTool } from "../tools/accounts/list-accounts.js";
import { listBusinessesTool } from "../tools/businesses/list-businesses.js";
import { getCustomerTool } from "../tools/customers/get-customer.js";
import { listCustomersTool } from "../tools/customers/list-customers.js";
import { downloadInvoicePdfTool } from "../tools/invoices/download-invoice-pdf.js";
import { getInvoiceTool } from "../tools/invoices/get-invoice.js";
import { listInvoicesTool } from "../tools/invoices/list-invoices.js";
import { listProductsTool } from "../tools/products/list-products.js";
import { listClientProfilesTool } from "../tools/profiles/list-client-profiles.js";
import { getPayrollRatesTool } from "../tools/tax/get-payroll-rates.js";
import { listVendorsTool } from "../tools/vendors/list-vendors.js";
import type { RegisteredTool } from "./define-tool.js";

const TOOLS: RegisteredTool[] = [
  listBusinessesTool,
  listCustomersTool,
  getCustomerTool,
  listInvoicesTool,
  getInvoiceTool,
  downloadInvoicePdfTool,
  listProductsTool,
  listVendorsTool,
  listAccountsTool,
  getAccountTool,
  listClientProfilesTool,
  getPayrollRatesTool,
];

export function allTools(): readonly RegisteredTool[] {
  return TOOLS;
}

export function registerTools(...tools: RegisteredTool[]): void {
  TOOLS.push(...tools);
}

export function findTool(name: string): RegisteredTool | undefined {
  return TOOLS.find((t) => t.name === name);
}

export function __clearToolsForTests(): void {
  TOOLS.length = 0;
}
