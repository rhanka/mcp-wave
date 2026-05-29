import { getAccountTool } from "../tools/accounts/get-account.js";
import { listAccountsTool } from "../tools/accounts/list-accounts.js";
import { listBusinessesTool } from "../tools/businesses/list-businesses.js";
import { createCustomerTool } from "../tools/customers/create-customer.js";
import { getCustomerTool } from "../tools/customers/get-customer.js";
import { listCustomersTool } from "../tools/customers/list-customers.js";
import { approveInvoiceTool } from "../tools/invoices/approve-invoice.js";
import { createInvoiceTool } from "../tools/invoices/create-invoice.js";
import { deleteInvoiceTool } from "../tools/invoices/delete-invoice.js";
import { deleteInvoicePaymentTool } from "../tools/invoices/delete-invoice-payment.js";
import { downloadInvoicePdfTool } from "../tools/invoices/download-invoice-pdf.js";
import { getInvoiceTool } from "../tools/invoices/get-invoice.js";
import { getInvoicePaymentTool } from "../tools/invoices/get-invoice-payment.js";
import { listInvoicesTool } from "../tools/invoices/list-invoices.js";
import { markInvoicePaidTool } from "../tools/invoices/mark-invoice-paid.js";
import { sendInvoiceTool } from "../tools/invoices/send-invoice.js";
import { sendInvoicePaymentReceiptTool } from "../tools/invoices/send-invoice-payment-receipt.js";
import { updateInvoicePaymentTool } from "../tools/invoices/update-invoice-payment.js";
import { listProductsTool } from "../tools/products/list-products.js";
import { upsertProductTool } from "../tools/products/upsert-product.js";
import { listClientProfilesTool } from "../tools/profiles/list-client-profiles.js";
import { getPayrollRatesTool } from "../tools/tax/get-payroll-rates.js";
import { listVendorsTool } from "../tools/vendors/list-vendors.js";
import { auditAccountMappingTool } from "../tools/workflows/audit-account-mapping.js";
import { createInvoiceForClientTool } from "../tools/workflows/create-invoice-for-client.js";
import { setupAccountMappingTool } from "../tools/workflows/setup-account-mapping.js";
import { splitPayrollRemittanceTool } from "../tools/workflows/split-payroll-remittance.js";
import type { RegisteredTool } from "./define-tool.js";

const TOOLS: RegisteredTool[] = [
  // Read tools (Phase A.5)
  listBusinessesTool,
  listCustomersTool,
  getCustomerTool,
  listInvoicesTool,
  getInvoiceTool,
  getInvoicePaymentTool,
  downloadInvoicePdfTool,
  listProductsTool,
  listVendorsTool,
  listAccountsTool,
  getAccountTool,
  listClientProfilesTool,
  getPayrollRatesTool,
  // Write tools (Phase B.1)
  approveInvoiceTool,
  createInvoiceTool,
  sendInvoiceTool,
  markInvoicePaidTool,
  updateInvoicePaymentTool,
  deleteInvoicePaymentTool,
  sendInvoicePaymentReceiptTool,
  deleteInvoiceTool,
  createCustomerTool,
  upsertProductTool,
  // Workflow tools (Phase B.3)
  createInvoiceForClientTool,
  auditAccountMappingTool,
  setupAccountMappingTool,
  splitPayrollRemittanceTool,
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
