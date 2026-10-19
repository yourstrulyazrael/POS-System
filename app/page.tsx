"use client";

import {
  ArrowRight,
  BarChart3,
  Bell,
  Boxes,
  CalendarClock,
  Check,
  ChevronDown,
  CircleDollarSign,
  ClipboardList,
  Cloud,
  CloudOff,
  CloudUpload,
  EllipsisVertical,
  Clock3,
  Coffee,
  CreditCard,
  Banknote,
  CirclePause,
  History,
  CircleHelp,
  LayoutDashboard,
  Download,
  FileSpreadsheet,
  FileUp,
  ImageIcon,
  Info,
  KeyRound,
  LayoutGrid,
  ImageOff,
  PenLine,
  Printer,
  LogOut,
  Minus,
  PackagePlus,
  Plus,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  ScanBarcode,
  Search,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Store,
  Trash2,
  TriangleAlert,
  UserRound,
  Users,
  WifiOff,
  UserPlus,
  WalletCards,
  X,
  type LucideIcon,
} from "lucide-react";
import { AUTH_STORAGE_KEY, callPosAdmin, createClient } from "@/lib/supabase/client";
import { loadStoreConnection, projectRef, type StoreConnection } from "@/lib/store-connection";
import { ConnectStoreScreen } from "@/components/connect-store";
import { StoreName, StoreNameContext } from "@/components/store-name";
import { headerButton, headerPrimaryButton, PageHeader, PageTitle, Sparkline } from "@/components/page-header";
import { deletePendingOrder, isNetworkError, listPendingOrders, readCache, savePendingOrder, storedSessionUserId, writeCache, type PendingOrder } from "@/lib/offline-store";
import { buildCashCountReport, buildRefundReceipt, buildSaleReceipt, defaultStoreDetails, type StoreDetails } from "@/lib/receipts";
import { checkForUpdates, defaultHardwareSettings, installUpdate, isDesktopApp, loadHardwareSettings, openCashDrawer, printDocument, saveHardwareSettings, supportsLiveUpdates, watchUpdateStatus, type HardwareSettings, type UpdateStatus } from "@/lib/hardware";
import { rememberOfflineCredential, verifyOfflineCredential } from "@/lib/offline-auth";
import { closeSession, expectedCash, openSession, readCurrentSession, readSessionOutbox, recordInSession, removeFromSessionOutbox, type CashSession } from "@/lib/cash-session";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { AnalyticsReportsView } from "@/components/analytics-reports";
import { SmoothLineChart } from "@/components/smooth-line-chart";
import { ShiftHistoryView } from "@/components/shift-history";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useFunctionKeys, type FunctionKey } from "@/lib/use-function-keys";
import { formatQuantity, isValidCustomQuantity, itemCountOf, lineAmount, roundQuantity } from "@/lib/quantity";
import { defaultPosLayout, loadPosLayout, normalizeLayout, savePosLayout, type PosLayout } from "@/lib/pos-layout";
import { CartResizeHandle, PosLayoutPanel } from "@/components/pos-layout-panel";
import { CashCountDialog, DrawerStatusButton, HardwareSettingsCard, OpenDrawerDialog, ReconnectBanner, RecallDialog, RefundDialog, RefundIcon, StoreDetailsCard, SuspendDialog, UpdateReadyBar, UpdatesCard, VoidDialog, VoidIcon } from "@/components/pos-dialogs";
import { listSuspendedOrders, MAX_SUSPENDED_ORDERS, saveSuspendedOrders, type SuspendedOrder } from "@/lib/suspended-orders";
import { buildProductsXlsx, buildTemplateXlsx, importColumns, readProductFile, type RawProductRecord } from "@/lib/product-import";
import { FormEvent, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";

type Role = "employee" | "admin";
type PaymentMethod = "cash" | "e_wallet" | "card";
type Product = {
  id: string;
  name: string;
  category: string;
  costPrice: number;
  costPriceKnown: boolean;
  wholesalePrice: number;
  price: number;
  stock: number;
  imageIcon: string;
  imageUrl: string | null;
  barcode: string | null;
  emoji: string;
  color: string;
};
type OrderLine = { id?: string; name: string; quantity: number; unitPrice: number; custom: boolean; refundedQuantity: number; wholesale?: boolean };
type Order = { id: string; fullId: string; items: number; total: number; time: string; createdAt: Date; lines: OrderLine[]; paymentMethod: PaymentMethod; paymentReferenceLast4: string | null; cashReceived: number | null; changeDue: number | null; employeeName: string; isWholesale: boolean; syncStatus?: "pending" | "failed"; syncError?: string | null; status: "completed" | "voided"; refundedTotal: number; voidReason: string | null };
type SalesChartPoint = { label: string; cash: number; eWallet: number; card: number };
type ProfitReportPoint = {
  label: string;
  revenue: number;
  costOfGoods: number;
  netProfit: number;
  orderCount: number;
  ordersWithCost: number;
  ordersWithoutCost: number;
};
type ProfitReportRow = {
  bucket_label: string;
  revenue_total: number | string;
  cost_of_goods: number | string;
  net_profit: number | string;
  orders_count: number | string;
  orders_with_cost: number | string;
  orders_without_cost: number | string;
};
type ProductRow = { id: string; name: string; category: string; cost_price: number; cost_price_known: boolean; wholesale_price: number; price: number; stock: number; image_icon: string | null; image_url: string | null; barcode: string | null };
type OrderRow = {
  id: string;
  total: number;
  created_at: string;
  order_items: { id: string; quantity: number; product_name: string; unit_price: number | string; product_id: string | null; is_wholesale?: boolean; refund_items: { quantity: number }[] }[];
  status: "completed" | "voided";
  refunded_total: number | string;
  void_reason: string | null;
  client_order_id: string | null;
  receipt_number?: string | null;
  payment_method: PaymentMethod;
  payment_reference_last4: string | null;
  cash_received: number | string | null;
  change_due: number | string | null;
  employee_name: string;
  employee_id?: string | null;
  is_wholesale: boolean;
};
// One cart line: a product at retail or at wholesale price.
type CartLine = { key: string; product: Product; wholesale: boolean; quantity: number };
const WHOLESALE_SUFFIX = "::wholesale";
const cartKey = (productId: string, wholesale: boolean) => (wholesale ? `${productId}${WHOLESALE_SUFFIX}` : productId);
const parseCartKey = (key: string) =>
  key.endsWith(WHOLESALE_SUFFIX)
    ? { productId: key.slice(0, -WHOLESALE_SUFFIX.length), wholesale: true }
    : { productId: key, wholesale: false };
// A destructive action waiting for the user to confirm it.
// tone "neutral" is for a choice that isn't destructive; a second action
// (secondaryLabel/onSecondary) adds a third button between Cancel and confirm.
type ConfirmAction = { title: string; message: string; confirmLabel: string; onConfirm: () => Promise<void>; tone?: "danger" | "neutral"; secondaryLabel?: string; onSecondary?: () => Promise<void> };
type NewProductValues = { name: string; category: string; costPrice: number; wholesalePrice: number; price: number; stock: number; imageIcon: string; image: File | null; barcode: string | null };
// A "Quick Add" line for something not in the product catalog.
type CustomItem = { id: string; description: string; quantity: number; unitPrice: number };
type Employee = { id: string; email: string; full_name: string; role: "employee" };
type DashboardStats = { sales_total: number; orders_today: number; active_products: number; units_in_stock: number; active_employees: number };
type SalesPeriod = "today" | "7days" | "30days";
type Page = "dashboard" | "analytics" | "pos" | "inventory" | "orders" | "shifts" | "employees" | "account";

const POS_DISPLAY_LIMIT = 200;
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "";
const INVENTORY_PAGE_SIZE = 100;

const money = (amount: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(amount);
const paymentMethodLabel = (method: PaymentMethod) =>
  method === "e_wallet" ? "E-Wallet" : method === "card" ? "Card" : "Cash";

const categoryColors = ["bg-sky-50", "bg-amber-50", "bg-violet-50", "bg-rose-50"];
const showImagesStorageKey = "pos.showProductImages";

const productIcons = [
  { id: "auto", label: "Auto", emoji: "" },
  { id: "rice", label: "Rice", emoji: "🍚" },
  { id: "canned", label: "Canned", emoji: "🥫" },
  { id: "noodles", label: "Noodles", emoji: "🍜" },
  { id: "snacks", label: "Snacks", emoji: "🍟" },
  { id: "eggs", label: "Eggs", emoji: "🥚" },
  { id: "drink", label: "Drink", emoji: "🥤" },
  { id: "coffee", label: "Coffee", emoji: "☕" },
  { id: "condiments", label: "Condiments", emoji: "🧂" },
  { id: "personal-care", label: "Personal care", emoji: "🧴" },
  { id: "household", label: "Household", emoji: "🧹" },
  { id: "bread", label: "Bread", emoji: "🍞" },
  { id: "candy", label: "Candy", emoji: "🍬" },
  { id: "frozen", label: "Frozen", emoji: "🧊" },
  { id: "medicine", label: "Medicine", emoji: "🩹" },
] as const;

function productAppearance(name: string, category: string, index: number, imageIcon = "auto") {
  const emojiByCategory: Record<string, string> = {
    "Rice & Grains": "🍚",
    "Canned Goods": "🥫",
    "Instant Noodles": "🍜",
    Snacks: "🍟",
    "Eggs & Dairy": "🥚",
    Beverages: "🥤",
    "Coffee & Drinks": "☕",
    Condiments: "🧂",
    "Personal Care": "🧴",
    Household: "🧹",
  };
  const emojiByName: Record<string, string> = {
    "Sinandomeng Rice (1 kg)": "🍚",
    "Pancit Canton": "🍜",
    "Cup Noodles": "🍲",
    "Potato Chips": "🍟",
    "SkyFlakes Crackers": "🍘",
    "Bottled Water": "💧",
    "Cola (Small Bottle)": "🥤",
    "3-in-1 Coffee Sachet": "☕",
    "Powdered Juice Sachet": "🧃",
    "Shampoo Sachet": "🧴",
    "Bath Soap": "🧼",
    "Laundry Detergent Sachet": "🫧",
    "Fresh Eggs (piece)": "🥚",
  };
  const categoryEmoji = emojiByCategory[category] ?? "✨";
  const selectedIcon = productIcons.find((icon) => icon.id === imageIcon);
  return {
    emoji: selectedIcon?.emoji || emojiByName[name] || categoryEmoji,
    color: categoryColors[index % categoryColors.length],
  };
}

type Workspace = Awaited<ReturnType<typeof fetchWorkspaceData>>;
type CachedProfile = { role: Role; fullName: string; email: string };
type StockShortfall = { id: string; productName: string; shortfall: number; createdAt: Date };

// A sale waiting in the offline queue, shown alongside synced orders.
function pendingToOrder(sale: PendingOrder): Order {
  const createdAt = new Date(sale.createdAt);
  return {
    id: sale.receiptNumber ?? `#${sale.clientOrderId.slice(0, 8)}`,
    fullId: sale.clientOrderId,
    createdAt,
    lines: sale.items.map((item) => ({
      name: item.kind === "product" ? item.name : item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      custom: item.kind === "custom",
      refundedQuantity: 0,
      wholesale: item.kind === "product" && !!item.wholesale,
    })),
    items: sale.items.reduce((sum, item) => sum + itemCountOf(item.quantity), 0),
    total: sale.total,
    time: createdAt.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }),
    paymentMethod: sale.paymentMethod,
    paymentReferenceLast4: sale.paymentReferenceLast4,
    cashReceived: sale.cashReceived,
    changeDue: sale.cashReceived === null ? null : Math.round((sale.cashReceived - sale.total) * 100) / 100,
    employeeName: sale.employeeName,
    isWholesale: sale.wholesale,
    syncStatus: sale.failed ? "failed" : "pending",
    syncError: sale.lastError,
    status: "completed",
    refundedTotal: 0,
    voidReason: null,
  };
}

// Problems that mean "try again later" rather than "the server refused this":
// no connection, or a session that needs refreshing once back online.
function isTransientSyncError(error: unknown) {
  if (isNetworkError(error)) return true;
  const message = error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message) : "";
  return /jwt|token|session|authentication required|503|502|504/i.test(message);
}

// Supabase returns at most 1,000 rows per request, so large lists are read
// page by page until a page comes back empty.
async function fetchAllRows<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (;;) {
    const { data, error } = await page(rows.length, rows.length + 999);
    if (error) return { data: null, error };
    if (!data?.length) return { data: rows, error: null };
    rows.push(...data);
  }
}

async function fetchWorkspaceData(includeAdminStats = false, period: SalesPeriod = "today") {
  const supabase = createClient();
  const [productsResult, ordersResult] = await Promise.all([
    fetchAllRows<ProductRow>((from, to) => supabase.from("products").select("id, name, category, cost_price, cost_price_known, wholesale_price, price, stock, image_icon, image_url, barcode").eq("active", true).order("name").order("id").range(from, to).returns<ProductRow[]>()),
    supabase.from("orders").select("id, total, created_at, payment_method, payment_reference_last4, cash_received, change_due, employee_name, is_wholesale, status, refunded_total, void_reason, client_order_id, receipt_number, order_items(id, quantity, product_name, unit_price, product_id, is_wholesale, refund_items(quantity))").order("created_at", { ascending: false }).limit(50).returns<OrderRow[]>(),
  ]);
  // Receipt header; optional until the refunds/receipts migration is applied.
  const storeResult = await supabase.from("store_settings").select("store_name, address, phone, tin, receipt_footer").eq("id", 1).maybeSingle();
  const storeDetails: StoreDetails = !storeResult.error && storeResult.data
    ? {
      storeName: storeResult.data.store_name,
      address: storeResult.data.address,
      phone: storeResult.data.phone,
      tin: storeResult.data.tin,
      receiptFooter: storeResult.data.receipt_footer,
    }
    : defaultStoreDetails;
  if (productsResult.error) throw new Error(`Unable to load products: ${productsResult.error.message}`);
  if (ordersResult.error) throw new Error(`Unable to load orders: ${ordersResult.error.message}`);
  let stats: DashboardStats | null = null;
  let salesChart: SalesChartPoint[] = [];
  let shortfalls: StockShortfall[] = [];
  if (includeAdminStats) {
    const [{ data, error }, { data: chartRows, error: chartError }, shortfallResult] = await Promise.all([
      supabase.rpc("get_admin_dashboard_stats", { p_period: period }).single(),
      supabase.rpc("get_admin_sales_chart", { p_period: period }),
      supabase.from("stock_shortfalls").select("id, product_name, shortfall, created_at").is("resolved_at", null).order("created_at", { ascending: false }).limit(100),
    ]);
    // Optional: missing until the offline-sync migration is applied.
    if (!shortfallResult.error) {
      shortfalls = (shortfallResult.data ?? []).map((row: { id: string; product_name: string; shortfall: number; created_at: string }) => ({
        id: row.id,
        productName: row.product_name,
        shortfall: Number(row.shortfall),
        createdAt: new Date(row.created_at),
      }));
    }
    if (error) throw new Error(`Unable to load store summary: ${error.message}`);
    if (chartError) throw new Error(`Unable to load sales chart: ${chartError.message}`);
    if (
      !data ||
      typeof data !== "object" ||
      !("sales_total" in data) ||
      !("orders_today" in data) ||
      !("active_products" in data) ||
      !("units_in_stock" in data) ||
      !("active_employees" in data)
    ) {
      throw new Error("Store summary response was invalid.");
    }
    stats = {
      sales_total: Number(data.sales_total),
      orders_today: Number(data.orders_today),
      active_products: Number(data.active_products),
      units_in_stock: Number(data.units_in_stock),
      active_employees: Number(data.active_employees),
    };
    salesChart = (chartRows ?? []).map((row: { bucket_label: string; cash_total: number | string; e_wallet_total: number | string; card_total: number | string }) => ({
      label: String(row.bucket_label),
      cash: Number(row.cash_total),
      eWallet: Number(row.e_wallet_total),
      card: Number(row.card_total),
    }));
  }
  return {
    products: productsResult.data.map((product, index): Product => ({
      id: product.id,
      name: product.name,
      category: product.category,
      stock: product.stock,
      costPrice: Number(product.cost_price),
      costPriceKnown: product.cost_price_known,
      wholesalePrice: Number(product.wholesale_price),
      price: Number(product.price),
      imageIcon: product.image_icon ?? "auto",
      imageUrl: product.image_url,
      barcode: product.barcode,
      ...productAppearance(product.name, product.category, index, product.image_icon ?? "auto"),
    })),
    orders: ordersResult.data.map((order): Order => ({
      // The receipt number is the sale's one-time id, so receipts printed offline
      // match the order after it syncs.
      // Receipt number (062526-0001); older sales without one keep the short id.
      id: order.receipt_number ?? `#${(order.client_order_id ?? order.id).slice(0, 8)}`,
      fullId: order.id,
      createdAt: new Date(order.created_at),
      // A line without a product_id is a custom item (or a since-deleted product).
      lines: order.order_items.map((item) => ({
        id: item.id,
        name: item.product_name,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unit_price),
        custom: item.product_id === null,
        refundedQuantity: roundQuantity((item.refund_items ?? []).reduce((sum, refunded) => sum + Number(refunded.quantity), 0)),
        wholesale: item.is_wholesale ?? false,
      })),
      items: order.order_items.reduce((sum, item) => sum + itemCountOf(Number(item.quantity)), 0),
      total: Number(order.total),
      time: new Date(order.created_at).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }),
      paymentMethod: order.payment_method,
      paymentReferenceLast4: order.payment_reference_last4,
      cashReceived: order.cash_received === null ? null : Number(order.cash_received),
      changeDue: order.change_due === null ? null : Number(order.change_due),
      employeeName: order.employee_name || "Former employee",
      isWholesale: order.is_wholesale,
      status: order.status ?? "completed",
      refundedTotal: Number(order.refunded_total ?? 0),
      voidReason: order.void_reason ?? null,
    })),
    stats,
    salesChart,
    shortfalls,
    storeDetails,
  };
}

// An optional price field: blank means "none" (stored as 0, e.g. a product not
// sold wholesale). Anything else must be a number (validated by the caller).
function optionalPrice(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text === "" ? 0 : Number(text);
}

// A POS entry is "<quantity>/<barcode or name>" or just "<barcode or name>",
// e.g. "24/4800016644290" adds 24 of that item. A decimal quantity
// ("0.25/sugar") is for custom items only.
function parseSaleEntry(value: string) {
  const match = /^\s*(\d+(?:\.\d+)?|\.\d+)\s*\/\s*(.*)$/.exec(value);
  return match ? { quantity: Number(match[1]), term: match[2].trim() } : { quantity: null, term: value.trim() };
}

// Categories are free text, so typing a new name creates one. Spacing is
// tidied and a name matching an existing category (ignoring case) reuses it,
// so "snacks" doesn't become a second "Snacks" chip. Returns "" if invalid.
function normalizeCategory(value: unknown, existing: string[]) {
  const name = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!name || name.length > 80) return "";
  return existing.find((category) => category.toLowerCase() === name.toLowerCase()) ?? name;
}

// Barcodes are stored as scanned: 1–64 printable ASCII characters, no spaces.
// Spaces are removed, so one typed or copied the way it's printed
// ("4 800016 644290") is stored as scanned ("4800016644290").
// Returns null for an empty value and undefined for an invalid one.
function normalizeBarcode(value: unknown) {
  if (value === undefined || value === null) return null;
  const barcode = compactBarcode(String(value));
  if (!barcode) return null;
  return /^[!-~]{1,64}$/.test(barcode) ? barcode : undefined;
}

// Product names are saved without spaces at the ends and with single spaces
// inside (the database does the same), and are unique ignoring capitals.
function normalizeProductName(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}
function productNameKey(name: string) {
  return normalizeProductName(name).toLowerCase();
}

// Barcode lookups ignore spaces the same way.
function compactBarcode(value: string) {
  return value.replace(/\s+/g, "");
}

function productSaveError(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "code" in error && error.code === "23505" && "message" in error && (String(error.message).includes("products_active_unbarcoded_name_key") || String(error.message).includes("products_active_name_key"))) {
    return "Another product without a barcode already has that name. Give one of them a barcode or a different name.";
  }
  if (isNetworkError(error)) {
    return "This needs an internet connection. Sales still work offline; try this again once you’re back online.";
  }
  if (error && typeof error === "object" && "code" in error && error.code === "23505" && "message" in error && String(error.message).includes("barcode")) {
    return "Another active product already uses that barcode.";
  }
  return error instanceof Error ? error.message : error && typeof error === "object" && "message" in error ? String(error.message) : fallback;
}

type ImportedProduct = {
  name: string;
  category: string;
  cost_price?: number;
  cost_price_known?: boolean;
  wholesale_price?: number;
  price: number;
  stock: number;
  image_icon: string;
  barcode?: string;
};

// Checks every imported row and collects all problems (with the file's row
// number) instead of stopping at the first. Blank optional prices are left
// out so an import doesn't overwrite values already set on a product.
type ImportPreview = {
  fileName: string;
  // status: how the row will be saved; renamedFrom: the existing product's
  // name when it was matched by barcode under a different name.
  products: (ImportedProduct & { sourceRow: number; isUpdate: boolean; status: "new" | "update" | "restore"; renamedFrom?: string })[];
  errors: string[];
  newCategories: string[];
  // Active products the file doesn't include (removed if imported as a master list).
  removable: string[];
};

function validateImportedProducts(records: RawProductRecord[]) {
  const products: (ImportedProduct & { sourceRow: number })[] = [];
  const errors: string[] = [];
  const seenNames = new Map<string, { row: number; hasBarcode: boolean }>();
  const seenBarcodes = new Map<string, number>();
  for (const record of records) {
    const row = `Row ${record.sourceRow}`;
    const problems: string[] = [];
    const name = normalizeProductName(record.name);
    const category = (record.category ?? "").trim();
    const price = Number(record.retail_price);
    const stock = Number(record.stock);
    const costText = record.cost_price ?? "";
    const wholesaleText = record.wholesale_price ?? "";
    const costPrice = Number(costText);
    const wholesalePrice = Number(wholesaleText);
    const imageIcon = (record.image_icon ?? "").trim() || "auto";
    const barcode = normalizeBarcode(record.barcode);

    if (!name || name.length > 120) problems.push("a product name (up to 120 characters)");
    if (!category || category.length > 80) problems.push("a category (up to 80 characters)");
    if (!record.retail_price || !Number.isFinite(price) || price <= 0) problems.push("a retail price above ₱0");
    if (record.stock === undefined || record.stock === "" || !Number.isInteger(stock) || stock < 0) problems.push("a whole-number stock of 0 or more");
    if (costText && (!Number.isFinite(costPrice) || costPrice < 0)) problems.push(`a cost price of ₱0 or more, or blank (found “${costText}”)`);
    if (wholesaleText && (!Number.isFinite(wholesalePrice) || wholesalePrice < 0)) problems.push(`a wholesale price of ₱0 or more, or blank (found “${wholesaleText}”)`);
    if (barcode === undefined) problems.push("a barcode of up to 64 letters, digits or symbols, or blank");
    if (!productIcons.some((icon) => icon.id === imageIcon)) problems.push("a valid image icon, or blank");
    if (problems.length) {
      errors.push(`${row} needs ${problems.join(", ")}.`);
      continue;
    }
    // Products with barcodes may share a name (the barcode tells them apart).
    const nameKey = name.toLowerCase();
    const earlier = seenNames.get(nameKey);
    if (earlier && (!barcode || !earlier.hasBarcode)) {
      errors.push(`${row} repeats “${name}” from row ${earlier.row}. Rows with the same name each need their own barcode.`);
      continue;
    }
    if (!earlier) seenNames.set(nameKey, { row: record.sourceRow, hasBarcode: !!barcode });
    if (barcode) {
      if (seenBarcodes.has(barcode)) {
        errors.push(`${row} repeats barcode ${barcode} from row ${seenBarcodes.get(barcode)}.`);
        continue;
      }
      seenBarcodes.set(barcode, record.sourceRow);
    }
    products.push({
      sourceRow: record.sourceRow,
      name,
      category,
      ...(costText ? { cost_price: costPrice, cost_price_known: true } : {}),
      ...(wholesaleText ? { wholesale_price: wholesalePrice } : {}),
      price,
      stock,
      image_icon: imageIcon,
      ...(barcode ? { barcode } : {}),
    });
  }
  return { products, errors };
}

