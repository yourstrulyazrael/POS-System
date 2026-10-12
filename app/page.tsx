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
import { deletePendingOrder, isNetworkError, listPendingOrders, readCache, savePendingOrder, storedSessionUserId, writeCache, type PendingOrder } from "@/lib/offline-store";
import { buildCashCountReport, buildRefundReceipt, buildSaleReceipt, defaultStoreDetails, type StoreDetails } from "@/lib/receipts";
import { checkForUpdates, defaultHardwareSettings, installUpdate, loadHardwareSettings, openCashDrawer, printDocument, saveHardwareSettings, supportsLiveUpdates, watchUpdateStatus, type HardwareSettings, type UpdateStatus } from "@/lib/hardware";
import { rememberOfflineCredential, verifyOfflineCredential } from "@/lib/offline-auth";
import { closeSession, expectedCash, openSession, readCurrentSession, readSessionOutbox, recordInSession, removeFromSessionOutbox, type CashSession } from "@/lib/cash-session";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { AnalyticsReportsView } from "@/components/analytics-reports";
import { SmoothLineChart } from "@/components/smooth-line-chart";
import { ShiftHistoryView } from "@/components/shift-history";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useFunctionKeys, type FunctionKey } from "@/lib/use-function-keys";
import { defaultPosLayout, loadPosLayout, normalizeLayout, savePosLayout, type PosLayout } from "@/lib/pos-layout";
import { CartResizeHandle, PosLayoutPanel } from "@/components/pos-layout-panel";
import { CashCountDialog, DrawerStatusButton, HardwareSettingsCard, OpenDrawerDialog, ReconnectBanner, RefundDialog, RefundIcon, StoreDetailsCard, UpdateReadyBar, UpdatesCard, VoidDialog, VoidIcon } from "@/components/pos-dialogs";
import { buildProductsXlsx, buildTemplateXlsx, importColumns, readProductFile, type RawProductRecord } from "@/lib/product-import";
import { FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
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
type OrderLine = { id?: string; name: string; quantity: number; unitPrice: number; custom: boolean; refundedQuantity: number };
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
  order_items: { id: string; quantity: number; product_name: string; unit_price: number | string; product_id: string | null; refund_items: { quantity: number }[] }[];
  status: "completed" | "voided";
  refunded_total: number | string;
  void_reason: string | null;
  client_order_id: string | null;
  payment_method: PaymentMethod;
  payment_reference_last4: string | null;
  cash_received: number | string | null;
  change_due: number | string | null;
  employee_name: string;
  employee_id?: string | null;
  is_wholesale: boolean;
};
// A destructive action waiting for the user to confirm it.
type ConfirmAction = { title: string; message: string; confirmLabel: string; onConfirm: () => Promise<void> };
// A "Quick Add" line for something not in the product catalog.
type CustomItem = { id: string; description: string; quantity: number; unitPrice: number };
type Employee = { id: string; email: string; full_name: string; role: "employee" };
type DashboardStats = { sales_total: number; orders_today: number; active_products: number; units_in_stock: number; active_employees: number };
type SalesPeriod = "today" | "7days" | "30days";
type Page = "dashboard" | "analytics" | "pos" | "inventory" | "orders" | "shifts" | "employees" | "account";

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
    id: `#${sale.clientOrderId.slice(0, 8)}`,
    fullId: sale.clientOrderId,
    createdAt,
    lines: sale.items.map((item) => ({
      name: item.kind === "product" ? item.name : item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      custom: item.kind === "custom",
      refundedQuantity: 0,
    })),
    items: sale.items.reduce((sum, item) => sum + item.quantity, 0),
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

