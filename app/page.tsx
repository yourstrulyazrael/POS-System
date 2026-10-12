"use client";

import {
  ArrowRight,
  BarChart3,
  Bell,
  Boxes,
  Check,
  ChevronDown,
  CircleDollarSign,
  ClipboardList,
  Clock3,
  Coffee,
  CreditCard,
  Banknote,
  CircleHelp,
  LayoutDashboard,
  FileUp,
  LogOut,
  Minus,
  PackagePlus,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Store,
  Trash2,
  UserRound,
  Users,
  UserPlus,
  WalletCards,
  X,
  type LucideIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { AnalyticsReportsView } from "@/components/analytics-reports";
import { SmoothLineChart } from "@/components/smooth-line-chart";
import { FormEvent, useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
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
  emoji: string;
  color: string;
};
type Order = { id: string; items: number; total: number; time: string; paymentMethod: PaymentMethod; paymentReferenceLast4: string | null; cashReceived: number | null; changeDue: number | null; employeeName: string };
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
type ProductRow = { id: string; name: string; category: string; cost_price: number; cost_price_known: boolean; wholesale_price: number; price: number; stock: number; image_icon: string | null; image_url: string | null };
type OrderRow = {
  id: string;
  total: number;
  created_at: string;
  order_items: { quantity: number }[];
  payment_method: PaymentMethod;
  payment_reference_last4: string | null;
  cash_received: number | string | null;
  change_due: number | string | null;
  employee_name: string;
  employee_id?: string | null;
};
type Employee = { id: string; email: string; full_name: string; role: "employee" };
type DashboardStats = { sales_total: number; orders_today: number; active_products: number; units_in_stock: number; active_employees: number };
type SalesPeriod = "today" | "7days" | "30days";

const money = (amount: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(amount);
const paymentMethodLabel = (method: PaymentMethod) =>
  method === "e_wallet" ? "E-Wallet" : method === "card" ? "Card" : "Cash";

const categoryColors = ["bg-sky-50", "bg-amber-50", "bg-violet-50", "bg-rose-50"];
const sariSariCategories = [
  "Rice & Grains",
  "Canned Goods",
  "Instant Noodles",
  "Snacks",
  "Eggs & Dairy",
  "Beverages",
  "Coffee & Drinks",
  "Condiments",
  "Personal Care",
  "Household",
];

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

async function fetchWorkspaceData(includeAdminStats = false, period: SalesPeriod = "today") {
  const supabase = createClient();
  const [productsResult, ordersResult] = await Promise.all([
    supabase.from("products").select("id, name, category, cost_price, cost_price_known, wholesale_price, price, stock, image_icon, image_url").eq("active", true).order("name").returns<ProductRow[]>(),
    supabase.from("orders").select("id, total, created_at, payment_method, payment_reference_last4, cash_received, change_due, employee_name, order_items(quantity)").order("created_at", { ascending: false }).limit(50).returns<OrderRow[]>(),
  ]);
  if (productsResult.error) throw new Error(`Unable to load products: ${productsResult.error.message}`);
  if (ordersResult.error) throw new Error(`Unable to load orders: ${ordersResult.error.message}`);
  let stats: DashboardStats | null = null;
  let salesChart: SalesChartPoint[] = [];
  if (includeAdminStats) {
    const [{ data, error }, { data: chartRows, error: chartError }] = await Promise.all([
      supabase.rpc("get_admin_dashboard_stats", { p_period: period }).single(),
      supabase.rpc("get_admin_sales_chart", { p_period: period }),
    ]);
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
    products: productsResult.data.map((product, index) => ({
      ...product,
      costPrice: Number(product.cost_price),
      costPriceKnown: product.cost_price_known,
      wholesalePrice: Number(product.wholesale_price),
      price: Number(product.price),
      imageIcon: product.image_icon ?? "auto",
      imageUrl: product.image_url,
      ...productAppearance(product.name, product.category, index, product.image_icon ?? "auto"),
    })),
    orders: ordersResult.data.map((order) => ({
      id: `#${order.id.slice(0, 8)}`,
      items: order.order_items.reduce((sum, item) => sum + item.quantity, 0),
      total: Number(order.total),
      time: new Date(order.created_at).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }),
      paymentMethod: order.payment_method,
      paymentReferenceLast4: order.payment_reference_last4,
      cashReceived: order.cash_received === null ? null : Number(order.cash_received),
      changeDue: order.change_due === null ? null : Number(order.change_due),
      employeeName: order.employee_name || "Former employee",
    })),
    stats,
    salesChart,
  };
}

function parseProductJson(content: string) {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error("The selected JSON file is not valid JSON.");
  }
  if (!Array.isArray(value)) throw new Error("Product JSON must be an array of product records.");
  return validateImportedProducts(value);
}