export default function Home() {
  const [signedIn, setSignedIn] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  // The store (Supabase project) this device is connected to; undefined until
  // read from this device, null if it has never been connected.
  const [storeConnection, setStoreConnection] = useState<StoreConnection | null | undefined>(undefined);
  const [changingStore, setChangingStore] = useState(false);
  const [role, setRole] = useState<Role>("employee");
  const [employeeName, setEmployeeName] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [orders, setOrders] = useState<Order[]>([]);
  const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(null);
  const [salesChart, setSalesChart] = useState<SalesChartPoint[]>([]);
  const [salesPeriod, setSalesPeriod] = useState<SalesPeriod>("today");
  const [profitReport, setProfitReport] = useState<ProfitReportPoint[]>([]);
  const [profitReportPeriod, setProfitReportPeriod] = useState<SalesPeriod>("today");
  const [profitReportLoading, setProfitReportLoading] = useState(false);
  const [profitReportError, setProfitReportError] = useState("");
  const [profitReportUpdatedAt, setProfitReportUpdatedAt] = useState<Date | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [readNotifications, setReadNotifications] = useState<string[]>([]);
  const [category, setCategory] = useState("All items");
  const [customItems, setCustomItems] = useState<CustomItem[]>([]);
  // The order line that +/−/Delete act on, highlighted and kept in view: the
  // one last added or touched.
  const [selectedLine, setSelectedLine] = useState<string | null>(null);
  // The order on screen is kept on this computer per user, so a restart or
  // crash doesn't lose it.
  const restoredCartFor = useRef<string | null>(null);
  // Ctrl+Z takes back recent additions, newest first.
  const additionsRef = useRef<{ key: string; custom: boolean; quantity: number }[]>([]);
  const [lastSale, setLastSale] = useState<Order | null>(null);
  const [quickAdd, setQuickAdd] = useState<{ quantity: number; description: string; note: string } | null>(null);
  const [showImages, setShowImages] = useState(true);
  const [search, setSearch] = useState("");
  const [activePage, setActivePage] = useState<Page>("pos");
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [editingProductPrices, setEditingProductPrices] = useState<Product | null>(null);
  const [selectedProductIcon, setSelectedProductIcon] = useState("auto");
  const [selectedProductImage, setSelectedProductImage] = useState<File | null>(null);
  const [editingProductImage, setEditingProductImage] = useState<Product | null>(null);
  const [removeExistingProductImage, setRemoveExistingProductImage] = useState(false);
  const [showHelpCenter, setShowHelpCenter] = useState(false);
  const [showCheckoutDialog, setShowCheckoutDialog] = useState(false);
  const [showMobileCart, setShowMobileCart] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [wholesaleMode, setWholesaleMode] = useState(false);
  const [cashReceived, setCashReceived] = useState("");
  const [paymentReferenceLast4, setPaymentReferenceLast4] = useState("");
  const [accountEmail, setAccountEmail] = useState("");
  const [accountName, setAccountName] = useState("");
  const [salesResetConfirmation, setSalesResetConfirmation] = useState("");
  const [notice, setNotice] = useState("");
  // An action offered in the notice (e.g. Undo), for that notice only.
  const [noticeAction, setNoticeAction] = useState<{ notice: string; label: string; run: () => void } | null>(null);
  // Shown after a sale: what was paid and the change to hand back.
  const [completedSale, setCompletedSale] = useState<{ label: string; total: number; paid: number | null; change: number | null; method: PaymentMethod; offline: boolean } | null>(null);
  const [authError, setAuthError] = useState("");
  const [adminCreated, setAdminCreated] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [usingCachedData, setUsingCachedData] = useState(false);
  // Supabase couldn't be reached even though the device reports a network
  // (e.g. Wi-Fi without internet). Cleared by the next successful request.
  const [serverUnreachable, setServerUnreachable] = useState(false);
  const [shortfalls, setShortfalls] = useState<StockShortfall[]>([]);
  const [showSyncPanel, setShowSyncPanel] = useState(false);
  const syncingRef = useRef(false);
  const [storeDetails, setStoreDetails] = useState<StoreDetails>(defaultStoreDetails);
  // The store's name for branding and headings (components/store-name.tsx).
  const brandName = (signedIn ? storeDetails.storeName.trim() : "") || storeConnection?.name.trim() || "Point of sale";
  const [hardware, setHardware] = useState<HardwareSettings>(defaultHardwareSettings);
  const [cashSession, setCashSession] = useState<CashSession | null>(null);
  const [showOpenDrawer, setShowOpenDrawer] = useState(false);
  const [showCashCount, setShowCashCount] = useState(false);
  const [voidTarget, setVoidTarget] = useState<Order | null>(null);
  const [refundTarget, setRefundTarget] = useState<Order | null>(null);
  // Signed in offline (password checked on this device): there is no Supabase
  // session until the cashier reconnects with their password.
  const [offlineSession, setOfflineSession] = useState(false);
  const [sessionOutboxCount, setSessionOutboxCount] = useState(0);
  // Print a receipt for the sale being paid for (starts from this till's default).
  const [printThisSale, setPrintThisSale] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  // POS screen layout for this till (tile size, order width, text size).
  const [posLayout, setPosLayout] = useState<PosLayout>(defaultPosLayout);
  const [showLayoutPanel, setShowLayoutPanel] = useState(false);
  // Orders put on hold (Save, Ctrl+S) and brought back (Recall, Ctrl+R).
  const [suspendedOrders, setSuspendedOrders] = useState<SuspendedOrder[]>([]);
  const [showSuspend, setShowSuspend] = useState(false);
  const [showRecall, setShowRecall] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const cartWrapperRef = useRef<HTMLDivElement>(null);
  const posGridRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [showAddEmployee, setShowAddEmployee] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [passwordEmployee, setPasswordEmployee] = useState<Employee | null>(null);
  const [restockProduct, setRestockProduct] = useState<Product | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const { quantity: entryQuantity, term: searchTerm } = parseSaleEntry(search);
  // Only categories that actually have products. A category is created by
  // giving a product a new category name (when adding, editing or importing).
  const productCategories = useMemo(
    () => [...new Set(products.map((product) => product.category))].sort((a, b) => a.localeCompare(b)),
    [products],
  );
  const categories = ["All items", ...productCategories];
  // Names shared by several products (told apart by barcode).
  const sharedNameKeys = useMemo(() => {
    const counts = new Map<string, number>();
    for (const product of products) counts.set(productNameKey(product.name), (counts.get(productNameKey(product.name)) ?? 0) + 1);
    return new Set([...counts].filter(([, count]) => count > 1).map(([key]) => key));
  }, [products]);
  const displayName = (product: Product) => (sharedNameKeys.has(productNameKey(product.name)) && product.barcode ? `${product.name} · …${product.barcode.slice(-4)}` : product.name);
  const activeCategory = categories.includes(category) ? category : "All items";
  const visibleProducts = useMemo(
    () =>
      products.filter(
        (product) =>
          (activeCategory === "All items" || product.category === activeCategory) &&
          (product.name.toLowerCase().includes(searchTerm.toLowerCase()) || (!!searchTerm && product.barcode === compactBarcode(searchTerm))),
      ),
    [activeCategory, products, searchTerm],
  );
  // Drawing thousands of rows slows the till down; search, scanning and the
  // category filter still reach every product.
  const shownProducts = visibleProducts.slice(0, POS_DISPLAY_LIMIT);
  // The cart holds one line per product and price tier: items added while
  // wholesale mode is on go on that product's wholesale line, so one sale can
  // have 24 pcs at wholesale and 1 pc at retail of the same product.
  const productsById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const cartLines: CartLine[] = Object.entries(cart).flatMap(([key, quantity]) => {
    const { productId, wholesale } = parseCartKey(key);
    const product = productsById.get(productId);
    return product && quantity > 0 ? [{ key, product, wholesale, quantity }] : [];
  });
  const quantityInCart = (productId: string) => (cart[cartKey(productId, false)] ?? 0) + (cart[cartKey(productId, true)] ?? 0);
  // Each custom line is rounded to the centavo, as the database records it.
  const customTotal = customItems.reduce((sum, item) => sum + lineAmount(item.unitPrice, item.quantity), 0);
  const itemCount = Object.values(cart).reduce((total, quantity) => total + quantity, 0) + customItems.reduce((sum, item) => sum + itemCountOf(item.quantity), 0);
  // A wholesale line is charged the product's wholesale price; a product
  // without one (₱0) stays at retail. place_order applies the same rule.
  // Custom items always use the price entered for them.
  const unitPrice = (product: Product, wholesale: boolean) => (wholesale && product.wholesalePrice > 0 ? product.wholesalePrice : product.price);
  const subtotal = cartLines.reduce((sum, line) => sum + unitPrice(line.product, line.wholesale) * line.quantity, 0) + customTotal;
  const total = Math.round(subtotal * 100) / 100;
  const retailTotal = Math.round((cartLines.reduce((sum, line) => sum + line.product.price * line.quantity, 0) + customTotal) * 100) / 100;
  const wholesaleSavings = Math.round((retailTotal - total) * 100) / 100;
  const wholesaleLines = cartLines.filter((line) => line.wholesale);
  const itemsWithoutWholesalePrice = wholesaleLines.filter((line) => line.product.wholesalePrice <= 0).map((line) => line.product);
  const notifications = [
    ...products
      .filter((product) => product.stock <= 5)
      .map((product) => ({
        id: `low-stock-${product.id}`,
        title: "Low stock",
        message: `${product.name} has ${product.stock} left.`,
        page: "inventory" as const,
      })),
    ...shortfalls.map((item) => ({
      id: `shortfall-${item.id}`,
      title: "Recount needed",
      message: `An offline sale sold ${item.shortfall} more ${item.productName} than recorded stock.`,
      page: "inventory" as const,
    })),
    ...orders.slice(0, 5).map((order) => ({
      id: `order-${order.id}`,
      title: "Recent sale",
      message: `${order.id} · ${money(order.total)}`,
      page: "orders" as const,
    })),
  ];
  const unreadNotificationCount = notifications.filter((item) => !readNotifications.includes(item.id)).length;

  // Shows a workspace and keeps a copy on this device, so the POS can open
  // and keep selling if the connection drops later. Cached per user, because
  // employees only see their own orders.
  const applyWorkspace = useCallback((workspace: Workspace, ownerId: string, fromCache = false) => {
    setProducts(workspace.products);
    setOrders(workspace.orders);
    setDashboardStats(workspace.stats);
    setSalesChart(workspace.salesChart);
    setShortfalls(workspace.shortfalls ?? []);
    if (workspace.storeDetails) setStoreDetails(workspace.storeDetails);
    setUsingCachedData(fromCache);
    if (!fromCache) setServerUnreachable(false);
    if (!fromCache) {
      setLastRefreshedAt(new Date());
      void writeCache(`workspace:${ownerId}`, workspace).catch((error: unknown) => console.error("Couldn’t cache the workspace for offline use:", error));
    }
  }, []);

  const signInWith = useCallback((id: string, profile: CachedProfile, workspace: Workspace, fromCache: boolean) => {
    setUserId(id);
    setRole(profile.role);
    setEmployeeName(profile.fullName || profile.email || "Team member");
    setAccountName(profile.fullName);
    setAccountEmail(profile.email);
    applyWorkspace(workspace, id, fromCache);
    setSignedIn(true);
    if (!fromCache) void writeCache(`profile:${id}`, profile).catch(() => undefined);
  }, [applyWorkspace]);

  useEffect(() => {
    let cancelled = false;
    setAdminCreated(new URLSearchParams(window.location.search).has("admin-created"));
    void listPendingOrders().then((queue) => { if (!cancelled) setPendingOrders(queue); }).catch((error: unknown) => console.error("Couldn’t read offline sales:", error));

    // Opens the last workspace saved on this device for the signed-in user.
    async function openOffline(id: string) {
      const [profile, workspace] = await Promise.all([readCache<CachedProfile>(`profile:${id}`), readCache<Workspace>(`workspace:${id}`)]);
      if (!profile || !workspace) {
        throw new Error("You’re offline, and this computer has no saved store data for your account yet. Connect to the internet once to sign in.");
      }
      if (cancelled) return;
      signInWith(id, profile, workspace, true);
      setServerUnreachable(true);
      if (profile.role === "admin") setActivePage("dashboard");
    }

    async function restoreSession() {
      try {
        const store = loadStoreConnection();
        setStoreConnection(store);
        if (!store) return; // Not connected yet: the connect screen shows.
        // Read the saved session without a network call, so a signed-out
        // launch shows the login screen immediately and an offline launch can
        // reopen the saved workspace.
        const savedUserId = storedSessionUserId(AUTH_STORAGE_KEY);
        if (!savedUserId) return;
        if (!navigator.onLine) return await openOffline(savedUserId);

        const supabase = createClient();
        try {
          const { data: { user }, error } = await supabase.auth.getUser();
          if (error && error.name !== "AuthSessionMissingError") throw error;
          if (!user) return;
          const { data: profile, error: profileError } = await supabase
            .from("profiles")
            .select("role, full_name")
            .eq("id", user.id)
            .single();
          if (profileError) throw profileError;
          if (profile.role !== "admin" && profile.role !== "employee") {
            throw new Error("Your account does not have a valid store role.");
          }
          const workspace = await fetchWorkspaceData(profile.role === "admin");
          if (cancelled) return;
          signInWith(user.id, { role: profile.role, fullName: profile.full_name || "", email: user.email ?? "" }, workspace, false);
          if (profile.role === "admin") setActivePage("dashboard");
        } catch (error) {
          // Connection dropped or Supabase unreachable: use the saved copy.
          if (isNetworkError(error)) return await openOffline(savedUserId);
          throw error;
        }
      } catch (error) {
        if (!cancelled) setAuthError(error instanceof Error ? error.message : "Unable to restore your session.");
      } finally {
        if (!cancelled) setCheckingAuth(false);
      }
    }
    void restoreSession();
    // Not connected to a store yet: nothing to listen to (the connect screen
    // shows, and connecting reloads the app).
    if (!loadStoreConnection()) return () => { cancelled = true; };
    // If the session ends elsewhere (expired refresh token, password change),
    // go back to the sign-in screen instead of failing on every request.
    const { data: { subscription } } = createClient().auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT" && !cancelled) {
        setSignedIn(false);
        setOfflineSession(false);
        setUserId(null);
        setCart({});
        setCustomItems([]);
        setActivePage("pos");
      }
    });
    return () => { cancelled = true; subscription.unsubscribe(); };
  }, [signInWith]);

  // Success messages clear themselves; anything else stays until dismissed.
  const noticeIsSuccess = /successfully|\badded\b|\bAdded\b|updated|removed|created|cleared|copied|synced|saved offline/i.test(notice) && !/couldn|could not|unable|but /i.test(notice);
  useEffect(() => {
    if (!notice || !noticeIsSuccess || showCheckoutDialog) return;
    // A notice with Undo stays a little longer, so there's time to use it.
    const timer = window.setTimeout(() => setNotice((current) => (current === notice ? "" : current)), noticeAction?.notice === notice ? 8000 : 5000);
    return () => window.clearTimeout(timer);
  }, [notice, noticeIsSuccess, showCheckoutDialog, noticeAction]);

  // The top bar grows with its banners (offline, reconnect, update ready).
  // Publish its real height so the sticky current order always fits below it.
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const publish = () => document.documentElement.style.setProperty("--pos-header-height", `${Math.ceil(header.getBoundingClientRect().height)}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(header);
    return () => observer.disconnect();
  }, [signedIn]);

  // The current order is sticky: pinned under the top bar once scrolled, but
  // lower down at the top of the page (below notices and prompts). Size it
  // from where it actually is, so its Pay button is always on screen.
  useEffect(() => {
    if (!signedIn || activePage !== "pos") return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const wrapper = cartWrapperRef.current;
        if (wrapper) wrapper.style.setProperty("--cart-top", `${Math.max(0, Math.round(wrapper.getBoundingClientRect().top))}px`);
      });
    };
    measure();
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    const observer = new ResizeObserver(measure); // notices/banners appearing move it
    observer.observe(document.body);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      observer.disconnect();
    };
  }, [activePage, signedIn]);

  // Each checkout starts from this till's "print receipts by default" setting.
  useEffect(() => {
    if (showCheckoutDialog) setPrintThisSale(hardware.autoPrint);
  }, [hardware.autoPrint, showCheckoutDialog]);

  // Desktop app: live update status from the main process.
  useEffect(() => watchUpdateStatus(setUpdateStatus), []);

  // This till's printer/drawer settings and its open cash drawer session.
  useEffect(() => {
    setHardware(loadHardwareSettings());
    setPosLayout(loadPosLayout());
    void readCurrentSession().then(setCashSession).catch(() => undefined);
    void readSessionOutbox().then((outbox) => setSessionOutboxCount(outbox.length)).catch(() => undefined);
  }, []);

  // Online/offline drives the banner, the sync indicator and the sync engine.
  useEffect(() => {
    const update = () => setIsOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const refreshWorkspace = useCallback(async (period = salesPeriod) => {
    if (!userId || offlineSession) return; // no Supabase session yet
    const workspace = await fetchWorkspaceData(role === "admin", period);
    applyWorkspace(workspace, userId);
  }, [applyWorkspace, offlineSession, role, salesPeriod, userId]);

  // Uploads queued offline sales, oldest first. A sale leaves the queue only
  // after Supabase confirms it; the server ignores a sale it already has, so
  // retries never double-record. A sale the server refuses is kept and marked
  // failed (retried only on request). Employees sync their own sales; an
  // admin can sync everyone's queued on this computer.
  const syncPendingOrders = useCallback(async ({ retryFailed = false, quiet = false } = {}) => {
    if (syncingRef.current || !userId || offlineSession || !navigator.onLine) return;
    syncingRef.current = true;
    setIsSyncing(true);
    let synced = 0;
    let shortfallCount = 0;
    let failed = 0;
    let stalled = false;
    try {
      const queue = await listPendingOrders();
      const supabase = createClient();
      for (const sale of queue) {
        if (sale.failed && !retryFailed) continue;
        if (sale.employeeId !== userId && role !== "admin") continue;
        const { data, error } = await supabase.rpc("sync_offline_order", {
          p_client_order_id: sale.clientOrderId,
          p_employee_id: sale.employeeId,
          p_created_at: sale.createdAt,
          p_items: sale.items.map((item) => item.kind === "product"
            ? { product_id: item.productId, name: item.name, quantity: item.quantity, unit_price: item.unitPrice, wholesale: item.wholesale ?? false }
            : { description: item.description, quantity: item.quantity, unit_price: item.unitPrice }),
          p_payment_method: sale.paymentMethod,
          p_payment_reference_last4: sale.paymentReferenceLast4,
          p_cash_received: sale.cashReceived,
          p_wholesale: sale.wholesale,
          p_cash_session_id: sale.cashSessionId ?? null,
        }).single();
        if (error) {
          if (isTransientSyncError(error)) {
            if (isNetworkError(error)) setServerUnreachable(true);
            stalled = true;
            break; // try again later
          }
          failed += 1;
          await savePendingOrder({ ...sale, attempts: sale.attempts + 1, lastError: error.message, failed: true });
          continue;
        }
        await deletePendingOrder(sale.clientOrderId);
        setServerUnreachable(false);
        synced += 1;
        if (data && typeof data === "object" && "shortfalls" in data) shortfallCount += Number(data.shortfalls) || 0;
      }

      // Drawer sessions go after the sales, so the database's expected-cash
      // check includes every synced sale; skipped if sales are still waiting.
      if (!stalled) {
        for (const session of await readSessionOutbox()) {
          const owner = session.closed?.closedBy ?? session.openedBy;
          if (session.openedBy !== userId && owner !== userId && role !== "admin") continue;
          const { error } = await supabase.rpc("sync_cash_session", {
            p_id: session.id,
            p_opened_by: session.openedBy,
            p_opened_at: session.openedAt,
            p_opening_float: session.openingFloat,
            p_device_label: session.deviceLabel,
            p_closed_by: session.closed?.closedBy ?? null,
            p_closed_at: session.closed?.closedAt ?? null,
            p_counted_cash: session.closed?.countedCash ?? null,
            p_expected_cash: session.closed?.expectedCash ?? null,
            p_denominations: session.closed?.denominations ?? {},
            p_notes: session.closed?.notes ?? "",
          });
          if (error) {
            if (isNetworkError(error)) setServerUnreachable(true);
            break; // kept in the outbox; retried on the next sync
          }
          await removeFromSessionOutbox(session.id);
        }
      }
    } catch (error) {
      if (!quiet) setNotice(`Couldn’t sync offline sales: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setSessionOutboxCount((await readSessionOutbox().catch(() => [])).length);
      setPendingOrders(await listPendingOrders().catch(() => []));
      syncingRef.current = false;
      setIsSyncing(false);
    }
    if (synced) {
      setNotice(`${synced} offline sale${synced === 1 ? "" : "s"} synced${shortfallCount ? ` · ${shortfallCount} item${shortfallCount === 1 ? "" : "s"} sold more than recorded stock (see Inventory)` : ""}.`);
      try {
        await refreshWorkspace();
      } catch {
        // The sales are safe; the next refresh will show them.
      }
    }
    if (failed) setNotice(`${failed} offline sale${failed === 1 ? "" : "s"} couldn’t be synced and ${failed === 1 ? "is" : "are"} kept on this computer. Open the sync status for details.`);
  }, [offlineSession, refreshWorkspace, role, userId]);

  const pendingForThisUser = useMemo(() => pendingOrders.filter((sale) => sale.employeeId === userId || role === "admin"), [pendingOrders, role, userId]);
  const waitingToSync = pendingForThisUser.filter((sale) => !sale.failed).length;
  // Queued sales appear in Orders and Recent sales (newest first) until synced.
  const displayOrders = useMemo(() => [...pendingForThisUser.map(pendingToOrder).reverse(), ...orders], [orders, pendingForThisUser]);
  const failedToSync = pendingForThisUser.filter((sale) => sale.failed).length;
  // Reconnect loop. While Supabase is unreachable, or working from the saved
  // copy, or sales are waiting: every 30 s (and right away when the device
  // reports a network), reload fresh data, then upload queued sales.
  const connected = isOnline && !serverUnreachable;
  const needsReconnect = signedIn && !offlineSession && (serverUnreachable || usingCachedData || waitingToSync > 0 || sessionOutboxCount > 0);
  useEffect(() => {
    if (!needsReconnect) return;
    const attempt = async () => {
      if (!navigator.onLine) return;
      if (serverUnreachable || usingCachedData) {
        try {
          await refreshWorkspace();
        } catch (error) {
          if (isNetworkError(error)) return; // still unreachable
          setServerUnreachable(false); // reachable, but the request was refused
        }
      }
      await syncPendingOrders({ quiet: true });
    };
    if (isOnline) void attempt();
    const timer = window.setInterval(() => void attempt(), 30_000);
    return () => window.clearInterval(timer);
  }, [isOnline, needsReconnect, refreshWorkspace, serverUnreachable, syncPendingOrders, usingCachedData]);

  const refreshDashboard = useCallback(async (period = salesPeriod, quiet = false) => {
    setIsRefreshing(true);
    try {
      await refreshWorkspace(period);
      setSalesPeriod(period);
    } catch (error) {
      setNotice(`${quiet ? "Automatic refresh failed" : "Unable to refresh the dashboard"}: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setIsRefreshing(false);
    }
  }, [refreshWorkspace, salesPeriod]);

  useEffect(() => {
    if (!signedIn || role !== "admin") return;
    const timer = window.setInterval(() => {
      // Skipped offline: the dashboard keeps showing the last loaded figures.
      if (navigator.onLine) void refreshDashboard(salesPeriod, true);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [refreshDashboard, role, salesPeriod, signedIn]);

  const refreshProfitReport = useCallback(async () => {
    setProfitReportLoading(true);
    setProfitReportError("");
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("get_admin_profit_report", { p_period: profitReportPeriod });
      if (error) throw error;
      const report = (data ?? []).map((row: ProfitReportRow): ProfitReportPoint => {
        const point = {
          label: String(row.bucket_label),
          revenue: Number(row.revenue_total),
          costOfGoods: Number(row.cost_of_goods),
          netProfit: Number(row.net_profit),
          orderCount: Number(row.orders_count),
          ordersWithCost: Number(row.orders_with_cost),
          ordersWithoutCost: Number(row.orders_without_cost),
        };
        if (Object.values(point).some((value) => typeof value === "number" && !Number.isFinite(value))) {
          throw new Error("The analytics report returned an invalid numeric value.");
        }
        return point;
      });
      setProfitReport(report);
      setProfitReportUpdatedAt(new Date());
    } catch (error) {
      setProfitReportError(error instanceof Error ? error.message : "Unable to load analytics report.");
    } finally {
      setProfitReportLoading(false);
    }
  }, [profitReportPeriod]);

  useEffect(() => {
    if (signedIn && role === "admin" && activePage === "analytics") void refreshProfitReport();
  }, [activePage, refreshProfitReport, role, signedIn]);

  // Items go on the wholesale or retail line depending on wholesale mode at
  // the moment they're added. Stock is checked across both lines.
  async function addToCart(product: Product) {
    addProductQuantity(product, 1, false);
  }

  function addProductQuantity(product: Product, quantity: number, announce = true) {
    const available = product.stock - quantityInCart(product.id);
    if (quantity > available) {
      setNotice(available > 0 ? `Only ${available} more ${product.name} in stock.` : `There isn’t enough stock for another ${product.name}.`);
      return false;
    }
    // Products without a wholesale price (e.g. single sachets) are retail-only:
    // they go on the regular line even in wholesale mode.
    const atWholesale = wholesaleMode && product.wholesalePrice > 0;
    const key = cartKey(product.id, atWholesale);
    setCart((current) => ({ ...current, [key]: (current[key] ?? 0) + quantity }));
    rememberAddition(key, false, quantity);
    if (wholesaleMode && !atWholesale) setNotice(`${product.name} has no wholesale price, so it was added at retail.`);
    else setNotice(announce ? `Added ${quantity} × ${product.name}${atWholesale ? " at wholesale" : ""} to the order.` : "");
    return true;
  }

  // Enter in the search box: a scanned/typed barcode, or the only matching
  // product, is added to the order. "24/<barcode>" adds 24 of that item.
  function openQuickAdd() {
    setQuickAdd({ quantity: entryQuantity ?? 1, description: searchTerm.slice(0, 120), note: "" });
    setSearch("");
  }

  function clearOrder() {
    setCart({});
    setCustomItems([]);
    setWholesaleMode(false);
    setSelectedLine(null);
    additionsRef.current = [];
  }

  // ---------- saved (suspended) orders ----------

  // Puts the order on screen on hold and clears it for the next customer.
  async function suspendOrder(note: string, list = suspendedOrders) {
    if (!itemCount) return list;
    if (list.length >= MAX_SUSPENDED_ORDERS) {
      setNotice(`Up to ${MAX_SUSPENDED_ORDERS} orders can be saved. Recall or discard one first.`);
      return null;
    }
    const saved: SuspendedOrder = {
      id: crypto.randomUUID(),
      savedAt: new Date().toISOString(),
      savedBy: employeeName,
      note,
      cart,
      customItems,
      wholesaleMode,
      total,
      itemCount,
    };
    const next = [...list, saved];
    try {
      await saveSuspendedOrders(next);
    } catch (error) {
      setNotice(`Couldn’t save the order: ${error instanceof Error ? error.message : "storage error"}`);
      return null;
    }
    setSuspendedOrders(next);
    clearOrder();
    setShowSuspend(false);
    setNotice(`Order saved${note ? ` as “${note}”` : ""}. Recall it any time with Recall (Ctrl+R).`);
    return next;
  }

  // Brings a saved order back. An order already on screen is saved first.
  // Stock and prices are today's: products no longer sold are dropped and
  // quantities are capped at the stock left.
  async function resumeOrder(id: string) {
    const saved = suspendedOrders.find((order) => order.id === id);
    if (!saved) return;
    let list = suspendedOrders.filter((order) => order.id !== id);
    const switched = itemCount > 0;
    if (switched) {
      const afterSave = await suspendOrder("", list);
      if (!afterSave) return;
      list = afterSave;
    }
    const restored: Record<string, number> = {};
    const used = new Map<string, number>();
    const changes: string[] = [];
    for (const [key, quantity] of Object.entries(saved.cart)) {
      const product = productsById.get(parseCartKey(key).productId);
      if (!product) { changes.push("an item that is no longer sold was removed"); continue; }
      const available = product.stock - (used.get(product.id) ?? 0);
      const kept = Math.min(quantity, Math.max(0, available));
      if (kept < quantity) changes.push(`${product.name} reduced to ${kept} (stock)`);
      if (kept > 0) { restored[key] = kept; used.set(product.id, (used.get(product.id) ?? 0) + kept); }
    }
    try {
      await saveSuspendedOrders(list);
    } catch (error) {
      setNotice(`Couldn’t recall the order: ${error instanceof Error ? error.message : "storage error"}`);
      return;
    }
    setSuspendedOrders(list);
    setCart(restored);
    setCustomItems(saved.customItems);
    setWholesaleMode(saved.wholesaleMode);
    setSelectedLine(null);
    additionsRef.current = [];
    setShowRecall(false);
    setNotice(`Recalled ${saved.note ? `“${saved.note}”` : "the saved order"}${switched ? "; the previous order was saved" : ""}.${changes.length ? ` Note: ${[...new Set(changes)].join("; ")}.` : ""}`);
  }

  async function discardSuspendedOrder(id: string) {
    const list = suspendedOrders.filter((order) => order.id !== id);
    try {
      await saveSuspendedOrders(list);
      setSuspendedOrders(list);
      if (!list.length) setShowRecall(false);
    } catch (error) {
      setNotice(`Couldn’t discard the order: ${error instanceof Error ? error.message : "storage error"}`);
    }
  }

  function notifyWithUndo(message: string, undo: () => void) {
    setNotice(message);
    setNoticeAction({ notice: message, label: "Undo", run: undo });
  }

  // Clear the order, with Undo in case it was a slip.
  function clearOrderWithUndo() {
    if (!itemCount) return;
    const snapshot = { cart, customItems, wholesaleMode };
    clearOrder();
    notifyWithUndo("Order cleared.", () => {
      setCart(snapshot.cart);
      setCustomItems(snapshot.customItems);
      setWholesaleMode(snapshot.wholesaleMode);
      setNotice("Order restored.");
    });
  }

  function rememberAddition(key: string, custom: boolean, quantity: number) {
    additionsRef.current = [...additionsRef.current.slice(-49), { key, custom, quantity }];
    setSelectedLine(key);
  }

  // Ctrl+Z: takes back the most recent addition (as much of it as is still in
  // the order, if it was changed since).
  function undoLastAddition() {
    const last = additionsRef.current.at(-1);
    if (!last) { setNotice("Nothing to undo."); return; }
    additionsRef.current = additionsRef.current.slice(0, -1);
    const name = last.custom ? customItems.find((item) => item.id === last.key)?.description : productsById.get(parseCartKey(last.key).productId)?.name;
    const inOrder = last.custom ? customItems.find((item) => item.id === last.key)?.quantity ?? 0 : cart[last.key] ?? 0;
    const quantity = Math.min(last.quantity, inOrder);
    if (!name || quantity <= 0) { undoLastAddition(); return; }
    if (last.custom) changeCustomQuantity(last.key, -quantity);
    else changeQuantity(last.key, -quantity);
    setSelectedLine(last.key);
    setNotice(`Undid: ${formatQuantity(quantity)} × ${name} taken off the order.`);
  }

  function addCustomItem(item: Omit<CustomItem, "id">) {
    const id = crypto.randomUUID();
    setCustomItems((current) => [...current, { ...item, id }]);
    rememberAddition(id, true, item.quantity);
    setQuickAdd(null);
    setNotice(`Added ${formatQuantity(item.quantity)} × ${item.description} (custom item) to the order.`);
  }

  function changeCustomQuantity(id: string, difference: number) {
    setSelectedLine(id);
    setCustomItems((current) => current
      .map((item) => (item.id === id ? { ...item, quantity: Math.min(9999, roundQuantity(item.quantity + difference)) } : item))
      .filter((item) => item.quantity > 0));
  }

  // Wholesale mode applies to items added while it's on; lines already in the
  // order keep their price. Turn it on before scanning bulk quantities.
  function toggleWholesaleMode() {
    setWholesaleMode((current) => {
      setNotice(current
        ? "Wholesale mode off: items you add now are charged retail prices."
        : "Wholesale mode on: items you add now are charged wholesale prices.");
      return !current;
    });
  }

  function toggleImages() {
    setShowImages((current) => {
      try {
        window.localStorage.setItem(showImagesStorageKey, current ? "off" : "on");
      } catch {
        // Storage can be unavailable (private mode); the toggle still works for this visit.
      }
      return !current;
    });
  }

  function submitSaleEntry() {
    const { quantity, term } = parseSaleEntry(search);
    const keepEntry = () => searchInputRef.current?.select();
    if (quantity !== null && !isValidCustomQuantity(quantity)) {
      setNotice("Enter a quantity from 1 to 9,999 before the slash, e.g. 24/4800016644290 (custom items can also use up to 2 decimal places, e.g. 0.25/).");
      keepEntry();
      return;
    }
    if (!term) {
      if (quantity !== null) setNotice(`Now scan or type the item to add ${formatQuantity(quantity)} of it.`);
      return;
    }
    const product = products.find((item) => item.barcode === compactBarcode(term)) ?? (visibleProducts.length === 1 ? visibleProducts[0] : undefined);
    if (!product && visibleProducts.length > 1) {
      setNotice(`${visibleProducts.length} products match “${term}”. Keep typing or pick one.`);
      keepEntry();
      return;
    }
    if (!product) {
      // Not in the catalog: offer to sell it as a custom item. A typed name
      // becomes the description; an unknown barcode is only mentioned.
      const looksLikeBarcode = /^[!-~]+$/.test(term) && /\d/.test(term) && !/\s/.test(term);
      setQuickAdd({
        quantity: quantity ?? 1,
        description: looksLikeBarcode ? "" : term.slice(0, 120),
        note: looksLikeBarcode ? `Barcode ${term} isn’t in your products.` : `“${term}” isn’t in your products.`,
      });
      setSearch("");
      return;
    }
    if (quantity !== null && !Number.isInteger(quantity)) {
      setNotice(`${product.name} is sold in whole numbers. Decimal quantities like ${formatQuantity(quantity)} are for custom items (Quick add, F3).`);
      keepEntry();
      return;
    }
    if (addProductQuantity(product, quantity ?? 1)) setSearch("");
    else keepEntry();
  }

  function choosePaymentMethod(method: PaymentMethod) {
    setPaymentMethod(method);
    setCashReceived("");
    setPaymentReferenceLast4("");
  }

  function goToPage(page: Page) {
    setActivePage(page);
    setShowNotifications(false);
    if (page === "employees") {
      void loadEmployees().catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Unable to load employees."));
    }
  }

  const navItems: { page: Page; label: string; icon: LucideIcon }[] = [
    ...(role === "admin" ? [
      { page: "dashboard" as const, label: "Dashboard", icon: LayoutDashboard },
      { page: "analytics" as const, label: "Analytics & Reports", icon: BarChart3 },
    ] : []),
    { page: "pos", label: "Point of sale", icon: ShoppingCart },
    ...(role === "admin" ? [
      { page: "inventory" as const, label: "Inventory", icon: Boxes },
      { page: "employees" as const, label: "Employees", icon: Users },
    ] : []),
    { page: "orders", label: "Orders", icon: ClipboardList },
    { page: "shifts", label: "Shifts", icon: CalendarClock },
    { page: "account", label: "Account", icon: UserRound },
  ];

  // A form someone has typed into asks before it's closed.
  function okToDiscard() {
    return !document.querySelector("form[data-dirty]") || window.confirm("Discard the changes you entered?");
  }
  const markDirty = (event: FormEvent<HTMLFormElement>) => { event.currentTarget.dataset.dirty = "1"; };
  function closeAddProduct() {
    if (!okToDiscard()) return;
    setShowAddProduct(false); setSelectedProductImage(null); setSelectedProductIcon("auto");
  }
  function closeEditPrices() {
    if (okToDiscard()) setEditingProductPrices(null);
  }
  function closeRestock() {
    if (okToDiscard()) setRestockProduct(null);
  }

  useEffect(() => {
    const page = signedIn ? navItems.find((item) => item.page === currentView)?.label : "Sign in";
    document.title = [page, brandName === "Point of sale" ? "" : brandName].filter(Boolean).join(" · ") || "Point of sale";
  });

  function closeTopDialog() {
    if (showHelpCenter) setShowHelpCenter(false);
    else if (isLoading) return false;
    else if (showCheckoutDialog) { setShowCheckoutDialog(false); setNotice(""); }
    else if (completedSale) setCompletedSale(null);
    else if (showAddProduct) closeAddProduct();
    else if (editingProductPrices) closeEditPrices();
    else if (editingProductImage) { setEditingProductImage(null); setSelectedProductImage(null); setRemoveExistingProductImage(false); }
    else if (showAddEmployee) setShowAddEmployee(false);
    else if (restockProduct) closeRestock();
    else if (quickAdd) setQuickAdd(null);
    else if (showImport) { if (!isImporting) setShowImport(false); }
    else if (confirmAction) setConfirmAction(null);
    else if (passwordEmployee) setPasswordEmployee(null);
    else if (showSyncPanel) setShowSyncPanel(false);
    else if (showLayoutPanel) setShowLayoutPanel(false);
    else if (showOpenDrawer) setShowOpenDrawer(false);
    else if (showCashCount) setShowCashCount(false);
    else if (voidTarget) setVoidTarget(null);
    else if (refundTarget) setRefundTarget(null);
    else if (showSuspend) setShowSuspend(false);
    else if (showRecall) setShowRecall(false);
    else if (showMobileCart) setShowMobileCart(false);
    else if (showNotifications) setShowNotifications(false);
    else return false;
    return true;
  }

  function handleShortcut(event: KeyboardEvent) {
    if (!signedIn || event.defaultPrevented || event.isComposing) return;
    const target = event.target as HTMLElement | null;
    const inTextField = !!target?.closest("input, textarea, select, [contenteditable='true']");
    const dialogOpen = showHelpCenter || showCheckoutDialog || showAddProduct || !!editingProductPrices || !!editingProductImage || showAddEmployee || !!restockProduct || !!quickAdd || showImport || !!confirmAction || !!passwordEmployee || showSyncPanel || showOpenDrawer || showCashCount || !!voidTarget || !!refundTarget || showSuspend || showRecall || !!completedSale;
    const digit = /^Digit([1-9])$/.exec(event.code)?.[1];

    if (event.key === "Escape") {
      if (closeTopDialog()) event.preventDefault();
      else if (activePage === "pos" && search) { event.preventDefault(); setSearch(""); }
      return;
    }
    if (event.key === "F1") {
      event.preventDefault();
      if (!dialogOpen) setShowHelpCenter(true);
      return;
    }
    if (dialogOpen) {
      // Modal options bind their own F-keys (useFunctionKeys); keep unused
      // ones from triggering browser help or find while a modal is open.
      if (/^F[1-47-9]$/.test(event.key)) event.preventDefault();
      return;
    }
    if (event.altKey && !event.ctrlKey && !event.metaKey && digit) {
      const item = navItems[Number(digit) - 1];
      if (item) { event.preventDefault(); goToPage(item.page); }
      return;
    }
    const plainKey = !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey;
    // Desktop app only: browsers keep F5/F6/F10/F12 for reload, the address
    // bar, the menu bar and developer tools. (F11, full screen, is handled by
    // the desktop app itself.)
    if (isDesktopApp() && plainKey && ["F5", "F6", "F10", "F12"].includes(event.key)) {
      event.preventDefault();
      if (event.repeat) return;
      if (event.key === "F5") {
        if (lastSale) void printReceipt(lastSale, true);
        else setNotice("No sale on this computer to reprint yet. Reprint older receipts from Orders.");
      } else if (event.key === "F6") void openDrawer(true);
      else if (event.key === "F12") { if (cashSession) setShowCashCount(true); else setShowOpenDrawer(true); }
      else if (activePage === "pos") updateLayout({ ...posLayout, cartSide: posLayout.cartSide === "left" ? "right" : "left" });
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k") {
      event.preventDefault();
      goToPage("pos");
      window.setTimeout(() => { searchInputRef.current?.focus(); searchInputRef.current?.select(); }, 0);
      return;
    }
    if (activePage !== "pos") return;
    // Order line keys work when the search box is empty (or not focused), so
    // typing and scanning are never affected.
    const entryIdle = !inTextField || (target === searchInputRef.current && !search);
    const lineKeys = [...cartLines.map((line) => line.key), ...customItems.map((item) => item.id)];
    const activeLine = selectedLine && lineKeys.includes(selectedLine) ? selectedLine : lineKeys.at(-1) ?? null;
    const changeLine = (key: string, difference: number) => {
      if (customItems.some((item) => item.id === key)) changeCustomQuantity(key, difference);
      else changeQuantity(key, difference);
    };
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && (event.key.toLowerCase() === "s" || event.key.toLowerCase() === "r")) {
      event.preventDefault();
      if (event.repeat) return;
      if (event.key.toLowerCase() === "s") {
        if (itemCount) setShowSuspend(true);
        else setNotice("Add items before saving an order for later.");
      } else if (suspendedOrders.length) setShowRecall(true);
      else setNotice("No saved orders on this computer.");
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "f") {
      event.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "z" && entryIdle) {
      event.preventDefault();
      undoLastAddition();
      return;
    }
    // ↑/↓ move the highlighted order line (the list scrolls with it) unless
    // the cashier is typing a search or moving between products; Ctrl+↑/↓
    // works everywhere. PgUp/PgDn scroll the order a page at a time.
    const onProducts = !!target?.closest("[data-product-card]");
    const plainOrderKey = !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && entryIdle && !onProducts;
    if ((event.key === "PageUp" || event.key === "PageDown") && plainOrderKey && lineKeys.length) {
      const list = document.querySelector<HTMLElement>("[data-order-list]");
      if (list && list.scrollHeight > list.clientHeight) {
        event.preventDefault();
        list.scrollBy({ top: (event.key === "PageUp" ? -1 : 1) * Math.max(40, list.clientHeight - 48) });
      }
      return;
    }
    if ((event.key === "ArrowUp" || event.key === "ArrowDown") && (plainOrderKey || ((event.ctrlKey || event.metaKey) && !event.altKey)) && lineKeys.length) {
      event.preventDefault();
      const index = activeLine ? lineKeys.indexOf(activeLine) : -1;
      const next = event.key === "ArrowUp" ? Math.max(0, index - 1) : Math.min(lineKeys.length - 1, index + 1);
      setSelectedLine(lineKeys[next]);
      return;
    }
    if (entryIdle && !event.ctrlKey && !event.altKey && !event.metaKey && activeLine && ["+", "=", "-", "Delete"].includes(event.key)) {
      event.preventDefault();
      if (event.key === "Delete") {
        const quantity = customItems.find((item) => item.id === activeLine)?.quantity ?? cart[activeLine] ?? 0;
        const index = lineKeys.indexOf(activeLine);
        changeLine(activeLine, -quantity);
        setSelectedLine(lineKeys[index + 1] ?? lineKeys[index - 1] ?? null);
      } else changeLine(activeLine, event.key === "-" ? -1 : 1);
      return;
    }
    if (event.key === "F2") {
      event.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    } else if (event.key === "F4") {
      event.preventDefault();
      if (itemCount && !isLoading) { setNotice(""); setShowCheckoutDialog(true); }
    } else if (event.key === "F9") {
      event.preventDefault();
      clearOrderWithUndo();
    } else if (event.key === "F3") {
      event.preventDefault();
      openQuickAdd();
    } else if (event.key === "F7") {
      event.preventDefault();
      toggleWholesaleMode();
    } else if (event.key === "F8") {
      event.preventDefault();
      toggleImages();
    } else if (!inTextField && !event.ctrlKey && !event.altKey && !event.metaKey && event.key.length === 1 && event.key !== " ") {
      // Type-to-search: typing or scanning anywhere on the POS starts a new
      // entry in the search box, where Enter adds the item.
      event.preventDefault();
      setSearch(event.key);
      searchInputRef.current?.focus();
    }
  }

  useFunctionKeys({
    F1: () => choosePaymentMethod("cash"),
    F2: () => choosePaymentMethod("e_wallet"),
    F3: () => choosePaymentMethod("card"),
    F7: () => setPrintThisSale((current) => !current),
  }, showCheckoutDialog && !showHelpCenter && !isLoading);

  // Auto-add: once the entry ("24/<barcode>" or a bare barcode) exactly matches
  // a product's barcode and input has paused, add it without waiting for Enter.
  // The pause lets a scanner finish typing, so a shorter barcode that prefixes
  // a longer one isn't matched mid-scan. Enter within the pause adds it first
  // and clears the entry, which cancels this timer.
  const submitSaleEntryRef = useRef(submitSaleEntry);
  useEffect(() => {
    submitSaleEntryRef.current = submitSaleEntry;
  });
  const entryMatchesBarcode = !!searchTerm && products.some((product) => product.barcode === compactBarcode(searchTerm));
  useEffect(() => {
    if (activePage !== "pos" || !entryMatchesBarcode) return;
    const timer = window.setTimeout(() => submitSaleEntryRef.current(), 150);
    return () => window.clearTimeout(timer);
  }, [activePage, entryMatchesBarcode, search]);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(showImagesStorageKey) === "off") setShowImages(false);
    } catch {
      // Storage unavailable: keep images on.
    }
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    listSuspendedOrders().then((orders) => { if (!cancelled) setSuspendedOrders(orders); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [signedIn]);

  useEffect(() => {
    const storageKey = userId ? `clover-pos-cart:${userId}` : null;
    if (!storageKey || restoredCartFor.current === storageKey) return;
    restoredCartFor.current = storageKey;
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey) ?? "null") as { cart?: Record<string, number>; customItems?: CustomItem[]; wholesaleMode?: boolean } | null;
      if (saved?.cart && typeof saved.cart === "object") setCart(saved.cart);
      if (Array.isArray(saved?.customItems)) setCustomItems(saved.customItems);
      if (typeof saved?.wholesaleMode === "boolean") setWholesaleMode(saved.wholesaleMode);
    } catch {
      // Unreadable: start with an empty order.
    }
  }, [userId]);
  useEffect(() => {
    const storageKey = userId ? `clover-pos-cart:${userId}` : null;
    if (!storageKey || restoredCartFor.current !== storageKey) return;
    try {
      if (Object.keys(cart).length || customItems.length) window.localStorage.setItem(storageKey, JSON.stringify({ cart, customItems, wholesaleMode }));
      else window.localStorage.removeItem(storageKey);
    } catch {
      // Storage full or blocked: the order still works for this session.
    }
  }, [cart, customItems, wholesaleMode, userId]);
  // Drop restored lines for products that are no longer sold.
  useEffect(() => {
    if (!products.length) return;
    const known = new Set(products.map((product) => product.id));
    setCart((current) => {
      const kept = Object.fromEntries(Object.entries(current).filter(([key]) => known.has(parseCartKey(key).productId)));
      return Object.keys(kept).length === Object.keys(current).length ? current : kept;
    });
  }, [products]);

  const shortcutHandlerRef = useRef(handleShortcut);
  useEffect(() => {
    shortcutHandlerRef.current = handleShortcut;
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => shortcutHandlerRef.current(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  // Changes one cart line (a product's retail or wholesale line).
  function changeQuantity(lineKey: string, difference: number) {
    setSelectedLine(lineKey);
    const product = productsById.get(parseCartKey(lineKey).productId);
    if (difference > 0 && product && quantityInCart(product.id) + difference > product.stock) {
      setNotice(`There isn’t enough stock for another ${product.name}.`);
      return;
    }
    setCart((current) => {
      const quantity = (current[lineKey] ?? 0) + difference;
      if (quantity <= 0) {
        const next = { ...current };
        delete next[lineKey];
        return next;
      }
      return { ...current, [lineKey]: quantity };
    });
  }

  async function checkout() {
    if (!itemCount) return;
    const receivedAmount = paymentMethod === "cash" ? Number(cashReceived) : null;
    if (paymentMethod === "cash" && (receivedAmount === null || !Number.isFinite(receivedAmount) || receivedAmount < total)) {
      setNotice("Cash received must be at least the order total.");
      return;
    }
    if (paymentMethod !== "cash" && !/^\d{4}$/.test(paymentReferenceLast4)) {
      setNotice(`Enter the last 4 digits of the ${paymentMethod === "e_wallet" ? "E-Wallet" : "card"} reference number.`);
      return;
    }
    setIsLoading(true);
    // One id per checkout attempt. The server records an id only once, so if
    // the connection drops mid-request the sale can be queued under the same
    // id without risking a duplicate.
    const sale: PendingOrder = {
      clientOrderId: crypto.randomUUID(),
      employeeId: userId ?? "",
      employeeName: employeeName || "Team member",
      createdAt: new Date().toISOString(),
      items: [
        ...cartLines.map((line) => ({
          kind: "product" as const,
          productId: line.product.id,
          name: line.product.name,
          quantity: line.quantity,
          unitPrice: unitPrice(line.product, line.wholesale),
          wholesale: line.wholesale && line.product.wholesalePrice > 0,
        })),
        ...customItems.map((item) => ({ kind: "custom" as const, description: item.description, quantity: item.quantity, unitPrice: item.unitPrice })),
      ],
      paymentMethod,
      paymentReferenceLast4: paymentMethod === "cash" ? null : paymentReferenceLast4,
      cashReceived: receivedAmount,
      wholesale: wholesaleLines.some((line) => line.product.wholesalePrice > 0),
      total,
      cashSessionId: cashSession?.id ?? null,
      attempts: 0,
      lastError: null,
      failed: false,
    };
    if (!userId) {
      setNotice("Your session isn’t ready yet. Sign out and sign in again.");
      setIsLoading(false);
      return;
    }
    if (!navigator.onLine || offlineSession) {
      await saveSaleOffline(sale, printThisSale);
      setIsLoading(false);
      return;
    }
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("place_order", {
        // Each line says whether it's wholesale; the database decides prices.
        p_items: [
          ...cartLines.map((line) => ({ product_id: line.product.id, quantity: line.quantity, wholesale: line.wholesale })),
          ...customItems.map((item) => ({ description: item.description, quantity: item.quantity, unit_price: item.unitPrice })),
        ],
        p_payment_method: paymentMethod,
        p_payment_reference_last4: sale.paymentReferenceLast4,
        p_cash_received: receivedAmount,
        p_wholesale: false,
        p_client_order_id: sale.clientOrderId,
        p_cash_session_id: sale.cashSessionId,
      }).single();
      if (error && isNetworkError(error)) {
        await saveSaleOffline(sale, printThisSale);
        return;
      }
      if (error) throw error;
      if (!data || typeof data !== "object" || !("order_id" in data) || typeof data.order_id !== "string") {
        throw new Error("Checkout completed, but the order confirmation was invalid.");
      }
      const { data: numbered } = await supabase.from("orders").select("receipt_number").eq("id", data.order_id).maybeSingle();
      const receiptNumber = numbered && typeof numbered.receipt_number === "string" ? numbered.receipt_number : undefined;
      const newOrderId = receiptNumber ?? `#${sale.clientOrderId.slice(0, 8)}`;
      // The database sets the prices. If its total differs from the screen
      // (a price changed since the products loaded, or the database needs
      // updating), say so rather than letting the till be off silently.
      const recordedTotal = "total" in data ? Number(data.total) : total;
      const totalMismatch = Number.isFinite(recordedTotal) && Math.abs(recordedTotal - total) >= 0.01;
      void afterSale({ ...sale, receiptNumber, ...(totalMismatch ? { total: recordedTotal } : {}) }, false, printThisSale);
      const finalTotal = totalMismatch ? recordedTotal : total;
      setCompletedSale({ label: newOrderId, total: finalTotal, paid: receivedAmount, change: receivedAmount !== null ? Math.max(0, Math.round((receivedAmount - finalTotal) * 100) / 100) : null, method: paymentMethod, offline: false });
      const wasWholesale = sale.wholesale;
      clearOrder();
      setShowCheckoutDialog(false);
      setCashReceived("");
      setPaymentReferenceLast4("");
      setNotice(totalMismatch
        ? `Order ${newOrderId} was recorded at ${money(recordedTotal)}, not the ${money(total)} shown. A price may have changed, or the database needs updating (npx supabase db push). Check the order and the change given.`
        : `${wasWholesale ? "Order with wholesale items" : "Order"} ${newOrderId} placed successfully.`);
      try {
        await refreshWorkspace();
      } catch (error) {
        setNotice(`Order ${newOrderId} was placed, but the store data could not refresh: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && (error.code === "PGRST202" || error.code === "42883")) {
        setNotice("Checkout needs the latest database update. Apply the migrations in supabase/migrations (through 202610120013_refunds_cash_drawer_receipts.sql), then retry.");
      } else {
        setNotice(error instanceof Error ? error.message : error && typeof error === "object" && "message" in error ? String(error.message) : "Unable to complete checkout.");
      }
    } finally {
      setIsLoading(false);
    }
  }

  function saleReceiptHtml(order: Order, reprint: boolean) {
    return buildSaleReceipt(storeDetails, {
      orderNumber: order.id,
      createdAt: order.createdAt,
      cashier: order.employeeName,
      lines: order.lines,
      total: order.total,
      paymentMethod: order.paymentMethod,
      paymentReferenceLast4: order.paymentReferenceLast4,
      cashReceived: order.cashReceived,
      changeDue: order.changeDue,
      wholesale: order.isWholesale,
      pendingSync: !!order.syncStatus,
      status: order.status,
      refundedTotal: order.refundedTotal,
      reprint,
    }, hardware.paperWidth);
  }

  async function printReceipt(order: Order, reprint: boolean) {
    try {
      await printDocument(saleReceiptHtml(order, reprint), hardware);
    } catch (error) {
      setNotice(`The receipt didn’t print: ${error instanceof Error ? error.message : "printer error"}. Check the printer in Account → Receipts & cash drawer.`);
    }
  }

  async function openDrawer(manual = false) {
    try {
      const opened = await openCashDrawer(hardware);
      if (manual && !opened) setNotice(hardware.drawerMode === "driver" ? "The drawer opens when a receipt prints (printer driver setting)." : "No cash drawer is set up on this computer. Set it up in Account → Receipts & cash drawer.");
    } catch (error) {
      setNotice(`The cash drawer didn’t open: ${error instanceof Error ? error.message : "drawer error"}`);
    }
  }

  function updateLayout(layout: PosLayout) {
    const normalized = normalizeLayout(layout);
    setPosLayout(normalized);
    savePosLayout(normalized);
  }

  // ---------- live updates (desktop app) ----------

  async function checkForAppUpdates() {
    try {
      setUpdateStatus((current) => ({ ...(current ?? { version: null, percent: null, message: null }), state: "checking" }));
      const status = await checkForUpdates();
      setUpdateStatus((current) => ({ ...status, currentVersion: current?.currentVersion ?? status.currentVersion }));
    } catch (error) {
      setNotice(`Couldn’t check for updates: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  // The app restarts into the new version. Queued offline sales, drawer
  // sessions and settings are stored on disk and survive the restart; only an
  // order still in the cart would be lost, so ask first.
  function restartToUpdate() {
    const run = async () => {
      setInstallingUpdate(true);
      try {
        await installUpdate();
      } catch (error) {
        setInstallingUpdate(false);
        setNotice(`The update couldn’t be installed: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    };
    if (itemCount > 0 || showCheckoutDialog) {
      setConfirmAction({
        title: "Restart with an order in progress?",
        message: "The items in the current order will be cleared. Completed sales, sales waiting to sync, and the open cash drawer session are kept.",
        confirmLabel: "Restart now",
        onConfirm: run,
      });
      return;
    }
    void run();
  }

  async function printTestReceipt() {
    const sample: Order = {
      id: "#TEST0001",
      fullId: "test",
      createdAt: new Date(),
      lines: [{ name: "Test item", quantity: 2, unitPrice: 25, custom: false, refundedQuantity: 0 }],
      items: 2,
      total: 50,
      time: "",
      paymentMethod: "cash",
      paymentReferenceLast4: null,
      cashReceived: 100,
      changeDue: 50,
      employeeName: employeeName || "Team member",
      isWholesale: false,
      status: "completed",
      refundedTotal: 0,
      voidReason: null,
    };
    await printReceipt(sample, false);
  }

  async function saveStoreDetails(details: StoreDetails) {
    try {
      const { error } = await createClient().from("store_settings").update({
        store_name: details.storeName.trim().slice(0, 80),
        address: details.address.trim().slice(0, 200),
        phone: details.phone.trim().slice(0, 40),
        tin: details.tin.trim().slice(0, 40),
        receipt_footer: details.receiptFooter.trim().slice(0, 200),
        updated_at: new Date().toISOString(),
      }).eq("id", 1);
      if (error) throw error;
      setStoreDetails(details);
      setNotice("Store details updated. New receipts will use them.");
    } catch (error) {
      setNotice(productSaveError(error, "Unable to save the store details."));
    }
  }

  // After a sale (online or saved offline): count it in the open drawer
  // session, open the drawer for cash, and print the receipt if enabled.
  async function afterSale(sale: PendingOrder, savedOffline: boolean, print: boolean) {
    if (sale.cashSessionId) {
      const updated = await recordInSession(sale.cashSessionId, sale.paymentMethod, sale.total, true).catch(() => null);
      if (updated) setCashSession(updated);
    }
    if (sale.paymentMethod === "cash") void openDrawer();
    const saved = pendingToOrder(sale);
    const order = savedOffline ? saved : { ...saved, syncStatus: undefined };
    setLastSale(order);
    if (print) await printReceipt(order, false);
  }

  // ---------- cash drawer sessions ----------

  async function startDrawerSession(openingFloat: number) {
    if (!userId) return;
    try {
      const session = await openSession({ openedBy: userId, openedByName: employeeName || "Team member", deviceLabel: hardware.deviceLabel, openingFloat });
      setCashSession(session);
      setSessionOutboxCount((await readSessionOutbox()).length);
      setShowOpenDrawer(false);
      setNotice(`Drawer opened with ${money(session.openingFloat)}. Cash sales are now counted for this shift.`);
      void syncPendingOrders({ quiet: true });
    } catch (error) {
      setNotice(`Couldn’t start the drawer session: ${error instanceof Error ? error.message : "storage error"}`);
    }
  }

  async function finishDrawerSession(count: { denominations: Record<string, number>; countedCash: number; notes: string; print: boolean }) {
    if (!cashSession || !userId) return;
    try {
      const expected = expectedCash(cashSession);
      const closedAt = new Date().toISOString();
      const closed = await closeSession(cashSession, {
        closedBy: userId,
        closedByName: employeeName || "Team member",
        closedAt,
        countedCash: count.countedCash,
        expectedCash: expected,
        denominations: count.denominations,
        notes: count.notes,
      });
      setCashSession(null);
      setSessionOutboxCount((await readSessionOutbox()).length);
      setShowCashCount(false);
      const difference = Math.round((count.countedCash - expected) * 100) / 100;
      setNotice(`Shift closed and saved. ${difference === 0 ? "The drawer balances." : difference > 0 ? `The drawer is over by ${money(difference)}.` : `The drawer is short by ${money(-difference)}.`}`);
      if (count.print) {
        const report = buildCashCountReport(storeDetails, {
          deviceLabel: closed.deviceLabel,
          openedBy: closed.openedByName,
          closedBy: employeeName || "Team member",
          openedAt: new Date(closed.openedAt),
          closedAt: new Date(closedAt),
          openingFloat: closed.openingFloat,
          cashSales: closed.cashSales,
          cashRefunds: closed.cashRefunds,
          salesCount: closed.salesCount,
          otherSales: Object.entries(closed.otherSales).filter(([, amount]) => amount !== 0).map(([method, amount]) => ({ method, amount })),
          expected,
          counted: count.countedCash,
          denominations: Object.entries(count.denominations).map(([label, amount]) => ({ label, count: amount, value: Number(label.replace(/[^\d.]/g, "")) })),
          notes: count.notes,
        }, hardware.paperWidth);
        void printDocument(report, hardware).catch((error: unknown) => setNotice(`The shift was saved, but the report didn’t print: ${error instanceof Error ? error.message : "printer error"}`));
      }
      void syncPendingOrders({ quiet: true });
    } catch (error) {
      setNotice(`Couldn’t close the drawer session: ${error instanceof Error ? error.message : "storage error"}`);
    }
  }

  // ---------- voids and refunds (online only) ----------

  async function afterMoneyReturned(method: string, amount: number) {
    if (cashSession) {
      const updated = await recordInSession(cashSession.id, method, -amount, false).catch(() => null);
      if (updated) setCashSession(updated);
    }
    if (method === "cash") void openDrawer();
  }

  async function voidSale(order: Order, reason: string, printSlip: boolean) {
    const { data, error } = await createClient().rpc("void_order", {
      p_order_id: order.fullId,
      p_reason: reason,
      p_cash_session_id: cashSession?.id ?? null,
    }).single();
    if (error) throw error;
    const amount = data && typeof data === "object" && "amount" in data ? Number(data.amount) : order.total;
    await afterMoneyReturned(order.paymentMethod, amount);
    setVoidTarget(null);
    setNotice(`Sale ${order.id} voided. ${money(amount)} returned by ${paymentMethodLabel(order.paymentMethod)}; items were put back in stock.`);
    if (printSlip) {
      void printDocument(buildRefundReceipt(storeDetails, {
        orderNumber: order.id,
        kind: "void",
        createdAt: new Date(),
        processedBy: employeeName,
        lines: order.lines,
        amount,
        method: order.paymentMethod,
        reason,
        restocked: true,
      }, hardware.paperWidth), hardware).catch(() => undefined);
    }
    await refreshWorkspace().catch(() => undefined);
  }

  async function refundSale(order: Order, refund: { lines: { id: string; quantity: number }[]; reason: string; restock: boolean; method: PaymentMethod; printSlip: boolean }) {
    const { data, error } = await createClient().rpc("refund_order", {
      p_order_id: order.fullId,
      p_items: refund.lines.map((line) => ({ order_item_id: line.id, quantity: line.quantity })),
      p_reason: refund.reason,
      p_restock: refund.restock,
      p_method: refund.method,
      p_cash_session_id: cashSession?.id ?? null,
      p_client_refund_id: crypto.randomUUID(),
    }).single();
    if (error) throw error;
    const amount = data && typeof data === "object" && "amount" in data ? Number(data.amount) : 0;
    await afterMoneyReturned(refund.method, amount);
    setRefundTarget(null);
    setNotice(`Refund of ${money(amount)} for ${order.id} recorded${refund.restock ? "; items were put back in stock" : ""}.`);
    if (refund.printSlip) {
      const byId = new Map(order.lines.map((line) => [line.id, line]));
      void printDocument(buildRefundReceipt(storeDetails, {
        orderNumber: order.id,
        kind: "refund",
        createdAt: new Date(),
        processedBy: employeeName,
        lines: refund.lines.map((line) => ({ name: byId.get(line.id)?.name ?? "Item", quantity: line.quantity, unitPrice: byId.get(line.id)?.unitPrice ?? 0 })),
        amount,
        method: refund.method,
        reason: refund.reason,
        restocked: refund.restock,
      }, hardware.paperWidth), hardware).catch(() => undefined);
    }
    await refreshWorkspace().catch(() => undefined);
  }

  // Records a sale on this computer to sync later. The sale is on disk before
  // anything else changes; if saving fails, the cart is left as it was.
  async function saveSaleOffline(sale: PendingOrder, print: boolean) {
    try {
      await savePendingOrder(sale);
    } catch (error) {
      setNotice(`This sale could NOT be saved on this computer (${error instanceof Error ? error.message : "storage error"}). Keep the cart and write the sale down, or retry once online.`);
      return;
    }
    setPendingOrders((current) => [...current.filter((item) => item.clientOrderId !== sale.clientOrderId), sale]);
    setServerUnreachable(true);
    // Reflect the sale in the local stock, here and in the saved copy.
    const sold = new Map(sale.items.flatMap((item) => (item.kind === "product" ? [[item.productId, item.quantity] as const] : [])));
    const updatedProducts = products.map((product) => (sold.has(product.id) ? { ...product, stock: Math.max(0, product.stock - (sold.get(product.id) ?? 0)) } : product));
    setProducts(updatedProducts);
    if (userId) {
      void writeCache(`workspace:${userId}`, { products: updatedProducts, orders, stats: dashboardStats, salesChart, shortfalls, storeDetails } satisfies Workspace).catch(() => undefined);
    }
    clearOrder();
    setShowCheckoutDialog(false);
    setCashReceived("");
    setPaymentReferenceLast4("");
    setNotice(`Sale #${sale.clientOrderId.slice(0, 8)} saved offline on this computer. It will sync automatically when the connection is back.`);
    setCompletedSale({ label: `#${sale.clientOrderId.slice(0, 8)}`, total: sale.total, paid: sale.cashReceived, change: sale.cashReceived !== null ? Math.max(0, Math.round((sale.cashReceived - sale.total) * 100) / 100) : null, method: sale.paymentMethod, offline: true });
    void afterSale(sale, true, print);
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");
    setAuthError("");
    setIsLoading(true);
    try {
      const supabase = createClient();
      const { data: authData, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role, full_name")
        .eq("id", authData.user.id)
        .single();
      if (profileError) throw profileError;
      // The workspace follows the account's role; there's nothing to pick.
      if (profile.role !== "admin" && profile.role !== "employee") {
        await supabase.auth.signOut({ scope: "local" });
        throw new Error("This account doesn’t have a store role yet. Ask an administrator to set it up.");
      }
      const workspace = await fetchWorkspaceData(profile.role === "admin", salesPeriod);
      signInWith(authData.user.id, { role: profile.role, fullName: profile.full_name || "", email: authData.user.email ?? "" }, workspace, false);
      setOfflineSession(false);
      setActivePage(profile.role === "admin" ? "dashboard" : "pos");
      // Lets this person sign in here offline later (password verifier only).
      void rememberOfflineCredential(authData.user.id, email, password).catch(() => undefined);
    } catch (error) {
      if (isNetworkError(error)) {
        await signInOffline(email, password);
        return;
      }
      setAuthError(error instanceof Error ? error.message : "Unable to sign in.");
    } finally {
      setIsLoading(false);
    }
  }

  // Supabase is unreachable: check the password against this device's saved
  // verifier and open the saved workspace. Sales are queued until the cashier
  // reconnects online.
  async function signInOffline(email: string, password: string) {
    try {
      const result = await verifyOfflineCredential(email, password);
      if ("error" in result) {
        setAuthError(result.error);
        return;
      }
      const [profile, workspace] = await Promise.all([
        readCache<CachedProfile>(`profile:${result.userId}`),
        readCache<Workspace>(`workspace:${result.userId}`),
      ]);
      if (!profile || !workspace) {
        setAuthError("You’re offline, and this computer has no saved store data for your account yet. Connect to the internet to sign in.");
        return;
      }
      signInWith(result.userId, profile, workspace, true);
      setOfflineSession(true);
      setServerUnreachable(true);
      setActivePage(profile.role === "admin" ? "dashboard" : "pos");
    } catch (error) {
      setAuthError(`Offline sign-in failed: ${error instanceof Error ? error.message : "storage error"}`);
    }
  }

  // Back online after an offline sign-in: one password entry creates the real
  // Supabase session, then queued sales sync.
  async function reconnectOnline(password: string) {
    const supabase = createClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email: accountEmail, password });
    if (error) throw error;
    if (data.user.id !== userId) {
      await supabase.auth.signOut({ scope: "local" });
      throw new Error("That password belongs to a different account.");
    }
    void rememberOfflineCredential(data.user.id, accountEmail, password).catch(() => undefined);
    setOfflineSession(false);
    setServerUnreachable(false);
    setNotice("Reconnected. Syncing your offline sales…");
  }

  async function addProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const name = normalizeProductName(formData.get("name"));
    const costPrice = Number(formData.get("cost_price"));
    // Optional: blank means the product isn't sold wholesale (stored as 0).
    const wholesalePrice = optionalPrice(formData.get("wholesale_price"));
    const price = Number(formData.get("price"));
    const stock = Number(formData.get("stock"));
    const selectedCategory = normalizeCategory(formData.get("category"), productCategories);
    const barcode = normalizeBarcode(formData.get("barcode"));
    if (!selectedCategory) {
      setNotice("Enter a category of up to 80 characters — pick an existing one or type a new name.");
      return;
    }
    if (barcode === undefined) {
      setNotice("Enter a barcode of up to 64 letters, digits, or symbols.");
      return;
    }
    if (selectedProductImage && (
      !["image/jpeg", "image/png", "image/webp"].includes(selectedProductImage.type) ||
      selectedProductImage.size > 5 * 1024 * 1024
    )) {
      setNotice("Choose a JPEG, PNG, or WebP image that is no larger than 5 MB.");
      return;
    }
    if (!name || name.length > 120 || !Number.isFinite(costPrice) || costPrice < 0 || !Number.isFinite(wholesalePrice) || wholesalePrice < 0 || !Number.isFinite(price) || price <= 0 || !Number.isInteger(stock) || stock < 0) {
      setNotice("Enter a product name, a valid cost price, a wholesale price of ₱0 or more (or leave it blank), a retail price above ₱0, and a valid stock quantity.");
      return;
    }
    // Already for sale under this name (ignoring capitals and spacing) or
    // barcode? Products with barcodes may share a name; without a barcode,
    // nothing would tell two of them apart.
    const sameName = products.find((product) => productNameKey(product.name) === productNameKey(name) && (!barcode || !product.barcode));
    if (sameName) {
      setNotice(barcode
        ? `“${sameName.name}” is already in your products without a barcode. Add the barcode to it instead (its ⋮ Actions menu → Edit details), or use a different name.`
        : `“${sameName.name}” is already in your products. To add another product with this name, give it a barcode; to change the existing one, use its ⋮ Actions menu in Inventory.`);
      return;
    }
    const sameBarcode = barcode ? products.find((product) => product.barcode === barcode) : undefined;
    if (sameBarcode) {
      setNotice(`The barcode ${barcode} is already used by “${sameBarcode.name}”.`);
      return;
    }
    const values: NewProductValues = { name, category: selectedCategory, costPrice, wholesalePrice, price, stock, imageIcon: selectedProductIcon, image: selectedProductImage, barcode };

    // A removed product with this name: offer to bring it back (its past sales
    // stay with it) instead of adding a second product with the same name.
    try {
      const pattern = name.replace(/[\\%_]/g, (character) => `\\${character}`);
      const { data: removedMatches } = await createClient().from("products").select("id, name").eq("active", false).ilike("name", pattern).order("updated_at", { ascending: false }).limit(1);
      const removed = (removedMatches ?? [])[0] as { id: string; name: string } | undefined;
      if (removed) {
        setConfirmAction({
          title: `Restore “${removed.name}”?`,
          message: "A product with this name was removed earlier. Restore it with the details you entered, so its past sales stay together, or add a separate new product.",
          confirmLabel: "Restore it",
          tone: "neutral",
          onConfirm: () => saveNewProduct(values, removed.id),
          secondaryLabel: "Add as new",
          onSecondary: () => saveNewProduct(values, null),
        });
        return;
      }
    } catch (error) {
      setNotice(productSaveError(error, "Unable to add product."));
      return;
    }
    try {
      await saveNewProduct(values, null);
    } catch (error) {
      setNotice(productSaveError(error, "Unable to add product."));
    }
  }

  // Adds the product, or restores a removed one (restoreId) with these details.
  async function saveNewProduct(values: NewProductValues, restoreId: string | null) {
    let uploadedPath: string | null = null;
    let productSaved = false;
    const supabase = createClient();
    try {
      let imageUrl: string | null = null;
      if (values.image) {
        const extensionByType: Record<string, string> = {
          "image/jpeg": "jpg",
          "image/png": "png",
          "image/webp": "webp",
        };
        uploadedPath = `${crypto.randomUUID()}.${extensionByType[values.image.type]}`;
        const { error: uploadError } = await supabase.storage
          .from("product-images")
          .upload(uploadedPath, values.image, {
            contentType: values.image.type,
            cacheControl: "3600",
            upsert: false,
          });
        if (uploadError) throw new Error(`Unable to upload product image: ${uploadError.message}`);
        imageUrl = supabase.storage.from("product-images").getPublicUrl(uploadedPath).data.publicUrl;
      }
      const fields = {
        name: values.name,
        category: values.category,
        cost_price: values.costPrice,
        cost_price_known: true,
        wholesale_price: values.wholesalePrice,
        price: values.price,
        stock: values.stock,
        image_icon: values.imageIcon,
        barcode: values.barcode,
      };
      const { error } = restoreId
        // A restored product keeps its old picture unless a new one was chosen.
        ? await supabase.from("products").update({ ...fields, ...(imageUrl ? { image_url: imageUrl } : {}), active: true, updated_at: new Date().toISOString() }).eq("id", restoreId)
        : await supabase.from("products").insert({ ...fields, image_url: imageUrl });
      if (error) throw error;
      productSaved = true;
      setShowAddProduct(false);
      setSelectedProductIcon("auto");
      setSelectedProductImage(null);
      setNotice(restoreId ? `${values.name} restored to inventory with the details you entered.` : `${values.name} added to inventory.`);
      try {
        await refreshWorkspace();
      } catch (error) {
        setNotice(`${values.name} was saved, but the catalog could not refresh: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    } finally {
      if (uploadedPath && !productSaved) {
        const { error: cleanupError } = await supabase.storage.from("product-images").remove([uploadedPath]);
        if (cleanupError) console.error("Unable to remove an unused product image:", cleanupError.message);
      }
    }
  }

  function removeProduct(product: Product) {
    setConfirmAction({
      title: `Remove ${product.name}?`,
      message: "It disappears from Point of sale and Inventory. Past orders that include it are kept.",
      confirmLabel: "Remove product",
      onConfirm: async () => {
        const { error } = await createClient().from("products").update({ active: false }).eq("id", product.id);
        if (error) throw error;
        setProducts((current) => current.filter((item) => item.id !== product.id));
        setCart((current) => {
          const next = { ...current };
          delete next[cartKey(product.id, false)];
          delete next[cartKey(product.id, true)];
          return next;
        });
        notifyWithUndo(`${product.name} removed from inventory.`, () => {
          void (async () => {
            const { error: undoError } = await createClient().from("products").update({ active: true }).eq("id", product.id);
            if (undoError) { setNotice(productSaveError(undoError, `Couldn’t bring back ${product.name}.`)); return; }
            setNotice(`${product.name} is back in inventory.`);
            try { await refreshWorkspace(); } catch { /* the next refresh shows it */ }
          })();
        });
        try {
          await refreshWorkspace();
        } catch (error) {
          setNotice(`${product.name} was removed, but dashboard data could not refresh: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
      },
    });
  }

  async function resolveShortfalls(ids: string[]) {
    if (!ids.length) return;
    try {
      const { error } = await createClient()
        .from("stock_shortfalls")
        .update({ resolved_at: new Date().toISOString(), resolved_by: userId })
        .in("id", ids);
      if (error) throw error;
      setShortfalls((current) => current.filter((item) => !ids.includes(item.id)));
      setNotice(`${ids.length === 1 ? "Product" : `${ids.length} products`} marked as recounted.`);
    } catch (error) {
      setNotice(productSaveError(error, "Unable to update the recount list."));
    }
  }

  async function runConfirmAction(secondary = false) {
    if (!confirmAction) return;
    setIsLoading(true);
    try {
      await (secondary && confirmAction.onSecondary ? confirmAction.onSecondary : confirmAction.onConfirm)();
      setConfirmAction(null);
    } catch (error) {
      setNotice(productSaveError(error, "That action couldn’t be completed."));
      setConfirmAction(null);
    } finally {
      setIsLoading(false);
    }
  }

  async function saveProductPrices(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingProductPrices) return;
    const formData = new FormData(event.currentTarget);
    const costPrice = Number(formData.get("cost_price"));
    const wholesalePrice = optionalPrice(formData.get("wholesale_price"));
    const retailPrice = Number(formData.get("price"));
    const barcode = normalizeBarcode(formData.get("barcode"));
    const productCategory = normalizeCategory(formData.get("category"), productCategories);
    if (!productCategory) {
      setNotice("Enter a category of up to 80 characters — pick an existing one or type a new name.");
      return;
    }
    if (!Number.isFinite(costPrice) || costPrice < 0 || !Number.isFinite(wholesalePrice) || wholesalePrice < 0 || !Number.isFinite(retailPrice) || retailPrice <= 0) {
      setNotice("Enter a valid cost price, a wholesale price of ₱0 or more (or leave it blank), and a retail price above ₱0.");
      return;
    }
    if (barcode === undefined) {
      setNotice("Enter a barcode of up to 64 letters, digits, or symbols.");
      return;
    }
    setIsLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.from("products").update({
        cost_price: costPrice,
        cost_price_known: true,
        wholesale_price: wholesalePrice,
        price: retailPrice,
        barcode,
        category: productCategory,
      }).eq("id", editingProductPrices.id);
      if (error) throw error;
      const productName = editingProductPrices.name;
      setEditingProductPrices(null);
      setNotice(`${productName} details updated.`);
      try {
        await refreshWorkspace();
      } catch (error) {
        setNotice(`${productName} prices were updated, but the catalog could not refresh: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    } catch (error) {
      setNotice(productSaveError(error, "Unable to update product details."));
    } finally {
      setIsLoading(false);
    }
  }

  async function saveProductImage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingProductImage) return;
    if (selectedProductImage && (
      !["image/jpeg", "image/png", "image/webp"].includes(selectedProductImage.type) ||
      selectedProductImage.size > 5 * 1024 * 1024
    )) {
      setNotice("Choose a JPEG, PNG, or WebP image that is no larger than 5 MB.");
      return;
    }
    let uploadedPath: string | null = null;
    let imageSaved = false;
    setIsLoading(true);
    try {
      const supabase = createClient();
      let imageUrl = removeExistingProductImage ? null : editingProductImage.imageUrl;
      if (selectedProductImage) {
        const extensionByType: Record<string, string> = {
          "image/jpeg": "jpg",
          "image/png": "png",
          "image/webp": "webp",
        };
        uploadedPath = `${crypto.randomUUID()}.${extensionByType[selectedProductImage.type]}`;
        const { error: uploadError } = await supabase.storage
          .from("product-images")
          .upload(uploadedPath, selectedProductImage, {
            contentType: selectedProductImage.type,
            cacheControl: "3600",
            upsert: false,
          });
        if (uploadError) throw new Error(`Unable to upload product image: ${uploadError.message}`);
        imageUrl = supabase.storage.from("product-images").getPublicUrl(uploadedPath).data.publicUrl;
      }
      const { error } = await supabase.from("products").update({
        image_icon: selectedProductIcon,
        image_url: imageUrl,
      }).eq("id", editingProductImage.id);
      if (error) throw error;
      imageSaved = true;
      const previousImageUrl = editingProductImage.imageUrl;
      setEditingProductImage(null);
      setSelectedProductImage(null);
      setSelectedProductIcon("auto");
      setRemoveExistingProductImage(false);
      setNotice(`${editingProductImage.name} image updated.`);
      if (previousImageUrl && (removeExistingProductImage || uploadedPath)) {
        const imagePathMarker = "/storage/v1/object/public/product-images/";
        const oldPath = previousImageUrl.split(imagePathMarker)[1]?.split(/[?#]/)[0];
        if (oldPath && /^[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(oldPath)) {
          const { error: cleanupError } = await supabase.storage.from("product-images").remove([oldPath]);
          if (cleanupError) setNotice(`${editingProductImage.name} was updated, but its previous image could not be removed: ${cleanupError.message}`);
        } else {
          setNotice(`${editingProductImage.name} was updated, but its previous image is not in the managed image bucket and was not removed.`);
        }
      }
      try {
        await refreshWorkspace();
      } catch (error) {
        setNotice(`${editingProductImage.name} was updated, but the catalog could not refresh: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    } catch (error) {
      if (uploadedPath && !imageSaved) {
        const supabase = createClient();
        const { error: cleanupError } = await supabase.storage.from("product-images").remove([uploadedPath]);
        if (cleanupError) console.error("Unable to remove an unused product image:", cleanupError.message);
      }
      setNotice(error instanceof Error ? error.message : "Unable to update product image.");
    } finally {
      setIsLoading(false);
    }
  }

  async function restock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!restockProduct) return;
    const formData = new FormData(event.currentTarget);
    const quantity = Number(formData.get("quantity"));
    const note = String(formData.get("note") ?? "").trim();
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1_000_000) {
      setNotice("Enter a restock quantity between 1 and 1,000,000.");
      return;
    }
    setIsLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc("restock_product", {
        p_product_id: restockProduct.id,
        p_quantity: quantity,
        p_note: note || null,
      });
      if (error) throw error;
      const productName = restockProduct.name;
      setRestockProduct(null);
      setNotice(`${productName} restocked by ${quantity} unit${quantity === 1 ? "" : "s"}.`);
      setReadNotifications((current) => current.filter((id) => id !== `low-stock-${restockProduct.id}`));
      try {
        await refreshWorkspace();
      } catch (error) {
        setNotice(`${productName} was restocked, but dashboard data could not refresh: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to update product stock.");
    } finally {
      setIsLoading(false);
    }
  }

  async function performSignOut() {
    const supabase = createClient();
    // Local scope: signs out this device only, not the account everywhere.
    // An offline sign-in has no Supabase session to end.
    const { error } = offlineSession ? { error: null } : await supabase.auth.signOut({ scope: "local" });
    if (error) {
      if (!isNetworkError(error)) {
        setNotice(`Unable to sign out: ${error.message}`);
        return;
      }
      // Offline, Supabase can't be told; forget the session on this device.
      window.localStorage.removeItem(AUTH_STORAGE_KEY);
      window.location.reload();
      return;
    }
    setSignedIn(false);
    setOfflineSession(false);
    setUserId(null);
    setActivePage("pos");
    setCart({});
    setCustomItems([]);
  }

  // Queued sales stay on this computer through a sign-out, but warn first:
  // offline, nobody can sign back in until the connection returns.
  function signOut() {
    const unsynced = pendingOrders.filter((sale) => sale.employeeId === userId).length;
    if (isOnline && unsynced === 0) {
      void performSignOut();
      return;
    }
    setConfirmAction({
      title: isOnline ? "Sign out with unsynced sales?" : "Sign out while offline?",
      message: [
        unsynced ? `${unsynced} of your sale${unsynced === 1 ? " hasn’t" : "s haven’t"} synced yet. ${unsynced === 1 ? "It stays" : "They stay"} saved on this computer and will sync the next time you, or an admin, sign in here online.` : "",
        isOnline ? "" : "Signing in needs an internet connection, so no one can sign back in until it’s back.",
      ].filter(Boolean).join(" "),
      confirmLabel: "Sign out anyway",
      onConfirm: performSignOut,
    });
  }

  async function updateAccountEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const email = String(formData.get("email") ?? "").trim();
    if (!email || email.toLowerCase() === accountEmail.toLowerCase()) {
      setNotice("Enter a different, valid email address.");
      return;
    }
    setIsLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ email });
      if (error) throw error;
      setNotice("Email change requested. Follow the confirmation instructions sent by Supabase before signing in with the new address.");
      form.reset();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to update account email.");
    } finally {
      setIsLoading(false);
    }
  }

  async function updateAccountPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const password = String(formData.get("password") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");
    if (password.length < 8) {
      setNotice("Choose a password with at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setNotice("The new passwords do not match.");
      return;
    }
    setIsLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      form.reset();
      setNotice("Your password has been updated.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to update account password.");
    } finally {
      setIsLoading(false);
    }
  }

  async function updateAccountName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const fullName = String(formData.get("fullName") ?? "").trim();
    if (!fullName || fullName.length > 100) {
      setNotice("Enter a name with 1 to 100 characters.");
      return;
    }
    setIsLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ data: { full_name: fullName } });
      if (error) throw error;
      setAccountName(fullName);
      setEmployeeName(fullName);
      setNotice("Your account name was updated.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to update account name.");
    } finally {
      setIsLoading(false);
    }
  }

  async function resetSalesHistory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (role !== "admin" || salesResetConfirmation !== "RESET SALES HISTORY") {
      setNotice("Enter RESET SALES HISTORY exactly to confirm this admin-only action.");
      return;
    }
    setIsLoading(true);
    try {
      const { data, error } = await createClient().rpc("reset_sales_history", { p_confirmation: salesResetConfirmation });
      if (error) throw error;
      const deletedOrders = Number(data);
      if (!Number.isSafeInteger(deletedOrders) || deletedOrders < 0) {
        throw new Error("Sales history was reset, but the database returned an invalid order count.");
      }
      setOrders([]);
      setDashboardStats((current) => current ? { ...current, sales_total: 0, orders_today: 0 } : current);
      setSalesResetConfirmation("");
      setNotice(`${deletedOrders} sales order${deletedOrders === 1 ? "" : "s"} and their item history permanently deleted. Products, stock, employees, and stock movements were not changed.`);
    } catch (error) {
      setNotice(productSaveError(error, "Unable to reset sales history."));
    } finally {
      setIsLoading(false);
    }
  }

  async function loadEmployees() {
    const { data, error } = await createClient()
      .from("profiles")
      .select("id, email, full_name, role")
      .eq("role", "employee")
      .order("created_at", { ascending: false })
      .returns<Employee[]>();
    if (error) throw new Error(`Unable to load employee accounts: ${error.message}`);
    setEmployees(data);
  }

  async function createEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    try {
      const formData = new FormData(event.currentTarget);
      const { employee } = await callPosAdmin<{ employee: Employee }>({
        action: "create-employee",
        fullName: String(formData.get("fullName") ?? ""),
        email: String(formData.get("email") ?? ""),
        password: String(formData.get("password") ?? ""),
      });
      setEmployees((current) => [employee, ...current]);
      setShowAddEmployee(false);
      setNotice(`Employee account created for ${employee.full_name}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to create employee.");
    } finally {
      setIsLoading(false);
    }
  }

  function removeEmployee(employee: Employee) {
    setConfirmAction({
      title: `Remove ${employee.full_name}?`,
      message: `${employee.email} will no longer be able to sign in. Their past sales stay in your records.`,
      confirmLabel: "Remove employee",
      onConfirm: async () => {
        await callPosAdmin({ action: "remove-employee", id: employee.id });
        setEmployees((current) => current.filter((item) => item.id !== employee.id));
        setNotice(`Employee account for ${employee.full_name} removed.`);
      },
    });
  }

  async function setEmployeePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!passwordEmployee) return;
    const formData = new FormData(event.currentTarget);
    const password = String(formData.get("password") ?? "");
    if (password.length < 8 || password !== String(formData.get("confirmPassword") ?? "")) {
      setNotice("Enter the same new password twice, using at least 8 characters.");
      return;
    }
    setIsLoading(true);
    try {
      await callPosAdmin({ action: "set-employee-password", id: passwordEmployee.id, password });
      setNotice(`New password set for ${passwordEmployee.full_name}. Share it with them securely.`);
      setPasswordEmployee(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to set the password.");
    } finally {
      setIsLoading(false);
    }
  }

  // Step 1 of an import: read and check the file for the preview. Category
  // spellings are matched to existing ones (and to earlier rows in the file).
  // Each row is matched the way the database will save it: same barcode, else
  // same name ignoring capitals, else a removed product to restore.
  async function prepareImport(file: File): Promise<ImportPreview> {
    const { products: rows, errors } = validateImportedProducts(await readProductFile(file));
    // Removed products (to show which rows restore one). Skipped offline, and
    // given up on after a few seconds, so the preview never waits on it.
    type RemovedProduct = { id: string; name: string; barcode: string | null };
    let removedProducts: RemovedProduct[] = [];
    if (!offlineSession && navigator.onLine) {
      const supabase = createClient();
      const lookup = fetchAllRows<RemovedProduct>((from, to) => supabase.from("products").select("id, name, barcode").eq("active", false).order("updated_at", { ascending: false }).order("id").range(from, to).returns<RemovedProduct[]>())
        .then(({ data }) => data ?? [], () => []);
      removedProducts = await Promise.race([lookup, new Promise<RemovedProduct[]>((resolve) => window.setTimeout(() => resolve([]), 8000))]);
    }
    const knownCategories = [...productCategories];
    const newCategories: string[] = [];
    const matched = new Set<string>();
    const prepared = rows.map((row) => {
      const productCategory = normalizeCategory(row.category, knownCategories);
      if (!knownCategories.includes(productCategory)) {
        knownCategories.push(productCategory);
        newCategories.push(productCategory);
      }
      const key = productNameKey(row.name);
      const sameName = products.filter((product) => productNameKey(product.name) === key);
      if (!row.barcode && sameName.length > 1) {
        errors.push(`Row ${row.sourceRow}: several products are named “${row.name}”. Add the barcode to say which one.`);
      }
      // With a barcode: that barcode, else the same name without a barcode.
      // Without one: the only product with that name.
      const active = row.barcode
        ? products.find((product) => product.barcode === row.barcode) ?? sameName.find((product) => !product.barcode)
        : sameName.length === 1 ? sameName[0] : undefined;
      const removed = active ? undefined : row.barcode
        ? removedProducts.find((product) => product.barcode === row.barcode) ?? removedProducts.find((product) => !product.barcode && productNameKey(product.name) === key)
        : removedProducts.find((product) => productNameKey(product.name) === key);
      const match = active ?? removed;
      if (match) matched.add(match.id);
      return {
        ...row,
        category: productCategory,
        status: active ? "update" as const : removed ? "restore" as const : "new" as const,
        isUpdate: !!match,
        ...(match && productNameKey(match.name) !== key ? { renamedFrom: match.name } : {}),
      };
    });
    const removable = products.filter((product) => !matched.has(product.id)).map((product) => product.name).sort((a, b) => a.localeCompare(b));
    return { fileName: file.name, products: prepared, errors, newCategories, removable };
  }

  // Step 2: save, in one database transaction (all rows or none). A master
  // list also removes products for sale that no row matched; removed
  // products are hidden, not deleted, so past orders keep them.
  async function importProducts(preview: ImportPreview, masterList = false) {
    setIsImporting(true);
    try {
      const rows = preview.products.map((product) => ({
        name: product.name,
        category: product.category,
        price: product.price,
        stock: product.stock,
        image_icon: product.image_icon,
        ...(product.cost_price !== undefined ? { cost_price: product.cost_price } : {}),
        ...(product.wholesale_price !== undefined ? { wholesale_price: product.wholesale_price } : {}),
        ...(product.barcode ? { barcode: product.barcode } : {}),
      }));
      const { data, error } = await createClient().rpc("import_products", { p_rows: rows, p_replace: masterList }).single();
      if (error) {
        if (error.code === "PGRST202" || error.code === "42883") {
          throw new Error("Importing needs the latest database update. Run npx supabase db push (migration 202610130004_product_name_rules.sql), then retry.");
        }
        throw error;
      }
      const result = (data ?? {}) as { imported?: number; removed?: number; added?: number; restored?: number };
      const imported = Number(result.imported ?? preview.products.length);
      const details = [
        result.added ? `${result.added} new` : "",
        result.restored ? `${result.restored} restored` : "",
        result.removed ? `${result.removed} not on the list removed` : "",
      ].filter(Boolean).join(", ");
      setShowImport(false);
      if (masterList) setCart({});
      setNotice(`${masterList ? "Master list applied successfully" : "Import saved successfully"}: ${imported} product${imported === 1 ? "" : "s"}${details ? ` (${details})` : ""}.`);
      try {
        await refreshWorkspace();
      } catch (refreshError) {
        setNotice(`The import was saved, but the catalog could not refresh: ${refreshError instanceof Error ? refreshError.message : "Unknown error"}`);
      }
    } catch (error) {
      setNotice(productSaveError(error, masterList ? "Unable to apply the master list." : "Unable to import products."));
    } finally {
      setIsImporting(false);
    }
  }

  if (!checkingAuth && storeConnection !== undefined && (!storeConnection || (changingStore && !signedIn))) {
    return <ConnectStoreScreen current={storeConnection} onCancel={changingStore ? () => setChangingStore(false) : undefined} />;
  }

  if (checkingAuth) {
    return <LoadingSkeleton />;
  }

  if (!signedIn) {
    return (
      <main className="min-h-screen bg-[#f4f8ff] text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        {!isOnline && <OfflineBanner />}
        <div className="grid min-h-screen lg:grid-cols-[1.05fr_0.95fr]">
          <section className="relative hidden overflow-hidden bg-[#1459d9] px-12 py-10 text-white lg:flex lg:flex-col lg:justify-between xl:px-20">
            <div className="absolute -right-28 -top-24 h-96 w-96 rounded-full border border-white/10" />
            <div className="absolute -right-12 -top-10 h-64 w-64 rounded-full border border-white/10" />
            <div className="absolute -bottom-40 -left-24 h-96 w-96 rounded-full bg-blue-400/20 blur-3xl" />
            <Brand light name={brandName} />
            <div className="relative z-10 max-w-xl pb-12">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3.5 py-2 text-sm font-medium text-blue-50">
                <Sparkles size={15} /> Your store, running smoothly
              </div>
              <h1 className="text-5xl font-semibold leading-[1.12] tracking-tight xl:text-6xl">
                Make every
                <br />
                checkout count.
              </h1>
              <p className="mt-5 max-w-md text-lg leading-8 text-blue-100">
                A calmer, quicker way to serve customers and keep your business moving.
              </p>
              <div className="mt-10 flex items-center gap-3">
                <div className="flex -space-x-2">
                  {["bg-sky-200", "bg-orange-200", "bg-violet-200"].map((color, index) => (
                    <span key={color} className={`grid h-9 w-9 place-items-center rounded-full border-2 border-[#1459d9] ${color} text-sm font-bold text-slate-700`}>
                      {["J", "M", "A"][index]}
                    </span>
                  ))}
                </div>
                <p className="text-sm text-blue-100">Made for the people behind the counter</p>
              </div>
            </div>
            <p className="relative z-10 text-xs text-blue-200">{brandName} · Point of sale</p>
          </section>

          <section className="relative flex items-center justify-center px-5 py-10 sm:px-10">
            <div className="absolute right-5 top-5"><ThemeSwitcher /></div>
            <div className="w-full max-w-[420px]">
              <div className="mb-10 lg:hidden"><Brand name={brandName} /></div>
              <div className="mb-8">
                <p className="mb-2 text-sm font-semibold text-blue-700 dark:text-blue-400">WELCOME BACK</p>
                <h2 className="text-3xl font-semibold tracking-tight">Sign in to your store</h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">Enter your work email and password. Admins and employees sign in here.</p>
                {storeConnection && (
                  <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 font-semibold text-slate-700 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700"><Store size={12} className="text-blue-600" />{storeConnection.name || projectRef(storeConnection.url)}</span>
                    <button type="button" onClick={() => setChangingStore(true)} className="font-semibold text-blue-700 hover:text-blue-800 dark:text-blue-400">Change store</button>
                  </p>
                )}
              </div>

              {adminCreated && <div role="status" className="mb-5 flex items-start gap-2.5 rounded-xl border border-emerald-100 bg-emerald-50 p-3.5 text-xs leading-5 text-emerald-800"><Check size={16} className="mt-0.5 shrink-0" />Your admin account is ready. Sign in to set up your store.</div>}

              <form onSubmit={signIn} className="space-y-4">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Work email
                  <input
                    required
                    autoFocus
                    type="email"
                    name="email"
                    autoComplete="username"
                    placeholder="you@yourstore.com"
                    className="mt-2 h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900 dark:focus:ring-blue-950"
                  />
                </label>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Password
                  <input
                    required
                    type="password"
                    name="password"
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    className="mt-2 h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900 dark:focus:ring-blue-950"
                  />
                </label>
                <details className="text-xs text-slate-500">
                  <summary className="cursor-pointer font-medium text-blue-700 hover:text-blue-800 dark:text-blue-300">Forgot your password?</summary>
                  <p className="mt-2 leading-5">Ask your store administrator to set a new one from Employees → Set password. Administrators can reset their own password in the Supabase dashboard (Authentication → Users).</p>
                </details>
                {authError && <p role="alert" className="text-sm text-red-600">{authError}</p>}
                <button disabled={isLoading} type="submit" className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 disabled:opacity-60">
                  {isLoading ? "Signing in…" : <>Sign in <ArrowRight size={17} /><Kbd>Enter</Kbd></>}
                </button>
              </form>

              <div className="mt-6 flex items-start gap-2.5 rounded-xl border border-blue-100 bg-blue-50 p-3.5 text-xs leading-5 text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
                <ShieldCheck size={16} className="mt-0.5 shrink-0" />
                <span>You stay signed in on this computer until you sign out. Administrators create employee accounts from Employees.</span>
              </div>
              <p className="mt-5 text-center text-sm text-slate-500">Setting up a new store? <Link href="/setup-admin" className="font-semibold text-blue-700 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300">Create the first admin</Link></p>
              <p className="mt-8 text-center text-xs text-slate-400">Secure checkout starts here · {brandName}{APP_VERSION && <> · v{APP_VERSION}</>}</p>
            </div>
          </section>
        </div>
      </main>
    );
  }

  const isAdmin = role === "admin";
  const currentView = isAdmin ? activePage : activePage === "inventory" || activePage === "employees" ? "pos" : activePage;

  return (
    <StoreNameContext.Provider value={brandName}>
    <main className={`min-h-screen bg-[#f5f8fd] text-slate-900 dark:bg-slate-950 dark:text-slate-100 ${currentView === "analytics" ? "analytics-report-print-mode" : ""}`}>
      <div className="flex min-h-screen">
        <div className="min-w-0 flex-1">
          <header ref={headerRef} className="sticky top-0 z-20 border-b border-slate-100 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
            {updateStatus?.state === "ready" && <UpdateReadyBar version={updateStatus.version} busy={installingUpdate} onRestart={restartToUpdate} testFeed={updateStatus.testFeed} />}
            {offlineSession && isOnline && <ReconnectBanner email={accountEmail} onReconnect={reconnectOnline} />}
            {!connected && <OfflineBanner signedIn waiting={waitingToSync} />}
            <div className={`flex h-[88px] items-center gap-3 px-4 sm:px-8 ${currentView === "pos" ? "xl:px-9" : "xl:px-14"}`}>
            <div className="shrink-0 xl:hidden"><Brand compact name={brandName} /></div>
            <div className="hidden shrink-0 xl:block"><Brand name={brandName} /></div>
            {/* Page icons; the name (and Alt+N shortcut) appears on hover or focus. */}
            <nav aria-label="Workspace navigation" className="ml-2 hidden flex-1 items-center gap-1.5 md:flex xl:ml-8">
              {navItems.map((item, index) => <NavIcon key={item.page} icon={item.icon} label={item.label} shortcut={`Alt+${index + 1}`} active={currentView === item.page} onClick={() => goToPage(item.page)} />)}
            </nav>
            <button type="button" onClick={() => { goToPage("pos"); window.setTimeout(() => { searchInputRef.current?.focus(); searchInputRef.current?.select(); }, 0); }} aria-keyshortcuts="Control+K" className="ml-auto hidden h-12 w-[320px] shrink-0 items-center gap-3 rounded-xl border border-slate-200 px-4 text-left text-base text-slate-400 transition hover:border-blue-200 dark:border-slate-700 xl:flex">
              <Search size={20} className="shrink-0" /><span className="flex-1 truncate">Search products or scan…</span><kbd className="rounded border border-slate-200 px-1.5 py-0.5 font-mono text-[11px] text-slate-400 dark:border-slate-700">Ctrl K</kbd>
            </button>
            <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-3 xl:ml-3">
              <button type="button" aria-label="Open help center (F1)" title="Help (F1)" aria-keyshortcuts="F1" onClick={() => setShowHelpCenter(true)} className="grid h-12 w-12 place-items-center rounded-xl text-slate-500 transition hover:bg-slate-50 dark:hover:bg-slate-800"><CircleHelp size={25} /></button>
              <div className="hidden items-center gap-2 rounded-xl bg-slate-50 px-3.5 py-2.5 text-sm font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300 lg:flex">
                <Clock3 size={17} className="text-slate-400" />
                {new Date().toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric", timeZone: "Asia/Manila" })}
              </div>
              <DrawerStatusButton session={cashSession} onOpen={() => setShowOpenDrawer(true)} onCount={() => setShowCashCount(true)} />
              <SyncStatusButton isOnline={connected} isSyncing={isSyncing} waiting={waitingToSync} failed={failedToSync} onClick={() => setShowSyncPanel(true)} />
              <div className="relative">
                <button type="button" aria-label="Notifications" aria-expanded={showNotifications} onClick={() => setShowNotifications((current) => !current)} className="relative grid h-12 w-12 place-items-center rounded-xl text-slate-500 transition hover:bg-slate-50 dark:hover:bg-slate-800">
                  <Bell size={25} />
                  {unreadNotificationCount > 0 && <span className="absolute -right-0.5 -top-0.5 grid min-h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white ring-2 ring-white dark:ring-slate-900">{unreadNotificationCount > 9 ? "9+" : unreadNotificationCount}</span>}
                </button>
                {showNotifications && <div className="absolute right-0 top-14 z-50 w-[min(340px,calc(100vw-32px))] overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
                  <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-700"><div><p className="text-sm font-semibold">Notifications</p><p className="text-[11px] text-slate-400">{unreadNotificationCount} unread</p></div><button type="button" onClick={() => setReadNotifications(notifications.map((item) => item.id))} className="text-[11px] font-semibold text-blue-600 hover:text-blue-700">Mark all read</button></div>
                  {notifications.length > 0 ? <div className="max-h-80 overflow-y-auto">{notifications.map((item) => {
                    const unread = !readNotifications.includes(item.id);
                    return <button type="button" key={item.id} onClick={() => { setReadNotifications((current) => current.includes(item.id) ? current : [...current, item.id]); setActivePage(item.page); setShowNotifications(false); }} className={`flex w-full items-start gap-3 border-b border-slate-50 px-4 py-3 text-left last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800 ${unread ? "bg-blue-50/60 dark:bg-blue-950/20" : ""}`}><span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${unread ? "bg-blue-600" : "bg-slate-200"}`} /><span><span className="block text-xs font-semibold">{item.title}</span><span className="mt-1 block text-[11px] leading-4 text-slate-500">{item.message}</span></span></button>;
                  })}</div> : <div className="px-4 py-8 text-center text-xs text-slate-400"><Bell size={20} className="mx-auto mb-2 opacity-50" />You’re all caught up.</div>}
                </div>}
              </div>
              <ThemeSwitcher />
              <div className="hidden h-8 w-px bg-slate-100 dark:bg-slate-800 sm:block" />
              <div className="flex items-center gap-2.5">
                <div className="grid h-11 w-11 place-items-center rounded-full bg-blue-100 text-sm font-bold text-blue-700">{employeeName.split(" ").map((part) => part[0]).join("").slice(0, 2)}</div>
                <div className="hidden xl:block">
                  <p className="text-sm font-semibold">{employeeName}</p>
                  <p className="mt-0.5 text-xs capitalize text-slate-400">{role}</p>
                </div>
                <button type="button" aria-label="Sign out" title="Sign out" onClick={() => void signOut()} className="rounded-xl p-2.5 text-slate-400 hover:bg-slate-50 hover:text-slate-700 dark:hover:bg-slate-800"><LogOut size={22} /></button>
              </div>
            </div>
            </div>
            {/* Phones: the same icons on a second row of the sticky header. */}
            <nav aria-label="Workspace navigation" className="flex justify-around gap-1 overflow-x-auto border-t border-slate-100 px-2 py-1.5 dark:border-slate-800 md:hidden">
              {navItems.map((item) => <NavIcon key={item.page} icon={item.icon} label={item.label} active={currentView === item.page} onClick={() => goToPage(item.page)} />)}
            </nav>
          </header>

          <div className={currentView === "pos" ? "p-4 sm:p-7 xl:p-9" : "px-4 py-7 sm:px-8 sm:py-9 xl:px-14 xl:py-11"}>
            {notice && (
              <div role="status" className={`mb-5 flex items-center justify-between rounded-xl border px-4 py-3 text-sm ${noticeIsSuccess ? "border-emerald-100 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200" : "border-blue-100 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-200"}`}>
                <span className="flex items-center gap-2">{noticeIsSuccess ? <Check size={16} className="shrink-0" /> : <Info size={16} className="shrink-0" />}{notice}</span>
                <span className="flex shrink-0 items-center gap-2">
                  {noticeAction?.notice === notice && <button type="button" onClick={() => { const action = noticeAction; setNoticeAction(null); setNotice(""); action.run(); }} className="rounded-lg border border-current px-2.5 py-1 text-xs font-semibold hover:bg-white/60 dark:hover:bg-white/10">{noticeAction.label}</button>}
                  <button type="button" aria-label="Dismiss notification" onClick={() => setNotice("")}><X size={16} /></button>
                </span>
              </div>
            )}
            {editingProductImage && (
              <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/40 p-4" onClick={(event) => { if (event.target === event.currentTarget && !isLoading) { setEditingProductImage(null); setSelectedProductImage(null); setRemoveExistingProductImage(false); } }}>
                <div role="dialog" aria-modal="true" aria-labelledby="edit-product-image-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
                  <div className="mb-5 flex items-start justify-between">
                    <div><p className="text-xs font-semibold text-blue-600">INVENTORY</p><h2 id="edit-product-image-title" className="mt-1 text-xl font-semibold">Update product image</h2><p className="mt-1 text-sm text-slate-500">{editingProductImage.name}</p></div>
                    <button type="button" aria-label="Close dialog" disabled={isLoading} onClick={() => { setEditingProductImage(null); setSelectedProductImage(null); setRemoveExistingProductImage(false); }} className="rounded-lg p-2 text-slate-400 hover:bg-slate-50 disabled:opacity-50"><X size={18} /></button>
                  </div>
                  <form onSubmit={saveProductImage} className="space-y-5">
                    <ProductImagePicker
                      selectedIcon={selectedProductIcon}
                      selectedImage={selectedProductImage}
                      existingImageUrl={editingProductImage.imageUrl}
                      existingImageRemoved={removeExistingProductImage}
                      onRemoveExisting={() => setRemoveExistingProductImage(true)}
                      onIconChange={(icon) => { setSelectedProductIcon(icon); setRemoveExistingProductImage(true); }}
                      onImageChange={setSelectedProductImage}
                    />
                    <div className="flex gap-3">
                      <button type="button" disabled={isLoading} onClick={() => { setEditingProductImage(null); setSelectedProductImage(null); setRemoveExistingProductImage(false); }} aria-keyshortcuts="Escape" className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">Cancel <Kbd>Esc</Kbd></button>
                      <button type="submit" disabled={isLoading} className="h-11 flex-1 rounded-lg bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{isLoading ? "Saving…" : "Save image"}</button>
                    </div>
                  </form>
                </div>
              </div>
            )}
            {showHelpCenter && <HelpCenterDialog
              onClose={() => setShowHelpCenter(false)}
              showInventory={isAdmin}
              onNavigate={(page) => { setShowHelpCenter(false); setActivePage(page); }}
            />}

            {currentView === "analytics" && isAdmin ? (
              <AnalyticsReportsView
                period={profitReportPeriod}
                onPeriodChange={setProfitReportPeriod}
                rows={profitReport}
                isLoading={profitReportLoading}
                error={profitReportError}
                lastUpdated={profitReportUpdatedAt}
                onRefresh={() => void refreshProfitReport()}
              />
            ) : currentView === "dashboard" && isAdmin && dashboardStats ? (
              <AdminOverview
                stats={dashboardStats}
                products={products}
                orders={displayOrders}
                salesChart={salesChart}
                period={salesPeriod}
                lastRefreshedAt={lastRefreshedAt}
                isRefreshing={isRefreshing}
                userName={employeeName}
                onNewSale={() => setActivePage("pos")}
                onPeriodChange={(period) => void refreshDashboard(period)}
                onRefresh={() => void refreshDashboard()}
                onViewAnalytics={() => setActivePage("analytics")}
                onViewInventory={() => setActivePage("inventory")}
                onViewOrders={() => setActivePage("orders")}
              />
            ) : currentView === "employees" && isAdmin ? (
              <EmployeeView
                employees={employees}
                onAdd={() => setShowAddEmployee(true)}
                onRemove={removeEmployee}
                onSetPassword={setPasswordEmployee}
              />
            ) : currentView === "account" ? (
              <>
              <section className="mx-auto mb-5 max-w-3xl space-y-5">
                <HardwareSettingsCard settings={hardware} onChange={(settings) => { setHardware(settings); saveHardwareSettings(settings); }} onTestPrint={() => void printTestReceipt()} onTestDrawer={() => void openDrawer(true)} />
                {supportsLiveUpdates() && <UpdatesCard status={updateStatus} onCheck={checkForAppUpdates} onInstall={restartToUpdate} />}
                <StoreDetailsCard details={storeDetails} canEdit={isAdmin && connected && !offlineSession} onSave={saveStoreDetails} />
              </section>
              <AccountView
                email={accountEmail}
                name={accountName}
                role={role}
                isProcessing={isLoading}
                salesResetConfirmation={salesResetConfirmation}
                onSalesResetConfirmationChange={setSalesResetConfirmation}
                onUpdateEmail={updateAccountEmail}
                onUpdatePassword={updateAccountPassword}
                onUpdateName={updateAccountName}
                onResetSalesHistory={resetSalesHistory}
              />
              </>
            ) : currentView === "inventory" && isAdmin ? (
              <InventoryView
                products={products}
                shortfalls={shortfalls}
                onResolveShortfalls={(ids) => void resolveShortfalls(ids)}
                onAdd={() => { setSelectedProductIcon("auto"); setSelectedProductImage(null); setShowAddProduct(true); }}
                onEditPrices={setEditingProductPrices}
                onEditImage={(product) => {
                  setSelectedProductIcon(product.imageIcon);
                  setSelectedProductImage(null);
                  setRemoveExistingProductImage(false);
                  setEditingProductImage(product);
                }}
                onRemove={removeProduct}
                onImport={() => setShowImport(true)}
                onRestock={setRestockProduct}
              />
            ) : currentView === "orders" ? (
              <OrdersView orders={displayOrders} isAdmin={isAdmin} userName={employeeName} connected={connected && !offlineSession} onPrint={(order) => void printReceipt(order, true)} onVoid={setVoidTarget} onRefund={setRefundTarget} />
            ) : currentView === "shifts" ? (
              <ShiftHistoryView isAdmin={isAdmin} />
            ) : (
              <div ref={posGridRef} className="grid items-start gap-5 pb-20 md:grid-cols-[var(--pos-columns)] md:pb-0 xl:gap-6" style={{ "--pos-columns": posLayout.cartSide === "left" ? `minmax(0,${posLayout.cartShare}fr) minmax(0,${100 - posLayout.cartShare}fr)` : `minmax(0,${100 - posLayout.cartShare}fr) minmax(0,${posLayout.cartShare}fr)` } as CSSProperties}>
                {/* Current order: on the left by default (Customize or F10 in the
                    desktop app swaps sides), and the larger side.
                    Phones: a drawer that slides in from the right.
                    Tablets and up: a sticky column that fills the viewport
                    height, so Checkout stays visible however long the order is. */}
                {showMobileCart && <div aria-hidden="true" onClick={() => setShowMobileCart(false)} className="fixed inset-0 z-40 bg-slate-950/40 md:hidden" />}
                <div
                  id="cart-panel"
                  ref={cartWrapperRef}
                  className={`fixed inset-y-0 right-0 z-50 w-[min(440px,92vw)] transition-[transform,visibility] duration-200 md:visible md:sticky md:bottom-auto md:right-auto md:z-auto md:top-[calc(var(--pos-header-height,72px)+16px)] md:h-[calc(100dvh-var(--cart-top,88px)-16px)] md:w-auto md:translate-x-0 md:transition-none ${posLayout.cartSide === "right" ? "md:order-2" : ""} ${showMobileCart ? "visible translate-x-0" : "invisible translate-x-full"}`}
                >
                  <CartResizeHandle share={posLayout.cartShare} side={posLayout.cartSide} containerRef={posGridRef} onResize={(cartShare) => updateLayout({ ...posLayout, cartShare })} />
                  <CartPanel
                    textScale={posLayout.textScale}
                    lines={cartLines.map((line) => ({ ...line, product: { ...line.product, name: displayName(line.product) } }))}
                    count={itemCount}
                    subtotal={subtotal}
                    total={total}
                    onChange={changeQuantity}
                    onCheckout={() => { setNotice(""); setShowMobileCart(false); setShowCheckoutDialog(true); }}
                    isProcessing={isLoading}
                    onClear={clearOrderWithUndo}
                    onOpenDrawer={() => void openDrawer(true)}
                    onSuspend={() => setShowSuspend(true)}
                    onRecall={() => setShowRecall(true)}
                    heldCount={suspendedOrders.length}
                    desktopKeys={isDesktopApp()}
                    selectedKey={selectedLine}
                    onSelect={setSelectedLine}
                    priceOf={unitPrice}
                    hasWholesale={wholesaleLines.length > 0}
                    wholesaleMode={wholesaleMode}
                    onToggleWholesale={toggleWholesaleMode}
                    savings={wholesaleSavings}
                    onClose={() => setShowMobileCart(false)}
                    customItems={customItems}
                    onCustomChange={changeCustomQuantity}
                    showImages={showImages}
                  />
                </div>

                {/* Text size: CSS zoom scales text and controls together (many sizes are in px). */}
                <section aria-label="Products" className="min-w-0" style={{ zoom: posLayout.textScale / 100 }}>
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <div className="flex h-10 min-w-[200px] flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 focus-within:border-blue-400 dark:border-slate-700 dark:bg-slate-900">
                      <Search size={16} className="shrink-0 text-slate-400" />
                      {entryQuantity !== null && <span className="shrink-0 rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">×{entryQuantity}</span>}
                      <input
                        ref={searchInputRef}
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        onKeyDown={(event) => {
                          // With a search typed, ↓ goes to the matching products; with an
                          // empty search it moves through the order (handled globally).
                          if (event.key === "ArrowDown" && (search || !(cartLines.length + customItems.length))) {
                            event.preventDefault();
                            document.querySelector<HTMLButtonElement>("[data-product-card]:not(:disabled)")?.focus();
                          } else if (event.key === "Enter") {
                            event.preventDefault();
                            submitSaleEntry();
                          }
                        }}
                        placeholder="Search, scan, or 24/barcode"
                        aria-label="Search products or scan a barcode. Prefix a quantity and slash to add several, for example 24/ then the barcode."
                        aria-keyshortcuts="F2"
                        autoComplete="off"
                        className="w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-slate-400"
                      />
                      {search ? <button type="button" aria-label="Clear search" onClick={() => setSearch("")} className="flex items-center gap-1 text-slate-400"><Kbd>Esc</Kbd><X size={14} /></button> : <Kbd className="text-slate-400">F2</Kbd>}
                    </div>
                    {productCategories.length > 1 && (
                      <select value={activeCategory} onChange={(event) => setCategory(event.target.value)} aria-label="Filter by category" className="h-10 max-w-[180px] rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                        {categories.map((item) => <option key={item} value={item}>{item}</option>)}
                      </select>
                    )}
                  </div>
                  <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
                    <p className="hidden min-w-0 flex-1 items-center gap-1.5 text-[11px] text-slate-400 lg:flex"><ScanBarcode size={13} className="shrink-0" /><span className="truncate">Scan to add. Type <code className="rounded bg-slate-100 px-1 font-mono text-slate-500 dark:bg-slate-800">24/</code> first to add several.</span></p>
                    <button type="button" aria-pressed={showLayoutPanel} onClick={() => setShowLayoutPanel((current) => !current)} className="flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-600 hover:border-blue-200 hover:text-blue-700 aria-pressed:border-blue-300 aria-pressed:text-blue-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"><LayoutGrid size={14} />Customize</button>
                    <button type="button" role="switch" aria-checked={showImages} aria-keyshortcuts="F8" onClick={toggleImages} className="flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-600 hover:border-blue-200 hover:text-blue-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                      {showImages ? <ImageIcon size={14} /> : <ImageOff size={14} />}{showImages ? "Images on" : "Images off"}<Kbd>F8</Kbd>
                    </button>
                    <button type="button" aria-keyshortcuts="F3" onClick={openQuickAdd} className="flex h-8 items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-300">
                      <Plus size={14} />Quick add<Kbd>F3</Kbd>
                    </button>
                  </div>

                  {!cashSession && (
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100">
                      <span><b className="font-semibold">Start your shift:</b> count the opening cash so the drawer can be balanced at the end of the shift.</span>
                      <button type="button" onClick={() => setShowOpenDrawer(true)} className="h-8 rounded-lg bg-blue-600 px-3 font-semibold text-white hover:bg-blue-700">Start shift</button>
                    </div>
                  )}

                  {visibleProducts.length > POS_DISPLAY_LIMIT && <p className="mb-2 text-[11px] text-slate-500">Showing the first {POS_DISPLAY_LIMIT} of {visibleProducts.length.toLocaleString("en-PH")} products. Search, scan, or pick a category to find the others.</p>}
                  {visibleProducts.length === 0 ? (
                    <div className="grid min-h-64 place-items-center rounded-2xl border border-dashed border-slate-200 bg-white text-center dark:border-slate-700 dark:bg-slate-900">
                      <div><ShoppingBag size={28} className="mx-auto text-slate-300" /><p className="mt-3 text-sm font-semibold">No products found</p><p className="mt-1 text-xs text-slate-400">Try another name or category, or sell it as a custom item.</p><button type="button" onClick={openQuickAdd} className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700"><Plus size={14} /> Quick add custom item <Kbd>F3</Kbd></button></div>
                    </div>
                  ) : posLayout.productView === "list" ? (
                    <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-[0_2px_10px_rgba(20,45,90,0.025)] dark:border-slate-800 dark:bg-slate-900">
                      <div aria-hidden="true" className={`${productRowGrid} border-b border-slate-100 bg-slate-50/80 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:border-slate-800 dark:bg-slate-800/60`}>
                        <span className="hidden xl:block">Barcode</span><span>Product</span><span className="hidden text-right lg:block">Stock</span><span className="text-right">Price</span>
                      </div>
                      <div className="divide-y divide-slate-100 dark:divide-slate-800" onKeyDown={(event) => moveProductFocus(event, () => searchInputRef.current?.focus())}>
                        {shownProducts.map((product) => {
                          const left = product.stock - quantityInCart(product.id);
                          const showWholesale = wholesaleMode && product.wholesalePrice > 0;
                          return (
                            <button type="button" key={product.id} data-product-card disabled={left <= 0} onClick={() => addToCart(product)} className={`${productRowGrid} w-full items-center px-4 text-left outline-none transition hover:bg-blue-50/60 focus-visible:bg-blue-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-300 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-slate-800/60 dark:focus-visible:bg-slate-800 ${showImages ? "py-2" : "py-2.5"}`}>
                              <span className="hidden truncate font-mono text-[11px] text-slate-500 xl:block">{product.barcode || "—"}</span>
                              <span className="flex min-w-0 items-center gap-2.5">
                                {showImages && <span className="hidden shrink-0 lg:block"><ProductArtwork product={product} className="h-9 w-9 rounded-lg text-lg" /></span>}
                                <span className="min-w-0"><span className="block truncate text-[13px] font-semibold text-slate-800 dark:text-slate-100">{displayName(product)}</span><span className="block truncate text-[10px] font-medium uppercase tracking-wide text-slate-400">{product.category}<span className="normal-case tracking-normal lg:hidden"> · <span className="font-mono">{left}</span> left</span></span></span>
                              </span>
                              <span className={`hidden text-right font-mono text-xs font-semibold tabular-nums lg:block ${left <= 0 ? "text-red-500" : left < 10 ? "text-amber-600" : "text-slate-600 dark:text-slate-300"}`}>{left}</span>
                              <span className="text-right">{showWholesale ? <><span className="block font-mono text-[13px] font-bold tabular-nums text-black dark:text-white">{money(product.wholesalePrice)}</span><span className="block text-[9px] font-semibold uppercase tracking-wide text-emerald-600">Wholesale</span></> : <><span className="block font-mono text-[13px] font-bold tabular-nums text-black dark:text-white">{money(product.price)}</span>{wholesaleMode && <span className="block text-[9px] font-semibold uppercase tracking-wide text-slate-400">Retail only</span>}</>}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(${posLayout.tileSize}px, 100%), 1fr))` }} onKeyDown={(event) => moveProductFocus(event, () => searchInputRef.current?.focus())}>
                      {shownProducts.map((product) => {
                        const unavailable = product.stock <= quantityInCart(product.id);
                        const showWholesale = wholesaleMode && product.wholesalePrice > 0;
                        return (
                          <button type="button" key={product.id} data-product-card disabled={unavailable} onClick={() => addToCart(product)} className={`group relative rounded-2xl border border-slate-100 bg-white text-left shadow-[0_2px_10px_rgba(20,45,90,0.025)] transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50 ${showImages ? "p-3 sm:p-4" : "px-3 py-2.5"}`}>
                            {showImages && <ProductArtwork product={product} className={`mb-3 aspect-[1.6/1] rounded-xl text-[42px] transition-transform group-hover:scale-[1.015]`} />}
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-slate-800">{displayName(product)}</p>
                                <p className="mt-1 text-[11px] text-slate-400">{product.category} · <span className="font-mono">{product.stock - quantityInCart(product.id)}</span> left</p>
                              </div>
                              <span className="shrink-0 text-right">{showWholesale ? <><span className="block font-mono text-sm font-bold text-black dark:text-white">{money(product.wholesalePrice)}</span><span className="block text-[10px] font-semibold uppercase tracking-wide text-emerald-600">Wholesale</span></> : <><span className="block font-mono text-sm font-bold text-black dark:text-white">{money(product.price)}</span>{wholesaleMode && <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Retail only</span>}</>}</span>
                            </div>
                            {showImages && <span className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-full bg-white text-blue-600 opacity-0 shadow-sm transition group-hover:opacity-100"><Plus size={16} /></span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>

                <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-100 bg-white/95 px-4 py-3 shadow-[0_-4px_16px_rgba(20,45,90,0.06)] backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 md:hidden">
                  <button type="button" aria-controls="cart-panel" aria-expanded={showMobileCart} onClick={() => setShowMobileCart(true)} className="flex h-12 w-full items-center gap-3 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-lg shadow-blue-600/20">
                    <span className="relative"><ShoppingCart size={19} />{itemCount > 0 && <span className="absolute -right-2 -top-2 grid min-h-4 min-w-4 place-items-center rounded-full bg-white px-1 text-[9px] font-bold text-blue-700">{itemCount > 99 ? "99+" : itemCount}</span>}</span>
                    <span className="flex-1 text-left">{itemCount ? "View order" : "Order is empty"}{wholesaleMode && <span className="ml-2 rounded-full bg-white/20 px-2 py-0.5 text-[10px]">Wholesale mode</span>}</span>
                    <span>{money(total)}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
          <footer className="px-4 pb-6 text-center text-[10px] text-slate-400 sm:px-7 xl:px-9">{brandName} · Point of sale{APP_VERSION && <> · v{APP_VERSION}</>}</footer>
        </div>
      </div>

      {showCheckoutDialog && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/50 p-4" onClick={(event) => { if (event.target === event.currentTarget && !isLoading) setShowCheckoutDialog(false); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="checkout-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-start justify-between">
              <div><p className="text-xs font-semibold text-blue-600">PAYMENT</p><h2 id="checkout-title" className="mt-1 text-xl font-semibold">Complete checkout</h2><p className="mt-1 text-sm text-slate-500">{itemCount} item{itemCount === 1 ? "" : "s"} · <span className="font-mono">{money(total)}</span> due</p></div>
              <button type="button" aria-label="Close checkout dialog" disabled={isLoading} onClick={() => setShowCheckoutDialog(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-50 disabled:opacity-50"><X size={18} /></button>
            </div>
            <form noValidate onSubmit={(event) => { event.preventDefault(); if (!isLoading) void checkout(); }}>
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-semibold text-slate-700">Choose payment method</legend>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { method: "cash", label: "Cash", Icon: Banknote },
                  { method: "e_wallet", label: "E-Wallet", Icon: WalletCards },
                  { method: "card", label: "Card", Icon: CreditCard },
                ] as const).map(({ method, label, Icon }, index) => (
                  <button key={method} type="button" aria-pressed={paymentMethod === method} aria-keyshortcuts={`F${index + 1}`} onClick={() => choosePaymentMethod(method)} className={`flex h-14 flex-col items-center justify-center gap-1 rounded-lg border text-xs font-semibold ${paymentMethod === method ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-500 hover:border-blue-200"}`}><Icon size={16} />{label}<Kbd>F{index + 1}</Kbd></button>
                ))}
              </div>
            </fieldset>
            {/* Wholesale is chosen per item while ringing up (Wholesale mode, F7); this summarises it. */}
            {wholesaleLines.length > 0 && (
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-[11px] leading-4 dark:border-emerald-800 dark:bg-emerald-950/50">
                <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">Wholesale prices on {wholesaleLines.reduce((sum, line) => sum + line.quantity, 0)} item{wholesaleLines.reduce((sum, line) => sum + line.quantity, 0) === 1 ? "" : "s"}</p>
                <p className="mt-0.5 text-emerald-700 dark:text-emerald-300">{wholesaleSavings > 0 ? `Saving ${money(wholesaleSavings)} off retail (${money(retailTotal)}).` : "No savings: none of these items has a wholesale price."} Other items are charged retail.</p>
                {itemsWithoutWholesalePrice.length > 0 && <p className="mt-2 border-t border-emerald-200 pt-2 text-amber-700 dark:border-emerald-800 dark:text-amber-300">No wholesale price set — charged at retail: {itemsWithoutWholesalePrice.map((product) => product.name).join(", ")}</p>}
              </div>
            )}
            <button type="button" role="switch" aria-checked={printThisSale} aria-keyshortcuts="F7" onClick={() => setPrintThisSale((current) => !current)} className={`mt-2 flex w-full items-center gap-3 rounded-xl border p-3 text-left ${printThisSale ? "border-blue-200 bg-blue-50/70 dark:border-blue-800 dark:bg-blue-950/50" : "border-slate-200 dark:border-slate-700"}`}>
              <span className={`relative h-5 w-9 shrink-0 rounded-full transition ${printThisSale ? "bg-blue-600" : "bg-slate-300"}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${printThisSale ? "left-[18px]" : "left-0.5"}`} /></span>
              <span className="flex-1"><span className="flex items-center gap-1.5 text-sm font-semibold text-slate-700"><Printer size={14} /> Print receipt</span><span className="block text-[11px] text-slate-500">{printThisSale ? "A receipt prints when the payment is confirmed" : "No receipt for this sale (reprint any time from Orders)"}</span></span>
              <Kbd className="text-slate-500">F7</Kbd>
            </button>
            {paymentMethod === "cash" ? (
              <div className="mt-4 space-y-3 rounded-xl bg-slate-50 p-4">
                <label className="block text-sm font-medium text-slate-700">Cash received (₱)
                  <input autoFocus required type="number" min={total} step="0.01" inputMode="decimal" value={cashReceived} onChange={(event) => setCashReceived(event.currentTarget.value)} placeholder={total.toFixed(2)} className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50" />
                </label>
                <div className="flex items-center justify-between border-t border-slate-200 pt-3 text-sm"><span className="font-medium text-slate-500">Change due</span><span className="font-mono font-bold text-slate-900">{money(Math.max(0, (Number(cashReceived) || 0) - total))}</span></div>
              </div>
            ) : (
              <label className="mt-4 block text-sm font-medium text-slate-700">{paymentMethod === "e_wallet" ? "E-Wallet" : "Card"} reference · last 4 digits
                <input autoFocus required type="text" inputMode="numeric" autoComplete="off" maxLength={4} pattern="[0-9]{4}" value={paymentReferenceLast4} onChange={(event) => setPaymentReferenceLast4(event.currentTarget.value.replace(/\D/g, "").slice(0, 4))} placeholder="1234" className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 px-3 font-mono text-sm tracking-[0.2em] outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50" />
              </label>
            )}
            {notice && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{notice}</p>}
            <div className="mt-5 flex gap-3">
              <button type="button" disabled={isLoading} onClick={() => { setShowCheckoutDialog(false); setNotice(""); }} aria-keyshortcuts="Escape" className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">Cancel <Kbd>Esc</Kbd></button>
              <button type="submit" disabled={isLoading || !itemCount} aria-keyshortcuts="Enter" className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60">{isLoading ? "Processing…" : <>Confirm payment <Kbd>Enter</Kbd></>}</button>
            </div>
            </form>
          </div>
        </div>
      )}
      {showAddProduct && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/40 p-4" onClick={(event) => { if (event.target === event.currentTarget) closeAddProduct(); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="add-product-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-start justify-between">
              <div><p className="text-xs font-semibold text-blue-600">INVENTORY</p><h2 id="add-product-title" className="mt-1 text-xl font-semibold">Add a product</h2></div>
              <button type="button" aria-label="Close dialog" onClick={closeAddProduct} className="rounded-lg p-2 text-slate-400 hover:bg-slate-50"><X size={18} /></button>
            </div>
            <form onSubmit={addProduct} onInput={markDirty} className="max-h-[80vh] space-y-4 overflow-y-auto pr-1">
              <label className="block text-sm font-medium text-slate-700">Product name<input required name="name" placeholder="e.g. Sardines (155 g)" className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50" /></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm font-medium text-slate-700">Cost price (₱)<input required name="cost_price" type="number" min="0" step="0.01" placeholder="18.00" className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50" /></label>
                <label className="block text-sm font-medium text-slate-700">Wholesale price (₱) <span className="font-normal text-slate-400">optional</span><input name="wholesale_price" type="number" min="0" step="0.01" placeholder="Blank = retail only" title="Leave blank for products not sold wholesale, like single sachets" className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50" /></label>
                <label className="block text-sm font-medium text-slate-700">Retail price (₱)<input required name="price" type="number" min="0.01" step="0.01" placeholder="25.00" className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50" /></label>
                <label className="block text-sm font-medium text-slate-700">Stock<input required name="stock" type="number" min="0" step="1" placeholder="12" className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50" /></label>
              </div>
              <BarcodeField />
              <CategoryField categories={productCategories} />
              <ProductImagePicker
                selectedIcon={selectedProductIcon}
                selectedImage={selectedProductImage}
                onIconChange={setSelectedProductIcon}
                onImageChange={setSelectedProductImage}
                optional
              />
              <div className="flex gap-3 pt-2"><button type="button" onClick={closeAddProduct} aria-keyshortcuts="Escape" className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancel <Kbd>Esc</Kbd></button><button type="submit" aria-keyshortcuts="Enter" className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700">Add product <Kbd>Enter</Kbd></button></div>
            </form>
          </div>
        </div>
      )}
      {editingProductPrices && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/40 p-4" onClick={(event) => { if (event.target === event.currentTarget && !isLoading) closeEditPrices(); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="edit-product-prices-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-start justify-between">
              <div><p className="text-xs font-semibold text-blue-600">INVENTORY</p><h2 id="edit-product-prices-title" className="mt-1 text-xl font-semibold">Edit product details</h2><p className="mt-1 text-sm text-slate-500">{editingProductPrices.name}</p></div>
              <button type="button" aria-label="Close price editor" disabled={isLoading} onClick={closeEditPrices} className="rounded-lg p-2 text-slate-400 hover:bg-slate-50 disabled:opacity-50"><X size={18} /></button>
            </div>
            <form onSubmit={saveProductPrices} onInput={markDirty} className="space-y-4">
              <label className="block text-sm font-medium text-slate-700">Cost price (₱)<input required name="cost_price" type="number" min="0" step="0.01" defaultValue={editingProductPrices.costPriceKnown ? editingProductPrices.costPrice : ""} className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50" /></label>
              <label className="block text-sm font-medium text-slate-700">Wholesale price (₱) <span className="font-normal text-slate-400">optional</span><input name="wholesale_price" type="number" min="0" step="0.01" defaultValue={editingProductPrices.wholesalePrice > 0 ? editingProductPrices.wholesalePrice : ""} placeholder="Blank = retail only" title="Leave blank for products not sold wholesale, like single sachets" className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50" /></label>
              <label className="block text-sm font-medium text-slate-700">Retail price (₱)<input required name="price" type="number" min="0.01" step="0.01" defaultValue={editingProductPrices.price} className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50" /></label>
              <BarcodeField defaultValue={editingProductPrices.barcode ?? ""} />
              <CategoryField categories={productCategories} defaultValue={editingProductPrices.category} />
              <div className="flex gap-3 pt-2"><button type="button" disabled={isLoading} onClick={closeEditPrices} aria-keyshortcuts="Escape" className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">Cancel <Kbd>Esc</Kbd></button><button disabled={isLoading} type="submit" aria-keyshortcuts="Enter" className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{isLoading ? "Saving…" : <>Save <Kbd>Enter</Kbd></>}</button></div>
            </form>
          </div>
        </div>
      )}
      {showAddEmployee && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/40 p-4" onClick={(event) => { if (event.target === event.currentTarget) setShowAddEmployee(false); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="add-employee-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
            <div className="mb-5 flex items-start justify-between"><div><p className="text-xs font-semibold text-blue-600">TEAM ACCESS</p><h2 id="add-employee-title" className="mt-1 text-xl font-semibold">Create employee account</h2></div><button type="button" aria-label="Close dialog" onClick={() => setShowAddEmployee(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-50"><X size={18} /></button></div>
            <form onSubmit={createEmployee} className="space-y-4">
              <label className="block text-sm font-medium text-slate-700">Full name<input required maxLength={100} name="fullName" autoComplete="name" className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50" /></label>
              <label className="block text-sm font-medium text-slate-700">Work email<input required type="email" name="email" autoComplete="email" className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50" /></label>
              <label className="block text-sm font-medium text-slate-700">Temporary password<input required minLength={8} type="password" name="password" autoComplete="new-password" className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50" /><span className="mt-1 block text-xs font-normal text-slate-400">At least 8 characters. Share it securely with the employee.</span></label>
              <div className="flex gap-3 pt-2"><button type="button" onClick={() => setShowAddEmployee(false)} aria-keyshortcuts="Escape" className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancel <Kbd>Esc</Kbd></button><button disabled={isLoading} type="submit" aria-keyshortcuts="Enter" className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{isLoading ? "Creating…" : <>Create account <Kbd>Enter</Kbd></>}</button></div>
            </form>
          </div>
        </div>
      )}
      {completedSale && <SaleCompleteDialog sale={completedSale} onClose={(typed) => {
        setCompletedSale(null);
        // Typing or scanning straight away starts the next sale.
        if (typed) { setSearch(typed); window.setTimeout(() => searchInputRef.current?.focus(), 0); }
        else window.setTimeout(() => searchInputRef.current?.focus(), 0);
      }} />}
      {quickAdd && <QuickAddDialog initial={quickAdd} onAdd={addCustomItem} onClose={() => { if (okToDiscard()) setQuickAdd(null); }} />}
      {showOpenDrawer && <OpenDrawerDialog deviceLabel={hardware.deviceLabel} onOpen={startDrawerSession} onClose={() => setShowOpenDrawer(false)} />}
      {showCashCount && cashSession && <CashCountDialog session={cashSession} onConfirm={finishDrawerSession} onClose={() => setShowCashCount(false)} onOpenDrawer={() => void openDrawer(true)} />}
      {voidTarget && <VoidDialog order={voidTarget} onConfirm={(reason, printSlip) => voidSale(voidTarget, reason, printSlip)} onClose={() => setVoidTarget(null)} />}
      {refundTarget && <RefundDialog order={refundTarget} onConfirm={(refund) => refundSale(refundTarget, refund)} onClose={() => setRefundTarget(null)} />}
      {showSuspend && <SuspendDialog itemCount={itemCount} total={total} onSave={async (note) => { await suspendOrder(note); }} onClose={() => setShowSuspend(false)} />}
      {showRecall && <RecallDialog orders={suspendedOrders} currentHasItems={itemCount > 0} onResume={(id) => void resumeOrder(id)} onDiscard={(id) => void discardSuspendedOrder(id)} onClose={() => setShowRecall(false)} />}
      {showLayoutPanel && currentView === "pos" && <PosLayoutPanel layout={posLayout} onChange={updateLayout} onClose={() => setShowLayoutPanel(false)} swapHint={isDesktopApp() ? "F10" : undefined} />}
      {showSyncPanel && <SyncPanel sales={pendingOrders} isOnline={isOnline} isSyncing={isSyncing} currentUserId={userId} isAdmin={isAdmin} onSync={(retryFailed) => void syncPendingOrders({ retryFailed })} onClose={() => setShowSyncPanel(false)} />}
      {confirmAction && <ConfirmDialog action={confirmAction} isWorking={isLoading} onConfirm={() => void runConfirmAction()} onSecondary={() => void runConfirmAction(true)} onCancel={() => setConfirmAction(null)} />}
      {passwordEmployee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onClick={(event) => { if (event.target === event.currentTarget && !isLoading) setPasswordEmployee(null); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="set-password-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
            <div className="mb-5 flex items-start justify-between"><div><p className="text-xs font-semibold text-blue-600">TEAM ACCESS</p><h2 id="set-password-title" className="mt-1 text-xl font-semibold">Set a new password</h2><p className="mt-1 text-sm text-slate-500">{passwordEmployee.full_name} · {passwordEmployee.email}</p></div><button type="button" aria-label="Close dialog" disabled={isLoading} onClick={() => setPasswordEmployee(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-50 disabled:opacity-50 dark:hover:bg-slate-800"><X size={18} /></button></div>
            <form onSubmit={setEmployeePassword} className="space-y-4">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">New password<input required autoFocus minLength={8} maxLength={72} type="password" name="password" autoComplete="new-password" className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50 dark:border-slate-700 dark:bg-slate-950" /></label>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Confirm new password<input required minLength={8} maxLength={72} type="password" name="confirmPassword" autoComplete="new-password" className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50 dark:border-slate-700 dark:bg-slate-950" /><span className="mt-1 block text-xs font-normal text-slate-400">They’ll use it at their next sign-in. Sessions already open stay signed in.</span></label>
              <div className="flex gap-3 pt-2"><button type="button" disabled={isLoading} onClick={() => setPasswordEmployee(null)} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700">Cancel <Kbd>Esc</Kbd></button><button type="submit" disabled={isLoading} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{isLoading ? "Saving…" : <>Set password <Kbd>Enter</Kbd></>}</button></div>
            </form>
          </div>
        </div>
      )}
      {showImport && isAdmin && <ImportProductsDialog prepare={prepareImport} onImport={(preview, masterList) => void importProducts(preview, masterList)} onClose={() => setShowImport(false)} isImporting={isImporting} />}
      {restockProduct && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/40 p-4" onClick={(event) => { if (event.target === event.currentTarget) closeRestock(); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="restock-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
            <div className="mb-5 flex items-start justify-between"><div><p className="text-xs font-semibold text-blue-600">STOCK ADJUSTMENT</p><h2 id="restock-title" className="mt-1 text-xl font-semibold">Restock product</h2><p className="mt-1 text-sm text-slate-500">{restockProduct.name} · currently {restockProduct.stock} in stock</p></div><button type="button" aria-label="Close dialog" onClick={() => setRestockProduct(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-50"><X size={18} /></button></div>
            <form onSubmit={restock} onInput={markDirty} className="space-y-4">
              <label className="block text-sm font-medium text-slate-700">Units received<input required autoFocus name="quantity" type="number" min="1" max="1000000" step="1" placeholder="e.g. 24" className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50" /></label>
              <label className="block text-sm font-medium text-slate-700">Note <span className="font-normal text-slate-400">(optional)</span><input maxLength={200} name="note" placeholder="Supplier delivery, invoice number…" className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50" /></label>
              <div className="flex gap-3 pt-2"><button type="button" onClick={closeRestock} aria-keyshortcuts="Escape" className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancel <Kbd>Esc</Kbd></button><button disabled={isLoading} type="submit" aria-keyshortcuts="Enter" className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{isLoading ? "Updating…" : <>Add to stock <Kbd>Enter</Kbd></>}</button></div>
            </form>
          </div>
        </div>
      )}
    </main>
    </StoreNameContext.Provider>
  );
}

function Brand({ name, light = false, compact = false }: { name: string; light?: boolean; compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className={`grid shrink-0 place-items-center rounded-xl ${light ? "bg-white/15 text-white" : "bg-blue-600 text-white"} ${compact ? "h-11 w-11" : "h-12 w-12"}`}><Coffee size={compact ? 22 : 25} strokeWidth={2.2} /></div>
      {!compact && <div><p className={`max-w-[240px] truncate text-lg font-bold tracking-tight ${light ? "text-white" : "text-slate-900"}`}>{name}</p><p className={`mt-0.5 text-[11px] ${light ? "text-blue-200" : "text-slate-400"}`}>POINT OF SALE</p></div>}
    </div>
  );
}

// Icon-only navigation button; its name shows in a tooltip on hover or
// keyboard focus, and is always available to screen readers.
function NavIcon({ icon: Icon, label, shortcut, active, onClick }: { icon: LucideIcon; label: string; shortcut?: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      aria-keyshortcuts={shortcut}
      className={`group relative grid h-11 w-11 shrink-0 place-items-center rounded-xl border transition md:h-14 md:w-14 md:rounded-2xl ${active ? "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-300" : "border-transparent text-slate-400 hover:bg-slate-50 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"}`}
    >
      <Icon size={28} className="h-6 w-6 md:h-7 md:w-7" strokeWidth={active ? 2.1 : 1.8} />
      <span aria-hidden="true" className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[11px] font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-hover:delay-150 group-focus-visible:opacity-100 dark:bg-slate-700">
        {label}{shortcut && <span className="ml-1.5 text-slate-400">{shortcut}</span>}
      </span>
    </button>
  );
}

// Arrow keys move between product cards; columns are found from the cards'
// rendered positions, so this follows the responsive grid.
function moveProductFocus(event: ReactKeyboardEvent<HTMLDivElement>, onLeaveTop: () => void) {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  const cards = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-product-card]:not(:disabled)"));
  const index = cards.indexOf(document.activeElement as HTMLButtonElement);
  if (index === -1) return;
  event.preventDefault();
  const column = cards[index].offsetLeft;
  let next: HTMLButtonElement | undefined;
  if (event.key === "ArrowLeft") next = cards[index - 1];
  else if (event.key === "ArrowRight") next = cards[index + 1];
  else if (event.key === "ArrowDown") next = cards.slice(index + 1).find((card) => card.offsetLeft === column);
  else next = cards.slice(0, index).reverse().find((card) => card.offsetLeft === column);
  if (next) next.focus();
  else if (event.key === "ArrowUp") onLeaveTop();
}

// Keyboard-shortcut hint shown inside buttons, e.g. "Confirm payment [Enter]".
// Hidden on small screens, where a hardware keyboard is unlikely.
function Kbd({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={`hidden shrink-0 rounded border border-current px-1 py-px font-sans text-[9px] font-semibold uppercase leading-3 tracking-wide opacity-60 sm:inline-block ${className}`}>{children}</kbd>
  );
}

function AdminOverview({
  stats,
  products,
  orders,
  salesChart,
  period,
  lastRefreshedAt,
  isRefreshing,
  userName,
  onPeriodChange,
  onRefresh,
  onNewSale,
  onViewAnalytics,
  onViewInventory,
  onViewOrders,
}: {
  stats: DashboardStats;
  products: Product[];
  orders: Order[];
  salesChart: SalesChartPoint[];
  period: SalesPeriod;
  lastRefreshedAt: Date | null;
  isRefreshing: boolean;
  userName: string;
  onPeriodChange: (period: SalesPeriod) => void;
  onRefresh: () => void;
  onNewSale: () => void;
  onViewAnalytics: () => void;
  onViewInventory: () => void;
  onViewOrders: () => void;
}) {
  const lowStockProducts = products.filter((product) => product.stock <= 5);
  const outOfStock = lowStockProducts.filter((product) => product.stock <= 0).length;
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Manila" }).format(new Date()));
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const firstName = userName.trim().split(/\s+/)[0] || "there";
  const averageSale = stats.orders_today ? stats.sales_total / stats.orders_today : 0;
  const revenueTrend = salesChart.map((point) => point.cash + point.eWallet + point.card);
  const periodTag = period === "today" ? "TODAY" : period === "7days" ? "7 DAYS" : "30 DAYS";
  const twoDigits = (value: number) => String(value).padStart(2, "0");
  const topCards: { label: string; value: string; detail: string; icon: LucideIcon; chip: string }[] = [
    { label: "Sales", value: money(stats.sales_total), detail: periodLabel(period), icon: CircleDollarSign, chip: "bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-300" },
    { label: "Transactions", value: twoDigits(stats.orders_today), detail: period === "today" ? "Completed sales today" : `Completed sales · ${periodLabel(period)}`, icon: ReceiptText, chip: "bg-violet-50 text-violet-600 dark:bg-violet-950/60 dark:text-violet-300" },
    { label: "Average sale", value: money(averageSale), detail: "Per transaction", icon: BarChart3, chip: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-300" },
  ];
  const card = "rounded-2xl border border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900";
  return (
    <section>
      <PageHeader
        eyebrow={<><StoreName /> · Dashboard</>}
        icon={<Store size={12} />}
        title={`${greeting}, ${firstName}`}
        subtitle="Here’s what’s happening at your store."
        actions={<>
          <button type="button" onClick={onViewAnalytics} className={headerButton}><BarChart3 size={18} /> Reports</button>
          <button type="button" onClick={onViewInventory} className={headerButton}><Boxes size={18} /> Inventory</button>
          <button type="button" onClick={onNewSale} className={headerPrimaryButton}><Plus size={18} /> New sale</button>
        </>}
      />

      {lowStockProducts.length > 0 && (
        <div role="status" className="mb-7 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-3.5 text-[15px] font-medium text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          <TriangleAlert size={20} className="shrink-0" />
          <span className="flex-1">{outOfStock > 0 ? `${outOfStock} product${outOfStock === 1 ? " is" : "s are"} out of stock` : ""}{outOfStock > 0 && lowStockProducts.length > outOfStock ? " and " : ""}{lowStockProducts.length > outOfStock ? `${lowStockProducts.length - outOfStock} ${lowStockProducts.length - outOfStock === 1 ? "is" : "are"} running low` : ""}. Restock before they run out.</span>
          <button type="button" onClick={onViewInventory} className="shrink-0 font-semibold hover:underline">View</button>
        </div>
      )}

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500">
        <span className="flex items-center gap-2"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />Updates every 30 seconds · last {lastRefreshedAt ? lastRefreshedAt.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", second: "2-digit", timeZone: "Asia/Manila" }) : "—"}</span>
        <span className="flex items-center gap-2">
          <select aria-label="Sales report period" value={period} onChange={(event) => onPeriodChange(event.target.value as SalesPeriod)} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-900">
            <option value="today">Today</option><option value="7days">Last 7 days</option><option value="30days">Last 30 days</option>
          </select>
          <button type="button" onClick={onRefresh} disabled={isRefreshing} className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 hover:border-blue-200 hover:text-blue-700 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"><RefreshCw size={15} className={isRefreshing ? "animate-spin" : ""} /> Refresh</button>
        </span>
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        {topCards.map(({ label, value, detail, icon: Icon, chip }) => (
          <div key={label} className={`${card} p-6`}>
            <div className="flex items-start justify-between gap-3"><span className="text-base text-slate-600 dark:text-slate-300">{label}</span><span className={`grid h-10 w-10 place-items-center rounded-full ${chip}`}><Icon size={19} /></span></div>
            <p className="mt-4 font-mono text-[34px] font-bold leading-none tracking-tight">{value}</p>
            <p className="mt-4 text-[13px] text-slate-500">{detail}</p>
          </div>
        ))}
      </div>

      <div className="mt-5 grid gap-5 md:grid-cols-3">
        <div className={`${card} p-6`}>
          <div className="flex items-center justify-between gap-3"><span className="flex items-center gap-2 text-base text-slate-600 dark:text-slate-300"><CircleDollarSign size={17} className="text-slate-400" />Revenue trend</span><span className="text-[11px] font-bold tracking-wider text-slate-400">{periodTag}</span></div>
          <div className="mt-4 flex items-end justify-between gap-4"><p className="font-mono text-[30px] font-bold leading-none">{money(stats.sales_total)}</p><Sparkline values={revenueTrend} className="text-blue-600 dark:text-blue-400" /></div>
          <p className="mt-4 inline-flex rounded-md bg-slate-100 px-2 py-1 text-[13px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">{revenueTrend.length > 1 ? `${revenueTrend.filter((value) => value > 0).length} of ${revenueTrend.length} ${period === "today" ? "hours" : "days"} with sales` : "Not enough data for a trend yet"}</p>
        </div>
        <div className={`${card} p-6`}>
          <div className="flex items-center justify-between gap-3"><span className="flex items-center gap-2 text-base text-slate-600 dark:text-slate-300"><Boxes size={17} className="text-slate-400" />Stock on hand</span><span className="text-[11px] font-bold tracking-wider text-slate-400">NOW</span></div>
          <p className="mt-4 font-mono text-[30px] font-bold leading-none">{stats.units_in_stock.toLocaleString("en-PH")}</p>
          <p className="mt-4 inline-flex rounded-md bg-slate-100 px-2 py-1 text-[13px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">{stats.active_products.toLocaleString("en-PH")} products for sale</p>
        </div>
        <div className={`${card} p-6`}>
          <div className="flex items-center justify-between gap-3"><span className="flex items-center gap-2 text-base text-slate-600 dark:text-slate-300"><Users size={17} className="text-slate-400" />Team</span><span className="text-[11px] font-bold tracking-wider text-slate-400">NOW</span></div>
          <p className="mt-4 font-mono text-[30px] font-bold leading-none">{twoDigits(stats.active_employees)}</p>
          <p className="mt-4 inline-flex rounded-md bg-slate-100 px-2 py-1 text-[13px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">Active staff accounts</p>
        </div>
      </div>

      <div className="mt-7 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-6">
          <SalesChartView rows={salesChart} period={period} />
          <div className={`${card} overflow-hidden`}>
            <div className="flex items-center justify-between gap-3 px-7 pb-4 pt-6">
              <div><h2 className="flex items-center gap-2 text-[22px] font-semibold">Recent sales <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500 dark:bg-slate-800">{orders.length}</span></h2><p className="mt-1 text-base text-slate-500">The latest transactions at your store.</p></div>
              <button type="button" onClick={onViewOrders} className="shrink-0 text-[15px] font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400">All orders</button>
            </div>
            {orders.length ? (
              <div className="divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-800 dark:border-slate-800">
                {orders.slice(0, 6).map((order) => (
                  <div key={order.id} className="flex items-center justify-between gap-4 px-7 py-3.5">
                    <div className="min-w-0"><p className="font-mono text-sm font-semibold">{order.id}</p><p className="mt-0.5 text-[13px] text-slate-500">{order.items} item{order.items === 1 ? "" : "s"} · {order.time} · {order.employeeName}{order.status === "voided" ? " · voided" : ""}</p></div>
                    <p className="shrink-0 font-mono text-[15px] font-semibold">{money(order.total)}</p>
                  </div>
                ))}
              </div>
            ) : <p className="border-t border-slate-100 px-7 py-10 text-center text-[15px] text-slate-500 dark:border-slate-800">No sales yet. Completed sales show up here.</p>}
          </div>
        </div>

        <aside className={`${card} overflow-hidden`}>
          <div className="flex items-center justify-between gap-3 px-6 pb-4 pt-6">
            <h2 className="flex items-center gap-2 text-[22px] font-semibold"><TriangleAlert size={20} className="text-amber-500" />Low stock</h2>
            <button type="button" onClick={onViewInventory} className="text-[15px] font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400">Inventory</button>
          </div>
          {lowStockProducts.length ? (
            <ul className="divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-800 dark:border-slate-800">
              {lowStockProducts.slice(0, 8).map((product) => (
                <li key={product.id} className="flex items-center justify-between gap-3 px-6 py-3.5">
                  <span className="flex min-w-0 items-center gap-3"><ProductArtwork product={product} className="h-10 w-10 shrink-0 rounded-lg text-lg" /><span className="min-w-0"><span className="block truncate text-[15px] font-semibold">{product.name}</span><span className="block text-[13px] text-slate-500">{product.category}</span></span></span>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 font-mono text-xs font-semibold ${product.stock <= 0 ? "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300" : "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"}`}>{product.stock <= 0 ? "Out" : `${product.stock} left`}</span>
                </li>
              ))}
            </ul>
          ) : <p className="border-t border-slate-100 px-6 py-10 text-center text-[15px] text-slate-500 dark:border-slate-800">Every product has more than 5 in stock.</p>}
        </aside>
      </div>
    </section>
  );
}

function periodLabel(period: SalesPeriod) {
  if (period === "7days") return "Last 7 days";
  if (period === "30days") return "Last 30 days";
  return "Today · Asia/Manila";
}

function SalesChartView({ rows, period }: { rows: SalesChartPoint[]; period: SalesPeriod }) {
  const [paymentFilter, setPaymentFilter] = useState<"all" | PaymentMethod>("all");
  const series = [
    { method: "cash" as const, name: "Cash", color: "#3b82f6", values: rows.map((row) => row.cash) },
    { method: "e_wallet" as const, name: "E-Wallet", color: "#db2777", values: rows.map((row) => row.eWallet) },
    { method: "card" as const, name: "Card", color: "#d97706", values: rows.map((row) => row.card) },
  ].filter((item) => paymentFilter === "all" || paymentFilter === item.method);

  return (
    <section aria-label="Sales chart" className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
      <div className="flex flex-col justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center">
        <div><h2 className="text-xl font-semibold">Sales by payment method</h2><p className="mt-1 text-[15px] text-slate-500">{periodLabel(period)} · PHP</p></div>
        <div className="flex gap-1 rounded-lg bg-slate-50 p-1" aria-label="Filter sales chart by payment method">
          {(["all", "cash", "e_wallet", "card"] as const).map((method) => (
            <button key={method} type="button" aria-pressed={paymentFilter === method} onClick={() => setPaymentFilter(method)} className={`rounded-lg px-3.5 py-2 text-sm font-semibold capitalize ${paymentFilter === method ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
              {method === "all" ? "All" : paymentMethodLabel(method)}
            </button>
          ))}
        </div>
      </div>
      <div className="px-4 py-4 sm:px-5">
        <div className="mb-3 flex items-center gap-4 text-[10px] text-slate-500">
          {series.map((item) => <span key={item.method} className="flex items-center gap-1.5"><span className="h-0.5 w-3 rounded-full" style={{ backgroundColor: item.color }} />{item.name}</span>)}
        </div>
        {rows.length ? (
          <SmoothLineChart
            labels={rows.map((row) => row.label)}
            series={series}
            valueFormat={(value) => new Intl.NumberFormat("en-PH", { notation: "compact", maximumFractionDigits: 1 }).format(value)}
            tooltipFormat={money}
          />
        ) :<div className="grid h-36 place-items-center text-xs text-slate-400">No sales recorded for this period.</div>}
      </div>
    </section>
  );
}

function HelpCenterDialog({ onClose, onNavigate, showInventory }: {
  onClose: () => void;
  onNavigate: (page: "pos" | "inventory" | "orders") => void;
  showInventory: boolean;
}) {
  const options: { key: FunctionKey; page: "pos" | "inventory" | "orders"; label: string; icon: LucideIcon }[] = [
    { key: "F2", page: "pos", label: "Open point of sale", icon: ShoppingCart },
    ...(showInventory ? [{ key: "F3" as const, page: "inventory" as const, label: "Open inventory", icon: Boxes }] : []),
    { key: showInventory ? "F4" : "F3", page: "orders", label: "View orders", icon: ReceiptText },
  ];
  useFunctionKeys({
    F1: onClose,
    ...Object.fromEntries(options.map((option) => [option.key, () => onNavigate(option.page)])),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="help-center-title" className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
        <div className="mb-5 flex items-start justify-between">
          <div className="flex items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600"><CircleHelp size={20} /></div><div><p className="text-xs font-semibold text-blue-600">HELP &amp; SUPPORT</p><h2 id="help-center-title" className="mt-1 text-xl font-semibold">Help center</h2><p className="mt-1 text-sm text-slate-500">Quick answers for everyday store tasks.</p></div></div>
          <button type="button" aria-label="Close help center (Esc)" aria-keyshortcuts="Escape" onClick={onClose} className="flex items-center gap-1.5 rounded-lg p-2 text-slate-400 hover:bg-slate-50"><Kbd>Esc</Kbd><X size={18} /></button>
        </div>
        <div className="divide-y divide-slate-100 rounded-xl border border-slate-100 px-4">
          <details className="py-3" open>
            <summary className="cursor-pointer text-sm font-semibold">How do I complete a sale?</summary>
            <p className="mt-2 text-xs leading-5 text-slate-500">Open Point of sale, add products to the cart, choose Cash, E-Wallet, or Card, and confirm the checkout. Stock is deducted when the order is recorded.</p>
          </details>
          <details className="py-3">
            <summary className="cursor-pointer text-sm font-semibold">How do I record an E-Wallet or card payment?</summary>
            <p className="mt-2 text-xs leading-5 text-slate-500">Confirm the payment with the provider, then choose E-Wallet or Card in the checkout dialog and enter the last 4 digits of its reference number. The POS records those digits but does not process or verify the payment.</p>
          </details>
          <details className="py-3">
            <summary className="cursor-pointer text-sm font-semibold">How do I add stock or update product photos?</summary>
            <p className="mt-2 text-xs leading-5 text-slate-500">Admins open Inventory and use the ⋮ Actions menu on a product to restock it or add or change its image. Images are optional — when adding a product you can skip the image and an icon is chosen automatically.</p>
          </details>
          <details className="py-3">
            <summary className="cursor-pointer text-sm font-semibold">What happens when the internet goes down?</summary>
            <p className="mt-2 text-xs leading-5 text-slate-500">Keep selling. If you were signed in, checkout keeps working with the products last loaded on this computer. Each sale is saved on this computer and syncs to the store database automatically when the connection returns; the cloud icon in the top bar shows how many are waiting. A sale is never recorded twice. Anyone who signed in online on this computer in the last 30 days can also sign in offline; when the connection returns, enter your password once in the blue bar to reconnect and sync. Voids, refunds, inventory and employee changes, and reports need a connection. If offline sales sold more than the recorded stock, admins see a “Recount needed” list in Inventory.</p>
          </details>
          <details className="py-3">
            <summary className="cursor-pointer text-sm font-semibold">Can I change the size of the POS screen?</summary>
            <p className="mt-2 text-xs leading-5 text-slate-500">Yes. On Point of sale, click Customize: put the current order on the left or right (F10 in the desktop app), make it larger or smaller, show products as a list or as tiles, and change the text size. You can also drag the divider between the order and the products. The layout is saved on this computer; Reset puts it back.</p>
          </details>
          <details className="py-3">
            <summary className="cursor-pointer text-sm font-semibold">How do I void a sale or give a refund?</summary>
            <p className="mt-2 text-xs leading-5 text-slate-500">Open Orders, then the sale’s ⋮ Actions menu. Void sale cancels the whole sale and puts every item back in stock; cashiers can void their own sales within 30 minutes, admins any time. Refund items (admins) returns some or all items, with the option to restock them and to return the money by cash, e-wallet or card. Reports show sales after refunds.</p>
          </details>
          <details className="py-3">
            <summary className="cursor-pointer text-sm font-semibold">How do I set up the receipt printer and cash drawer?</summary>
            <p className="mt-2 text-xs leading-5 text-slate-500">Go to Account → Receipts &amp; cash drawer on each till. Pick the printer and paper width, and choose how the drawer opens: through the printer driver, a network receipt printer, or a shared Windows printer (desktop app). Use the test buttons to check. Admins set the store name, address and receipt message under Store details. Reprint any receipt from Orders → ⋮ → Print receipt.</p>
          </details>
          <details className="py-3">
            <summary className="cursor-pointer text-sm font-semibold">How do I count the drawer at the end of a shift?</summary>
            <p className="mt-2 text-xs leading-5 text-slate-500">Start the shift with the wallet icon in the top bar and enter the opening cash. Cash sales and cash refunds on that computer are added up. At the end, click the wallet icon again, enter how many of each note and coin are in the drawer, and close the shift: you’ll see whether the drawer is balanced, over or short, and can print the shift report. Admins see every count under Shifts → Cash counts. Works offline.</p>
          </details>
          <details className="py-3">
            <summary className="cursor-pointer text-sm font-semibold">How do I sell something that isn’t in my products?</summary>
            <p className="mt-2 text-xs leading-5 text-slate-500">Scan or type it and press Enter — if it isn’t found, the Quick add window opens. You can also press F3 or click Quick add. Enter a description, quantity, and either the price each or the total amount. The quantity can have up to 2 decimal places, e.g. 0.25 or 1.50 for a quarter or one and a half kilos; type 0.25/ before the name to start with it. Catalog products are sold in whole numbers. Custom items don’t change stock and have no recorded cost, so orders containing them are left out of the estimated-profit figures.</p>
          </details>
          <details className="py-3">
            <summary className="cursor-pointer text-sm font-semibold">Can I put an order on hold?</summary>
            <p className="mt-2 text-xs leading-5 text-slate-500">Yes. Click Save (Ctrl+S) under the current order, add an optional note such as the customer’s name, and serve the next customer. Click Recall (Ctrl+R) to bring it back; if another order is on screen, it’s saved first so you can switch back and forth. Saved orders stay on this computer (also offline and after restarting). Stock isn’t held aside: when an order is recalled, today’s prices apply and quantities are checked against the stock left.</p>
          </details>
          <details className="py-3">
            <summary className="cursor-pointer text-sm font-semibold">How are duplicate products prevented?</summary>
            <p className="mt-2 text-xs leading-5 text-slate-500">Each barcode belongs to one product. Products with barcodes may share a name, e.g. two sizes both called “Coke”; the last digits of the barcode show next to the name to tell them apart. A product without a barcode needs a name of its own (capitals and extra spaces don’t count, so “Coke” and “coke ” are the same). A removed product doesn’t block its name: adding it again offers to restore it with its past sales. Imports update the product with the same barcode first, then the same name, so renaming a product in your spreadsheet renames it instead of adding a second one; a row without a barcode must name only one product.</p>
          </details>
          <details className="py-3">
            <summary className="cursor-pointer text-sm font-semibold">How do categories work?</summary>
            <p className="mt-2 text-xs leading-5 text-slate-500">Categories come from your products. Admins create one by typing a new category name when adding or editing a product, or by including it in the category column of an import. Only categories that have products appear on Point of sale.</p>
          </details>
          <details className="py-3">
            <summary className="cursor-pointer text-sm font-semibold">How do I sell at wholesale prices?</summary>
            <p className="mt-2 text-xs leading-5 text-slate-500">Turn on Wholesale mode (the switch at the top of the current order, or F7) before adding the items that get wholesale prices, then turn it off for items that don’t. One sale can mix both, even for the same product: for example 24 pieces at wholesale and 1 at retail show as two lines. Wholesale lines are tagged in the order, on the receipt and in Orders. A product without a wholesale price is charged retail.</p>
          </details>
          <details className="py-3">
            <summary className="cursor-pointer text-sm font-semibold">How do I use a barcode scanner?</summary>
            <p className="mt-2 text-xs leading-5 text-slate-500">Plug in any USB or Bluetooth scanner that works as a keyboard. On Point of sale, scan an item and it is added to the order. To add several at once, type the quantity and a slash first, then scan — for example 24/ then scan adds 24. You can also type 24/ followed by the barcode or product name and press Enter. Admins assign barcodes from Inventory using Edit details in a product’s ⋮ Actions menu, when adding a product, or with a barcode column in a CSV/JSON import.</p>
          </details>
          <details className="py-3">
            <summary className="cursor-pointer text-sm font-semibold">What does the Shifts page show?</summary>
            <p className="mt-2 text-xs leading-5 text-slate-500">Each shift groups the orders an employee processed during the day shift (6 AM–6 PM) or night shift (6 PM–6 AM), with order counts and sales totals. Filter by day or night, sort by date or sales, and open a shift to see its orders.</p>
          </details>
          <details className="py-3">
            <summary className="cursor-pointer text-sm font-semibold">Where can I find completed sales?</summary>
            <p className="mt-2 text-xs leading-5 text-slate-500">Open Orders to review recent transactions, totals, payment methods, cash received, change due, and payment reference digits.</p>
          </details>
        </div>
        <div className="mt-5 hidden rounded-xl border border-slate-100 p-4 sm:block">
          <h3 className="text-sm font-semibold">Keyboard shortcuts</h3>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
            {([
              ["Alt + 1–9", "Go to a page (hover a page icon in the top bar to see its number)"],
              ["Type or scan", "On Point of sale, starts a search or barcode entry"],
              ["24/ + scan", "Adds 24 of the scanned item (any quantity up to 9,999)"],
              ["Enter", "Add the scanned or only matching item · confirm a dialog"],
              ["↑ ↓ ← →", "Move between products (↓ from a search); Enter adds the focused one"],
              ["F2", "Focus the product search"],
              ["F3", "Quick add a custom item that isn’t in your products"],
              ["F4", "Continue to payment"],
              ["F8", "Turn product images on or off"],
              ["F1 / F2 / F3", "In checkout: Cash / E-Wallet / Card"],
              ["F7", "Wholesale mode on or off (applies to items added next)"],
              ["F7 in checkout", "Print a receipt for this sale, or not"],
              ["F-keys in pop-ups", "Choose a pop-up’s options (shown on each option)"],
              ["F9", "Clear the current order"],
              ["Ctrl + S", "Save the order for later (suspend) and start a new one"],
              ["Ctrl + R", "Recall a saved order; 1–9 picks one in the list"],
              ["+ / −", "One more or one less of the highlighted order line (search box empty)"],
              ["Delete", "Remove the highlighted order line"],
              ["↑ ↓", "Move up or down the order (search box empty); the list scrolls along"],
              ["Ctrl + ↑ ↓", "Move up or down the order, even while typing a search"],
              ["PgUp / PgDn", "Scroll the order a page at a time"],
              ["Ctrl + Z", "Undo the last item added (repeat to go further back)"],
              ["Ctrl + F", "Focus the product search"],
              ...(isDesktopApp() ? [
                ["F5", "Reprint the last receipt from this computer"],
                ["F6", "Open the cash drawer"],
                ["F10", "Move the current order to the other side"],
                ["F11", "Full screen on or off"],
                ["F12", "Start the shift, or count the drawer to end it"],
                ["Ctrl + = / − / 0", "Zoom the whole app in, out, or back to normal"],
              ] as const : []),
              ["Esc", "Close a dialog or clear the search"],
              ["F1", "Open this help center"],
            ] as const).map(([keys, action]) => (
              <div key={keys} className="contents"><dt><kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">{keys}</kbd></dt><dd className="text-slate-500">{action}</dd></div>
            ))}
          </dl>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {options.map(({ key, page, label, icon: Icon }, index) => (
            <button key={page} type="button" aria-keyshortcuts={key} onClick={() => onNavigate(page)} className={`inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-semibold ${index === 0 ? "bg-blue-600 text-white hover:bg-blue-700" : "border border-slate-200 text-slate-600 hover:bg-slate-50"}`}><Icon size={14} /> {label}<Kbd>{key}</Kbd></button>
          ))}
        </div>
      </section>
    </div>
  );
}

function ProductArtwork({ product, className = "" }: { product: Product; className?: string }) {
  // Photos are stored online; offline (or if one fails to load) the product's
  // icon is shown instead of a broken image.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return (
    <div className={`relative grid shrink-0 place-items-center overflow-hidden ${product.color} ${className}`}>
      {product.imageUrl && failedUrl !== product.imageUrl ? (
        <Image
          src={product.imageUrl}
          alt={product.name}
          fill
          unoptimized
          sizes="(max-width: 640px) 45vw, 220px"
          className="object-cover"
          onError={() => setFailedUrl(product.imageUrl)}
        />
      ) : (
        <span aria-hidden="true">{product.emoji}</span>
      )}
    </div>
  );
}

// One line in the page flow (not overlaid), so nothing underneath is hidden.
function OfflineBanner({ signedIn = false, waiting = 0 }: { signedIn?: boolean; waiting?: number }) {
  const message = signedIn
    ? `Offline mode: keep selling. Sales are saved on this computer${waiting ? ` (${waiting} waiting)` : ""} and sync automatically when you’re back online. Inventory, employee and report changes need a connection.`
    : "You’re offline. Signing in needs an internet connection.";
  return (
    <div role="alert" title={message} className="flex h-8 items-center justify-center gap-2 bg-amber-500 px-4 text-xs font-semibold text-amber-950">
      <WifiOff size={14} className="shrink-0" />
      <span className="truncate">{message}</span>
    </div>
  );
}

// Header indicator for the offline queue; opens the sync panel.
function SyncStatusButton({ isOnline, isSyncing, waiting, failed, onClick }: { isOnline: boolean; isSyncing: boolean; waiting: number; failed: number; onClick: () => void }) {
  const label = failed
    ? `${failed} sale${failed === 1 ? "" : "s"} couldn’t sync`
    : isSyncing
      ? "Syncing sales…"
      : waiting
        ? `${waiting} sale${waiting === 1 ? "" : "s"} waiting to sync`
        : isOnline ? "All sales synced" : "Offline";
  const tone = failed
    ? "text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
    : waiting || isSyncing
      ? "text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/40"
      : isOnline ? "text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40" : "text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800";
  const Icon = !isOnline ? CloudOff : waiting || failed || isSyncing ? CloudUpload : Cloud;
  return (
    <button type="button" onClick={onClick} aria-label={`Sync status: ${label}`} title={label} className={`relative flex h-12 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold transition ${tone}`}>
      <Icon size={24} className={isSyncing ? "animate-pulse" : ""} />
      {(waiting > 0 || failed > 0) && <span>{waiting + failed}</span>}
    </button>
  );
}

// Lists sales saved on this computer that haven't reached Supabase yet.
function SyncPanel({ sales, isOnline, isSyncing, currentUserId, isAdmin, onSync, onClose }: {
  sales: PendingOrder[];
  isOnline: boolean;
  isSyncing: boolean;
  currentUserId: string | null;
  isAdmin: boolean;
  onSync: (retryFailed: boolean) => void;
  onClose: () => void;
}) {
  const failed = sales.filter((sale) => sale.failed);
  const otherCashiers = isAdmin ? 0 : sales.filter((sale) => sale.employeeId !== currentUserId).length;
  const visible = sales.filter((sale) => isAdmin || sale.employeeId === currentUserId);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="sync-title" className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
        <div className="flex items-start justify-between border-b border-slate-100 p-6 pb-4 dark:border-slate-800">
          <div>
            <p className="text-xs font-semibold text-blue-600">OFFLINE SALES</p>
            <h2 id="sync-title" className="mt-1 text-xl font-semibold">Sync status</h2>
            <p className="mt-1 text-sm text-slate-500">
              {!isOnline ? "Offline. Sales below are saved on this computer and will sync automatically when the connection is back."
                : visible.length ? "These sales are saved on this computer and haven’t reached the store database yet."
                  : "Every sale from this computer has been synced."}
            </p>
          </div>
          <button type="button" aria-label="Close sync status (Esc)" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"><X size={18} /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-6 pt-4">
          {failed.length > 0 && (
            <div role="alert" className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-xs leading-5 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
              {failed.length} sale{failed.length === 1 ? " was" : "s were"} refused by the server and {failed.length === 1 ? "is" : "are"} kept here so nothing is lost. Check the reason below, fix it if possible (for example, an employee account that was removed needs an admin to sync), then retry.
            </div>
          )}
          {otherCashiers > 0 && <p className="text-xs text-slate-500">{otherCashiers} sale{otherCashiers === 1 ? "" : "s"} from another cashier on this computer will sync when they or an admin sign in.</p>}
          {visible.length > 0 ? (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100 dark:divide-slate-800 dark:border-slate-800">
              {visible.map((sale) => (
                <li key={sale.clientOrderId} className="px-4 py-3 text-xs">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold"><span className="font-mono">#{sale.clientOrderId.slice(0, 8)}</span> · {money(sale.total)}</p>
                      <p className="mt-0.5 text-[11px] text-slate-400">{new Date(sale.createdAt).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" })} · {sale.employeeName} · {sale.items.reduce((sum, item) => sum + item.quantity, 0)} items</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${sale.failed ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300" : "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300"}`}>{sale.failed ? "Failed" : "Waiting"}</span>
                  </div>
                  {sale.lastError && <p className="mt-1.5 text-[11px] text-red-600 dark:text-red-300">{sale.lastError}</p>}
                </li>
              ))}
            </ul>
          ) : (
            <div className="grid place-items-center py-8 text-center text-sm text-slate-400"><Cloud size={24} className="mb-2 text-emerald-500" />Nothing waiting to sync.</div>
          )}
        </div>
        <div className="flex gap-3 border-t border-slate-100 p-6 pt-4 dark:border-slate-800">
          <button type="button" onClick={onClose} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300">Close <Kbd>Esc</Kbd></button>
          <button type="button" disabled={!isOnline || isSyncing || visible.length === 0} onClick={() => onSync(failed.length > 0)} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
            <RefreshCw size={15} className={isSyncing ? "animate-spin" : ""} />{isSyncing ? "Syncing…" : !isOnline ? "Waiting for connection" : failed.length ? "Retry all" : "Sync now"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Confirmation for destructive actions. Cancel has focus first, so a stray
// Enter never deletes anything; Esc cancels.
// After a sale: the change to hand back, large. Enter, Esc or a click closes
// it; typing or scanning closes it and starts the next sale.
function SaleCompleteDialog({ sale, onClose }: {
  sale: { label: string; total: number; paid: number | null; change: number | null; method: PaymentMethod; offline: boolean };
  onClose: (typed?: string) => void;
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.key === "Enter" || event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
      else if (event.key.length === 1 && event.key !== " ") { event.preventDefault(); event.stopPropagation(); onClose(event.key); }
    }
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onClick={() => onClose()}>
      <section role="dialog" aria-modal="true" aria-labelledby="sale-complete-title" className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl dark:bg-slate-900" onClick={(event) => event.stopPropagation()}>
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-300"><Check size={24} /></div>
        <h2 id="sale-complete-title" className="mt-3 text-lg font-semibold">Sale complete</h2>
        <p className="mt-0.5 font-mono text-xs text-slate-500">{sale.label}{sale.offline ? " · saved offline" : ""}</p>
        <dl className="mt-5 space-y-1.5 text-left text-sm">
          <div className="flex justify-between"><dt className="text-slate-500">Total</dt><dd className="font-mono font-semibold">{money(sale.total)}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">{sale.method === "cash" ? "Cash received" : `Paid by ${paymentMethodLabel(sale.method)}`}</dt><dd className="font-mono font-semibold">{money(sale.paid ?? sale.total)}</dd></div>
        </dl>
        {sale.change !== null && (
          <div className="mt-4 rounded-xl bg-emerald-50 py-4 dark:bg-emerald-950/40">
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">Change</p>
            <p className="mt-1 font-mono text-4xl font-bold text-emerald-700 dark:text-emerald-300" aria-live="polite">{money(sale.change)}</p>
          </div>
        )}
        <button type="button" autoFocus onClick={() => onClose()} className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700">Next sale <Kbd>Enter</Kbd></button>
        <p className="mt-2 text-[11px] text-slate-400">Or just scan the next item.</p>
      </section>
    </div>
  );
}

// Shown while the app starts and reads the store's data.
function LoadingSkeleton() {
  return (
    <main aria-busy="true" aria-label="Loading your store" className="min-h-screen bg-[#f5f8fd] dark:bg-slate-950">
      <div className="flex h-[72px] items-center gap-4 border-b border-slate-100 bg-white px-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="h-10 w-10 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />
        <div className="h-4 w-32 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
        <div className="ml-auto h-9 w-40 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />
      </div>
      <div className="grid gap-5 p-6 md:grid-cols-[minmax(0,55fr)_minmax(0,45fr)]">
        <div className="h-[70vh] animate-pulse rounded-2xl bg-white dark:bg-slate-900" />
        <div className="space-y-3">
          <div className="h-10 animate-pulse rounded-xl bg-white dark:bg-slate-900" />
          {Array.from({ length: 6 }, (_, index) => <div key={index} className="h-14 animate-pulse rounded-xl bg-white dark:bg-slate-900" />)}
        </div>
      </div>
      <p className="sr-only">Loading your store…</p>
    </main>
  );
}

function ConfirmDialog({ action, isWorking, onConfirm, onSecondary, onCancel }: { action: ConfirmAction; isWorking: boolean; onConfirm: () => void; onSecondary: () => void; onCancel: () => void }) {
  const neutral = action.tone === "neutral";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onClick={(event) => { if (event.target === event.currentTarget && !isWorking) onCancel(); }}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-message" className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
        <div className={`mb-4 grid h-10 w-10 place-items-center rounded-xl ${neutral ? "bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-300" : "bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-300"}`}>{neutral ? <RotateCcw size={18} /> : <TriangleAlert size={18} />}</div>
        <h2 id="confirm-title" className="text-lg font-semibold">{action.title}</h2>
        <p id="confirm-message" className="mt-1.5 text-sm leading-6 text-slate-500">{action.message}</p>
        <div className="mt-6 flex gap-3">
          <button type="button" autoFocus disabled={isWorking} onClick={onCancel} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">Cancel <Kbd>Esc</Kbd></button>
          {action.secondaryLabel && <button type="button" disabled={isWorking} onClick={onSecondary} className="flex h-11 flex-1 items-center justify-center rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">{action.secondaryLabel}</button>}
          <button type="button" disabled={isWorking} onClick={onConfirm} className={`flex h-11 flex-1 items-center justify-center rounded-lg text-sm font-semibold text-white disabled:opacity-60 ${neutral ? "bg-blue-600 hover:bg-blue-700" : "bg-red-600 hover:bg-red-700"}`}>{isWorking ? "Working…" : action.confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

function downloadXlsx(data: Uint8Array, fileName: string) {
  const blob = new Blob([new Uint8Array(data)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function downloadImportTemplate() {
  downloadXlsx(buildTemplateXlsx(), "products-template.xlsx");
}

const manilaDateStamp = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
const sortForReport = (items: Product[]) =>
  [...items].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

// Same layout as the import template, so it can be edited and re-imported.
function exportInventoryExcel(items: Product[]) {
  downloadXlsx(buildProductsXlsx(sortForReport(items)), `inventory-${manilaDateStamp()}.xlsx`);
}

const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Builds a printable inventory report and opens the browser's print dialog
// from a hidden frame (choose "Save as PDF"). The page title becomes the
// suggested PDF file name.
function exportInventoryPdf(items: Product[], storeName: string) {
  const sorted = sortForReport(items);
  const units = sorted.reduce((sum, product) => sum + product.stock, 0);
  const retailValue = sorted.reduce((sum, product) => sum + product.price * product.stock, 0);
  const costed = sorted.filter((product) => product.costPriceKnown);
  const costValue = costed.reduce((sum, product) => sum + product.costPrice * product.stock, 0);
  const lowStock = sorted.filter((product) => product.stock <= 5).length;
  const generated = new Date().toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" });
  const rows = sorted.map((product) => `<tr${product.stock <= 5 ? ' class="low"' : ""}>
    <td>${escapeHtml(product.name)}</td><td>${escapeHtml(product.category)}</td><td class="mono">${escapeHtml(product.barcode ?? "")}</td>
    <td class="num">${product.costPriceKnown ? money(product.costPrice) : "—"}</td><td class="num">${product.wholesalePrice > 0 ? money(product.wholesalePrice) : "—"}</td>
    <td class="num">${money(product.price)}</td><td class="num">${product.stock}</td><td class="num">${money(product.price * product.stock)}</td></tr>`).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>inventory-${manilaDateStamp()}</title><style>
    @page { size: A4 landscape; margin: 12mm; }
    * { box-sizing: border-box; }
    body { margin: 0; font: 10px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #0f172a; }
    header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #2563eb; padding-bottom: 8px; margin-bottom: 12px; }
    h1 { margin: 0; font-size: 18px; } .muted { color: #64748b; }
    .summary { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-bottom: 14px; }
    .summary div { border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px 8px; }
    .summary b { display: block; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; }
    thead { display: table-header-group; }
    th { text-align: left; font-size: 8.5px; text-transform: uppercase; letter-spacing: .04em; color: #64748b; border-bottom: 1px solid #cbd5e1; padding: 5px 6px; }
    td { padding: 4px 6px; border-bottom: 1px solid #f1f5f9; }
    tr { break-inside: avoid; }
    .num { text-align: right; font-variant-numeric: tabular-nums; } th.num { text-align: right; }
    .mono { font-family: ui-monospace, Consolas, monospace; font-size: 9px; color: #475569; }
    tr.low td { background: #fffbeb; }
    tfoot td { font-weight: 700; border-top: 1px solid #cbd5e1; border-bottom: 0; }
    footer { margin-top: 10px; font-size: 8.5px; }
  </style></head><body>
    <header><div><div class="muted">${escapeHtml(storeName)} · Point of sale</div><h1>Inventory report</h1></div><div class="muted">Generated ${escapeHtml(generated)} · Asia/Manila</div></header>
    <section class="summary">
      <div><span class="muted">Products</span><b>${sorted.length}</b></div>
      <div><span class="muted">Units in stock</span><b>${units}</b></div>
      <div><span class="muted">Stock value (retail)</span><b>${money(retailValue)}</b></div>
      <div><span class="muted">Stock value (cost)</span><b>${money(costValue)}</b>${costed.length < sorted.length ? `<span class="muted">${sorted.length - costed.length} without cost</span>` : ""}</div>
      <div><span class="muted">Low stock (≤ 5)</span><b>${lowStock}</b></div>
    </section>
    <table><thead><tr><th>Product</th><th>Category</th><th>Barcode</th><th class="num">Cost</th><th class="num">Wholesale</th><th class="num">Retail</th><th class="num">Stock</th><th class="num">Value (retail)</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td colspan="6">Total</td><td class="num">${units}</td><td class="num">${money(retailValue)}</td></tr></tfoot></table>
    <footer class="muted">Low-stock rows are highlighted. Stock value (cost) counts only products with a recorded cost price.</footer>
  </body></html>`;

  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  frame.onload = () => {
    const printWindow = frame.contentWindow;
    if (!printWindow) return frame.remove();
    const cleanup = () => window.setTimeout(() => frame.remove(), 500);
    printWindow.addEventListener("afterprint", cleanup, { once: true });
    printWindow.focus();
    printWindow.print();
  };
  frame.srcdoc = html;
  document.body.appendChild(frame);
}

// Import products from Excel, CSV or JSON: choose a file, review what will
// change, then import. Nothing is saved until Import is pressed.
function ImportProductsDialog({ prepare, onImport, onClose, isImporting }: {
  prepare: (file: File) => Promise<ImportPreview>;
  onImport: (preview: ImportPreview, masterList: boolean) => void;
  onClose: () => void;
  isImporting: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState("");
  const [isReading, setIsReading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  // Master list: the file replaces the whole product list (products not in it are removed).
  const [masterList, setMasterList] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  useFunctionKeys({ F1: () => fileInputRef.current?.click(), F2: downloadImportTemplate, F3: () => { setMasterList((current) => !current); setAcknowledged(false); } }, !isImporting);
  const submitRef = useRef<() => void>(() => {});
  useEffect(() => {
    // Enter imports from anywhere in the dialog except a focused button/link,
    // which keeps its own Enter behaviour.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || (event.target as HTMLElement | null)?.closest("button, a")) return;
      event.preventDefault();
      submitRef.current();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  async function readFile(file: File | undefined) {
    if (!file) return;
    setIsReading(true);
    setError("");
    setPreview(null);
    try {
      setPreview(await prepare(file));
      setAcknowledged(false);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to read that file.");
    } finally {
      setIsReading(false);
    }
  }

  const newCount = preview?.products.filter((product) => product.status === "new").length ?? 0;
  const restoreCount = preview?.products.filter((product) => product.status === "restore").length ?? 0;
  const updateCount = (preview?.products.length ?? 0) - newCount;
  const needsAcknowledgement = masterList && (preview?.removable.length ?? 0) > 0;
  const canImport = !!preview && preview.products.length > 0 && preview.errors.length === 0 && !isImporting && (!needsAcknowledgement || acknowledged);
  useEffect(() => {
    submitRef.current = () => { if (canImport && preview) onImport(preview, masterList); };
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onClick={(event) => { if (event.target === event.currentTarget && !isImporting) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="import-title" className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
        <div className="flex items-start justify-between border-b border-slate-100 p-6 pb-4 dark:border-slate-800">
          <div><p className="text-xs font-semibold text-blue-600">INVENTORY</p><h2 id="import-title" className="mt-1 text-xl font-semibold">Import products</h2><p className="mt-1 text-sm text-slate-500">Excel (.xlsx), CSV, or JSON. Each row updates the product with the same barcode, or else the same name (capitals and spaces don’t matter), restores a removed one, or is added as new.</p></div>
          <button type="button" aria-label="Close import (Esc)" disabled={isImporting} onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-50 disabled:opacity-50 dark:hover:bg-slate-800"><X size={18} /></button>
        </div>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => { event.preventDefault(); if (canImport && preview) onImport(preview, masterList); }}
        >
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6 pt-4">
            <label
              onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(event) => { event.preventDefault(); setIsDragging(false); void readFile(event.dataTransfer.files[0]); }}
              className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition ${isDragging ? "border-blue-400 bg-blue-50 dark:bg-blue-950/30" : "border-slate-200 hover:border-blue-300 dark:border-slate-700"}`}
            >
              <FileSpreadsheet size={26} className="text-emerald-600" />
              <span className="text-sm font-semibold">{isReading ? "Reading file…" : preview ? preview.fileName : "Drop a file here or choose one"}</span>
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600">{preview ? "Choose a different file" : "Choose file"} <Kbd>F1</Kbd></span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.csv,.json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,application/json"
                className="sr-only"
                onChange={(event) => { void readFile(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }}
              />
            </label>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-4 py-3 text-xs dark:bg-slate-800">
              <span className="text-slate-500">Columns: {importColumns.map((column) => <span key={column.field} className={column.required ? "font-semibold text-slate-700 dark:text-slate-200" : ""}>{column.header}{column.required ? "*" : ""}{column.field !== importColumns[importColumns.length - 1].field ? ", " : ""}</span>)}</span>
              <button type="button" onClick={downloadImportTemplate} className="inline-flex items-center gap-1.5 font-semibold text-emerald-700 hover:text-emerald-800"><Download size={13} /> Excel template <Kbd>F2</Kbd></button>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={masterList}
              aria-keyshortcuts="F3"
              onClick={() => { setMasterList((current) => !current); setAcknowledged(false); }}
              className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left ${masterList ? "border-red-200 bg-red-50/70 dark:border-red-900 dark:bg-red-950/40" : "border-slate-200 dark:border-slate-700"}`}
            >
              <span className={`relative h-5 w-9 shrink-0 rounded-full transition ${masterList ? "bg-red-600" : "bg-slate-300"}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${masterList ? "left-[18px]" : "left-0.5"}`} /></span>
              <span className="flex-1">
                <span className="block text-sm font-semibold text-slate-700">Master list</span>
                <span className="block text-[11px] leading-4 text-slate-500">{masterList ? "This file becomes the complete product list: products not in it are removed from POS and Inventory." : "Off: products in the file are added or updated; everything else stays."}</span>
              </span>
              <Kbd className="text-slate-500">F3</Kbd>
            </button>

            {error && <div role="alert" className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

            {preview && masterList && preview.errors.length === 0 && preview.products.length > 0 && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                {preview.removable.length === 0 ? (
                  <p>Every current product is in this file, so nothing will be removed.</p>
                ) : (
                  <>
                    <p className="font-semibold">{preview.removable.length} current product{preview.removable.length === 1 ? " is" : "s are"} not in this file and will be removed:</p>
                    <p className="mt-1.5 max-h-24 overflow-y-auto leading-5">{preview.removable.slice(0, 200).join(", ")}{preview.removable.length > 200 ? `, and ${preview.removable.length - 200} more` : ""}</p>
                    <p className="mt-1.5 text-[11px] leading-4 opacity-80">Removed products disappear from POS and Inventory, but past orders and reports keep them. Importing them again later brings them back.</p>
                    <label className="mt-2.5 flex items-center gap-2 font-semibold">
                      <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.currentTarget.checked)} className="h-4 w-4 accent-red-600" />
                      I understand {preview.removable.length} product{preview.removable.length === 1 ? "" : "s"} will be removed
                    </label>
                  </>
                )}
              </div>
            )}

            {preview && (
              <>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl border border-slate-100 p-3 dark:border-slate-800"><p className="text-lg font-semibold">{newCount}</p><p className="text-[11px] text-slate-500">New products</p></div>
                  <div className="rounded-xl border border-slate-100 p-3 dark:border-slate-800"><p className="text-lg font-semibold">{updateCount}</p><p className="text-[11px] text-slate-500">Updates{restoreCount > 0 && <> · {restoreCount} restored</>}</p></div>
                  <div className="rounded-xl border border-slate-100 p-3 dark:border-slate-800"><p className="text-lg font-semibold">{preview.newCategories.length}</p><p className="text-[11px] text-slate-500">New categories</p></div>
                </div>
                {preview.newCategories.length > 0 && <p className="text-xs text-slate-500">New categories: <span className="font-medium text-slate-700 dark:text-slate-200">{preview.newCategories.join(", ")}</span></p>}
                {preview.errors.length > 0 && (
                  <div role="alert" className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-xs text-red-700">
                    <p className="font-semibold">Fix {preview.errors.length} row{preview.errors.length === 1 ? "" : "s"} in the file, then choose it again:</p>
                    <ul className="mt-1.5 max-h-32 list-disc space-y-0.5 overflow-y-auto pl-4">{preview.errors.map((message) => <li key={message}>{message}</li>)}</ul>
                  </div>
                )}
                {preview.products.length > 0 && (
                  <div className="overflow-x-auto rounded-xl border border-slate-100 dark:border-slate-800">
                    <table className="w-full min-w-[560px] text-left text-xs">
                      <thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:bg-slate-800"><tr><th className="px-3 py-2">Row</th><th className="px-3 py-2">Product</th><th className="px-3 py-2">Category</th><th className="px-3 py-2 text-right">Retail</th><th className="px-3 py-2 text-right">Wholesale</th><th className="px-3 py-2 text-right">Stock</th><th className="px-3 py-2"></th></tr></thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {preview.products.slice(0, 50).map((product) => (
                          <tr key={product.sourceRow}>
                            <td className="px-3 py-2 text-slate-400">{product.sourceRow}</td>
                            <td className="px-3 py-2 font-medium">{product.name}{product.renamedFrom && <span className="block text-[10px] font-normal text-amber-700 dark:text-amber-300">Renames “{product.renamedFrom}” (same barcode)</span>}{product.barcode && <span className="block font-mono text-[10px] font-normal text-slate-400">{product.barcode}</span>}</td>
                            <td className="px-3 py-2 text-slate-500">{product.category}</td>
                            <td className="px-3 py-2 text-right">{money(product.price)}</td>
                            <td className="px-3 py-2 text-right text-slate-500">{product.wholesale_price ? money(product.wholesale_price) : "—"}</td>
                            <td className="px-3 py-2 text-right">{product.stock}</td>
                            <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${product.status === "new" ? "bg-emerald-50 text-emerald-700" : product.status === "restore" ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700"}`}>{product.status === "new" ? "New" : product.status === "restore" ? "Restore" : "Update"}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {preview.products.length > 50 && <p className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-400 dark:border-slate-800">…and {preview.products.length - 50} more.</p>}
                  </div>
                )}
              </>
            )}
          </div>
          <div className="flex gap-3 border-t border-slate-100 p-6 pt-4 dark:border-slate-800">
            <button type="button" disabled={isImporting} onClick={onClose} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700">Cancel <Kbd>Esc</Kbd></button>
            <button type="submit" disabled={!canImport} className={`flex h-11 flex-1 items-center justify-center gap-2 rounded-lg text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${masterList ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"}`}>{isImporting ? "Importing…" : <>{masterList ? "Replace product list" : "Import"} {preview?.products.length ? `(${preview.products.length} product${preview.products.length === 1 ? "" : "s"})` : ""} <Kbd>Enter</Kbd></>}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Sell something that isn't in the product catalog. Price (each) and amount
// (line total) stay in sync through the quantity, so either can be entered.
function QuickAddDialog({ initial, onAdd, onClose }: {
  initial: { quantity: number; description: string; note: string };
  onAdd: (item: Omit<CustomItem, "id">) => void;
  onClose: () => void;
}) {
  const [quantity, setQuantity] = useState(String(initial.quantity));
  const [description, setDescription] = useState(initial.description);
  const [price, setPrice] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const inputClass = "mt-1.5 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50 dark:border-slate-700 dark:bg-slate-950";

  function updateFrom(next: { quantity?: string; price?: string; amount?: string }) {
    const nextQuantity = next.quantity ?? quantity;
    const count = Number(nextQuantity);
    const validCount = isValidCustomQuantity(count);
    if (next.quantity !== undefined) setQuantity(next.quantity);
    if (next.amount !== undefined) {
      setAmount(next.amount);
      setPrice(next.amount && validCount ? (Number(next.amount) / count).toFixed(2) : "");
      return;
    }
    const nextPrice = next.price ?? price;
    if (next.price !== undefined) setPrice(next.price);
    setAmount(nextPrice && validCount ? (Number(nextPrice) * count).toFixed(2) : "");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const count = Number(quantity);
    const unitPrice = Math.round(Number(price) * 100) / 100;
    const name = description.trim();
    if (!isValidCustomQuantity(count)) return setError("Enter a quantity above 0 and up to 9,999, with at most 2 decimal places (e.g. 0.25 or 1.50).");
    if (!name || name.length > 120) return setError("Enter a description of up to 120 characters.");
    if (!Number.isFinite(unitPrice) || unitPrice <= 0 || unitPrice > 999999.99) return setError("Enter a price or amount above ₱0.");
    onAdd({ description: name, quantity: roundQuantity(count), unitPrice });
  }

  const lineTotal = lineAmount(Number(price) || 0, Number(quantity) || 0);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="quick-add-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
        <div className="mb-5 flex items-start justify-between">
          <div><p className="text-xs font-semibold text-blue-600">CUSTOM ITEM</p><h2 id="quick-add-title" className="mt-1 text-xl font-semibold">Quick add</h2><p className="mt-1 text-sm text-slate-500">{initial.note ? `${initial.note} ` : ""}Sell it as a one-off item. Stock isn’t tracked for custom items.</p></div>
          <button type="button" aria-label="Close quick add (Esc)" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-50"><X size={18} /></button>
        </div>
        <form noValidate onSubmit={submit} onInput={(event) => { event.currentTarget.dataset.dirty = "1"; }} className="space-y-4">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Description<input autoFocus={!initial.description} required maxLength={120} value={description} onChange={(event) => setDescription(event.currentTarget.value)} placeholder="e.g. Ice (1 bag)" className={inputClass} /></label>
          <div className="grid grid-cols-3 gap-3">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Quantity<input required type="number" min="0.01" max="9999" step="0.01" inputMode="decimal" value={quantity} onChange={(event) => updateFrom({ quantity: event.currentTarget.value })} className={inputClass} /></label>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Price (₱)<input autoFocus={!!initial.description} required type="number" min="0.01" step="0.01" inputMode="decimal" value={price} onChange={(event) => updateFrom({ price: event.currentTarget.value })} placeholder="each" className={inputClass} /></label>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Amount (₱)<input type="number" min="0.01" step="0.01" inputMode="decimal" value={amount} onChange={(event) => updateFrom({ amount: event.currentTarget.value })} placeholder="total" className={inputClass} /></label>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800"><span>Adds to order</span><span className="font-mono font-semibold text-slate-800 dark:text-slate-100">{formatQuantity(Number(quantity) || 0)} × {money(Math.round(Number(price) * 100) / 100 || 0)} = {money(lineTotal || 0)}</span></div>
          {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} aria-keyshortcuts="Escape" className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancel <Kbd>Esc</Kbd></button>
            <button type="submit" aria-keyshortcuts="Enter" className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700">Add to order <Kbd>Enter</Kbd></button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Free-text category with the existing ones as suggestions: pick one, or type
// a new name to create a category.
function CategoryField({ categories, defaultValue = "" }: { categories: string[]; defaultValue?: string }) {
  const listId = useId();
  return (
    <label className="block text-sm font-medium text-slate-700">Category
      <input required name="category" list={listId} maxLength={80} defaultValue={defaultValue} autoComplete="off" placeholder={categories.length ? "Pick one or type a new category" : "e.g. Snacks"} className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50" />
      <datalist id={listId}>{categories.map((item) => <option key={item} value={item} />)}</datalist>
      <span className="mt-1 block text-[11px] font-normal text-slate-400">Typing a new name creates that category.</span>
    </label>
  );
}

function BarcodeField({ defaultValue = "" }: { defaultValue?: string }) {
  return (
    <label className="block text-sm font-medium text-slate-700">Barcode <span className="font-normal text-slate-400">(optional)</span>
      <span className="mt-1.5 flex h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-50">
        <ScanBarcode size={16} className="shrink-0 text-slate-400" />
        <input
          name="barcode"
          defaultValue={defaultValue}
          maxLength={80}
          autoComplete="off"
          placeholder="Scan or type the barcode"
          // Scanners end with Enter; keep it from submitting the form.
          onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }}
          className="w-full bg-transparent text-sm outline-none"
        />
      </span>
    </label>
  );
}

function ProductImagePicker({
  selectedIcon,
  selectedImage,
  existingImageUrl = null,
  existingImageRemoved = false,
  onRemoveExisting,
  onIconChange,
  onImageChange,
  optional = false,
}: {
  selectedIcon: string;
  selectedImage: File | null;
  existingImageUrl?: string | null;
  existingImageRemoved?: boolean;
  onRemoveExisting?: () => void;
  onIconChange: (icon: string) => void;
  onImageChange: (image: File | null) => void;
  optional?: boolean;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Optional pickers start collapsed; a product without an image or preset
  // gets an automatic icon from its category and name.
  const [expanded, setExpanded] = useState(!optional);
  const openFileOnExpandRef = useRef(false);
  const canRemoveImage = !!selectedImage || (!!existingImageUrl && !existingImageRemoved && !!onRemoveExisting);
  useFunctionKeys({
    F1: () => {
      if (expanded) fileInputRef.current?.click();
      else { openFileOnExpandRef.current = true; setExpanded(true); }
    },
    ...(canRemoveImage ? { F2: () => (selectedImage ? onImageChange(null) : onRemoveExisting?.()) } : {}),
  });

  useEffect(() => {
    if (expanded && openFileOnExpandRef.current) {
      openFileOnExpandRef.current = false;
      fileInputRef.current?.click();
    }
  }, [expanded]);

  useEffect(() => {
    if (!selectedImage) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(selectedImage);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [selectedImage]);

  const imagePreviewUrl = previewUrl ?? (existingImageRemoved ? null : existingImageUrl);

  if (!expanded) {
    return (
      <div>
        <button type="button" aria-keyshortcuts="F1" onClick={() => setExpanded(true)} className="flex w-full items-center gap-2 rounded-lg border border-dashed border-slate-200 px-3 py-2.5 text-left text-xs font-semibold text-slate-600 hover:border-blue-300 hover:text-blue-700">
          <ImageIcon size={15} /><span className="flex-1">Add an image or icon <span className="font-normal text-slate-400">(optional)</span></span><Kbd>F1</Kbd>
        </button>
        <p className="mt-1.5 text-[11px] text-slate-400">Skip it and an icon is picked automatically from the category.</p>
      </div>
    );
  }

  return (
    <fieldset className="space-y-2">
      <legend className="flex w-full items-center justify-between text-sm font-medium text-slate-700">
        <span>Product image or icon {optional && <span className="font-normal text-slate-400">(optional)</span>}</span>
        {optional && <button type="button" onClick={() => { onImageChange(null); onIconChange("auto"); setExpanded(false); }} className="text-[11px] font-semibold text-slate-400 hover:text-slate-700">Skip</button>}
      </legend>
      <div className="flex items-start gap-3">
        <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl bg-blue-50 text-3xl">
          {imagePreviewUrl ? <Image src={imagePreviewUrl} alt="Product image preview" width={64} height={64} unoptimized className="h-full w-full object-cover" /> : productIcons.find((icon) => icon.id === selectedIcon)?.emoji || "✨"}
        </div>
        <div className="min-w-0 flex-1">
          <label aria-keyshortcuts="F1" className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:border-blue-200 hover:text-blue-700">
            <FileUp size={14} /> Choose custom image <Kbd>F1</Kbd>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={(event: ChangeEvent<HTMLInputElement>) => onImageChange(event.currentTarget.files?.[0] ?? null)}
            />
          </label>
          {selectedImage ? (
            <button type="button" aria-keyshortcuts="F2" onClick={() => onImageChange(null)} className="ml-2 inline-flex items-center gap-1.5 text-xs font-medium text-red-500 hover:text-red-700">Remove image <Kbd>F2</Kbd></button>
          ) : existingImageUrl && !existingImageRemoved ? (
            <button type="button" aria-keyshortcuts="F2" onClick={onRemoveExisting} className="ml-2 inline-flex items-center gap-1.5 text-xs font-medium text-red-500 hover:text-red-700">Remove current image <Kbd>F2</Kbd></button>
          ) : (
            <p className="mt-1.5 text-[11px] text-slate-400">JPEG, PNG or WebP · max 5 MB</p>
          )}
        </div>
      </div>
      <p className="pt-1 text-xs font-medium text-slate-500">Or choose a preset icon</p>
      <div className="grid grid-cols-5 gap-2">
        {productIcons.map((icon) => (
          <button
            type="button"
            key={icon.id}
            aria-label={`${icon.label} icon`}
            aria-pressed={!selectedImage && selectedIcon === icon.id}
            onClick={() => { onIconChange(icon.id); onImageChange(null); }}
            className={`flex h-14 flex-col items-center justify-center rounded-lg border text-[20px] transition ${!selectedImage && selectedIcon === icon.id ? "border-blue-500 bg-blue-50 ring-2 ring-blue-100" : "border-slate-100 bg-white hover:border-blue-200"}`}
          >
            <span>{icon.emoji || "✨"}</span>
            <span className="mt-0.5 text-[9px] font-medium text-slate-500">{icon.label}</span>
          </button>
        ))}
      </div>
      <p className="text-[11px] leading-4 text-slate-400">Auto follows the product category and name. A custom image takes priority over the selected preset.</p>
    </fieldset>
  );
}

// Product list rows: barcode (wide screens), product and category, stock
// (its own column from lg up), price.
const productRowGrid = "grid gap-3 grid-cols-[minmax(0,1fr)_5rem] lg:grid-cols-[minmax(0,1fr)_3.5rem_5.5rem] xl:grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_3.5rem_5.5rem]";
// Order table: qty, description, price (wider screens), amount, remove.
const orderRowGrid = "grid items-center gap-3 grid-cols-[6.25rem_minmax(0,1fr)_5.5rem_1.25rem] lg:grid-cols-[6.25rem_minmax(0,1fr)_5rem_5.5rem_1.25rem]";

function CartPanel({ lines, count, subtotal, total, onChange, onCheckout, onClear, onOpenDrawer, onSuspend, onRecall, heldCount, desktopKeys, selectedKey, onSelect, isProcessing, priceOf, hasWholesale, savings, onClose, customItems, onCustomChange, showImages, textScale = 100, wholesaleMode, onToggleWholesale }: {
  lines: CartLine[];
  count: number;
  subtotal: number;
  total: number;
  onChange: (lineKey: string, difference: number) => void;
  onCheckout: () => void;
  onClear: () => void;
  onOpenDrawer: () => void;
  onSuspend: () => void;
  onRecall: () => void;
  heldCount: number;
  desktopKeys: boolean;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  isProcessing: boolean;
  priceOf: (product: Product, wholesale: boolean) => number;
  hasWholesale: boolean;
  savings: number;
  onClose: () => void;
  customItems: CustomItem[];
  onCustomChange: (id: string, difference: number) => void;
  showImages: boolean;
  textScale?: number;
  wholesaleMode: boolean;
  onToggleWholesale: () => void;
}) {
  const stepButton = "grid h-7 w-7 place-items-center rounded-md border border-slate-200 text-slate-500 hover:border-blue-300 hover:text-blue-600 dark:border-slate-700";
  const listRef = useRef<HTMLDivElement>(null);
  const lineKeys = [...lines.map((line) => line.key), ...customItems.map((item) => item.id)];
  // Falls back to the last line, which is also what +/−/Delete act on then.
  const activeKey = selectedKey && lineKeys.includes(selectedKey) ? selectedKey : lineKeys.at(-1) ?? null;
  const activeQuantity = activeKey ? lines.find((line) => line.key === activeKey)?.quantity ?? customItems.find((item) => item.id === activeKey)?.quantity ?? 0 : 0;
  // Keep the line being worked on in view: a new item lands at the bottom of a
  // long order, and adding more of an existing item updates its line wherever
  // it is. Scrolls only the order list, and only as far as needed.
  useEffect(() => {
    const list = listRef.current;
    const row = activeKey ? list?.querySelector<HTMLElement>(`[data-line-key="${CSS.escape(activeKey)}"]`) : null;
    if (!list || !row) return;
    // Instant, not smooth: rapid scans each land in view right away.
    if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop;
    else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight;
  }, [activeKey, activeQuantity, lineKeys.length]);
  const rowPadding = showImages ? "py-2.5" : "py-2";
  const row = (item: { key: string; name: string; label: string; tag?: ReactNode; artwork?: ReactNode; unitPrice: number; retailPrice?: number; quantity: number; onChange: (difference: number) => void }) => (
    <li key={item.key} data-line-key={item.key} aria-current={item.key === activeKey || undefined} onClick={() => onSelect(item.key)} className={`${orderRowGrid} border-l-[3px] px-4 transition-colors ${rowPadding} ${item.key === activeKey ? "border-l-blue-500 bg-blue-50/70 dark:bg-blue-950/40" : "border-l-transparent"}`}>
      <span className="flex items-center gap-1.5">
        <button type="button" aria-label={`Remove one ${item.label}`} onClick={() => item.onChange(-1)} className={stepButton}><Minus size={12} /></button>
        <span className="min-w-6 text-center font-mono text-sm font-bold tabular-nums">{formatQuantity(item.quantity)}</span>
        <button type="button" aria-label={`Add one ${item.label}`} onClick={() => item.onChange(1)} className={stepButton}><Plus size={12} /></button>
      </span>
      <span className="flex min-w-0 items-center gap-2.5">
        {showImages && item.artwork}
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-[13px] font-semibold"><span className="truncate">{item.name}</span>{item.tag}</span>
          <span className="block text-[11px] text-slate-400 lg:hidden"><span className="font-mono text-black dark:text-white">{money(item.unitPrice)}</span> each</span>
        </span>
      </span>
      <span className="hidden text-right font-mono text-xs tabular-nums text-black dark:text-white lg:block">{money(item.unitPrice)}{item.retailPrice !== undefined && item.retailPrice !== item.unitPrice && <span className="block text-[10px] text-slate-400 line-through">{money(item.retailPrice)}</span>}</span>
      <span className="text-right font-mono text-[13px] font-bold tabular-nums text-black dark:text-white">{money(lineAmount(item.unitPrice, item.quantity))}</span>
      <button type="button" aria-label={`Remove ${item.label} from order`} onClick={() => item.onChange(-item.quantity)} className="justify-self-end text-slate-300 hover:text-red-500"><Trash2 size={14} /></button>
    </li>
  );
  const tag = (text: string, className: string) => <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${className}`}>{text}</span>;

  return (
    <aside aria-label="Current order" style={{ zoom: textScale / 100 }} className="flex h-full flex-col overflow-hidden border-l border-slate-100 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 md:rounded-2xl md:border md:shadow-[0_3px_16px_rgba(20,45,90,0.035)]">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        <ShoppingCart size={17} className="text-blue-600" />
        <h2 className="text-sm font-semibold">Current order</h2>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-slate-800">{count} {count === 1 ? "item" : "items"}</span>
        {hasWholesale && <span className="hidden rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 2xl:inline">Includes wholesale</span>}
        {/* Wraps as a group, kept to the right, when the panel is narrow. */}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <button type="button" disabled={!heldCount} onClick={onRecall} aria-keyshortcuts="Control+R" title="Recall a saved order (Ctrl+R)" className="relative flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 text-[11px] font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-300 dark:hover:bg-blue-950"><History size={14} />Recall<Kbd>Ctrl R</Kbd>{heldCount > 0 && <span className="absolute -right-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-blue-600 px-1 font-mono text-[9px] font-bold text-white">{heldCount}</span>}</button>
          <button type="button" disabled={!count} onClick={onClear} aria-keyshortcuts="F9" title="Clear the order (F9)" className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 text-[11px] font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950"><Trash2 size={14} />Clear<Kbd>F9</Kbd></button>
          <button type="button" role="switch" aria-checked={wholesaleMode} aria-keyshortcuts="F7" onClick={onToggleWholesale} title={wholesaleMode ? "Items you add now get wholesale prices" : "Turn on before adding bulk items"} className={`flex h-8 shrink-0 items-center gap-2 rounded-lg border px-2.5 text-[11px] font-semibold transition ${wholesaleMode ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200" : "border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"}`}>
            <span className={`relative h-4 w-7 shrink-0 rounded-full transition ${wholesaleMode ? "bg-emerald-600" : "bg-slate-300 dark:bg-slate-600"}`}><span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${wholesaleMode ? "left-[14px]" : "left-0.5"}`} /></span>
            Wholesale {wholesaleMode ? "on" : "off"}<Kbd>F7</Kbd>
          </button>
        </div>
        <button type="button" aria-label="Close order panel" onClick={onClose} className="-mr-2 rounded-lg p-2 text-slate-400 hover:bg-slate-50 md:hidden"><X size={18} /></button>
      </div>
      {wholesaleMode && <p className="shrink-0 border-b border-emerald-200 bg-emerald-50 px-4 py-1.5 text-[11px] text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200">Wholesale mode: items you add now get wholesale prices.</p>}
      <div aria-hidden="true" className={`${orderRowGrid} shrink-0 border-b border-slate-100 bg-slate-50/80 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:border-slate-800 dark:bg-slate-800/60`}>
        <span className="pl-1">Qty</span><span>Description</span><span className="hidden text-right lg:block">Price</span><span className="text-right">Amount</span><span />
      </div>
      <div ref={listRef} data-order-list className="relative min-h-[120px] flex-1 overflow-y-auto">
        {lines.length + customItems.length > 0 ? (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {lines.map(({ key, product, wholesale, quantity }) => row({
              key,
              name: product.name,
              label: `${product.name}${wholesale ? " (wholesale)" : ""}`,
              tag: wholesale ? tag(product.wholesalePrice > 0 ? "Wholesale" : "No wholesale price", "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300") : undefined,
              artwork: <ProductArtwork product={product} className="h-9 w-9 shrink-0 rounded-lg text-lg" />,
              unitPrice: priceOf(product, wholesale),
              retailPrice: product.price,
              quantity,
              onChange: (difference) => onChange(key, difference),
            }))}
            {customItems.map((item) => row({
              key: item.id,
              name: item.description,
              label: item.description,
              tag: tag("Custom", "bg-slate-100 text-slate-500 dark:bg-slate-800"),
              artwork: <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800"><PenLine size={16} /></span>,
              unitPrice: item.unitPrice,
              quantity: item.quantity,
              onChange: (difference) => onCustomChange(item.id, difference),
            }))}
          </ul>
        ) : (
          <div className="flex h-full min-h-[180px] flex-col items-center justify-center text-center"><div className="grid h-12 w-12 place-items-center rounded-full bg-blue-50 text-blue-500 dark:bg-blue-950"><ScanBarcode size={20} /></div><p className="mt-3 text-xs font-semibold text-slate-700 dark:text-slate-200">No items yet</p><p className="mt-1 text-[11px] text-slate-400">Scan a barcode or pick a product from the list.</p></div>
        )}
      </div>
      <div className="shrink-0 border-t border-slate-100 px-4 py-3 dark:border-slate-800">
        {lineKeys.length > 0 && <p className="mb-2 hidden flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-400 sm:flex"><span><Kbd>+</Kbd> <Kbd>−</Kbd> quantity</span><span><Kbd>Del</Kbd> remove</span><span><Kbd>↑↓</Kbd> pick line</span><span><Kbd>Ctrl Z</Kbd> undo add</span></p>}
        <div className="space-y-1.5 text-xs">
          <div className="flex justify-between text-slate-500"><span>Subtotal <span className="text-slate-400">({count} items)</span></span><span className="font-mono font-medium tabular-nums text-black dark:text-white">{money(hasWholesale ? subtotal + savings : subtotal)}</span></div>
          {hasWholesale && savings > 0 && <div className="flex justify-between text-emerald-700 dark:text-emerald-400"><span>Wholesale savings</span><span className="font-mono font-medium tabular-nums">−{money(savings)}</span></div>}
          <div className="flex items-baseline justify-between border-t border-dashed border-slate-200 pt-2 dark:border-slate-700"><span className="text-sm font-semibold">Total</span><span className="font-mono text-2xl font-bold tabular-nums text-black dark:text-white">{money(total)}</span></div>
        </div>
        {/* Colour says what a button does: yellow saves for later, grey is the
            drawer, green checks out (blue Recall and red Clear are in the header). */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" disabled={!count} onClick={onSuspend} aria-keyshortcuts="Control+S" title="Save this order for later (Ctrl+S)" className="flex h-12 flex-col items-center justify-center gap-0.5 rounded-xl border text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-950"><span className="flex items-center gap-1.5"><CirclePause size={15} />Save</span><Kbd>Ctrl S</Kbd></button>
          <button type="button" onClick={onOpenDrawer} className="flex h-12 flex-col items-center justify-center gap-0.5 rounded-xl border text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"><span className="flex items-center gap-1.5"><Banknote size={15} />Drawer</span>{desktopKeys && <Kbd>F6</Kbd>}</button>
        </div>
        <button type="button" disabled={!count || isProcessing} onClick={onCheckout} aria-keyshortcuts="F4" className="mt-2 flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-bold text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none dark:disabled:bg-slate-800"><CreditCard size={18} /> {isProcessing ? "Processing…" : "Checkout"}{!isProcessing && <Kbd>F4</Kbd>}</button>
      </div>
    </aside>
  );
}

function InventoryView({ products, shortfalls, onResolveShortfalls, onAdd, onEditPrices, onEditImage, onRemove, onImport, onRestock }: {
  products: Product[];
  shortfalls: StockShortfall[];
  onResolveShortfalls: (ids: string[]) => void;
  onAdd: () => void;
  onEditPrices: (product: Product) => void;
  onEditImage: (product: Product) => void;
  onRemove: (product: Product) => void;
  onImport: () => void;
  onRestock: (product: Product) => void;
}) {
  const storeName = useContext(StoreNameContext);
  const lowStock = products.filter((product) => product.stock < 10).length;
  // Search (name, category or barcode) and pages, so large catalogs stay quick.
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const term = query.trim().toLowerCase();
  const compactTerm = compactBarcode(term);
  const matching = term
    ? products.filter((product) => product.name.toLowerCase().includes(term) || product.category.toLowerCase().includes(term) || (!!compactTerm && !!product.barcode?.toLowerCase().includes(compactTerm)))
    : products;
  const [sort, setSort] = useState<{ key: "name" | "category" | "price" | "stock"; descending: boolean }>({ key: "name", descending: false });
  const sorted = [...matching].sort((a, b) => {
    const order = sort.key === "price" ? a.price - b.price : sort.key === "stock" ? a.stock - b.stock : a[sort.key].localeCompare(b[sort.key]);
    return (sort.descending ? -order : order) || a.name.localeCompare(b.name);
  });
  const sortButton = (key: typeof sort.key, label: string) => (
    <button type="button" onClick={() => setSort((current) => ({ key, descending: current.key === key ? !current.descending : false }))} className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-slate-600" aria-label={`Sort by ${label}`}>
      {label}{sort.key === key && <span aria-hidden="true">{sort.descending ? "↓" : "↑"}</span>}
    </button>
  );
  const pageCount = Math.max(1, Math.ceil(matching.length / INVENTORY_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageItems = sorted.slice(currentPage * INVENTORY_PAGE_SIZE, (currentPage + 1) * INVENTORY_PAGE_SIZE);
  return (
    <section>
      <div className="mb-8 flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
        <PageTitle eyebrow={<><StoreName /> · Inventory</>} icon={<Store size={12} />} title="Inventory" subtitle="Keep your products and stock levels up to date." />
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onImport} className={headerButton}><FileSpreadsheet size={16} className="text-emerald-600" /> Import products</button>
          <DropdownMenu>
            <DropdownMenuTrigger disabled={products.length === 0} className="flex h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 text-[15px] font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 outline-none hover:border-blue-200 hover:text-blue-700 focus-visible:ring-2 focus-visible:ring-blue-300 disabled:opacity-50 data-[state=open]:border-blue-200 data-[state=open]:text-blue-700"><Download size={16} /> Export <ChevronDown size={14} /></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 rounded-xl border-slate-100 bg-white p-1 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900">
              <DropdownMenuLabel className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Export {products.length} products</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => exportInventoryExcel(products)} className="cursor-pointer rounded-lg text-xs focus:bg-blue-50 focus:text-blue-700 dark:focus:bg-slate-800"><FileSpreadsheet className="text-emerald-600" /><span><span className="block font-semibold">Excel (.xlsx)</span><span className="block text-[10px] text-slate-400">Editable; can be imported again</span></span></DropdownMenuItem>
              <DropdownMenuItem onSelect={() => exportInventoryPdf(products, storeName)} className="cursor-pointer rounded-lg text-xs focus:bg-blue-50 focus:text-blue-700 dark:focus:bg-slate-800"><Printer className="text-red-500" /><span><span className="block font-semibold">PDF report</span><span className="block text-[10px] text-slate-400">Print, or choose Save as PDF</span></span></DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <button type="button" onClick={onAdd} className={headerPrimaryButton}><PackagePlus size={18} /> Add product</button>
        </div>
      </div>
      {shortfalls.length > 0 && (
        <div role="alert" className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-2.5"><TriangleAlert size={16} className="mt-0.5 shrink-0" /><div><p className="text-sm font-semibold">Recount needed</p><p className="mt-0.5 leading-5">Sales made offline sold more than the recorded stock, so these products were set to 0. Count them, restock to the real amount, then mark them recounted.</p></div></div>
            <button type="button" onClick={() => onResolveShortfalls(shortfalls.map((item) => item.id))} className="h-8 shrink-0 rounded-lg bg-amber-600 px-3 font-semibold text-white hover:bg-amber-700">Mark all recounted</button>
          </div>
          <ul className="mt-3 divide-y divide-amber-200/70 rounded-xl bg-white/70 dark:divide-amber-900 dark:bg-slate-900/50">
            {shortfalls.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span><b className="font-semibold">{item.productName}</b>: {item.shortfall} more sold than recorded <span className="text-amber-700/80 dark:text-amber-200/70">· {item.createdAt.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" })}</span></span>
                <button type="button" onClick={() => onResolveShortfalls([item.id])} className="shrink-0 font-semibold text-amber-800 hover:underline dark:text-amber-200">Recounted</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mb-5 text-sm text-slate-500">Import an Excel (.xlsx), CSV, or JSON file with Product Name, Category, Retail Price and Stock columns, plus optional Wholesale Price, Cost Price and Barcode. Use Import products to download the Excel template and preview changes before saving.</p>
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-100 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"><p className="text-base text-slate-600 dark:text-slate-300">Total products</p><p className="mt-3 font-mono text-[34px] font-bold leading-none">{products.length}</p></div>
        <div className="rounded-2xl border border-slate-100 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"><p className="text-base text-slate-600 dark:text-slate-300">Units in stock</p><p className="mt-3 font-mono text-[34px] font-bold leading-none">{products.reduce((sum, product) => sum + product.stock, 0)}</p></div>
        <div className="rounded-2xl border border-slate-100 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"><p className="text-base text-slate-600 dark:text-slate-300">Running low</p><p className="mt-3 font-mono text-[34px] font-bold leading-none">{lowStock}<span className="ml-3 font-sans text-sm font-medium text-amber-600">needs attention</span></p></div>
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
        <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-7 py-5 dark:border-slate-800"><div><h2 className="text-xl font-semibold">All products</h2><p className="mt-1 text-[15px] text-slate-500">{products.length.toLocaleString("en-PH")} items in your catalog{term && <> · {matching.length.toLocaleString("en-PH")} match</>}</p></div><label className="flex h-11 w-full max-w-[320px] items-center gap-2.5 rounded-xl border border-slate-200 px-4 focus-within:border-blue-400 dark:border-slate-700"><Search size={14} className="shrink-0 text-slate-400" /><input value={query} onChange={(event) => { setQuery(event.currentTarget.value); setPage(0); }} placeholder="Search name, category or barcode" aria-label="Search products" className="w-full min-w-0 bg-transparent text-[15px] outline-none placeholder:text-slate-400" /></label></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50/70 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:bg-slate-800/60"><tr><th className="px-5 py-3" aria-sort={sort.key === "name" ? (sort.descending ? "descending" : "ascending") : undefined}>{sortButton("name", "Product")}</th><th className="px-4 py-3" aria-sort={sort.key === "category" ? (sort.descending ? "descending" : "ascending") : undefined}>{sortButton("category", "Category")}</th><th className="px-4 py-3">Cost price</th><th className="px-4 py-3">Wholesale price</th><th className="px-4 py-3" aria-sort={sort.key === "price" ? (sort.descending ? "descending" : "ascending") : undefined}>{sortButton("price", "Retail price")}</th><th className="px-4 py-3" aria-sort={sort.key === "stock" ? (sort.descending ? "descending" : "ascending") : undefined}>{sortButton("stock", "Stock")}</th><th className="px-5 py-3 text-right">Actions</th></tr></thead><tbody className="divide-y divide-slate-100">{pageItems.map((product) => <tr key={product.id} className="hover:bg-slate-50/50"><td className="px-5 py-3.5"><div className="flex items-center gap-3"><ProductArtwork product={product} className="h-9 w-9 rounded-lg text-lg" /><span><span className="block font-semibold text-slate-700">{product.name}</span>{product.barcode && <span className="mt-0.5 flex items-center gap-1 font-mono text-[10px] text-slate-400"><ScanBarcode size={11} />{product.barcode}</span>}</span></div></td><td className="px-4 py-3.5 text-slate-500">{product.category}</td><td className="px-4 py-3.5 font-mono">{product.costPriceKnown ? money(product.costPrice) : <span className="text-amber-600">Not set</span>}</td><td className="px-4 py-3.5 font-mono">{product.wholesalePrice > 0 ? money(product.wholesalePrice) : <span className="text-slate-400" title="Not sold wholesale">—</span>}</td><td className="px-4 py-3.5 font-mono font-semibold">{money(product.price)}</td><td className="px-4 py-3.5"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${product.stock < 10 ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}><span className="font-mono">{product.stock}</span> in stock</span></td><td className="px-5 py-3.5 text-right"><div className="inline-flex items-center gap-1">
                <DropdownMenu>
                  <DropdownMenuTrigger aria-label={`Actions for ${product.name}`} title="Actions" className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 outline-none hover:bg-slate-100 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-blue-300 data-[state=open]:bg-slate-100 data-[state=open]:text-slate-700 dark:hover:bg-slate-800 dark:data-[state=open]:bg-slate-800">
                    <EllipsisVertical size={16} />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48 rounded-xl border-slate-100 bg-white p-1 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900">
                    <DropdownMenuLabel className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Actions</DropdownMenuLabel>
                    <DropdownMenuItem onSelect={() => onEditPrices(product)} className="cursor-pointer rounded-lg text-xs focus:bg-blue-50 focus:text-blue-700 dark:focus:bg-slate-800"><CircleDollarSign /> Edit details</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onEditImage(product)} className="cursor-pointer rounded-lg text-xs focus:bg-blue-50 focus:text-blue-700 dark:focus:bg-slate-800"><FileUp /> {product.imageUrl ? "Change image" : "Add image"}</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onRestock(product)} className="cursor-pointer rounded-lg text-xs focus:bg-blue-50 focus:text-blue-700 dark:focus:bg-slate-800"><PackagePlus /> Restock</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <button type="button" aria-label={`Remove ${product.name}`} title="Remove product" onClick={() => onRemove(product)} className="grid h-8 w-8 place-items-center rounded-lg text-slate-300 hover:bg-red-50 hover:text-red-500"><Trash2 size={15} /></button>
              </div></td></tr>)}</tbody></table></div>
        {matching.length === 0 && <p className="px-5 py-8 text-center text-xs text-slate-400">{term ? `No products match “${query.trim()}”.` : "No products yet."}</p>}
        {pageCount > 1 && (
          <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 text-xs text-slate-500 dark:border-slate-800">
            <span>{(currentPage * INVENTORY_PAGE_SIZE + 1).toLocaleString("en-PH")}–{Math.min((currentPage + 1) * INVENTORY_PAGE_SIZE, matching.length).toLocaleString("en-PH")} of {matching.length.toLocaleString("en-PH")}</span>
            <span className="flex items-center gap-1.5">
              <button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} className="h-8 rounded-lg border border-slate-200 px-3 font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">Previous</button>
              <span className="px-1.5">Page {currentPage + 1} of {pageCount}</span>
              <button type="button" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)} className="h-8 rounded-lg border border-slate-200 px-3 font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">Next</button>
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

function EmployeeView({ employees, onAdd, onRemove, onSetPassword }: {
  employees: Employee[];
  onAdd: () => void;
  onRemove: (employee: Employee) => void;
  onSetPassword: (employee: Employee) => void;
}) {
  return (
    <section>
      <div className="mb-8 flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
        <PageTitle eyebrow={<><StoreName /> · Employees</>} icon={<Store size={12} />} title="Team members" subtitle="Create and manage secure employee sign-in accounts." />
        <button type="button" onClick={onAdd} className={headerPrimaryButton}><UserPlus size={18} /> Add employee</button>
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
        <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-7 py-5 dark:border-slate-800"><div><h2 className="text-xl font-semibold">Employee accounts</h2><p className="mt-1 text-[15px] text-slate-500">{employees.length} active employee{employees.length === 1 ? "" : "s"}</p></div><Users size={18} className="text-slate-400" /></div>
        {employees.length > 0 ? <div className="divide-y divide-slate-100">{employees.map((employee) => <div key={employee.id} className="flex items-center justify-between gap-3 px-5 py-4"><div className="flex min-w-0 items-center gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-blue-50 text-sm font-bold text-blue-700">{employee.full_name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</div><div className="min-w-0"><p className="truncate text-sm font-semibold">{employee.full_name}</p><p className="mt-1 truncate text-xs text-slate-400">{employee.email}</p></div></div><div className="flex items-center gap-3"><span className="hidden rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-700 sm:inline">Employee</span><button type="button" onClick={() => onSetPassword(employee)} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-xs font-semibold text-blue-600 hover:bg-blue-50 dark:hover:bg-slate-800"><KeyRound size={14} /> Set password</button><button type="button" aria-label={`Remove ${employee.full_name}`} title="Remove employee" onClick={() => onRemove(employee)} className="rounded-lg p-2 text-slate-300 hover:bg-red-50 hover:text-red-500"><Trash2 size={15} /></button></div></div>)}</div> : <div className="grid min-h-48 place-items-center text-center"><div><Users size={26} className="mx-auto text-slate-300" /><p className="mt-3 text-sm font-semibold">No employees yet</p><p className="mt-1 text-xs text-slate-400">Create accounts for the people on your team.</p></div></div>}
      </div>
      <p className="mt-4 text-xs text-slate-400">Admins create employee passwords and can set a new one any time with Set password. Share passwords securely. Employee accounts cannot access inventory or team settings.</p>
    </section>
  );
}

function AccountView({
  email,
  name,
  role,
  isProcessing,
  salesResetConfirmation,
  onSalesResetConfirmationChange,
  onUpdateEmail,
  onUpdatePassword,
  onUpdateName,
  onResetSalesHistory,
}: {
  email: string;
  name: string;
  role: Role;
  isProcessing: boolean;
  salesResetConfirmation: string;
  onSalesResetConfirmationChange: (value: string) => void;
  onUpdateEmail: (event: FormEvent<HTMLFormElement>) => void;
  onUpdatePassword: (event: FormEvent<HTMLFormElement>) => void;
  onUpdateName: (event: FormEvent<HTMLFormElement>) => void;
  onResetSalesHistory: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <section className="mx-auto max-w-3xl">
      <div className="mb-8"><PageTitle eyebrow={<><StoreName /> · Account</>} icon={<Store size={12} />} title="Account settings" subtitle="Manage your sign-in details and store history." /></div>
      <div className="space-y-5">
        <form onSubmit={onUpdateName} className="rounded-2xl border border-slate-100 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 sm:p-6">
          <div className="mb-5"><h2 className="text-xl font-semibold">Account name</h2><p className="mt-1 text-[15px] leading-6 text-slate-500">This name appears in the POS workspace and account profile.</p></div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">Full name<input required maxLength={100} name="fullName" defaultValue={name} autoComplete="name" className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50 dark:border-slate-700 dark:bg-slate-950" /></label>
          <button type="submit" disabled={isProcessing} className="mt-4 h-10 rounded-lg bg-blue-600 px-4 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{isProcessing ? "Saving…" : "Update name"}</button>
        </form>
        <form onSubmit={onUpdateEmail} className="rounded-2xl border border-slate-100 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 sm:p-6">
          <div className="mb-5"><h2 className="text-xl font-semibold">Email address</h2><p className="mt-1 text-[15px] leading-6 text-slate-500">A confirmation email may be required before your new address becomes active.</p></div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">Current email<input disabled value={email} className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300" /></label>
          <label className="mt-3 block text-xs font-medium text-slate-600 dark:text-slate-300">New email address<input required type="email" name="email" autoComplete="email" placeholder="you@yourstore.com" className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50 dark:border-slate-700 dark:bg-slate-950" /></label>
          <button type="submit" disabled={isProcessing} className="mt-4 h-10 rounded-lg bg-blue-600 px-4 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{isProcessing ? "Saving…" : "Update email"}</button>
        </form>
        <form onSubmit={onUpdatePassword} className="rounded-2xl border border-slate-100 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 sm:p-6">
          <div className="mb-5"><h2 className="text-xl font-semibold">Change password</h2><p className="mt-1 text-[15px] leading-6 text-slate-500">Use at least 8 characters. Your password is managed securely by Supabase Auth.</p></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">New password<input required minLength={8} type="password" name="password" autoComplete="new-password" className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50 dark:border-slate-700 dark:bg-slate-950" /></label>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">Confirm new password<input required minLength={8} type="password" name="confirmPassword" autoComplete="new-password" className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50 dark:border-slate-700 dark:bg-slate-950" /></label>
          </div>
          <button type="submit" disabled={isProcessing} className="mt-4 h-10 rounded-lg bg-blue-600 px-4 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{isProcessing ? "Saving…" : "Update password"}</button>
        </form>
        {role === "admin" && <form onSubmit={onResetSalesHistory} className="rounded-2xl border border-red-200 bg-red-50/70 p-5 dark:border-red-900/70 dark:bg-red-950/30 sm:p-6">
          <div className="mb-4 flex items-start gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-200"><Trash2 size={17} /></div><div><h2 className="text-sm font-semibold text-red-900 dark:text-red-100">Reset sales history</h2><p className="mt-1 text-xs leading-5 text-red-800/80 dark:text-red-200/80">Permanently deletes all orders and their order items. Products, current stock, employee accounts, and stock movement history are not changed. This cannot be undone.</p></div></div>
          <label className="block text-xs font-medium text-red-900 dark:text-red-100">Type RESET SALES HISTORY to confirm<input required value={salesResetConfirmation} onChange={(event) => onSalesResetConfirmationChange(event.currentTarget.value)} autoComplete="off" className="mt-1.5 h-10 w-full rounded-lg border border-red-200 bg-white px-3 text-sm outline-none focus:border-red-500 focus:ring-4 focus:ring-red-100 dark:border-red-900 dark:bg-slate-950 dark:text-white dark:focus:ring-red-950" /></label>
          <button type="submit" disabled={isProcessing || salesResetConfirmation !== "RESET SALES HISTORY"} className="mt-4 h-10 rounded-lg bg-red-600 px-4 text-xs font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50">{isProcessing ? "Resetting…" : "Permanently delete sales history"}</button>
        </form>}
      </div>
    </section>
  );
}


function OrderStatusBadge({ order }: { order: Order }) {
  if (order.syncStatus === "failed") {
    return <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-[10px] font-semibold text-red-700 dark:bg-red-950 dark:text-red-300"><TriangleAlert size={11} /> Sync failed</span>;
  }
  if (order.syncStatus === "pending") {
    return <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-300"><CloudUpload size={11} /> Pending sync</span>;
  }
  if (order.status === "voided") {
    return <span title={order.voidReason ?? undefined} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-600 line-through decoration-slate-400 dark:bg-slate-800 dark:text-slate-300"><VoidIcon size={11} /> Voided</span>;
  }
  if (order.refundedTotal > 0) {
    const full = order.refundedTotal >= order.total;
    return <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2.5 py-1 text-[10px] font-semibold text-violet-700 dark:bg-violet-950 dark:text-violet-300"><RefundIcon size={11} /> {full ? "Refunded" : `Partly refunded · ${money(order.refundedTotal)}`}</span>;
  }
  return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"><Check size={11} /> Completed</span>;
}

const orderDateTime = (date: Date) => ({
  date: date.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }),
  time: date.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }),
});

function OrdersView({ orders, isAdmin, userName, connected, onPrint, onVoid, onRefund }: {
  orders: Order[];
  isAdmin: boolean;
  userName: string;
  connected: boolean;
  onPrint: (order: Order) => void;
  onVoid: (order: Order) => void;
  onRefund: (order: Order) => void;
}) {
  const [paymentFilter, setPaymentFilter] = useState<"all" | PaymentMethod>("all");
  const [detailsOrder, setDetailsOrder] = useState<Order | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const visibleOrders = orders.filter((order) => paymentFilter === "all" || order.paymentMethod === paymentFilter);

  async function copyOrderId(order: Order) {
    try {
      await navigator.clipboard.writeText(order.fullId);
      setCopiedId(order.fullId);
      window.setTimeout(() => setCopiedId((current) => (current === order.fullId ? null : current)), 2000);
    } catch {
      setCopiedId(null);
    }
  }

  return (
    <section>
      <div className="mb-8"><PageTitle eyebrow={<><StoreName /> · Orders</>} icon={<Store size={12} />} title="Recent orders" subtitle="A quick look at your latest transactions." /></div>
      <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800 sm:flex-row sm:items-center">
          <div><h2 className="text-xl font-semibold">Order history</h2><p className="mt-1 text-[15px] text-slate-500">Showing {visibleOrders.length} of {orders.length} recent transactions</p></div>
          <div className="flex gap-1 rounded-lg bg-slate-50 p-1 dark:bg-slate-800" aria-label="Filter orders by payment method">
            {(["all", "cash", "e_wallet", "card"] as const).map((method) => <button key={method} type="button" aria-pressed={paymentFilter === method} onClick={() => setPaymentFilter(method)} className={`rounded-lg px-3.5 py-2 text-sm font-semibold capitalize ${paymentFilter === method ? "bg-white text-blue-700 shadow-sm dark:bg-slate-700 dark:text-blue-300" : "text-slate-500 hover:text-slate-700"}`}>{method === "all" ? "All payments" : paymentMethodLabel(method)}</button>)}
          </div>
        </div>
        {visibleOrders.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-slate-50/70 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:bg-slate-800/60">
                <tr><th className="px-5 py-3">Status</th><th className="px-4 py-3">Date &amp; Time</th><th className="px-4 py-3">Cashier</th><th className="px-4 py-3">Payment Method</th><th className="px-4 py-3 text-right">Total</th><th className="px-5 py-3 text-right">Actions</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {visibleOrders.map((order) => {
                  const { date, time } = orderDateTime(order.createdAt);
                  return (
                    <tr key={order.fullId} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                      <td className="px-5 py-3.5"><OrderStatusBadge order={order} /><p className="mt-1.5 font-mono text-[10px] text-slate-400">{order.id}</p></td>
                      <td className="px-4 py-3.5"><p className="font-medium text-slate-700 dark:text-slate-200">{date}</p><p className="mt-0.5 text-[11px] text-slate-400">{time}</p></td>
                      <td className="px-4 py-3.5 font-medium text-slate-700 dark:text-slate-200">{order.employeeName}</td>
                      <td className="px-4 py-3.5"><p className="font-medium text-slate-700 dark:text-slate-200">{paymentMethodLabel(order.paymentMethod)}{order.isWholesale && <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">Wholesale</span>}</p><p className="mt-0.5 text-[11px] text-slate-400">{order.paymentReferenceLast4 ? `Ref •••• ${order.paymentReferenceLast4}` : order.cashReceived !== null ? `Change ${money(order.changeDue ?? 0)}` : ""}</p></td>
                      <td className="px-4 py-3.5 text-right"><p className="font-mono text-sm font-semibold">{money(order.total)}</p><p className="mt-0.5 text-[11px] text-slate-400">{order.items} item{order.items === 1 ? "" : "s"}</p></td>
                      <td className="px-5 py-3.5 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger aria-label={`Actions for order ${order.id}`} title="Actions" className="inline-grid h-8 w-8 place-items-center rounded-lg text-slate-400 outline-none hover:bg-slate-100 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-blue-300 data-[state=open]:bg-slate-100 data-[state=open]:text-slate-700 dark:hover:bg-slate-800 dark:data-[state=open]:bg-slate-800">
                            <EllipsisVertical size={16} />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48 rounded-xl border-slate-100 bg-white p-1 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900">
                            <DropdownMenuLabel className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Actions</DropdownMenuLabel>
                            <DropdownMenuItem onSelect={() => setDetailsOrder(order)} className="cursor-pointer rounded-lg text-xs focus:bg-blue-50 focus:text-blue-700 dark:focus:bg-slate-800"><ReceiptText /> View details</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => void copyOrderId(order)} className="cursor-pointer rounded-lg text-xs focus:bg-blue-50 focus:text-blue-700 dark:focus:bg-slate-800"><ClipboardList /> Copy order number</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => onPrint(order)} className="cursor-pointer rounded-lg text-xs focus:bg-blue-50 focus:text-blue-700 dark:focus:bg-slate-800"><Printer /> Print receipt</DropdownMenuItem>
                            {!order.syncStatus && order.status !== "voided" && (isAdmin || (order.employeeName === userName && Date.now() - order.createdAt.getTime() < 30 * 60_000)) && order.refundedTotal === 0 && (
                              <DropdownMenuItem disabled={!connected} onSelect={() => onVoid(order)} className="cursor-pointer rounded-lg text-xs text-red-600 focus:bg-red-50 focus:text-red-700 dark:focus:bg-slate-800"><VoidIcon /> Void sale{connected ? "" : " (needs connection)"}</DropdownMenuItem>
                            )}
                            {isAdmin && !order.syncStatus && order.status !== "voided" && order.refundedTotal < order.total && (
                              <DropdownMenuItem disabled={!connected} onSelect={() => onRefund(order)} className="cursor-pointer rounded-lg text-xs text-red-600 focus:bg-red-50 focus:text-red-700 dark:focus:bg-slate-800"><RefundIcon /> Refund items{connected ? "" : " (needs connection)"}</DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-16 text-center text-sm text-slate-400">{orders.length ? `No ${paymentFilter === "all" ? "" : `${paymentMethodLabel(paymentFilter)} `}orders in the recent transactions.` : "No orders yet. Completed sales will show up here."}</div>
        )}
      </div>
      {copiedId && <p role="status" className="mt-3 text-xs text-emerald-700">Order number copied.</p>}
      {detailsOrder && <OrderDetailsDialog order={detailsOrder} onClose={() => setDetailsOrder(null)} />}
    </section>
  );
}

function OrderDetailsDialog({ order, onClose }: { order: Order; onClose: () => void }) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);
  const { date, time } = orderDateTime(order.createdAt);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="order-details-title" className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
        <div className="mb-5 flex items-start justify-between">
          <div><p className="text-xs font-semibold text-blue-600">ORDER DETAILS</p><h2 id="order-details-title" className="mt-1 font-mono text-xl font-semibold">{order.id}</h2><p className="mt-1 text-sm text-slate-500">{date} · {time} · {order.employeeName}</p></div>
          <button type="button" aria-label="Close order details (Esc)" onClick={onClose} className="flex items-center gap-1.5 rounded-lg p-2 text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"><Kbd>Esc</Kbd><X size={18} /></button>
        </div>
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100 dark:divide-slate-800 dark:border-slate-800">
          {order.lines.map((line, index) => (
            <li key={`${line.name}-${index}`} className="flex items-start justify-between gap-3 px-4 py-3 text-xs">
              <div className="min-w-0"><p className="flex items-center gap-1.5 font-semibold"><span className="truncate">{line.name}</span>{line.custom && <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800">Custom</span>}{line.wholesale && <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">Wholesale</span>}</p><p className="mt-0.5 text-[11px] text-slate-400"><span className="font-mono">{formatQuantity(line.quantity)} × {money(line.unitPrice)}</span></p></div>
              <span className="shrink-0 font-mono font-semibold">{money(lineAmount(line.unitPrice, line.quantity))}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-4 space-y-2 text-xs">
          <div className="flex justify-between text-slate-500"><dt>Payment</dt><dd className="font-medium text-slate-700 dark:text-slate-200">{paymentMethodLabel(order.paymentMethod)}{order.paymentReferenceLast4 ? ` · Ref •••• ${order.paymentReferenceLast4}` : ""}{order.isWholesale ? " · Wholesale" : ""}</dd></div>
          {order.cashReceived !== null && <div className="flex justify-between text-slate-500"><dt>Cash received</dt><dd className="font-mono font-medium text-slate-700 dark:text-slate-200">{money(order.cashReceived)}</dd></div>}
          {order.cashReceived !== null && <div className="flex justify-between text-slate-500"><dt>Change</dt><dd className="font-mono font-medium text-slate-700 dark:text-slate-200">{money(order.changeDue ?? 0)}</dd></div>}
          <div className="flex items-center justify-between border-t border-dashed border-slate-200 pt-3 dark:border-slate-700"><dt className="text-sm font-semibold">Total</dt><dd className="font-mono text-lg font-bold">{money(order.total)}</dd></div>
        </dl>
        <div className="mt-4 flex items-center gap-2 text-[11px] text-slate-500"><OrderStatusBadge order={order} /> {order.items} item{order.items === 1 ? "" : "s"}</div>{order.syncStatus && <p className="mt-2 text-[11px] leading-4 text-slate-500">{order.syncStatus === "failed" && order.syncError ? `The server refused this sale: ${order.syncError}` : "Saved on this computer. It syncs to the store database automatically when online."}</p>}
      </div>
    </div>
  );
}