async function fetchWorkspaceData(includeAdminStats = false, period: SalesPeriod = "today") {
  const supabase = createClient();
  const [productsResult, ordersResult] = await Promise.all([
    supabase.from("products").select("id, name, category, cost_price, cost_price_known, wholesale_price, price, stock, image_icon, image_url, barcode").eq("active", true).order("name").returns<ProductRow[]>(),
    supabase.from("orders").select("id, total, created_at, payment_method, payment_reference_last4, cash_received, change_due, employee_name, is_wholesale, status, refunded_total, void_reason, client_order_id, order_items(id, quantity, product_name, unit_price, product_id, refund_items(quantity))").order("created_at", { ascending: false }).limit(50).returns<OrderRow[]>(),
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
      id: `#${(order.client_order_id ?? order.id).slice(0, 8)}`,
      fullId: order.id,
      createdAt: new Date(order.created_at),
      // A line without a product_id is a custom item (or a since-deleted product).
      lines: order.order_items.map((item) => ({
        id: item.id,
        name: item.product_name,
        quantity: item.quantity,
        unitPrice: Number(item.unit_price),
        custom: item.product_id === null,
        refundedQuantity: (item.refund_items ?? []).reduce((sum, refunded) => sum + refunded.quantity, 0),
      })),
      items: order.order_items.reduce((sum, item) => sum + item.quantity, 0),
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

// A POS entry is "<quantity>/<barcode or name>" or just "<barcode or name>",
// e.g. "24/4800016644290" adds 24 of that item.
function parseSaleEntry(value: string) {
  const match = /^\s*(\d+)\s*\/\s*(.*)$/.exec(value);
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
// Returns null for an empty value and undefined for an invalid one.
function normalizeBarcode(value: unknown) {
  if (value === undefined || value === null) return null;
  const barcode = String(value).trim();
  if (!barcode) return null;
  return /^[!-~]{1,64}$/.test(barcode) ? barcode : undefined;
}

function productSaveError(error: unknown, fallback: string) {
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
  products: (ImportedProduct & { sourceRow: number; isUpdate: boolean })[];
  errors: string[];
  newCategories: string[];
  // Active products the file doesn't include (removed if imported as a master list).
  removable: string[];
};

function validateImportedProducts(records: RawProductRecord[]) {
  const products: (ImportedProduct & { sourceRow: number })[] = [];
  const errors: string[] = [];
  const seenNames = new Map<string, number>();
  const seenBarcodes = new Map<string, number>();
  for (const record of records) {
    const row = `Row ${record.sourceRow}`;
    const problems: string[] = [];
    const name = (record.name ?? "").trim();
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
    if (costText && (!Number.isFinite(costPrice) || costPrice < 0)) problems.push("a cost price of ₱0 or more (or blank)");
    if (wholesaleText && (!Number.isFinite(wholesalePrice) || wholesalePrice < 0)) problems.push("a wholesale price of ₱0 or more (or blank)");
    if (barcode === undefined) problems.push("a barcode without spaces (up to 64 characters), or blank");
    if (!productIcons.some((icon) => icon.id === imageIcon)) problems.push("a valid image icon, or blank");
    if (problems.length) {
      errors.push(`${row} needs ${problems.join(", ")}.`);
      continue;
    }
    const nameKey = name.toLowerCase();
    if (seenNames.has(nameKey)) {
      errors.push(`${row} repeats “${name}” from row ${seenNames.get(nameKey)}. Each product name can appear once.`);
      continue;
    }
    seenNames.set(nameKey, record.sourceRow);
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
  const headerRef = useRef<HTMLElement>(null);
  const cartWrapperRef = useRef<HTMLDivElement>(null);
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
  const activeCategory = categories.includes(category) ? category : "All items";
  const visibleProducts = useMemo(
    () =>
      products.filter(
        (product) =>
          (activeCategory === "All items" || product.category === activeCategory) &&
          (product.name.toLowerCase().includes(searchTerm.toLowerCase()) || (!!searchTerm && product.barcode === searchTerm)),
      ),
    [activeCategory, products, searchTerm],
  );
  const cartItems = products.filter((product) => cart[product.id]);
  const customTotal = customItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const itemCount = Object.values(cart).reduce((total, quantity) => total + quantity, 0) + customItems.reduce((sum, item) => sum + item.quantity, 0);
  // Wholesale mode charges each product's wholesale price; products without
  // one (₱0) stay at retail. place_order applies the same rule server-side.
  // Custom items always use the price entered for them.
  const unitPrice = (product: Product) => (wholesaleMode && product.wholesalePrice > 0 ? product.wholesalePrice : product.price);
  const subtotal = cartItems.reduce((total, product) => total + unitPrice(product) * cart[product.id], 0) + customTotal;
  const total = Math.round(subtotal * 100) / 100;
  const retailTotal = Math.round((cartItems.reduce((sum, product) => sum + product.price * cart[product.id], 0) + customTotal) * 100) / 100;
  const wholesaleSavings = Math.round((retailTotal - total) * 100) / 100;
  const itemsWithoutWholesalePrice = cartItems.filter((product) => product.wholesalePrice <= 0);
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
    const timer = window.setTimeout(() => setNotice((current) => (current === notice ? "" : current)), 5000);
    return () => window.clearTimeout(timer);
  }, [notice, noticeIsSuccess, showCheckoutDialog]);

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
            ? { product_id: item.productId, name: item.name, quantity: item.quantity, unit_price: item.unitPrice }
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

  async function addToCart(product: Product) {
    if (product.stock < (cart[product.id] ?? 0) + 1) {
      setNotice("There isn’t enough stock for another item.");
      return;
    }
    setCart((current) => ({ ...current, [product.id]: (current[product.id] ?? 0) + 1 }));
    setNotice("");
  }

  function addProductQuantity(product: Product, quantity: number) {
    const available = product.stock - (cart[product.id] ?? 0);
    if (quantity > available) {
      setNotice(available > 0 ? `Only ${available} more ${product.name} in stock.` : `There isn’t enough stock for another ${product.name}.`);
      return false;
    }
    setCart((current) => ({ ...current, [product.id]: (current[product.id] ?? 0) + quantity }));
    setNotice(`Added ${quantity} × ${product.name} to the order.`);
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
  }

  function addCustomItem(item: Omit<CustomItem, "id">) {
    setCustomItems((current) => [...current, { ...item, id: crypto.randomUUID() }]);
    setQuickAdd(null);
    setNotice(`Added ${item.quantity} × ${item.description} (custom item) to the order.`);
  }

  function changeCustomQuantity(id: string, difference: number) {
    setCustomItems((current) => current
      .map((item) => (item.id === id ? { ...item, quantity: Math.min(9999, item.quantity + difference) } : item))
      .filter((item) => item.quantity > 0));
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
    if (quantity !== null && (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 9999)) {
      setNotice("Enter a quantity from 1 to 9,999 before the slash, e.g. 24/4800016644290.");
      keepEntry();
      return;
    }
    if (!term) {
      if (quantity !== null) setNotice(`Now scan or type the item to add ${quantity} of it.`);
      return;
    }
    const product = products.find((item) => item.barcode === term) ?? (visibleProducts.length === 1 ? visibleProducts[0] : undefined);
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

  function closeTopDialog() {
    if (showHelpCenter) setShowHelpCenter(false);
    else if (isLoading) return false;
    else if (showCheckoutDialog) { setShowCheckoutDialog(false); setNotice(""); }
    else if (showAddProduct) { setShowAddProduct(false); setSelectedProductImage(null); setSelectedProductIcon("auto"); }
    else if (editingProductPrices) setEditingProductPrices(null);
    else if (editingProductImage) { setEditingProductImage(null); setSelectedProductImage(null); setRemoveExistingProductImage(false); }
    else if (showAddEmployee) setShowAddEmployee(false);
    else if (restockProduct) setRestockProduct(null);
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
    else if (showMobileCart) setShowMobileCart(false);
    else if (showNotifications) setShowNotifications(false);
    else return false;
    return true;
  }

  function handleShortcut(event: KeyboardEvent) {
    if (!signedIn || event.defaultPrevented || event.isComposing) return;
    const target = event.target as HTMLElement | null;
    const inTextField = !!target?.closest("input, textarea, select, [contenteditable='true']");
    const dialogOpen = showHelpCenter || showCheckoutDialog || showAddProduct || !!editingProductPrices || !!editingProductImage || showAddEmployee || !!restockProduct || !!quickAdd || showImport || !!confirmAction || !!passwordEmployee || showSyncPanel || showOpenDrawer || showCashCount || !!voidTarget || !!refundTarget;
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
    if (activePage !== "pos") return;
    if (event.key === "F2") {
      event.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    } else if (event.key === "F4") {
      event.preventDefault();
      if (itemCount && !isLoading) { setNotice(""); setShowCheckoutDialog(true); }
    } else if (event.key === "F9") {
      event.preventDefault();
      if (itemCount) { clearOrder(); setNotice("Order cleared."); }
    } else if (event.key === "F3") {
      event.preventDefault();
      openQuickAdd();
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
    F4: () => setWholesaleMode((current) => !current),
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
  const entryMatchesBarcode = !!searchTerm && products.some((product) => product.barcode === searchTerm);
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

  const shortcutHandlerRef = useRef(handleShortcut);
  useEffect(() => {
    shortcutHandlerRef.current = handleShortcut;
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => shortcutHandlerRef.current(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  function changeQuantity(productId: string, difference: number) {
    const product = products.find((item) => item.id === productId);
    if (difference > 0 && product && (cart[productId] ?? 0) + difference > product.stock) {
      setNotice(`There isn’t enough stock for another ${product.name}.`);
      return;
    }
    setCart((current) => {
      const quantity = (current[productId] ?? 0) + difference;
      if (quantity <= 0) {
        const next = { ...current };
        delete next[productId];
        return next;
      }
      return { ...current, [productId]: quantity };
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
        ...cartItems.map((product) => ({ kind: "product" as const, productId: product.id, name: product.name, quantity: cart[product.id], unitPrice: unitPrice(product) })),
        ...customItems.map((item) => ({ kind: "custom" as const, description: item.description, quantity: item.quantity, unitPrice: item.unitPrice })),
      ],
      paymentMethod,
      paymentReferenceLast4: paymentMethod === "cash" ? null : paymentReferenceLast4,
      cashReceived: receivedAmount,
      wholesale: wholesaleMode,
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
        p_items: [
          ...cartItems.map((product) => ({ product_id: product.id, quantity: cart[product.id] })),
          ...customItems.map((item) => ({ description: item.description, quantity: item.quantity, unit_price: item.unitPrice })),
        ],
        p_payment_method: paymentMethod,
        p_payment_reference_last4: sale.paymentReferenceLast4,
        p_cash_received: receivedAmount,
        p_wholesale: wholesaleMode,
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
      const newOrderId = sale.clientOrderId.slice(0, 8);
      void afterSale(sale, false, printThisSale);
      const wasWholesale = wholesaleMode;
      clearOrder();
      setShowCheckoutDialog(false);
      setCashReceived("");
      setPaymentReferenceLast4("");
      setNotice(`${wasWholesale ? "Wholesale order" : "Order"} #${newOrderId} placed successfully.`);
      try {
        await refreshWorkspace();
      } catch (error) {
        setNotice(`Order #${newOrderId} was placed, but the store data could not refresh: ${error instanceof Error ? error.message : "Unknown error"}`);
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
    if (print) {
      const order = pendingToOrder(sale);
      await printReceipt(savedOffline ? order : { ...order, syncStatus: undefined }, false);
    }
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
    const name = String(formData.get("name") ?? "").trim();
    const costPrice = Number(formData.get("cost_price"));
    const wholesalePrice = Number(formData.get("wholesale_price"));
    const price = Number(formData.get("price"));
    const stock = Number(formData.get("stock"));
    const selectedCategory = normalizeCategory(formData.get("category"), productCategories);
    const barcode = normalizeBarcode(formData.get("barcode"));
    if (!selectedCategory) {
      setNotice("Enter a category of up to 80 characters — pick an existing one or type a new name.");
      return;
    }
    if (barcode === undefined) {
      setNotice("Enter a barcode of up to 64 letters, digits, or symbols without spaces.");
      return;
    }
    if (selectedProductImage && (
      !["image/jpeg", "image/png", "image/webp"].includes(selectedProductImage.type) ||
      selectedProductImage.size > 5 * 1024 * 1024
    )) {
      setNotice("Choose a JPEG, PNG, or WebP image that is no larger than 5 MB.");
      return;
    }
    if (!name || !Number.isFinite(costPrice) || costPrice < 0 || !Number.isFinite(wholesalePrice) || wholesalePrice < 0 || !Number.isFinite(price) || price <= 0 || !Number.isInteger(stock) || stock < 0) {
      setNotice("Enter a product name, valid cost and wholesale prices, a retail price above ₱0, and a valid stock quantity.");
      return;
    }
    let uploadedPath: string | null = null;
    let productCreated = false;
    try {
      const supabase = createClient();
      let imageUrl: string | null = null;
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
      const { error } = await supabase.from("products").insert({
        name,
        category: selectedCategory,
        cost_price: costPrice,
        cost_price_known: true,
        wholesale_price: wholesalePrice,
        price,
        stock,
        image_icon: selectedProductIcon,
        image_url: imageUrl,
        barcode,
      });
      if (error) throw error;
      productCreated = true;
      setShowAddProduct(false);
      setSelectedProductIcon("auto");
      setSelectedProductImage(null);
      setNotice(`${name} added to inventory.`);
      try {
        await refreshWorkspace();
      } catch (error) {
        setNotice(`${name} was added, but the catalog could not refresh: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    } catch (error) {
      if (uploadedPath && !productCreated) {
        const supabase = createClient();
        const { error: cleanupError } = await supabase.storage.from("product-images").remove([uploadedPath]);
        if (cleanupError) console.error("Unable to remove an unused product image:", cleanupError.message);
      }
      setNotice(productSaveError(error, "Unable to add product."));
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
          delete next[product.id];
          return next;
        });
        setNotice(`${product.name} removed from inventory.`);
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

  async function runConfirmAction() {
    if (!confirmAction) return;
    setIsLoading(true);
    try {
      await confirmAction.onConfirm();
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
    const wholesalePrice = Number(formData.get("wholesale_price"));
    const retailPrice = Number(formData.get("price"));
    const barcode = normalizeBarcode(formData.get("barcode"));
    const productCategory = normalizeCategory(formData.get("category"), productCategories);
    if (!productCategory) {
      setNotice("Enter a category of up to 80 characters — pick an existing one or type a new name.");
      return;
    }
    if (!Number.isFinite(costPrice) || costPrice < 0 || !Number.isFinite(wholesalePrice) || wholesalePrice < 0 || !Number.isFinite(retailPrice) || retailPrice <= 0) {
      setNotice("Enter valid cost and wholesale prices, and a retail price above ₱0.");
      return;
    }
    if (barcode === undefined) {
      setNotice("Enter a barcode of up to 64 letters, digits, or symbols without spaces.");
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
  async function prepareImport(file: File): Promise<ImportPreview> {
    const { products: rows, errors } = validateImportedProducts(await readProductFile(file));
    const knownCategories = [...productCategories];
    const newCategories: string[] = [];
    const existingNames = new Set(products.map((product) => product.name));
    const prepared = rows.map((row) => {
      const productCategory = normalizeCategory(row.category, knownCategories);
      if (!knownCategories.includes(productCategory)) {
        knownCategories.push(productCategory);
        newCategories.push(productCategory);
      }
      return { ...row, category: productCategory, isUpdate: existingNames.has(row.name) };
    });
    const fileNames = new Set(rows.map((row) => row.name));
    const removable = products.filter((product) => !fileNames.has(product.name)).map((product) => product.name).sort((a, b) => a.localeCompare(b));
    return { fileName: file.name, products: prepared, errors, newCategories, removable };
  }

  // Step 2: save. Rows are upserted by product name. Rows are grouped by which
  // optional columns they include: a bulk upsert fills columns missing from a
  // row with NULL, which would fail or overwrite a value already set.
  async function importProducts(preview: ImportPreview, masterList = false) {
    if (masterList) return importMasterList(preview);
    setIsImporting(true);
    try {
      const groups = new Map<string, ImportedProduct[]>();
      for (const product of preview.products) {
        const row: ImportedProduct & { active: boolean } = {
          name: product.name,
          category: product.category,
          price: product.price,
          stock: product.stock,
          image_icon: product.image_icon,
          active: true,
          ...(product.cost_price !== undefined ? { cost_price: product.cost_price, cost_price_known: true } : {}),
          ...(product.wholesale_price !== undefined ? { wholesale_price: product.wholesale_price } : {}),
          ...(product.barcode ? { barcode: product.barcode } : {}),
        };
        const signature = Object.keys(row).sort().join(",");
        groups.set(signature, [...(groups.get(signature) ?? []), row]);
      }
      const supabase = createClient();
      for (const rows of groups.values()) {
        const { error } = await supabase.from("products").upsert(rows, { onConflict: "name" });
        if (error) throw error;
      }
      const count = preview.products.length;
      setShowImport(false);
      setNotice(`${count} product${count === 1 ? "" : "s"} imported successfully.`);
      try {
        await refreshWorkspace();
      } catch (error) {
        setNotice(`${count} products were imported, but the catalog could not refresh: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    } catch (error) {
      setNotice(productSaveError(error, "Unable to import products."));
    } finally {
      setIsImporting(false);
    }
  }

  // Master list: the file replaces the whole product list. Done by the
  // database in one transaction (remove products not in the file, then add or
  // update the rest), so a failure changes nothing. Removed products are
  // hidden, not deleted, so past orders keep them.
  async function importMasterList(preview: ImportPreview) {
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
      const { data, error } = await createClient().rpc("import_master_product_list", { p_rows: rows }).single();
      if (error) {
        if (error.code === "PGRST202" || error.code === "42883") {
          throw new Error("Master list import needs the latest database update. Run npx supabase db push (migration 202610130001_master_product_list.sql), then retry.");
        }
        throw error;
      }
      const imported = data && typeof data === "object" && "imported" in data ? Number(data.imported) : preview.products.length;
      const removed = data && typeof data === "object" && "removed" in data ? Number(data.removed) : 0;
      setShowImport(false);
      setCart({});
      setNotice(`Master list applied successfully: ${imported} product${imported === 1 ? "" : "s"} imported${removed ? `, ${removed} not on the list removed` : ""}.`);
      try {
        await refreshWorkspace();
      } catch (refreshError) {
        setNotice(`The master list was applied, but the catalog could not refresh: ${refreshError instanceof Error ? refreshError.message : "Unknown error"}`);
      }
    } catch (error) {
      setNotice(productSaveError(error, "Unable to apply the master list."));
    } finally {
      setIsImporting(false);
    }
  }

  if (checkingAuth) {
    return <main className="grid min-h-screen place-items-center bg-[#f4f8ff] text-sm text-slate-500 dark:bg-slate-950"><span className="animate-pulse">Loading your store…</span></main>;
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
            <Brand light />
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
            <p className="relative z-10 text-xs text-blue-200">Clover &amp; Co. · Point of sale</p>
          </section>

          <section className="relative flex items-center justify-center px-5 py-10 sm:px-10">
            <div className="absolute right-5 top-5"><ThemeSwitcher /></div>
            <div className="w-full max-w-[420px]">
              <div className="mb-10 lg:hidden"><Brand /></div>
              <div className="mb-8">
                <p className="mb-2 text-sm font-semibold text-blue-700 dark:text-blue-400">WELCOME BACK</p>
                <h2 className="text-3xl font-semibold tracking-tight">Sign in to your store</h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">Enter your work email and password. Admins and employees sign in here.</p>
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
              <p className="mt-8 text-center text-xs text-slate-400">Secure checkout starts here · Clover &amp; Co.</p>
            </div>
          </section>
        </div>
      </main>
    );
  }

  const isAdmin = role === "admin";
  const currentView = isAdmin ? activePage : activePage === "inventory" || activePage === "employees" ? "pos" : activePage;

  return (
    <main className={`min-h-screen bg-[#f5f8fd] text-slate-900 dark:bg-slate-950 dark:text-slate-100 ${currentView === "analytics" ? "analytics-report-print-mode" : ""}`}>
      <div className="flex min-h-screen">
        <div className="min-w-0 flex-1">
          <header ref={headerRef} className="sticky top-0 z-20 border-b border-slate-100 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
            {updateStatus?.state === "ready" && <UpdateReadyBar version={updateStatus.version} busy={installingUpdate} onRestart={restartToUpdate} testFeed={updateStatus.testFeed} />}
            {offlineSession && isOnline && <ReconnectBanner email={accountEmail} onReconnect={reconnectOnline} />}
            {!connected && <OfflineBanner signedIn waiting={waitingToSync} />}
            <div className="flex h-[72px] items-center gap-3 px-4 sm:px-7 xl:px-9">
            <div className="shrink-0 xl:hidden"><Brand compact /></div>
            <div className="hidden shrink-0 xl:block"><Brand /></div>
            {/* Page icons; the name (and Alt+N shortcut) appears on hover or focus. */}
            <nav aria-label="Workspace navigation" className="ml-2 hidden flex-1 items-center gap-1 md:flex xl:ml-6">
              {navItems.map((item, index) => <NavIcon key={item.page} icon={item.icon} label={item.label} shortcut={`Alt+${index + 1}`} active={currentView === item.page} onClick={() => goToPage(item.page)} />)}
            </nav>
            <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-3">
              <button type="button" aria-label="Open help center (F1)" title="Help (F1)" aria-keyshortcuts="F1" onClick={() => setShowHelpCenter(true)} className="grid h-10 w-10 place-items-center rounded-xl text-slate-500 transition hover:bg-slate-50 dark:hover:bg-slate-800"><CircleHelp size={19} /></button>
              <div className="hidden items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300 lg:flex">
                <Clock3 size={14} className="text-slate-400" />
                {new Date().toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric", timeZone: "Asia/Manila" })}
              </div>
              <DrawerStatusButton session={cashSession} onOpen={() => setShowOpenDrawer(true)} onCount={() => setShowCashCount(true)} />
              <SyncStatusButton isOnline={connected} isSyncing={isSyncing} waiting={waitingToSync} failed={failedToSync} onClick={() => setShowSyncPanel(true)} />
              <div className="relative">
                <button type="button" aria-label="Notifications" aria-expanded={showNotifications} onClick={() => setShowNotifications((current) => !current)} className="relative grid h-10 w-10 place-items-center rounded-xl text-slate-500 transition hover:bg-slate-50 dark:hover:bg-slate-800">
                  <Bell size={19} />
                  {unreadNotificationCount > 0 && <span className="absolute -right-0.5 -top-0.5 grid min-h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white ring-2 ring-white dark:ring-slate-900">{unreadNotificationCount > 9 ? "9+" : unreadNotificationCount}</span>}
                </button>
                {showNotifications && <div className="absolute right-0 top-12 z-50 w-[min(340px,calc(100vw-32px))] overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
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
                <div className="grid h-9 w-9 place-items-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">{employeeName.split(" ").map((part) => part[0]).join("").slice(0, 2)}</div>
                <div className="hidden xl:block">
                  <p className="text-xs font-semibold">{employeeName}</p>
                  <p className="mt-0.5 text-[10px] capitalize text-slate-400">{role}</p>
                </div>
                <button type="button" aria-label="Sign out" title="Sign out" onClick={() => void signOut()} className="rounded-lg p-2 text-slate-400 hover:bg-slate-50 hover:text-slate-700 dark:hover:bg-slate-800"><LogOut size={16} /></button>
              </div>
            </div>
            </div>
            {/* Phones: the same icons on a second row of the sticky header. */}
            <nav aria-label="Workspace navigation" className="flex justify-around gap-1 overflow-x-auto border-t border-slate-100 px-2 py-1.5 dark:border-slate-800 md:hidden">
              {navItems.map((item) => <NavIcon key={item.page} icon={item.icon} label={item.label} active={currentView === item.page} onClick={() => goToPage(item.page)} />)}
            </nav>
          </header>

          <div className="p-4 sm:p-7 xl:p-9">
            {notice && (
              <div role="status" className={`mb-5 flex items-center justify-between rounded-xl border px-4 py-3 text-sm ${noticeIsSuccess ? "border-emerald-100 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200" : "border-blue-100 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-200"}`}>
                <span className="flex items-center gap-2">{noticeIsSuccess ? <Check size={16} className="shrink-0" /> : <Info size={16} className="shrink-0" />}{notice}</span>
                <button type="button" aria-label="Dismiss notification" onClick={() => setNotice("")}><X size={16} /></button>
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
              <div className="grid items-start gap-5 pb-20 md:grid-cols-[minmax(0,1fr)_min(var(--cart-width),50vw)] md:pb-0 xl:gap-6" style={{ "--cart-width": `${posLayout.cartWidth}px` } as CSSProperties}>
                {/* Text size: CSS zoom scales text and controls together (many sizes are in px). */}
                <section className="min-w-0" style={{ zoom: posLayout.textScale / 100 }}>
                  <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                    <div>
                      <div className="mb-1 flex items-center gap-2 text-xs font-medium text-slate-400"><Store size={14} /> Clover &amp; Co. <span>/</span> <span className="text-blue-600">New sale</span></div>
                      <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">New sale</h1>
                      <p className="mt-1 text-sm text-slate-500">Find a product and add it to the customer’s order.</p>
                      <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-400"><ScanBarcode size={13} /> Scan an item to add it. Type a quantity and slash first to add several, e.g. <code className="rounded bg-slate-100 px-1 font-mono text-slate-500 dark:bg-slate-800">24/</code> then scan.</p>
                    </div>
                    <div className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 focus-within:border-blue-400 sm:w-[300px]">
                      <Search size={16} className="shrink-0 text-slate-400" />
                      {entryQuantity !== null && <span className="shrink-0 rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">×{entryQuantity}</span>}
                      <input
                        ref={searchInputRef}
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "ArrowDown") {
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
                  </div>

                  {!cashSession && (
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100">
                      <span><b className="font-semibold">Start your shift:</b> count the opening cash so the drawer can be balanced at the end of the shift.</span>
                      <button type="button" onClick={() => setShowOpenDrawer(true)} className="h-8 rounded-lg bg-blue-600 px-3 font-semibold text-white hover:bg-blue-700">Start shift</button>
                    </div>
                  )}
                  <div className="mb-5 flex flex-wrap items-center gap-2">
                    {productCategories.length > 1 && (
                      <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1" aria-label="Filter by category">
                        {categories.map((item) => (
                          <button type="button" key={item} onClick={() => setCategory(item)} aria-pressed={activeCategory === item} className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${activeCategory === item ? "bg-blue-600 text-white shadow-sm shadow-blue-600/20" : "border border-slate-200 bg-white text-slate-500 hover:border-blue-200 hover:text-blue-700"}`}>
                            {item}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="ml-auto flex shrink-0 gap-2 pb-1">
                      <button type="button" aria-pressed={showLayoutPanel} onClick={() => setShowLayoutPanel((current) => !current)} className="flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-600 hover:border-blue-200 hover:text-blue-700 aria-pressed:border-blue-300 aria-pressed:text-blue-700"><LayoutGrid size={14} />Customize</button>
                      <button type="button" role="switch" aria-checked={showImages} aria-keyshortcuts="F8" onClick={toggleImages} className="flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-600 hover:border-blue-200 hover:text-blue-700">
                        {showImages ? <ImageIcon size={14} /> : <ImageOff size={14} />}{showImages ? "Images on" : "Images off"}<Kbd>F8</Kbd>
                      </button>
                      <button type="button" aria-keyshortcuts="F3" onClick={openQuickAdd} className="flex h-8 items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-100">
                        <Plus size={14} />Quick add<Kbd>F3</Kbd>
                      </button>
                    </div>
                  </div>

                  {visibleProducts.length > 0 ? (
                    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(${posLayout.tileSize}px, 100%), 1fr))` }} onKeyDown={(event) => moveProductFocus(event, () => searchInputRef.current?.focus())}>
                      {visibleProducts.map((product) => {
                        const unavailable = product.stock <= (cart[product.id] ?? 0);
                        return (
                          <button type="button" key={product.id} data-product-card disabled={unavailable} onClick={() => addToCart(product)} className={`group relative rounded-2xl border border-slate-100 bg-white text-left shadow-[0_2px_10px_rgba(20,45,90,0.025)] transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50 ${showImages ? "p-3 sm:p-4" : "px-3 py-2.5"}`}>
                            {showImages && <ProductArtwork product={product} className={`mb-3 aspect-[1.6/1] rounded-xl text-[42px] transition-transform group-hover:scale-[1.015]`} />}
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-slate-800">{product.name}</p>
                                <p className="mt-1 text-[11px] text-slate-400">{product.category} · {product.stock - (cart[product.id] ?? 0)} left</p>
                              </div>
                              <span className="shrink-0 text-sm font-bold text-blue-700">{money(product.price)}</span>
                            </div>
                            {showImages && <span className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-full bg-white text-blue-600 opacity-0 shadow-sm transition group-hover:opacity-100"><Plus size={16} /></span>}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="grid min-h-64 place-items-center rounded-2xl border border-dashed border-slate-200 bg-white text-center">
                      <div><ShoppingBag size={28} className="mx-auto text-slate-300" /><p className="mt-3 text-sm font-semibold">No products found</p><p className="mt-1 text-xs text-slate-400">Try another name or category, or sell it as a custom item.</p><button type="button" onClick={openQuickAdd} className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700"><Plus size={14} /> Quick add custom item <Kbd>F3</Kbd></button></div>
                    </div>
                  )}
                </section>

                {/* Phones: the cart is a drawer that slides in from the right.
                    Tablets and up: a sticky column that fills the viewport
                    height, so Pay stays visible however long the list is. */}
                {showMobileCart && <div aria-hidden="true" onClick={() => setShowMobileCart(false)} className="fixed inset-0 z-40 bg-slate-950/40 md:hidden" />}
                <div
                  id="cart-panel"
                  ref={cartWrapperRef}
                  className={`fixed inset-y-0 right-0 z-50 w-[min(var(--cart-width),88vw)] transition-[transform,visibility] duration-200 md:visible md:sticky md:bottom-auto md:right-auto md:z-auto md:top-[calc(var(--pos-header-height,72px)+16px)] md:h-[calc(100dvh-var(--cart-top,88px)-16px)] md:w-auto md:translate-x-0 md:transition-none ${showMobileCart ? "visible translate-x-0" : "invisible translate-x-full"}`}
                >
                  <CartResizeHandle width={posLayout.cartWidth} onResize={(cartWidth) => updateLayout({ ...posLayout, cartWidth })} />
                  <CartPanel
                    textScale={posLayout.textScale}
                    items={cartItems}
                    quantities={cart}
                    count={itemCount}
                    subtotal={subtotal}
                    total={total}
                    onChange={changeQuantity}
                    onCheckout={() => { setNotice(""); setShowMobileCart(false); setShowCheckoutDialog(true); }}
                    isProcessing={isLoading}
                    onClear={clearOrder}
                    priceOf={unitPrice}
                    wholesale={wholesaleMode}
                    savings={wholesaleSavings}
                    onClose={() => setShowMobileCart(false)}
                    customItems={customItems}
                    onCustomChange={changeCustomQuantity}
                    showImages={showImages}
                  />
                </div>
                <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-100 bg-white/95 px-4 py-3 shadow-[0_-4px_16px_rgba(20,45,90,0.06)] backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 md:hidden">
                  <button type="button" aria-controls="cart-panel" aria-expanded={showMobileCart} onClick={() => setShowMobileCart(true)} className="flex h-12 w-full items-center gap-3 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-lg shadow-blue-600/20">
                    <span className="relative"><ShoppingCart size={19} />{itemCount > 0 && <span className="absolute -right-2 -top-2 grid min-h-4 min-w-4 place-items-center rounded-full bg-white px-1 text-[9px] font-bold text-blue-700">{itemCount > 99 ? "99+" : itemCount}</span>}</span>
                    <span className="flex-1 text-left">{itemCount ? "View order" : "Order is empty"}{wholesaleMode && <span className="ml-2 rounded-full bg-white/20 px-2 py-0.5 text-[10px]">Wholesale</span>}</span>
                    <span>{money(total)}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
          <footer className="px-4 pb-6 text-center text-[10px] text-slate-400 sm:px-7 xl:px-9">Clover &amp; Co. POS</footer>
        </div>
      </div>

      {showCheckoutDialog && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/50 p-4" onClick={(event) => { if (event.target === event.currentTarget && !isLoading) setShowCheckoutDialog(false); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="checkout-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-start justify-between">
              <div><p className="text-xs font-semibold text-blue-600">PAYMENT</p><h2 id="checkout-title" className="mt-1 text-xl font-semibold">Complete checkout</h2><p className="mt-1 text-sm text-slate-500">{itemCount} item{itemCount === 1 ? "" : "s"} · {money(total)} due</p></div>
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
            <div className={`mt-4 rounded-xl border p-3 ${wholesaleMode ? "border-emerald-200 bg-emerald-50/70 dark:border-emerald-800 dark:bg-emerald-950/50" : "border-slate-200 dark:border-slate-700"}`}>
              <button type="button" role="switch" aria-checked={wholesaleMode} aria-keyshortcuts="F4" onClick={() => setWholesaleMode((current) => !current)} className="flex w-full items-center gap-3 text-left">
                <span className={`relative h-5 w-9 shrink-0 rounded-full transition ${wholesaleMode ? "bg-emerald-600" : "bg-slate-300"}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${wholesaleMode ? "left-[18px]" : "left-0.5"}`} /></span>
                <span className="flex-1"><span className="block text-sm font-semibold text-slate-700">Wholesale pricing</span><span className="block text-[11px] text-slate-500">{wholesaleMode ? `Saving ${money(wholesaleSavings)} off retail (${money(retailTotal)})` : "Charge this customer wholesale prices"}</span></span>
                <Kbd className="text-slate-500">F4</Kbd>
              </button>
              {wholesaleMode && itemsWithoutWholesalePrice.length > 0 && (
                <p className="mt-2 border-t border-emerald-200 pt-2 text-[11px] leading-4 text-amber-700">No wholesale price set — charged at retail: {itemsWithoutWholesalePrice.map((product) => product.name).join(", ")}</p>
              )}
            </div>
            <button type="button" role="switch" aria-checked={printThisSale} aria-keyshortcuts="F7" onClick={() => setPrintThisSale((current) => !current)} className={`mt-2 flex w-full items-center gap-3 rounded-xl border p-3 text-left ${printThisSale ? "border-blue-200 bg-blue-50/70 dark:border-blue-800 dark:bg-blue-950/50" : "border-slate-200 dark:border-slate-700"}`}>
              <span className={`relative h-5 w-9 shrink-0 rounded-full transition ${printThisSale ? "bg-blue-600" : "bg-slate-300"}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${printThisSale ? "left-[18px]" : "left-0.5"}`} /></span>
              <span className="flex-1"><span className="flex items-center gap-1.5 text-sm font-semibold text-slate-700"><Printer size={14} /> Print receipt</span><span className="block text-[11px] text-slate-500">{printThisSale ? "A receipt prints when the payment is confirmed" : "No receipt for this sale (reprint any time from Orders)"}</span></span>
              <Kbd className="text-slate-500">F7</Kbd>
            </button>
            {paymentMethod === "cash" ? (
              <div className="mt-4 space-y-3 rounded-xl bg-slate-50 p-4">
                <label className="block text-sm font-medium text-slate-700">Cash received (₱)
                  <input autoFocus required type="number" min={total} step="0.01" inputMode="decimal" value={cashReceived} onChange={(event) => setCashReceived(event.currentTarget.value)} placeholder={total.toFixed(2)} className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50" />
                </label>
                <div className="flex items-center justify-between border-t border-slate-200 pt-3 text-sm"><span className="font-medium text-slate-500">Change due</span><span className="font-bold text-slate-900">{money(Math.max(0, (Number(cashReceived) || 0) - total))}</span></div>
              </div>
            ) : (
              <label className="mt-4 block text-sm font-medium text-slate-700">{paymentMethod === "e_wallet" ? "E-Wallet" : "Card"} reference · last 4 digits
                <input autoFocus required type="text" inputMode="numeric" autoComplete="off" maxLength={4} pattern="[0-9]{4}" value={paymentReferenceLast4} onChange={(event) => setPaymentReferenceLast4(event.currentTarget.value.replace(/\D/g, "").slice(0, 4))} placeholder="1234" className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 px-3 text-sm tracking-[0.2em] outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50" />
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
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/40 p-4" onClick={(event) => { if (event.target === event.currentTarget) { setShowAddProduct(false); setSelectedProductImage(null); setSelectedProductIcon("auto"); } }}>
          <div role="dialog" aria-modal="true" aria-labelledby="add-product-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-start justify-between">
              <div><p className="text-xs font-semibold text-blue-600">INVENTORY</p><h2 id="add-product-title" className="mt-1 text-xl font-semibold">Add a product</h2></div>
              <button type="button" aria-label="Close dialog" onClick={() => { setShowAddProduct(false); setSelectedProductImage(null); setSelectedProductIcon("auto"); }} className="rounded-lg p-2 text-slate-400 hover:bg-slate-50"><X size={18} /></button>
            </div>
            <form onSubmit={addProduct} className="max-h-[80vh] space-y-4 overflow-y-auto pr-1">
              <label className="block text-sm font-medium text-slate-700">Product name<input required name="name" placeholder="e.g. Sardines (155 g)" className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50" /></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm font-medium text-slate-700">Cost price (₱)<input required name="cost_price" type="number" min="0" step="0.01" placeholder="18.00" className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50" /></label>
                <label className="block text-sm font-medium text-slate-700">Wholesale price (₱)<input required name="wholesale_price" type="number" min="0" step="0.01" placeholder="22.00" className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50" /></label>
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
              <div className="flex gap-3 pt-2"><button type="button" onClick={() => { setShowAddProduct(false); setSelectedProductImage(null); setSelectedProductIcon("auto"); }} aria-keyshortcuts="Escape" className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancel <Kbd>Esc</Kbd></button><button type="submit" aria-keyshortcuts="Enter" className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700">Add product <Kbd>Enter</Kbd></button></div>
            </form>
          </div>
        </div>
      )}
      {editingProductPrices && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/40 p-4" onClick={(event) => { if (event.target === event.currentTarget && !isLoading) setEditingProductPrices(null); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="edit-product-prices-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-start justify-between">
              <div><p className="text-xs font-semibold text-blue-600">INVENTORY</p><h2 id="edit-product-prices-title" className="mt-1 text-xl font-semibold">Edit product details</h2><p className="mt-1 text-sm text-slate-500">{editingProductPrices.name}</p></div>
              <button type="button" aria-label="Close price editor" disabled={isLoading} onClick={() => setEditingProductPrices(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-50 disabled:opacity-50"><X size={18} /></button>
            </div>
            <form onSubmit={saveProductPrices} className="space-y-4">
              <label className="block text-sm font-medium text-slate-700">Cost price (₱)<input required name="cost_price" type="number" min="0" step="0.01" defaultValue={editingProductPrices.costPriceKnown ? editingProductPrices.costPrice : ""} className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50" /></label>
              <label className="block text-sm font-medium text-slate-700">Wholesale price (₱)<input required name="wholesale_price" type="number" min="0" step="0.01" defaultValue={editingProductPrices.wholesalePrice} className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50" /></label>
              <label className="block text-sm font-medium text-slate-700">Retail price (₱)<input required name="price" type="number" min="0.01" step="0.01" defaultValue={editingProductPrices.price} className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50" /></label>
              <BarcodeField defaultValue={editingProductPrices.barcode ?? ""} />
              <CategoryField categories={productCategories} defaultValue={editingProductPrices.category} />
              <div className="flex gap-3 pt-2"><button type="button" disabled={isLoading} onClick={() => setEditingProductPrices(null)} aria-keyshortcuts="Escape" className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">Cancel <Kbd>Esc</Kbd></button><button disabled={isLoading} type="submit" aria-keyshortcuts="Enter" className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{isLoading ? "Saving…" : <>Save <Kbd>Enter</Kbd></>}</button></div>
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
      {quickAdd && <QuickAddDialog initial={quickAdd} onAdd={addCustomItem} onClose={() => setQuickAdd(null)} />}
      {showOpenDrawer && <OpenDrawerDialog deviceLabel={hardware.deviceLabel} onOpen={startDrawerSession} onClose={() => setShowOpenDrawer(false)} />}
      {showCashCount && cashSession && <CashCountDialog session={cashSession} onConfirm={finishDrawerSession} onClose={() => setShowCashCount(false)} onOpenDrawer={() => void openDrawer(true)} />}
      {voidTarget && <VoidDialog order={voidTarget} onConfirm={(reason, printSlip) => voidSale(voidTarget, reason, printSlip)} onClose={() => setVoidTarget(null)} />}
      {refundTarget && <RefundDialog order={refundTarget} onConfirm={(refund) => refundSale(refundTarget, refund)} onClose={() => setRefundTarget(null)} />}
      {showLayoutPanel && currentView === "pos" && <PosLayoutPanel layout={posLayout} onChange={updateLayout} onClose={() => setShowLayoutPanel(false)} />}
      {showSyncPanel && <SyncPanel sales={pendingOrders} isOnline={isOnline} isSyncing={isSyncing} currentUserId={userId} isAdmin={isAdmin} onSync={(retryFailed) => void syncPendingOrders({ retryFailed })} onClose={() => setShowSyncPanel(false)} />}
      {confirmAction && <ConfirmDialog action={confirmAction} isWorking={isLoading} onConfirm={() => void runConfirmAction()} onCancel={() => setConfirmAction(null)} />}
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
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/40 p-4" onClick={(event) => { if (event.target === event.currentTarget) setRestockProduct(null); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="restock-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
            <div className="mb-5 flex items-start justify-between"><div><p className="text-xs font-semibold text-blue-600">STOCK ADJUSTMENT</p><h2 id="restock-title" className="mt-1 text-xl font-semibold">Restock product</h2><p className="mt-1 text-sm text-slate-500">{restockProduct.name} · currently {restockProduct.stock} in stock</p></div><button type="button" aria-label="Close dialog" onClick={() => setRestockProduct(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-50"><X size={18} /></button></div>
            <form onSubmit={restock} className="space-y-4">
              <label className="block text-sm font-medium text-slate-700">Units received<input required autoFocus name="quantity" type="number" min="1" max="1000000" step="1" placeholder="e.g. 24" className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50" /></label>
              <label className="block text-sm font-medium text-slate-700">Note <span className="font-normal text-slate-400">(optional)</span><input maxLength={200} name="note" placeholder="Supplier delivery, invoice number…" className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50" /></label>
              <div className="flex gap-3 pt-2"><button type="button" onClick={() => setRestockProduct(null)} aria-keyshortcuts="Escape" className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancel <Kbd>Esc</Kbd></button><button disabled={isLoading} type="submit" aria-keyshortcuts="Enter" className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{isLoading ? "Updating…" : <>Add to stock <Kbd>Enter</Kbd></>}</button></div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}

function Brand({ light = false, compact = false }: { light?: boolean; compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${light ? "bg-white/15 text-white" : "bg-blue-600 text-white"} ${compact ? "h-9 w-9" : ""}`}><Coffee size={compact ? 19 : 21} strokeWidth={2.2} /></div>
      {!compact && <div><p className={`text-[15px] font-bold tracking-tight ${light ? "text-white" : "text-slate-900"}`}>Clover <span className={light ? "text-blue-200" : "text-blue-600"}>&amp; Co.</span></p><p className={`mt-0.5 text-[10px] ${light ? "text-blue-200" : "text-slate-400"}`}>POINT OF SALE</p></div>}
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
      className={`group relative grid h-10 w-10 shrink-0 place-items-center rounded-xl transition ${active ? "bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300" : "text-slate-400 hover:bg-slate-50 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"}`}
    >
      <Icon size={19} strokeWidth={active ? 2.2 : 1.8} />
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
  onPeriodChange,
  onRefresh,
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
  onPeriodChange: (period: SalesPeriod) => void;
  onRefresh: () => void;
  onViewAnalytics: () => void;
  onViewInventory: () => void;
  onViewOrders: () => void;
}) {
  const lowStockProducts = products.filter((product) => product.stock <= 5);
  const cards: { label: string; value: string; detail: string; icon: LucideIcon; color: string }[] = [
    { label: "Sales", value: money(stats.sales_total), detail: periodLabel(period), icon: CircleDollarSign, color: "bg-blue-50 text-blue-600" },
    { label: "Orders", value: String(stats.orders_today), detail: period === "today" ? "Today · Asia/Manila" : periodLabel(period), icon: ReceiptText, color: "bg-violet-50 text-violet-600" },
    { label: "Inventory", value: String(stats.units_in_stock), detail: `${stats.active_products} active products`, icon: Boxes, color: "bg-emerald-50 text-emerald-600" },
    { label: "Employees", value: String(stats.active_employees), detail: "Active staff accounts", icon: Users, color: "bg-amber-50 text-amber-600" },
  ];
  return (
    <section>
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><div className="mb-1 flex items-center gap-2 text-xs font-medium text-slate-400"><Store size={14} /> Clover &amp; Co. <span>/</span> <span className="text-blue-600">Dashboard</span></div><h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">Store dashboard</h1><p className="mt-1 text-sm text-slate-500">Live sales, team, and inventory performance.</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onViewAnalytics} className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:border-blue-200 hover:text-blue-700"><BarChart3 size={14} /> Analytics &amp; Reports</button>
          <select aria-label="Sales report period" value={period} onChange={(event) => onPeriodChange(event.target.value as SalesPeriod)} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold outline-none focus:border-blue-400">
            <option value="today">Today</option><option value="7days">Last 7 days</option><option value="30days">Last 30 days</option>
          </select>
          <button type="button" onClick={onRefresh} disabled={isRefreshing} className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:border-blue-200 hover:text-blue-700 disabled:opacity-60"><RefreshCw size={14} className={isRefreshing ? "animate-spin" : ""} /> Refresh</button>
        </div>
      </div>
      <div className="mb-4 flex items-center justify-between text-[11px] text-slate-400"><span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />Auto-refresh every 30 seconds</span><span>Last updated: {lastRefreshedAt ? lastRefreshedAt.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", second: "2-digit", timeZone: "Asia/Manila" }) : "—"}</span></div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ label, value, detail, icon: Icon, color }) => <div key={label} className="rounded-2xl border border-slate-100 bg-white p-4"><div className="flex items-center justify-between"><span className="text-xs font-medium text-slate-500">{label}</span><span className={`grid h-8 w-8 place-items-center rounded-lg ${color}`}><Icon size={16} /></span></div><p className="mt-3 text-2xl font-semibold tracking-tight">{value}</p><p className="mt-1 text-[10px] text-slate-400">{detail}</p></div>)}
      </div>
      <SalesChartView rows={salesChart} period={period} />
      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="text-sm font-semibold">Low stock</h2><p className="mt-1 text-xs text-slate-400">Products with 5 or fewer units</p></div><button type="button" onClick={onViewInventory} className="text-xs font-semibold text-blue-600 hover:text-blue-700">Manage inventory <ArrowRight size={13} className="ml-1 inline" /></button></div>
          {lowStockProducts.length ? <div className="divide-y divide-slate-100">{lowStockProducts.slice(0, 5).map((product) => <div key={product.id} className="flex items-center justify-between gap-3 px-5 py-3"><div className="flex min-w-0 items-center gap-3"><ProductArtwork product={product} className="h-9 w-9 rounded-lg text-lg" /><div className="min-w-0"><p className="truncate text-xs font-semibold">{product.name}</p><p className="mt-0.5 text-[10px] text-slate-400">{product.category}</p></div></div><span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-semibold text-amber-700">{product.stock} left</span></div>)}</div> : <div className="px-5 py-8 text-center text-xs text-slate-400">No products need restocking.</div>}
        </div>
        <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="text-sm font-semibold">Recent sales</h2><p className="mt-1 text-xs text-slate-400">Latest completed transactions</p></div><button type="button" onClick={onViewOrders} className="text-xs font-semibold text-blue-600 hover:text-blue-700">All orders <ArrowRight size={13} className="ml-1 inline" /></button></div>
          {orders.length ? <div className="divide-y divide-slate-100">{orders.slice(0, 5).map((order) => <div key={order.id} className="flex items-center justify-between gap-3 px-5 py-3"><div><p className="text-xs font-semibold">{order.id}</p><p className="mt-0.5 text-[10px] text-slate-400">{order.items} item{order.items === 1 ? "" : "s"} · {order.time} · {order.employeeName} · {paymentMethodLabel(order.paymentMethod)}{order.isWholesale ? " · Wholesale" : ""}</p></div><p className="text-xs font-semibold">{money(order.total)}</p></div>)}</div> : <div className="px-5 py-8 text-center text-xs text-slate-400">No completed sales yet.</div>}
        </div>
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
    <section aria-label="Sales chart" className="mt-6 overflow-hidden rounded-2xl border border-slate-100 bg-white">
      <div className="flex flex-col justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center">
        <div><h2 className="text-sm font-semibold">Sales by payment method</h2><p className="mt-1 text-xs text-slate-400">{periodLabel(period)} · PHP</p></div>
        <div className="flex gap-1 rounded-lg bg-slate-50 p-1" aria-label="Filter sales chart by payment method">
          {(["all", "cash", "e_wallet", "card"] as const).map((method) => (
            <button key={method} type="button" aria-pressed={paymentFilter === method} onClick={() => setPaymentFilter(method)} className={`rounded-md px-3 py-1.5 text-[11px] font-semibold capitalize ${paymentFilter === method ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
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
          <div className="flex items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600"><CircleHelp size={20} /></div><div><p className="text-xs font-semibold text-blue-600">CLOVER &amp; CO. SUPPORT</p><h2 id="help-center-title" className="mt-1 text-xl font-semibold">Help center</h2><p className="mt-1 text-sm text-slate-500">Quick answers for everyday store tasks.</p></div></div>
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
            <p className="mt-2 text-xs leading-5 text-slate-500">Yes. On Point of sale, click Customize: make the product tiles smaller (more per row) or larger, make the current order narrower or wider, and change the text size. You can also drag the left edge of the current order. The layout is saved on this computer; Reset puts it back.</p>
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
            <p className="mt-2 text-xs leading-5 text-slate-500">Scan or type it and press Enter — if it isn’t found, the Quick add window opens. You can also press F3 or click Quick add. Enter a description, quantity, and either the price each or the total amount. Custom items don’t change stock and have no recorded cost, so orders containing them are left out of the estimated-profit figures.</p>
          </details>
          <details className="py-3">
            <summary className="cursor-pointer text-sm font-semibold">How do categories work?</summary>
            <p className="mt-2 text-xs leading-5 text-slate-500">Categories come from your products. Admins create one by typing a new category name when adding or editing a product, or by including it in the category column of an import. Only categories that have products appear on Point of sale.</p>
          </details>
          <details className="py-3">
            <summary className="cursor-pointer text-sm font-semibold">How do I sell at wholesale prices?</summary>
            <p className="mt-2 text-xs leading-5 text-slate-500">In the checkout dialog, turn on Wholesale pricing (or press F4). Each item is charged its wholesale price; items without one are charged retail and listed in the dialog. Wholesale switches off after the sale or when the order is cleared, and wholesale orders are tagged in Orders.</p>
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
              ["↑ ↓ ← →", "Move between products; Enter adds the focused one"],
              ["F2", "Focus the product search"],
              ["F3", "Quick add a custom item that isn’t in your products"],
              ["F4", "Continue to payment"],
              ["F8", "Turn product images on or off"],
              ["F1 / F2 / F3", "In checkout: Cash / E-Wallet / Card"],
              ["F4 in checkout", "Turn wholesale pricing on or off"],
              ["F7 in checkout", "Print a receipt for this sale, or not"],
              ["F-keys in pop-ups", "Choose a pop-up’s options (shown on each option)"],
              ["F9", "Clear the current order"],
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
    <button type="button" onClick={onClick} aria-label={`Sync status: ${label}`} title={label} className={`relative flex h-10 items-center gap-1.5 rounded-xl px-2.5 text-xs font-semibold transition ${tone}`}>
      <Icon size={18} className={isSyncing ? "animate-pulse" : ""} />
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
function ConfirmDialog({ action, isWorking, onConfirm, onCancel }: { action: ConfirmAction; isWorking: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onClick={(event) => { if (event.target === event.currentTarget && !isWorking) onCancel(); }}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-message" className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
        <div className="mb-4 grid h-10 w-10 place-items-center rounded-xl bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-300"><TriangleAlert size={18} /></div>
        <h2 id="confirm-title" className="text-lg font-semibold">{action.title}</h2>
        <p id="confirm-message" className="mt-1.5 text-sm leading-6 text-slate-500">{action.message}</p>
        <div className="mt-6 flex gap-3">
          <button type="button" autoFocus disabled={isWorking} onClick={onCancel} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">Cancel <Kbd>Esc</Kbd></button>
          <button type="button" disabled={isWorking} onClick={onConfirm} className="flex h-11 flex-1 items-center justify-center rounded-lg bg-red-600 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60">{isWorking ? "Working…" : action.confirmLabel}</button>
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
function exportInventoryPdf(items: Product[]) {
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
    <header><div><div class="muted">Clover &amp; Co. · Point of sale</div><h1>Inventory report</h1></div><div class="muted">Generated ${escapeHtml(generated)} · Asia/Manila</div></header>
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

  const newCount = preview?.products.filter((product) => !product.isUpdate).length ?? 0;
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
          <div><p className="text-xs font-semibold text-blue-600">INVENTORY</p><h2 id="import-title" className="mt-1 text-xl font-semibold">Import products</h2><p className="mt-1 text-sm text-slate-500">Excel (.xlsx), CSV, or JSON. Products are matched by name: existing names are updated, new names are added.</p></div>
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
                  <div className="rounded-xl border border-slate-100 p-3 dark:border-slate-800"><p className="text-lg font-semibold">{updateCount}</p><p className="text-[11px] text-slate-500">Updates</p></div>
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
                            <td className="px-3 py-2 font-medium">{product.name}{product.barcode && <span className="block font-mono text-[10px] font-normal text-slate-400">{product.barcode}</span>}</td>
                            <td className="px-3 py-2 text-slate-500">{product.category}</td>
                            <td className="px-3 py-2 text-right">{money(product.price)}</td>
                            <td className="px-3 py-2 text-right text-slate-500">{product.wholesale_price !== undefined ? money(product.wholesale_price) : "—"}</td>
                            <td className="px-3 py-2 text-right">{product.stock}</td>
                            <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${product.isUpdate ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>{product.isUpdate ? "Update" : "New"}</span></td>
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
    const validCount = Number.isInteger(count) && count > 0;
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
    if (!Number.isInteger(count) || count < 1 || count > 9999) return setError("Enter a whole-number quantity from 1 to 9,999.");
    if (!name || name.length > 120) return setError("Enter a description of up to 120 characters.");
    if (!Number.isFinite(unitPrice) || unitPrice <= 0 || unitPrice > 999999.99) return setError("Enter a price or amount above ₱0.");
    onAdd({ description: name, quantity: count, unitPrice });
  }

  const lineTotal = Math.round(Number(price) * 100) / 100 * (Number(quantity) || 0);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="quick-add-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
        <div className="mb-5 flex items-start justify-between">
          <div><p className="text-xs font-semibold text-blue-600">CUSTOM ITEM</p><h2 id="quick-add-title" className="mt-1 text-xl font-semibold">Quick add</h2><p className="mt-1 text-sm text-slate-500">{initial.note ? `${initial.note} ` : ""}Sell it as a one-off item. Stock isn’t tracked for custom items.</p></div>
          <button type="button" aria-label="Close quick add (Esc)" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-50"><X size={18} /></button>
        </div>
        <form noValidate onSubmit={submit} className="space-y-4">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Description<input autoFocus={!initial.description} required maxLength={120} value={description} onChange={(event) => setDescription(event.currentTarget.value)} placeholder="e.g. Ice (1 bag)" className={inputClass} /></label>
          <div className="grid grid-cols-3 gap-3">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Quantity<input required type="number" min="1" max="9999" step="1" inputMode="numeric" value={quantity} onChange={(event) => updateFrom({ quantity: event.currentTarget.value })} className={inputClass} /></label>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Price (₱)<input autoFocus={!!initial.description} required type="number" min="0.01" step="0.01" inputMode="decimal" value={price} onChange={(event) => updateFrom({ price: event.currentTarget.value })} placeholder="each" className={inputClass} /></label>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Amount (₱)<input type="number" min="0.01" step="0.01" inputMode="decimal" value={amount} onChange={(event) => updateFrom({ amount: event.currentTarget.value })} placeholder="total" className={inputClass} /></label>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800"><span>Adds to order</span><span className="font-semibold text-slate-800 dark:text-slate-100">{Number(quantity) || 0} × {money(Math.round(Number(price) * 100) / 100 || 0)} = {money(lineTotal || 0)}</span></div>
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
          maxLength={64}
          pattern="[!-~]{1,64}"
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

function CartPanel({ items, quantities, count, subtotal, total, onChange, onCheckout, onClear, isProcessing, priceOf, wholesale, savings, onClose, customItems, onCustomChange, showImages, textScale = 100 }: {
  items: Product[];
  quantities: Record<string, number>;
  count: number;
  subtotal: number;
  total: number;
  onChange: (productId: string, difference: number) => void;
  onCheckout: () => void;
  onClear: () => void;
  isProcessing: boolean;
  priceOf: (product: Product) => number;
  wholesale: boolean;
  savings: number;
  onClose: () => void;
  customItems: CustomItem[];
  onCustomChange: (id: string, difference: number) => void;
  showImages: boolean;
  textScale?: number;
}) {
  const stepButton = "grid h-6 w-6 place-items-center rounded-md border border-slate-200 text-slate-500 hover:border-blue-300 hover:text-blue-600";
  return (
    <aside aria-label="Current order" style={{ zoom: textScale / 100 }} className="flex h-full flex-col overflow-hidden border-l border-slate-100 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 md:rounded-2xl md:border md:shadow-[0_3px_16px_rgba(20,45,90,0.035)]">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
        <div><div className="flex items-center gap-2"><ShoppingCart size={17} className="text-blue-600" /><h2 className="text-sm font-semibold">Current order</h2></div><p className="mt-1 flex items-center gap-1.5 pl-[25px] text-[11px] text-slate-400">New sale{wholesale && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Wholesale</span>}</p></div>
        {count > 0 && <button type="button" onClick={onClear} aria-keyshortcuts="F9" className="ml-auto flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 hover:text-red-500">Clear all <Kbd>F9</Kbd></button>}
        <button type="button" aria-label="Close order panel" onClick={onClose} className="-mr-2 rounded-lg p-2 text-slate-400 hover:bg-slate-50 md:hidden"><X size={18} /></button>
      </div>
      <div className="flex shrink-0 items-center justify-between bg-slate-50/80 px-5 py-3 text-[11px] dark:bg-slate-800/60"><span className="text-slate-500">Customer</span><span className="font-semibold text-slate-700 dark:text-slate-200">Walk-in customer</span></div>
      <div className="min-h-[120px] flex-1 overflow-y-auto px-5">
        {items.length + customItems.length > 0 ? <ul className="divide-y divide-slate-100 dark:divide-slate-800">{items.map((product) => <li key={product.id} className={`flex items-center gap-3 ${showImages ? "py-4" : "py-3"}`}>
          {showImages && <ProductArtwork product={product} className="h-11 w-11 rounded-xl text-xl" />}
          <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{product.name}</p><p className="mt-1 text-[11px] text-slate-400">{money(priceOf(product))} each{priceOf(product) !== product.price && <span className="ml-1.5 line-through">{money(product.price)}</span>}</p><div className="mt-2 flex items-center gap-2"><button type="button" aria-label={`Remove one ${product.name}`} onClick={() => onChange(product.id, -1)} className="grid h-6 w-6 place-items-center rounded-md border border-slate-200 text-slate-500 hover:border-blue-300 hover:text-blue-600"><Minus size={12} /></button><span className="w-4 text-center text-xs font-semibold">{quantities[product.id]}</span><button type="button" aria-label={`Add one ${product.name}`} onClick={() => onChange(product.id, 1)} className="grid h-6 w-6 place-items-center rounded-md border border-slate-200 text-slate-500 hover:border-blue-300 hover:text-blue-600"><Plus size={12} /></button></div></div>
          <div className="flex h-full flex-col items-end justify-between gap-4"><button type="button" aria-label={`Remove ${product.name} from order`} onClick={() => onChange(product.id, -quantities[product.id])} className="text-slate-300 hover:text-red-500"><Trash2 size={14} /></button><span className="text-xs font-semibold">{money(priceOf(product) * quantities[product.id])}</span></div>
        </li>)}{customItems.map((item) => <li key={item.id} className={`flex items-center gap-3 ${showImages ? "py-4" : "py-3"}`}>
          {showImages && <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-800"><PenLine size={18} /></div>}
          <div className="min-w-0 flex-1"><p className="flex items-center gap-1.5 text-xs font-semibold"><span className="truncate">{item.description}</span><span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800">Custom</span></p><p className="mt-1 text-[11px] text-slate-400">{money(item.unitPrice)} each</p><div className="mt-2 flex items-center gap-2"><button type="button" aria-label={`Remove one ${item.description}`} onClick={() => onCustomChange(item.id, -1)} className={stepButton}><Minus size={12} /></button><span className="min-w-4 text-center text-xs font-semibold">{item.quantity}</span><button type="button" aria-label={`Add one ${item.description}`} onClick={() => onCustomChange(item.id, 1)} className={stepButton}><Plus size={12} /></button></div></div>
          <div className="flex h-full flex-col items-end justify-between gap-4"><button type="button" aria-label={`Remove ${item.description} from order`} onClick={() => onCustomChange(item.id, -item.quantity)} className="text-slate-300 hover:text-red-500"><Trash2 size={14} /></button><span className="text-xs font-semibold">{money(item.unitPrice * item.quantity)}</span></div>
        </li>)}</ul> : <div className="flex min-h-[180px] flex-col items-center justify-center text-center"><div className="grid h-12 w-12 place-items-center rounded-full bg-blue-50 text-blue-500"><ShoppingCart size={20} /></div><p className="mt-3 text-xs font-semibold text-slate-700">Your order is empty</p><p className="mt-1 text-[11px] text-slate-400">Add a product to get started.</p></div>}
      </div>
      <div className="shrink-0 border-t border-slate-100 px-5 py-4 dark:border-slate-800">
        <div className="space-y-2.5 text-xs"><div className="flex justify-between text-slate-500"><span>Subtotal <span className="text-slate-400">({count} items)</span></span><span className="font-medium text-slate-700">{money(wholesale ? subtotal + savings : subtotal)}</span></div>{wholesale && savings > 0 && <div className="flex justify-between text-emerald-700"><span>Wholesale savings</span><span className="font-medium">−{money(savings)}</span></div>}<div className="my-3 border-t border-dashed border-slate-200" /><div className="flex items-center justify-between"><span className="text-sm font-semibold">Total</span><span className="text-lg font-bold text-slate-900">{money(total)}</span></div></div>
        <button type="button" disabled={!count || isProcessing} onClick={onCheckout} aria-keyshortcuts="F4" className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 text-sm font-semibold text-white shadow-lg shadow-blue-600/15 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"><CreditCard size={17} /> {isProcessing ? "Processing…" : `Continue to payment · ${money(total)}`}{!isProcessing && <Kbd>F4</Kbd>}</button>
        <p className="mt-3 flex items-center justify-center gap-1.5 text-[10px] text-slate-400"><WalletCards size={13} /> Secure, fast checkout</p>
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
  const lowStock = products.filter((product) => product.stock < 10).length;
  return (
    <section>
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><div className="mb-1 flex items-center gap-2 text-xs font-medium text-slate-400"><Store size={14} /> Clover &amp; Co. <span>/</span> <span className="text-blue-600">Inventory</span></div><h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">Inventory</h1><p className="mt-1 text-sm text-slate-500">Keep your products and stock levels up to date.</p></div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onImport} className="flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 hover:border-blue-200 hover:text-blue-700"><FileSpreadsheet size={16} className="text-emerald-600" /> Import products</button>
          <DropdownMenu>
            <DropdownMenuTrigger disabled={products.length === 0} className="flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 outline-none hover:border-blue-200 hover:text-blue-700 focus-visible:ring-2 focus-visible:ring-blue-300 disabled:opacity-50 data-[state=open]:border-blue-200 data-[state=open]:text-blue-700"><Download size={16} /> Export <ChevronDown size={14} /></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 rounded-xl border-slate-100 bg-white p-1 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900">
              <DropdownMenuLabel className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Export {products.length} products</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => exportInventoryExcel(products)} className="cursor-pointer rounded-lg text-xs focus:bg-blue-50 focus:text-blue-700 dark:focus:bg-slate-800"><FileSpreadsheet className="text-emerald-600" /><span><span className="block font-semibold">Excel (.xlsx)</span><span className="block text-[10px] text-slate-400">Editable; can be imported again</span></span></DropdownMenuItem>
              <DropdownMenuItem onSelect={() => exportInventoryPdf(products)} className="cursor-pointer rounded-lg text-xs focus:bg-blue-50 focus:text-blue-700 dark:focus:bg-slate-800"><Printer className="text-red-500" /><span><span className="block font-semibold">PDF report</span><span className="block text-[10px] text-slate-400">Print, or choose Save as PDF</span></span></DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <button type="button" onClick={onAdd} className="flex h-10 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-md shadow-blue-600/15 hover:bg-blue-700"><PackagePlus size={16} /> Add product</button>
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
      <p className="mb-4 text-xs text-slate-400">Import an Excel (.xlsx), CSV, or JSON file with Product Name, Category, Retail Price and Stock columns, plus optional Wholesale Price, Cost Price and Barcode. Use Import products to download the Excel template and preview changes before saving.</p>
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-100 bg-white p-4"><p className="text-xs text-slate-500">Total products</p><p className="mt-2 text-2xl font-semibold">{products.length}</p></div>
        <div className="rounded-2xl border border-slate-100 bg-white p-4"><p className="text-xs text-slate-500">Units in stock</p><p className="mt-2 text-2xl font-semibold">{products.reduce((sum, product) => sum + product.stock, 0)}</p></div>
        <div className="rounded-2xl border border-slate-100 bg-white p-4"><p className="text-xs text-slate-500">Running low</p><p className="mt-2 text-2xl font-semibold">{lowStock}<span className="ml-2 text-xs font-medium text-amber-600">needs attention</span></p></div>
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="text-sm font-semibold">All products</h2><p className="mt-1 text-xs text-slate-400">{products.length} items in your catalog</p></div><span className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-500">Updated just now</span></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-xs"><thead className="bg-slate-50/70 text-[10px] font-semibold uppercase tracking-wider text-slate-400"><tr><th className="px-5 py-3">Product</th><th className="px-4 py-3">Category</th><th className="px-4 py-3">Cost price</th><th className="px-4 py-3">Wholesale price</th><th className="px-4 py-3">Retail price</th><th className="px-4 py-3">Stock</th><th className="px-5 py-3 text-right">Actions</th></tr></thead><tbody className="divide-y divide-slate-100">{products.map((product) => <tr key={product.id} className="hover:bg-slate-50/50"><td className="px-5 py-3.5"><div className="flex items-center gap-3"><ProductArtwork product={product} className="h-9 w-9 rounded-lg text-lg" /><span><span className="block font-semibold text-slate-700">{product.name}</span>{product.barcode && <span className="mt-0.5 flex items-center gap-1 font-mono text-[10px] text-slate-400"><ScanBarcode size={11} />{product.barcode}</span>}</span></div></td><td className="px-4 py-3.5 text-slate-500">{product.category}</td><td className="px-4 py-3.5">{product.costPriceKnown ? money(product.costPrice) : <span className="text-amber-600">Not set</span>}</td><td className="px-4 py-3.5">{money(product.wholesalePrice)}</td><td className="px-4 py-3.5 font-semibold">{money(product.price)}</td><td className="px-4 py-3.5"><span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${product.stock < 10 ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>{product.stock} in stock</span></td><td className="px-5 py-3.5 text-right"><div className="inline-flex items-center gap-1">
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
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><div className="mb-1 flex items-center gap-2 text-xs font-medium text-slate-400"><Store size={14} /> Clover &amp; Co. <span>/</span> <span className="text-blue-600">Employees</span></div><h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">Team members</h1><p className="mt-1 text-sm text-slate-500">Create and manage secure employee sign-in accounts.</p></div>
        <button type="button" onClick={onAdd} className="flex h-10 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-md shadow-blue-600/15 hover:bg-blue-700"><UserPlus size={16} /> Add employee</button>
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="text-sm font-semibold">Employee accounts</h2><p className="mt-1 text-xs text-slate-400">{employees.length} active employee{employees.length === 1 ? "" : "s"}</p></div><Users size={18} className="text-slate-400" /></div>
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
      <div className="mb-6"><div className="mb-1 flex items-center gap-2 text-xs font-medium text-slate-400"><Store size={14} /> Clover &amp; Co. <span>/</span> <span className="text-blue-600">Account</span></div><h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">Account settings</h1><p className="mt-1 text-sm text-slate-500">Manage your sign-in details and store history.</p></div>
      <div className="space-y-5">
        <form onSubmit={onUpdateName} className="rounded-2xl border border-slate-100 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 sm:p-6">
          <div className="mb-4"><h2 className="text-sm font-semibold">Account name</h2><p className="mt-1 text-xs leading-5 text-slate-500">This name appears in the POS workspace and account profile.</p></div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">Full name<input required maxLength={100} name="fullName" defaultValue={name} autoComplete="name" className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50 dark:border-slate-700 dark:bg-slate-950" /></label>
          <button type="submit" disabled={isProcessing} className="mt-4 h-10 rounded-lg bg-blue-600 px-4 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{isProcessing ? "Saving…" : "Update name"}</button>
        </form>
        <form onSubmit={onUpdateEmail} className="rounded-2xl border border-slate-100 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 sm:p-6">
          <div className="mb-4"><h2 className="text-sm font-semibold">Email address</h2><p className="mt-1 text-xs leading-5 text-slate-500">A confirmation email may be required before your new address becomes active.</p></div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">Current email<input disabled value={email} className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300" /></label>
          <label className="mt-3 block text-xs font-medium text-slate-600 dark:text-slate-300">New email address<input required type="email" name="email" autoComplete="email" placeholder="you@yourstore.com" className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50 dark:border-slate-700 dark:bg-slate-950" /></label>
          <button type="submit" disabled={isProcessing} className="mt-4 h-10 rounded-lg bg-blue-600 px-4 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{isProcessing ? "Saving…" : "Update email"}</button>
        </form>
        <form onSubmit={onUpdatePassword} className="rounded-2xl border border-slate-100 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 sm:p-6">
          <div className="mb-4"><h2 className="text-sm font-semibold">Change password</h2><p className="mt-1 text-xs leading-5 text-slate-500">Use at least 8 characters. Your password is managed securely by Supabase Auth.</p></div>
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
      <div className="mb-6"><div className="mb-1 flex items-center gap-2 text-xs font-medium text-slate-400"><Store size={14} /> Clover &amp; Co. <span>/</span> <span className="text-blue-600">Orders</span></div><h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">Recent orders</h1><p className="mt-1 text-sm text-slate-500">A quick look at your latest transactions.</p></div>
      <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800 sm:flex-row sm:items-center">
          <div><h2 className="text-sm font-semibold">Order history</h2><p className="mt-1 text-xs text-slate-400">Showing {visibleOrders.length} of {orders.length} recent transactions</p></div>
          <div className="flex gap-1 rounded-lg bg-slate-50 p-1 dark:bg-slate-800" aria-label="Filter orders by payment method">
            {(["all", "cash", "e_wallet", "card"] as const).map((method) => <button key={method} type="button" aria-pressed={paymentFilter === method} onClick={() => setPaymentFilter(method)} className={`rounded-md px-3 py-1.5 text-[11px] font-semibold capitalize ${paymentFilter === method ? "bg-white text-blue-700 shadow-sm dark:bg-slate-700 dark:text-blue-300" : "text-slate-500 hover:text-slate-700"}`}>{method === "all" ? "All payments" : paymentMethodLabel(method)}</button>)}
          </div>
        </div>
        {visibleOrders.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-xs">
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
                      <td className="px-4 py-3.5 text-right"><p className="text-sm font-semibold">{money(order.total)}</p><p className="mt-0.5 text-[11px] text-slate-400">{order.items} item{order.items === 1 ? "" : "s"}</p></td>
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
              <div className="min-w-0"><p className="flex items-center gap-1.5 font-semibold"><span className="truncate">{line.name}</span>{line.custom && <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800">Custom</span>}</p><p className="mt-0.5 text-[11px] text-slate-400">{line.quantity} × {money(line.unitPrice)}</p></div>
              <span className="shrink-0 font-semibold">{money(line.quantity * line.unitPrice)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-4 space-y-2 text-xs">
          <div className="flex justify-between text-slate-500"><dt>Payment</dt><dd className="font-medium text-slate-700 dark:text-slate-200">{paymentMethodLabel(order.paymentMethod)}{order.paymentReferenceLast4 ? ` · Ref •••• ${order.paymentReferenceLast4}` : ""}{order.isWholesale ? " · Wholesale" : ""}</dd></div>
          {order.cashReceived !== null && <div className="flex justify-between text-slate-500"><dt>Cash received</dt><dd className="font-medium text-slate-700 dark:text-slate-200">{money(order.cashReceived)}</dd></div>}
          {order.cashReceived !== null && <div className="flex justify-between text-slate-500"><dt>Change</dt><dd className="font-medium text-slate-700 dark:text-slate-200">{money(order.changeDue ?? 0)}</dd></div>}
          <div className="flex items-center justify-between border-t border-dashed border-slate-200 pt-3 dark:border-slate-700"><dt className="text-sm font-semibold">Total</dt><dd className="text-lg font-bold">{money(order.total)}</dd></div>
        </dl>
        <div className="mt-4 flex items-center gap-2 text-[11px] text-slate-500"><OrderStatusBadge order={order} /> {order.items} item{order.items === 1 ? "" : "s"}</div>{order.syncStatus && <p className="mt-2 text-[11px] leading-4 text-slate-500">{order.syncStatus === "failed" && order.syncError ? `The server refused this sale: ${order.syncError}` : "Saved on this computer. It syncs to the store database automatically when online."}</p>}
      </div>
    </div>
  );
}