function parseProductCsv(content: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (character === '"' && quoted && content[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && content[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error("The CSV file has an unclosed quoted field.");
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  if (rows.length < 2) throw new Error("The CSV needs a header and at least one product row.");

  const headers = rows[0].map((header) => header.replace(/^\uFEFF/, "").trim().toLowerCase());
  const requiredHeaders = ["name", "category", "stock"];
  if (requiredHeaders.some((header) => !headers.includes(header)) || (!headers.includes("price") && !headers.includes("retail_price"))) {
    throw new Error("CSV headers must include name, category, retail_price (or price), and stock.");
  }
  const records = rows.slice(1).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
  );
  return validateImportedProducts(records);
}

function validateImportedProducts(value: unknown[]) {
  return value.map((record, index) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new Error(`Product row ${index + 1} must be an object.`);
    }
    const item = record as Record<string, unknown>;
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const category = typeof item.category === "string" ? item.category.trim() : "";
    const costPriceProvided = item.cost_price !== undefined && item.cost_price !== null && item.cost_price !== "";
    const costPrice = costPriceProvided ? Number(item.cost_price) : 0;
    const wholesalePrice = item.wholesale_price === undefined || item.wholesale_price === "" ? 0 : Number(item.wholesale_price);
    const price = Number(item.retail_price ?? item.price);
    const stock = Number(item.stock);
    const imageIcon = typeof item.image_icon === "string" ? item.image_icon.trim() : "auto";
    if (
      !name ||
      name.length > 120 ||
      !category ||
      category.length > 80 ||
      !Number.isFinite(costPrice) ||
      costPrice < 0 ||
      !Number.isFinite(wholesalePrice) ||
      wholesalePrice < 0 ||
      !Number.isFinite(price) ||
      price <= 0 ||
      !Number.isInteger(stock) ||
      stock < 0 ||
      !productIcons.some((icon) => icon.id === imageIcon)
    ) {
      throw new Error(`Product row ${index + 1} needs a name, category, non-negative cost and wholesale prices, a positive retail price, and non-negative whole-number stock.`);
    }
    return {
      name,
      category,
      ...(costPriceProvided ? { cost_price: costPrice, cost_price_known: true } : {}),
      ...(item.wholesale_price !== undefined && item.wholesale_price !== null && item.wholesale_price !== "" ? { wholesale_price: wholesalePrice } : {}),
      price,
      stock,
      image_icon: imageIcon,
    };
  });
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
  const [search, setSearch] = useState("");
  const [activePage, setActivePage] = useState<"dashboard" | "analytics" | "pos" | "inventory" | "orders" | "employees" | "account">("pos");
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [editingProductPrices, setEditingProductPrices] = useState<Product | null>(null);
  const [selectedProductIcon, setSelectedProductIcon] = useState("auto");
  const [selectedProductImage, setSelectedProductImage] = useState<File | null>(null);
  const [editingProductImage, setEditingProductImage] = useState<Product | null>(null);
  const [removeExistingProductImage, setRemoveExistingProductImage] = useState(false);
  const [showHelpCenter, setShowHelpCenter] = useState(false);
  const [showCheckoutDialog, setShowCheckoutDialog] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [cashReceived, setCashReceived] = useState("");
  const [paymentReferenceLast4, setPaymentReferenceLast4] = useState("");
  const [accountEmail, setAccountEmail] = useState("");
  const [accountName, setAccountName] = useState("");
  const [salesResetConfirmation, setSalesResetConfirmation] = useState("");
  const [notice, setNotice] = useState("");
  const [authError, setAuthError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [showAddEmployee, setShowAddEmployee] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [restockProduct, setRestockProduct] = useState<Product | null>(null);

  const categories = useMemo(
    () => ["All items", ...new Set([...sariSariCategories, ...products.map((product) => product.category)])],
    [products],
  );
  const visibleProducts = useMemo(
    () =>
      products.filter(
        (product) =>
          (category === "All items" || product.category === category) &&
          product.name.toLowerCase().includes(search.toLowerCase()),
      ),
    [category, products, search],
  );
  const cartItems = products.filter((product) => cart[product.id]);
  const itemCount = Object.values(cart).reduce((total, quantity) => total + quantity, 0);
  const subtotal = cartItems.reduce((total, product) => total + product.price * cart[product.id], 0);
  const total = Math.round(subtotal * 100) / 100;
  const notifications = [
    ...products
      .filter((product) => product.stock <= 5)
      .map((product) => ({
        id: `low-stock-${product.id}`,
        title: "Low stock",
        message: `${product.name} has ${product.stock} left.`,
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

  useEffect(() => {
    let cancelled = false;
    async function restoreSession() {
      try {
        const supabase = createClient();
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
        setRole(profile.role);
        setEmployeeName(profile.full_name || user.email || "Team member");
        setAccountName(profile.full_name || "");
        setAccountEmail(user.email ?? "");
        setProducts(workspace.products);
        setOrders(workspace.orders);
        setDashboardStats(workspace.stats);
        setSalesChart(workspace.salesChart);
        setLastRefreshedAt(new Date());
        if (profile.role === "admin") setActivePage("dashboard");
        setSignedIn(true);
      } catch (error) {
        if (!cancelled) setAuthError(error instanceof Error ? error.message : "Unable to restore your session.");
      } finally {
        if (!cancelled) setCheckingAuth(false);
      }
    }
    void restoreSession();
    return () => { cancelled = true; };
  }, []);

  const refreshWorkspace = useCallback(async (period = salesPeriod) => {
    const workspace = await fetchWorkspaceData(role === "admin", period);
    setProducts(workspace.products);
    setOrders(workspace.orders);
    setDashboardStats(workspace.stats);
    setSalesChart(workspace.salesChart);
    setLastRefreshedAt(new Date());
  }, [role, salesPeriod]);

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
      void refreshDashboard(salesPeriod, true);
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
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("place_order", {
        p_items: cartItems.map((product) => ({ product_id: product.id, quantity: cart[product.id] })),
        p_payment_method: paymentMethod,
        p_payment_reference_last4: paymentMethod === "cash" ? null : paymentReferenceLast4,
        p_cash_received: receivedAmount,
      }).single();
      if (error) throw error;
      if (!data || typeof data !== "object" || !("order_id" in data) || typeof data.order_id !== "string") {
        throw new Error("Checkout completed, but the order confirmation was invalid.");
      }
      const newOrderId = data.order_id.slice(0, 8);
      setCart({});
      setShowCheckoutDialog(false);
      setCashReceived("");
      setPaymentReferenceLast4("");
      setNotice(`Order #${newOrderId} placed successfully.`);
      try {
        await refreshWorkspace();
      } catch (error) {
        setNotice(`Order #${newOrderId} was placed, but the store data could not refresh: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to complete checkout.");
    } finally {
      setIsLoading(false);
    }
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
      if (profile.role !== role) {
        await supabase.auth.signOut();
        throw new Error(`This account is ${profile.role}. Select the ${profile.role} workspace to continue.`);
      }
      const workspace = await fetchWorkspaceData(profile.role === "admin", salesPeriod);
      setEmployeeName(profile.full_name || authData.user.email || "Team member");
      setAccountName(profile.full_name || "");
      setAccountEmail(authData.user.email ?? "");
      setProducts(workspace.products);
      setOrders(workspace.orders);
      setDashboardStats(workspace.stats);
      setSalesChart(workspace.salesChart);
      setLastRefreshedAt(new Date());
      setActivePage(profile.role === "admin" ? "dashboard" : "pos");
      setSignedIn(true);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Unable to sign in.");
    } finally {
      setIsLoading(false);
    }
  }

  async function addProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const name = String(formData.get("name") ?? "").trim();
    const costPrice = Number(formData.get("cost_price"));
    const wholesalePrice = Number(formData.get("wholesale_price"));
    const price = Number(formData.get("price"));
    const stock = Number(formData.get("stock"));
    const selectedCategory = String(formData.get("category") ?? sariSariCategories[0]);
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
      setNotice(error instanceof Error ? error.message : "Unable to add product.");
    }
  }

  async function removeProduct(product: Product) {
    try {
      const supabase = createClient();
      const { error } = await supabase.from("products").update({ active: false }).eq("id", product.id);
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
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to remove product.");
    }
  }

  async function saveProductPrices(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingProductPrices) return;
    const formData = new FormData(event.currentTarget);
    const costPrice = Number(formData.get("cost_price"));
    const wholesalePrice = Number(formData.get("wholesale_price"));
    const retailPrice = Number(formData.get("price"));
    if (!Number.isFinite(costPrice) || costPrice < 0 || !Number.isFinite(wholesalePrice) || wholesalePrice < 0 || !Number.isFinite(retailPrice) || retailPrice <= 0) {
      setNotice("Enter valid cost and wholesale prices, and a retail price above ₱0.");
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
      }).eq("id", editingProductPrices.id);
      if (error) throw error;
      const productName = editingProductPrices.name;
      setEditingProductPrices(null);
      setNotice(`${productName} prices updated.`);
      try {
        await refreshWorkspace();
      } catch (error) {
        setNotice(`${productName} prices were updated, but the catalog could not refresh: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to update product prices.");
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

  async function signOut() {
    const supabase = createClient();
    const { error } = await supabase.auth.signOut();
    if (error) {
      setNotice(`Unable to sign out: ${error.message}`);
      return;
    }
    setSignedIn(false);
    setActivePage("pos");
    setCart({});
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
      const response = await fetch("/api/admin/reset-sales-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: salesResetConfirmation }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to reset sales history.");
      if (!Number.isSafeInteger(result.deletedOrders) || result.deletedOrders < 0) {
        throw new Error("Sales history was reset, but the server returned an invalid order count.");
      }
      setOrders([]);
      setDashboardStats((current) => current ? { ...current, sales_total: 0, orders_today: 0 } : current);
      setSalesResetConfirmation("");
      setNotice(`${result.deletedOrders} sales order${result.deletedOrders === 1 ? "" : "s"} and their item history permanently deleted. Products, stock, employees, and stock movements were not changed.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to reset sales history.");
    } finally {
      setIsLoading(false);
    }
  }

  async function loadEmployees() {
    const response = await fetch("/api/admin/employees");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Unable to load employee accounts.");
    setEmployees(data.employees);
  }

  async function createEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    try {
      const formData = new FormData(event.currentTarget);
      const response = await fetch("/api/admin/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: formData.get("fullName"),
          email: formData.get("email"),
          password: formData.get("password"),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to create employee.");
      setEmployees((current) => [data.employee, ...current]);
      setShowAddEmployee(false);
      setNotice(`Employee account created for ${data.employee.full_name}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to create employee.");
    } finally {
      setIsLoading(false);
    }
  }

  async function removeEmployee(employee: Employee) {
    try {
      const response = await fetch("/api/admin/employees", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: employee.id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to remove employee.");
      setEmployees((current) => current.filter((item) => item.id !== employee.id));
      setNotice(`Employee account for ${employee.full_name} removed.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to remove employee.");
    }
  }

  async function importProducts(file: File) {
    setIsImporting(true);
    try {
      const text = await file.text();
      const rows = file.name.toLowerCase().endsWith(".json")
        ? parseProductJson(text)
        : parseProductCsv(text);
      if (rows.length === 0) throw new Error("The selected file does not contain any products.");
      const supabase = createClient();
      const { error } = await supabase.from("products").upsert(
        rows.map((product) => ({ ...product, active: true })),
        { onConflict: "name" },
      );
      if (error) throw error;
      await refreshWorkspace();
      setNotice(`${rows.length} product${rows.length === 1 ? "" : "s"} imported successfully.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to import products.");
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
                <p className="mb-2 text-sm font-semibold text-blue-700">WELCOME BACK</p>
                <h2 className="text-3xl font-semibold tracking-tight">Sign in to your store</h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">Choose your workspace, then enter your details.</p>
              </div>

              <div className="mb-6 grid grid-cols-2 rounded-xl bg-slate-100 p-1">
                {(["employee", "admin"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setRole(option)}
                    disabled={isLoading}
                    className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium capitalize transition ${
                      role === option ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    {option === "employee" ? <UserRound size={16} /> : <ShieldCheck size={16} />}
                    {option}
                  </button>
                ))}
              </div>

              <form onSubmit={signIn} className="space-y-4">
                <label className="block text-sm font-medium text-slate-700">
                  Work email
                  <input
                    required
                    type="email"
                    name="email"
                    placeholder="you@yourstore.com"
                    className="mt-2 h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                  />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  Password
                  <input
                    required
                    minLength={4}
                    type="password"
                    name="password"
                    placeholder="Enter your password"
                    className="mt-2 h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                  />
                </label>
                <div className="flex items-center justify-between py-1 text-sm">
                  <label className="flex items-center gap-2 text-slate-600">
                    <input type="checkbox" className="h-4 w-4 rounded border-slate-300 accent-blue-600" />
                    Remember me
                  </label>
                  <a href="/auth/forgot-password" className="font-medium text-blue-700 hover:text-blue-800">Forgot password?</a>
                </div>
                {authError && <p role="alert" className="text-sm text-red-600">{authError}</p>}
                <button disabled={isLoading} type="submit" className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 disabled:opacity-60">
                  {isLoading ? "Signing in…" : <>Sign in as {role} <ArrowRight size={17} /></>}
                </button>
              </form>

              <div className="mt-6 flex items-start gap-2.5 rounded-xl border border-blue-100 bg-blue-50 p-3.5 text-xs leading-5 text-blue-800">
                <ShieldCheck size={16} className="mt-0.5 shrink-0" />
                <span>Accounts are managed securely with Supabase. An administrator can create employee accounts from the dashboard.</span>
              </div>
              <p className="mt-5 text-center text-sm text-slate-500">Setting up a new store? <Link href="/setup-admin" className="font-semibold text-blue-700 hover:text-blue-800">Create the first admin</Link></p>
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
        <aside className="hidden w-[248px] shrink-0 flex-col border-r border-slate-100 bg-white px-5 py-6 dark:border-slate-800 dark:bg-slate-900 lg:flex">
          <Brand />
          <div className="mt-10">
            <p className="mb-3 px-3 text-[10px] font-bold tracking-[0.16em] text-slate-400">WORKSPACE</p>
            <nav className="space-y-1">
              {isAdmin && <SidebarLink icon={LayoutDashboard} label="Dashboard" active={currentView === "dashboard"} onClick={() => setActivePage("dashboard")} />}
              {isAdmin && <SidebarLink icon={BarChart3} label="Analytics & Reports" active={currentView === "analytics"} onClick={() => setActivePage("analytics")} />}
              <SidebarLink icon={ShoppingCart} label="Point of sale" active={currentView === "pos"} onClick={() => setActivePage("pos")} />
              {isAdmin && <SidebarLink icon={Boxes} label="Inventory" active={currentView === "inventory"} onClick={() => setActivePage("inventory")} />}
              {isAdmin && <SidebarLink icon={Users} label="Employees" active={currentView === "employees"} onClick={() => { setActivePage("employees"); void loadEmployees().catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Unable to load employees.")); }} />}
              <SidebarLink icon={ClipboardList} label="Orders" active={currentView === "orders"} onClick={() => setActivePage("orders")} />
              <SidebarLink icon={UserRound} label="Account" active={currentView === "account"} onClick={() => setActivePage("account")} />
            </nav>
          </div>
          <div className="mt-auto rounded-2xl bg-[#f2f6ff] p-4 dark:bg-slate-800">
            <div className="mb-3 grid h-9 w-9 place-items-center rounded-xl bg-white text-blue-600 shadow-sm dark:bg-slate-700 dark:text-blue-300"><CircleHelpIcon /></div>
            <p className="text-sm font-semibold">Need a hand?</p>
            <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-300">Your store team is here to help you out.</p>
            <button type="button" onClick={() => setShowHelpCenter(true)} className="mt-3 text-xs font-semibold text-blue-700 dark:text-blue-300">Visit help center <ArrowRight size={12} className="ml-1 inline" /></button>
          </div>
          <button type="button" onClick={() => void signOut()} className="mt-5 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-500 transition hover:bg-slate-50 hover:text-slate-800">
            <LogOut size={17} /> Sign out
          </button>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 flex h-[72px] items-center justify-between border-b border-slate-100 bg-white/95 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 sm:px-7 xl:px-9">
            <div className="flex items-center gap-3 lg:hidden"><Brand compact /></div>
            <div className="hidden lg:block">
              <p className="text-sm font-semibold">{isAdmin ? "Store overview" : "Good morning, " + employeeName.split(" ")[0] + " 👋"}</p>
              <p className="mt-0.5 text-xs text-slate-400">Here’s what’s happening in your store today.</p>
            </div>
            <div className="flex items-center gap-2 sm:gap-4">
              <button type="button" aria-label="Open help center" onClick={() => setShowHelpCenter(true)} className="grid h-10 w-10 place-items-center rounded-xl text-slate-500 transition hover:bg-slate-50 dark:hover:bg-slate-800"><CircleHelp size={19} /></button>
              <div className="hidden items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600 sm:flex">
                <Clock3 size={14} className="text-slate-400" />
                {new Date().toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric", timeZone: "Asia/Manila" })}
              </div>
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
              <div className="h-8 w-px bg-slate-100" />
              <div className="flex items-center gap-2.5">
                <div className="grid h-9 w-9 place-items-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">{employeeName.split(" ").map((part) => part[0]).join("").slice(0, 2)}</div>
                <div className="hidden sm:block">
                  <p className="text-xs font-semibold">{employeeName}</p>
                  <p className="mt-0.5 text-[10px] capitalize text-slate-400">{role}</p>
                </div>
                <button type="button" aria-label="Sign out" onClick={() => void signOut()} className="ml-1 rounded-lg p-2 text-slate-400 hover:bg-slate-50 hover:text-slate-700"><LogOut size={16} /></button>
              </div>
            </div>
          </header>

          <nav aria-label="Workspace navigation" className="flex gap-1 overflow-x-auto border-b border-slate-100 bg-white px-4 py-2 dark:border-slate-800 dark:bg-slate-900 lg:hidden">
            {isAdmin && <SidebarLink icon={LayoutDashboard} label="Dashboard" active={currentView === "dashboard"} onClick={() => setActivePage("dashboard")} />}
            {isAdmin && <SidebarLink icon={BarChart3} label="Analytics" active={currentView === "analytics"} onClick={() => setActivePage("analytics")} />}
            <SidebarLink icon={ShoppingCart} label="Point of sale" active={currentView === "pos"} onClick={() => setActivePage("pos")} />
            {isAdmin && <SidebarLink icon={Boxes} label="Inventory" active={currentView === "inventory"} onClick={() => setActivePage("inventory")} />}
            {isAdmin && <SidebarLink icon={Users} label="Employees" active={currentView === "employees"} onClick={() => { setActivePage("employees"); void loadEmployees().catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Unable to load employees.")); }} />}
            <SidebarLink icon={ClipboardList} label="Orders" active={currentView === "orders"} onClick={() => setActivePage("orders")} />
            <SidebarLink icon={UserRound} label="Account" active={currentView === "account"} onClick={() => setActivePage("account")} />
          </nav>

          <div className="p-4 sm:p-7 xl:p-9">
            {notice && (
              <div role="status" className={`mb-5 flex items-center justify-between rounded-xl border px-4 py-3 text-sm ${notice.includes("successfully") || notice.includes("added") ? "border-emerald-100 bg-emerald-50 text-emerald-800" : "border-blue-100 bg-blue-50 text-blue-800"}`}>
                <span className="flex items-center gap-2"><Check size={16} />{notice}</span>
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
                      <button type="button" disabled={isLoading} onClick={() => { setEditingProductImage(null); setSelectedProductImage(null); setRemoveExistingProductImage(false); }} className="h-11 flex-1 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
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
                orders={orders}
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
              />
            ) : currentView === "account" ? (
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
            ) : currentView === "inventory" && isAdmin ? (
              <InventoryView
                products={products}
                onAdd={() => { setSelectedProductIcon("auto"); setSelectedProductImage(null); setShowAddProduct(true); }}
                onEditPrices={setEditingProductPrices}
                onEditImage={(product) => {
                  setSelectedProductIcon(product.imageIcon);
                  setSelectedProductImage(null);
                  setRemoveExistingProductImage(false);
                  setEditingProductImage(product);
                }}
                onRemove={removeProduct}
                onImport={importProducts}
                isImporting={isImporting}
                onRestock={setRestockProduct}
              />
            ) : currentView === "orders" ? (
              <OrdersView orders={orders} />
            ) : (
              <div className="grid items-start gap-6 2xl:grid-cols-[minmax(0,1fr)_350px]">
                <section className="min-w-0">
                  <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                    <div>
                      <div className="mb-1 flex items-center gap-2 text-xs font-medium text-slate-400"><Store size={14} /> Clover &amp; Co. <span>/</span> <span className="text-blue-600">New sale</span></div>
                      <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">New sale</h1>
                      <p className="mt-1 text-sm text-slate-500">Find a product and add it to the customer’s order.</p>
                    </div>
                    <div className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 sm:w-[230px]">
                      <Search size={16} className="shrink-0 text-slate-400" />
                      <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products..." aria-label="Search products" className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400" />
                      {search && <button type="button" aria-label="Clear search" onClick={() => setSearch("")}><X size={14} className="text-slate-400" /></button>}
                    </div>
                  </div>

                  <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
                    {categories.map((item) => (
                      <button type="button" key={item} onClick={() => setCategory(item)} className={`shrink-0 rounded-full px-4 py-2 text-xs font-semibold transition ${category === item ? "bg-blue-600 text-white shadow-sm shadow-blue-600/20" : "border border-slate-200 bg-white text-slate-500 hover:border-blue-200 hover:text-blue-700"}`}>
                        {item}
                      </button>
                    ))}
                  </div>

                  {visibleProducts.length > 0 ? (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-3">
                      {visibleProducts.map((product) => {
                        const unavailable = product.stock <= (cart[product.id] ?? 0);
                        return (
                          <button type="button" key={product.id} disabled={unavailable} onClick={() => addToCart(product)} className={`group relative rounded-2xl border border-slate-100 bg-white p-3 text-left shadow-[0_2px_10px_rgba(20,45,90,0.025)] transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50 sm:p-4`}>
                            <ProductArtwork product={product} className={`mb-3 aspect-[1.6/1] rounded-xl text-[42px] transition-transform group-hover:scale-[1.015]`} />
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-slate-800">{product.name}</p>
                                <p className="mt-1 text-[11px] text-slate-400">{product.category} · {product.stock - (cart[product.id] ?? 0)} left</p>
                              </div>
                              <span className="shrink-0 text-sm font-bold text-blue-700">{money(product.price)}</span>
                            </div>
                            <span className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-full bg-white text-blue-600 opacity-0 shadow-sm transition group-hover:opacity-100"><Plus size={16} /></span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="grid min-h-64 place-items-center rounded-2xl border border-dashed border-slate-200 bg-white text-center">
                      <div><ShoppingBag size={28} className="mx-auto text-slate-300" /><p className="mt-3 text-sm font-semibold">No products found</p><p className="mt-1 text-xs text-slate-400">Try another name or category.</p></div>
                    </div>
                  )}
                </section>

                <CartPanel
                  items={cartItems}
                  quantities={cart}
                  count={itemCount}
                  subtotal={subtotal}
                  total={total}
                  onChange={changeQuantity}
                  onCheckout={() => { setNotice(""); setShowCheckoutDialog(true); }}
                  isProcessing={isLoading}
                  onClear={() => setCart({})}
                />
              </div>
            )}
          </div>
          <footer className="px-4 pb-6 text-center text-[10px] text-slate-400 sm:px-7 xl:px-9">Clover &amp; Co. POS · Front-end preview</footer>
        </div>
      </div>

      {showCheckoutDialog && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/50 p-4" onClick={(event) => { if (event.target === event.currentTarget && !isLoading) setShowCheckoutDialog(false); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="checkout-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-start justify-between">
              <div><p className="text-xs font-semibold text-blue-600">PAYMENT</p><h2 id="checkout-title" className="mt-1 text-xl font-semibold">Complete checkout</h2><p className="mt-1 text-sm text-slate-500">{itemCount} item{itemCount === 1 ? "" : "s"} · {money(total)} due</p></div>
              <button type="button" aria-label="Close checkout dialog" disabled={isLoading} onClick={() => setShowCheckoutDialog(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-50 disabled:opacity-50"><X size={18} /></button>
            </div>
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-semibold text-slate-700">Choose payment method</legend>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { method: "cash", label: "Cash", Icon: Banknote },
                  { method: "e_wallet", label: "E-Wallet", Icon: WalletCards },
                  { method: "card", label: "Card", Icon: CreditCard },
                ] as const).map(({ method, label, Icon }) => (
                  <button key={method} type="button" aria-pressed={paymentMethod === method} onClick={() => { setPaymentMethod(method); setCashReceived(""); setPaymentReferenceLast4(""); }} className={`flex h-12 flex-col items-center justify-center gap-1 rounded-lg border text-xs font-semibold ${paymentMethod === method ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-500 hover:border-blue-200"}`}><Icon size={16} />{label}</button>
                ))}
              </div>
            </fieldset>
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
              <button type="button" disabled={isLoading} onClick={() => { setShowCheckoutDialog(false); setNotice(""); }} className="h-11 flex-1 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
              <button type="button" disabled={isLoading || !itemCount} onClick={checkout} className="h-11 flex-1 rounded-lg bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60">{isLoading ? "Processing…" : "Confirm payment"}</button>
            </div>
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
              <label className="block text-sm font-medium text-slate-700">Category<select name="category" className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50">{categories.filter((item) => item !== "All items").map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
              <ProductImagePicker
                selectedIcon={selectedProductIcon}
                selectedImage={selectedProductImage}
                onIconChange={setSelectedProductIcon}
                onImageChange={setSelectedProductImage}
              />
              <div className="flex gap-3 pt-2"><button type="button" onClick={() => { setShowAddProduct(false); setSelectedProductImage(null); setSelectedProductIcon("auto"); }} className="h-11 flex-1 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancel</button><button type="submit" className="h-11 flex-1 rounded-lg bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700">Add product</button></div>
            </form>
          </div>
        </div>
      )}
      {editingProductPrices && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/40 p-4" onClick={(event) => { if (event.target === event.currentTarget && !isLoading) setEditingProductPrices(null); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="edit-product-prices-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-start justify-between">
              <div><p className="text-xs font-semibold text-blue-600">INVENTORY</p><h2 id="edit-product-prices-title" className="mt-1 text-xl font-semibold">Update product prices</h2><p className="mt-1 text-sm text-slate-500">{editingProductPrices.name}</p></div>
              <button type="button" aria-label="Close price editor" disabled={isLoading} onClick={() => setEditingProductPrices(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-50 disabled:opacity-50"><X size={18} /></button>
            </div>
            <form onSubmit={saveProductPrices} className="space-y-4">
              <label className="block text-sm font-medium text-slate-700">Cost price (₱)<input required name="cost_price" type="number" min="0" step="0.01" defaultValue={editingProductPrices.costPriceKnown ? editingProductPrices.costPrice : ""} className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50" /></label>
              <label className="block text-sm font-medium text-slate-700">Wholesale price (₱)<input required name="wholesale_price" type="number" min="0" step="0.01" defaultValue={editingProductPrices.wholesalePrice} className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50" /></label>
              <label className="block text-sm font-medium text-slate-700">Retail price (₱)<input required name="price" type="number" min="0.01" step="0.01" defaultValue={editingProductPrices.price} className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50" /></label>
              <div className="flex gap-3 pt-2"><button type="button" disabled={isLoading} onClick={() => setEditingProductPrices(null)} className="h-11 flex-1 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">Cancel</button><button disabled={isLoading} type="submit" className="h-11 flex-1 rounded-lg bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{isLoading ? "Saving…" : "Save prices"}</button></div>
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
              <div className="flex gap-3 pt-2"><button type="button" onClick={() => setShowAddEmployee(false)} className="h-11 flex-1 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancel</button><button disabled={isLoading} type="submit" className="h-11 flex-1 rounded-lg bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{isLoading ? "Creating…" : "Create account"}</button></div>
            </form>
          </div>
        </div>
      )}
      {restockProduct && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/40 p-4" onClick={(event) => { if (event.target === event.currentTarget) setRestockProduct(null); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="restock-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
            <div className="mb-5 flex items-start justify-between"><div><p className="text-xs font-semibold text-blue-600">STOCK ADJUSTMENT</p><h2 id="restock-title" className="mt-1 text-xl font-semibold">Restock product</h2><p className="mt-1 text-sm text-slate-500">{restockProduct.name} · currently {restockProduct.stock} in stock</p></div><button type="button" aria-label="Close dialog" onClick={() => setRestockProduct(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-50"><X size={18} /></button></div>
            <form onSubmit={restock} className="space-y-4">
              <label className="block text-sm font-medium text-slate-700">Units received<input required autoFocus name="quantity" type="number" min="1" max="1000000" step="1" placeholder="e.g. 24" className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50" /></label>
              <label className="block text-sm font-medium text-slate-700">Note <span className="font-normal text-slate-400">(optional)</span><input maxLength={200} name="note" placeholder="Supplier delivery, invoice number…" className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50" /></label>
              <div className="flex gap-3 pt-2"><button type="button" onClick={() => setRestockProduct(null)} className="h-11 flex-1 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancel</button><button disabled={isLoading} type="submit" className="h-11 flex-1 rounded-lg bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{isLoading ? "Updating…" : "Add to stock"}</button></div>
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

function CircleHelpIcon() {
  return <CircleHelp size={17} />;
}

function SidebarLink({ icon: Icon, label, active, onClick }: { icon: LucideIcon; label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition ${active ? "bg-blue-50 text-blue-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"}`}>
      <Icon size={17} strokeWidth={active ? 2.2 : 1.8} />{label}
    </button>
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
          {orders.length ? <div className="divide-y divide-slate-100">{orders.slice(0, 5).map((order) => <div key={order.id} className="flex items-center justify-between gap-3 px-5 py-3"><div><p className="text-xs font-semibold">{order.id}</p><p className="mt-0.5 text-[10px] text-slate-400">{order.items} item{order.items === 1 ? "" : "s"} · {order.time} · {order.employeeName} · {paymentMethodLabel(order.paymentMethod)}</p></div><p className="text-xs font-semibold">{money(order.total)}</p></div>)}</div> : <div className="px-5 py-8 text-center text-xs text-slate-400">No completed sales yet.</div>}
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
    { method: "e_wallet" as const, name: "E-Wallet", color: "#8b5cf6", values: rows.map((row) => row.eWallet) },
    { method: "card" as const, name: "Card", color: "#f59e0b", values: rows.map((row) => row.card) },
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
          {series.map((item) => <span key={item.method} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />{item.name}</span>)}
        </div>
        {rows.length ? (
          <div className="rounded-xl bg-slate-50 px-3 py-3 dark:bg-slate-800 sm:px-5">
            <div className="text-[10px] font-medium text-slate-400">Sales · PHP</div>
            <div className="mt-1">
              <SmoothLineChart
                labels={rows.map((row) => row.label)}
                series={series}
                valueFormat={(value) => new Intl.NumberFormat("en-PH", { notation: "compact", maximumFractionDigits: 1 }).format(value)}
              />
            </div>
          </div>
        ) : <div className="grid h-36 place-items-center text-xs text-slate-400">No sales recorded for this period.</div>}
      </div>
    </section>
  );
}

function HelpCenterDialog({ onClose, onNavigate, showInventory }: {
  onClose: () => void;
  onNavigate: (page: "pos" | "inventory" | "orders") => void;
  showInventory: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="help-center-title" className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
        <div className="mb-5 flex items-start justify-between">
          <div className="flex items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600"><CircleHelp size={20} /></div><div><p className="text-xs font-semibold text-blue-600">CLOVER &amp; CO. SUPPORT</p><h2 id="help-center-title" className="mt-1 text-xl font-semibold">Help center</h2><p className="mt-1 text-sm text-slate-500">Quick answers for everyday store tasks.</p></div></div>
          <button type="button" aria-label="Close help center" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-50"><X size={18} /></button>
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
            <p className="mt-2 text-xs leading-5 text-slate-500">Admins can open Inventory to restock an item or use its Image action to upload or change its custom photo. New products can also be given a custom image when added.</p>
          </details>
          <details className="py-3">
            <summary className="cursor-pointer text-sm font-semibold">Where can I find completed sales?</summary>
            <p className="mt-2 text-xs leading-5 text-slate-500">Open Orders to review recent transactions, totals, payment methods, cash received, change due, and payment reference digits.</p>
          </details>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" onClick={() => onNavigate("pos")} className="inline-flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700"><ShoppingCart size={14} /> Open point of sale</button>
          {showInventory && <button type="button" onClick={() => onNavigate("inventory")} className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"><Boxes size={14} /> Open inventory</button>}
          <button type="button" onClick={() => onNavigate("orders")} className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"><ReceiptText size={14} /> View orders</button>
        </div>
      </section>
    </div>
  );
}

function ProductArtwork({ product, className = "" }: { product: Product; className?: string }) {
  return (
    <div className={`relative grid shrink-0 place-items-center overflow-hidden ${product.color} ${className}`}>
      {product.imageUrl ? (
        <Image
          src={product.imageUrl}
          alt={product.name}
          fill
          unoptimized
          sizes="(max-width: 640px) 45vw, 220px"
          className="object-cover"
        />
      ) : (
        <span aria-hidden="true">{product.emoji}</span>
      )}
    </div>
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
}: {
  selectedIcon: string;
  selectedImage: File | null;
  existingImageUrl?: string | null;
  existingImageRemoved?: boolean;
  onRemoveExisting?: () => void;
  onIconChange: (icon: string) => void;
  onImageChange: (image: File | null) => void;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

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

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-slate-700">Product image or icon</legend>
      <div className="flex items-start gap-3">
        <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl bg-blue-50 text-3xl">
          {imagePreviewUrl ? <Image src={imagePreviewUrl} alt="Product image preview" width={64} height={64} unoptimized className="h-full w-full object-cover" /> : productIcons.find((icon) => icon.id === selectedIcon)?.emoji || "✨"}
        </div>
        <div className="min-w-0 flex-1">
          <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:border-blue-200 hover:text-blue-700">
            <FileUp size={14} /> Choose custom image
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={(event: ChangeEvent<HTMLInputElement>) => onImageChange(event.currentTarget.files?.[0] ?? null)}
            />
          </label>
          {selectedImage ? (
            <button type="button" onClick={() => onImageChange(null)} className="ml-2 text-xs font-medium text-red-500 hover:text-red-700">Remove image</button>
          ) : existingImageUrl && !existingImageRemoved ? (
            <button type="button" onClick={onRemoveExisting} className="ml-2 text-xs font-medium text-red-500 hover:text-red-700">Remove current image</button>
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

function CartPanel({ items, quantities, count, subtotal, total, onChange, onCheckout, onClear, isProcessing }: {
  items: Product[];
  quantities: Record<string, number>;
  count: number;
  subtotal: number;
  total: number;
  onChange: (productId: string, difference: number) => void;
  onCheckout: () => void;
  onClear: () => void;
  isProcessing: boolean;
}) {
  return (
    <aside className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-[0_3px_16px_rgba(20,45,90,0.035)] 2xl:sticky 2xl:top-[96px]">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <div><div className="flex items-center gap-2"><ShoppingCart size={17} className="text-blue-600" /><h2 className="text-sm font-semibold">Current order</h2></div><p className="mt-1 pl-[25px] text-[11px] text-slate-400">New sale</p></div>
        {count > 0 && <button type="button" onClick={onClear} className="text-[11px] font-semibold text-slate-400 hover:text-red-500">Clear all</button>}
      </div>
      <div className="flex items-center justify-between bg-slate-50/80 px-5 py-3 text-[11px]"><span className="text-slate-500">Customer</span><button type="button" className="flex items-center gap-1 font-semibold text-blue-700">Walk-in customer <ChevronDown size={13} /></button></div>
      <div className="max-h-[330px] min-h-[180px] overflow-y-auto px-5">
        {items.length > 0 ? <ul className="divide-y divide-slate-100">{items.map((product) => <li key={product.id} className="flex items-center gap-3 py-4">
          <ProductArtwork product={product} className="h-11 w-11 rounded-xl text-xl" />
          <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{product.name}</p><p className="mt-1 text-[11px] text-slate-400">{money(product.price)} each</p><div className="mt-2 flex items-center gap-2"><button type="button" aria-label={`Remove one ${product.name}`} onClick={() => onChange(product.id, -1)} className="grid h-6 w-6 place-items-center rounded-md border border-slate-200 text-slate-500 hover:border-blue-300 hover:text-blue-600"><Minus size={12} /></button><span className="w-4 text-center text-xs font-semibold">{quantities[product.id]}</span><button type="button" aria-label={`Add one ${product.name}`} onClick={() => onChange(product.id, 1)} className="grid h-6 w-6 place-items-center rounded-md border border-slate-200 text-slate-500 hover:border-blue-300 hover:text-blue-600"><Plus size={12} /></button></div></div>
          <div className="flex h-full flex-col items-end justify-between gap-4"><button type="button" aria-label={`Remove ${product.name} from order`} onClick={() => onChange(product.id, -quantities[product.id])} className="text-slate-300 hover:text-red-500"><Trash2 size={14} /></button><span className="text-xs font-semibold">{money(product.price * quantities[product.id])}</span></div>
        </li>)}</ul> : <div className="flex min-h-[180px] flex-col items-center justify-center text-center"><div className="grid h-12 w-12 place-items-center rounded-full bg-blue-50 text-blue-500"><ShoppingCart size={20} /></div><p className="mt-3 text-xs font-semibold text-slate-700">Your order is empty</p><p className="mt-1 text-[11px] text-slate-400">Add a product to get started.</p></div>}
      </div>
      <div className="border-t border-slate-100 px-5 py-4">
        <div className="space-y-2.5 text-xs"><div className="flex justify-between text-slate-500"><span>Subtotal <span className="text-slate-400">({count} items)</span></span><span className="font-medium text-slate-700">{money(subtotal)}</span></div><div className="my-3 border-t border-dashed border-slate-200" /><div className="flex items-center justify-between"><span className="text-sm font-semibold">Total</span><span className="text-lg font-bold text-slate-900">{money(total)}</span></div></div>
        <button type="button" disabled={!count || isProcessing} onClick={onCheckout} className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 text-sm font-semibold text-white shadow-lg shadow-blue-600/15 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"><CreditCard size={17} /> {isProcessing ? "Processing…" : `Continue to payment · ${money(total)}`}</button>
        <p className="mt-3 flex items-center justify-center gap-1.5 text-[10px] text-slate-400"><WalletCards size={13} /> Secure, fast checkout</p>
      </div>
    </aside>
  );
}

function InventoryView({ products, onAdd, onEditPrices, onEditImage, onRemove, onImport, isImporting, onRestock }: {
  products: Product[];
  onAdd: () => void;
  onEditPrices: (product: Product) => void;
  onEditImage: (product: Product) => void;
  onRemove: (product: Product) => void;
  onImport: (file: File) => void;
  isImporting: boolean;
  onRestock: (product: Product) => void;
}) {
  const lowStock = products.filter((product) => product.stock < 10).length;
  return (
    <section>
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><div className="mb-1 flex items-center gap-2 text-xs font-medium text-slate-400"><Store size={14} /> Clover &amp; Co. <span>/</span> <span className="text-blue-600">Inventory</span></div><h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">Inventory</h1><p className="mt-1 text-sm text-slate-500">Keep your products and stock levels up to date.</p></div>
        <div className="flex flex-wrap gap-2">
          <label className={`flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 hover:border-blue-200 hover:text-blue-700 ${isImporting ? "pointer-events-none opacity-60" : ""}`}><FileUp size={16} />{isImporting ? "Importing…" : "Import CSV / JSON"}<input type="file" accept=".csv,.json,text/csv,application/json" className="sr-only" disabled={isImporting} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) onImport(file); event.currentTarget.value = ""; }} /></label>
          <button type="button" onClick={onAdd} className="flex h-10 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-md shadow-blue-600/15 hover:bg-blue-700"><PackagePlus size={16} /> Add product</button>
        </div>
      </div>
      <p className="mb-4 text-xs text-slate-400">Import CSV or JSON with <code className="rounded bg-slate-100 px-1 py-0.5">name, category, cost_price, wholesale_price, retail_price, stock</code> fields. Older imports with <code className="rounded bg-slate-100 px-1 py-0.5">price</code> remain supported.</p>
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-100 bg-white p-4"><p className="text-xs text-slate-500">Total products</p><p className="mt-2 text-2xl font-semibold">{products.length}</p></div>
        <div className="rounded-2xl border border-slate-100 bg-white p-4"><p className="text-xs text-slate-500">Units in stock</p><p className="mt-2 text-2xl font-semibold">{products.reduce((sum, product) => sum + product.stock, 0)}</p></div>
        <div className="rounded-2xl border border-slate-100 bg-white p-4"><p className="text-xs text-slate-500">Running low</p><p className="mt-2 text-2xl font-semibold">{lowStock}<span className="ml-2 text-xs font-medium text-amber-600">needs attention</span></p></div>
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="text-sm font-semibold">All products</h2><p className="mt-1 text-xs text-slate-400">{products.length} items in your catalog</p></div><span className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-500">Updated just now</span></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[960px] text-left text-xs"><thead className="bg-slate-50/70 text-[10px] font-semibold uppercase tracking-wider text-slate-400"><tr><th className="px-5 py-3">Product</th><th className="px-4 py-3">Category</th><th className="px-4 py-3">Cost price</th><th className="px-4 py-3">Wholesale price</th><th className="px-4 py-3">Retail price</th><th className="px-4 py-3">Stock</th><th className="px-5 py-3 text-right">Actions</th></tr></thead><tbody className="divide-y divide-slate-100">{products.map((product) => <tr key={product.id} className="hover:bg-slate-50/50"><td className="px-5 py-3.5"><div className="flex items-center gap-3"><ProductArtwork product={product} className="h-9 w-9 rounded-lg text-lg" /><span className="font-semibold text-slate-700">{product.name}</span></div></td><td className="px-4 py-3.5 text-slate-500">{product.category}</td><td className="px-4 py-3.5">{product.costPriceKnown ? money(product.costPrice) : <span className="text-amber-600">Not set</span>}</td><td className="px-4 py-3.5">{money(product.wholesalePrice)}</td><td className="px-4 py-3.5 font-semibold">{money(product.price)}</td><td className="px-4 py-3.5"><span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${product.stock < 10 ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>{product.stock} in stock</span></td><td className="px-5 py-3.5 text-right"><div className="inline-flex items-center"><button type="button" onClick={() => onEditPrices(product)} aria-label={`Edit prices for ${product.name}`} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-2 font-semibold text-blue-600 hover:bg-blue-50"><CircleDollarSign size={14} /> Prices</button><button type="button" onClick={() => onEditImage(product)} aria-label={`Edit image for ${product.name}`} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-2 font-semibold text-slate-500 hover:bg-blue-50 hover:text-blue-700"><FileUp size={14} /> Image</button><button type="button" onClick={() => onRestock(product)} aria-label={`Restock ${product.name}`} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-2 font-semibold text-blue-600 hover:bg-blue-50"><PackagePlus size={15} /> Restock</button><button type="button" aria-label={`Remove ${product.name}`} onClick={() => onRemove(product)} className="rounded-lg p-2 text-slate-300 hover:bg-red-50 hover:text-red-500"><Trash2 size={15} /></button></div></td></tr>)}</tbody></table></div>
      </div>
    </section>
  );
}

function EmployeeView({ employees, onAdd, onRemove }: {
  employees: Employee[];
  onAdd: () => void;
  onRemove: (employee: Employee) => void;
}) {
  return (
    <section>
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><div className="mb-1 flex items-center gap-2 text-xs font-medium text-slate-400"><Store size={14} /> Clover &amp; Co. <span>/</span> <span className="text-blue-600">Employees</span></div><h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">Team members</h1><p className="mt-1 text-sm text-slate-500">Create and manage secure employee sign-in accounts.</p></div>
        <button type="button" onClick={onAdd} className="flex h-10 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-md shadow-blue-600/15 hover:bg-blue-700"><UserPlus size={16} /> Add employee</button>
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="text-sm font-semibold">Employee accounts</h2><p className="mt-1 text-xs text-slate-400">{employees.length} active employee{employees.length === 1 ? "" : "s"}</p></div><Users size={18} className="text-slate-400" /></div>
        {employees.length > 0 ? <div className="divide-y divide-slate-100">{employees.map((employee) => <div key={employee.id} className="flex items-center justify-between gap-3 px-5 py-4"><div className="flex min-w-0 items-center gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-blue-50 text-sm font-bold text-blue-700">{employee.full_name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</div><div className="min-w-0"><p className="truncate text-sm font-semibold">{employee.full_name}</p><p className="mt-1 truncate text-xs text-slate-400">{employee.email}</p></div></div><div className="flex items-center gap-3"><span className="hidden rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-700 sm:inline">Employee</span><button type="button" aria-label={`Remove ${employee.full_name}`} onClick={() => onRemove(employee)} className="rounded-lg p-2 text-slate-300 hover:bg-red-50 hover:text-red-500"><Trash2 size={15} /></button></div></div>)}</div> : <div className="grid min-h-48 place-items-center text-center"><div><Users size={26} className="mx-auto text-slate-300" /><p className="mt-3 text-sm font-semibold">No employees yet</p><p className="mt-1 text-xs text-slate-400">Create accounts for the people on your team.</p></div></div>}
      </div>
      <p className="mt-4 text-xs text-slate-400">Employee passwords are created by admins and should be shared securely. Employee accounts cannot access inventory or team settings.</p>
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

function OrdersView({ orders }: { orders: Order[] }) {
  const [paymentFilter, setPaymentFilter] = useState<"all" | PaymentMethod>("all");
  const visibleOrders = orders.filter((order) => paymentFilter === "all" || order.paymentMethod === paymentFilter);
  return (
    <section>
      <div className="mb-6"><div className="mb-1 flex items-center gap-2 text-xs font-medium text-slate-400"><Store size={14} /> Clover &amp; Co. <span>/</span> <span className="text-blue-600">Orders</span></div><h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">Recent orders</h1><p className="mt-1 text-sm text-slate-500">A quick look at your latest transactions.</p></div>
      <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
        <div className="flex flex-col justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center">
          <div><h2 className="text-sm font-semibold">Order history</h2><p className="mt-1 text-xs text-slate-400">Showing {visibleOrders.length} of {orders.length} recent transactions</p></div>
          <div className="flex gap-1 rounded-lg bg-slate-50 p-1" aria-label="Filter orders by payment method">
            {(["all", "cash", "e_wallet", "card"] as const).map((method) => <button key={method} type="button" aria-pressed={paymentFilter === method} onClick={() => setPaymentFilter(method)} className={`rounded-md px-3 py-1.5 text-[11px] font-semibold capitalize ${paymentFilter === method ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>{method === "all" ? "All payments" : paymentMethodLabel(method)}</button>)}
          </div>
        </div>
        <div className="divide-y divide-slate-100">{visibleOrders.map((order) => <div key={order.id} className="flex items-center justify-between gap-3 px-5 py-4"><div className="flex min-w-0 items-center gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600"><ReceiptText size={18} /></div><div className="min-w-0"><p className="text-sm font-semibold">{order.id}</p><p className="mt-1 text-xs text-slate-400">{order.items} items · {order.time}</p><p className="mt-1 text-xs font-medium text-slate-600">{order.employeeName}</p><p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">{paymentMethodLabel(order.paymentMethod)}{order.paymentReferenceLast4 ? ` · Ref •••• ${order.paymentReferenceLast4}` : ""}</p>{order.paymentMethod === "cash" && order.cashReceived !== null && <p className="mt-1 text-[10px] text-slate-400">Received {money(order.cashReceived)} · Change {money(order.changeDue ?? 0)}</p>}</div></div><div className="text-right"><p className="text-sm font-semibold">{money(order.total)}</p><p className="mt-1 text-[10px] font-medium text-emerald-600">Completed</p></div></div>)}</div>
        {visibleOrders.length === 0 && <div className="py-16 text-center text-sm text-slate-400">{orders.length ? `No ${paymentFilter === "all" ? "" : `${paymentMethodLabel(paymentFilter)} `}orders in the recent transactions.` : "No orders yet. Completed sales will show up here."}</div>}
      </div>
    </section>
  );
}
