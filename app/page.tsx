"use client";

import {
  ArrowRight,
  Bell,
  Boxes,
  Check,
  ChevronDown,
  CircleDollarSign,
  ClipboardList,
  Clock3,
  Coffee,
  CreditCard,
  FileUp,
  LayoutDashboard,
  LogOut,
  Minus,
  PackagePlus,
  Plus,
  ReceiptText,
  Search,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Store,
  Trash2,
  TrendingUp,
  UserRound,
  Users,
  UserPlus,
  WalletCards,
  X,
  type LucideIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Role = "employee" | "admin";
type Product = {
  id: string;
  name: string;
  category: string;
  price: number;
  stock: number;
  emoji: string;
  color: string;
};
type Order = { id: string; items: number; total: number; time: string };
type ProductRow = { id: string; name: string; category: string; price: number; stock: number };
type OrderRow = {
  id: string;
  total: number;
  created_at: string;
  order_items: { quantity: number }[];
};
type Employee = { id: string; email: string; full_name: string; role: "employee" };
type DashboardStats = { sales_total: number; orders_today: number; active_products: number; units_in_stock: number };

const money = (amount: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);

const categoryColors = ["bg-sky-50", "bg-amber-50", "bg-violet-50", "bg-rose-50"];
const sariSariCategories = [
  "Rice & Grains",
  "Canned Goods",
  "Instant Noodles",
  "Snacks",
  "Beverages",
  "Coffee & Drinks",
  "Condiments",
  "Personal Care",
  "Household",
];

function productAppearance(name: string, category: string, index: number) {
  const emojiByCategory: Record<string, string> = {
    "Rice & Grains": "🍚",
    "Canned Goods": "🥫",
    "Instant Noodles": "🍜",
    Snacks: "🍟",
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
  return {
    emoji: emojiByName[name] ?? emojiByCategory[category] ?? "✨",
    color: categoryColors[index % categoryColors.length],
  };
}

async function fetchWorkspaceData(includeAdminStats = false) {
  const supabase = createClient();
  const [productsResult, ordersResult] = await Promise.all([
    supabase.from("products").select("id, name, category, price, stock").eq("active", true).order("name").returns<ProductRow[]>(),
    supabase.from("orders").select("id, total, created_at, order_items(quantity)").order("created_at", { ascending: false }).limit(50).returns<OrderRow[]>(),
  ]);
  if (productsResult.error) throw new Error(`Unable to load products: ${productsResult.error.message}`);
  if (ordersResult.error) throw new Error(`Unable to load orders: ${ordersResult.error.message}`);
  let stats: DashboardStats | null = null;
  if (includeAdminStats) {
    const { data, error } = await supabase.rpc("get_admin_dashboard_stats").single();
    if (error) throw new Error(`Unable to load store summary: ${error.message}`);
    if (
      !data ||
      typeof data !== "object" ||
      !("sales_total" in data) ||
      !("orders_today" in data) ||
      !("active_products" in data) ||
      !("units_in_stock" in data)
    ) {
      throw new Error("Store summary response was invalid.");
    }
    stats = {
      sales_total: Number(data.sales_total),
      orders_today: Number(data.orders_today),
      active_products: Number(data.active_products),
      units_in_stock: Number(data.units_in_stock),
    };
  }
  return {
    products: productsResult.data.map((product, index) => ({
      ...product,
      price: Number(product.price),
      ...productAppearance(product.name, product.category, index),
    })),
    orders: ordersResult.data.map((order) => ({
      id: `#${order.id.slice(0, 8)}`,
      items: order.order_items.reduce((sum, item) => sum + item.quantity, 0),
      total: Number(order.total),
      time: new Date(order.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
    })),
    stats,
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
  const requiredHeaders = ["name", "category", "price", "stock"];
  if (requiredHeaders.some((header) => !headers.includes(header))) {
    throw new Error("CSV headers must include name, category, price, and stock.");
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
    const price = Number(item.price);
    const stock = Number(item.stock);
    if (
      !name ||
      name.length > 120 ||
      !category ||
      category.length > 80 ||
      !Number.isFinite(price) ||
      price <= 0 ||
      !Number.isInteger(stock) ||
      stock < 0
    ) {
      throw new Error(`Product row ${index + 1} needs a name, category, positive price, and non-negative whole-number stock.`);
    }
    return { name, category, price, stock };
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
  const [category, setCategory] = useState("All items");
  const [search, setSearch] = useState("");
  const [activePage, setActivePage] = useState<"pos" | "inventory" | "orders" | "employees">("pos");
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [notice, setNotice] = useState("");
  const [authError, setAuthError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [showAddEmployee, setShowAddEmployee] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

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
  const tax = Math.round(subtotal * 0.0825 * 100) / 100;
  const total = Math.round((subtotal + tax) * 100) / 100;

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
        setProducts(workspace.products);
        setOrders(workspace.orders);
        setDashboardStats(workspace.stats);
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

  async function refreshWorkspace() {
    const workspace = await fetchWorkspaceData(role === "admin");
    setProducts(workspace.products);
    setOrders(workspace.orders);
    setDashboardStats(workspace.stats);
  }

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
    setIsLoading(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("place_order", {
        p_items: cartItems.map((product) => ({ product_id: product.id, quantity: cart[product.id] })),
      }).single();
      if (error) throw error;
      if (!data || typeof data !== "object" || !("order_id" in data) || typeof data.order_id !== "string") {
        throw new Error("Checkout completed, but the order confirmation was invalid.");
      }
      const newOrderId = data.order_id.slice(0, 8);
      setCart({});
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
      const workspace = await fetchWorkspaceData(profile.role === "admin");
      setEmployeeName(profile.full_name || authData.user.email || "Team member");
      setProducts(workspace.products);
      setOrders(workspace.orders);
      setDashboardStats(workspace.stats);
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
    const price = Number(formData.get("price"));
    const stock = Number(formData.get("stock"));
    const selectedCategory = String(formData.get("category") ?? sariSariCategories[0]);
    if (!name || !Number.isFinite(price) || price <= 0 || !Number.isInteger(stock) || stock < 0) {
      setNotice("Enter a product name, a price above $0, and a valid stock quantity.");
      return;
    }
    try {
      const supabase = createClient();
      const { error } = await supabase.from("products").insert({
        name,
        category: selectedCategory,
        price,
        stock,
      });
      if (error) throw error;
      await refreshWorkspace();
      setShowAddProduct(false);
      setNotice(`${name} added to inventory.`);
    } catch (error) {
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
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to remove product.");
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
    <main className="min-h-screen bg-[#f5f8fd] text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="flex min-h-screen">
        <aside className="hidden w-[248px] shrink-0 flex-col border-r border-slate-100 bg-white px-5 py-6 dark:border-slate-800 dark:bg-slate-900 lg:flex">
          <Brand />
          <div className="mt-10">
            <p className="mb-3 px-3 text-[10px] font-bold tracking-[0.16em] text-slate-400">WORKSPACE</p>
            <nav className="space-y-1">
              <SidebarLink icon={LayoutDashboard} label="Point of sale" active={currentView === "pos"} onClick={() => setActivePage("pos")} />
              {isAdmin && <SidebarLink icon={Boxes} label="Inventory" active={currentView === "inventory"} onClick={() => setActivePage("inventory")} />}
              {isAdmin && <SidebarLink icon={Users} label="Employees" active={currentView === "employees"} onClick={() => { setActivePage("employees"); void loadEmployees().catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Unable to load employees.")); }} />}
              <SidebarLink icon={ClipboardList} label="Orders" active={currentView === "orders"} onClick={() => setActivePage("orders")} />
            </nav>
          </div>
          <div className="mt-auto rounded-2xl bg-[#f2f6ff] p-4">
            <div className="mb-3 grid h-9 w-9 place-items-center rounded-xl bg-white text-blue-600 shadow-sm"><CircleHelpIcon /></div>
            <p className="text-sm font-semibold">Need a hand?</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">Your store team is here to help you out.</p>
            <button type="button" className="mt-3 text-xs font-semibold text-blue-700">Visit help center <ArrowRight size={12} className="ml-1 inline" /></button>
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
              <div className="hidden items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600 sm:flex">
                <Clock3 size={14} className="text-slate-400" />
                {new Date().toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
              </div>
              <button type="button" aria-label="Notifications" className="relative grid h-10 w-10 place-items-center rounded-xl text-slate-500 transition hover:bg-slate-50">
                <Bell size={19} /><span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-blue-500 ring-2 ring-white" />
              </button>
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
            <SidebarLink icon={LayoutDashboard} label="Point of sale" active={currentView === "pos"} onClick={() => setActivePage("pos")} />
            {isAdmin && <SidebarLink icon={Boxes} label="Inventory" active={currentView === "inventory"} onClick={() => setActivePage("inventory")} />}
            {isAdmin && <SidebarLink icon={Users} label="Employees" active={currentView === "employees"} onClick={() => { setActivePage("employees"); void loadEmployees().catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Unable to load employees.")); }} />}
            <SidebarLink icon={ClipboardList} label="Orders" active={currentView === "orders"} onClick={() => setActivePage("orders")} />
          </nav>

          <div className="p-4 sm:p-7 xl:p-9">
            {notice && (
              <div role="status" className={`mb-5 flex items-center justify-between rounded-xl border px-4 py-3 text-sm ${notice.includes("successfully") || notice.includes("added") ? "border-emerald-100 bg-emerald-50 text-emerald-800" : "border-blue-100 bg-blue-50 text-blue-800"}`}>
                <span className="flex items-center gap-2"><Check size={16} />{notice}</span>
                <button type="button" aria-label="Dismiss notification" onClick={() => setNotice("")}><X size={16} /></button>
              </div>
            )}

            {currentView === "employees" && isAdmin ? (
              <EmployeeView
                employees={employees}
                onAdd={() => setShowAddEmployee(true)}
                onRemove={removeEmployee}
              />
            ) : currentView === "inventory" && isAdmin ? (
              <InventoryView
                products={products}
                onAdd={() => setShowAddProduct(true)}
                onRemove={removeProduct}
                onImport={importProducts}
                isImporting={isImporting}
              />
            ) : currentView === "orders" ? (
              <OrdersView orders={orders} />
            ) : (
              <div className="grid items-start gap-6 2xl:grid-cols-[minmax(0,1fr)_350px]">
                <section className="min-w-0">
                  {isAdmin && dashboardStats && <AdminOverview stats={dashboardStats} />}
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
                            <div className={`mb-3 grid aspect-[1.6/1] place-items-center rounded-xl text-[42px] ${product.color} transition-transform group-hover:scale-[1.015]`}>{product.emoji}</div>
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
                  tax={tax}
                  total={total}
                  onChange={changeQuantity}
                  onCheckout={checkout}
                  isProcessing={isLoading}
                  onClear={() => setCart({})}
                />
              </div>
            )}
          </div>
          <footer className="px-4 pb-6 text-center text-[10px] text-slate-400 sm:px-7 xl:px-9">Clover &amp; Co. POS · Front-end preview</footer>
        </div>
      </div>

      {showAddProduct && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/40 p-4" onClick={(event) => { if (event.target === event.currentTarget) setShowAddProduct(false); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="add-product-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-start justify-between">
              <div><p className="text-xs font-semibold text-blue-600">INVENTORY</p><h2 id="add-product-title" className="mt-1 text-xl font-semibold">Add a product</h2></div>
              <button type="button" aria-label="Close dialog" onClick={() => setShowAddProduct(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-50"><X size={18} /></button>
            </div>
            <form onSubmit={addProduct} className="space-y-4">
              <label className="block text-sm font-medium text-slate-700">Product name<input required name="name" placeholder="e.g. Caramel latte" className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50" /></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm font-medium text-slate-700">Price ($)<input required name="price" type="number" min="0.01" step="0.01" placeholder="4.50" className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50" /></label>
                <label className="block text-sm font-medium text-slate-700">Stock<input required name="stock" type="number" min="0" step="1" placeholder="12" className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50" /></label>
              </div>
              <label className="block text-sm font-medium text-slate-700">Category<select name="category" className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50">{categories.filter((item) => item !== "All items").map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
              <div className="flex gap-3 pt-2"><button type="button" onClick={() => setShowAddProduct(false)} className="h-11 flex-1 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancel</button><button type="submit" className="h-11 flex-1 rounded-lg bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700">Add product</button></div>
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
  return <ShoppingBag size={17} />;
}

function SidebarLink({ icon: Icon, label, active, onClick }: { icon: LucideIcon; label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition ${active ? "bg-blue-50 text-blue-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"}`}>
      <Icon size={17} strokeWidth={active ? 2.2 : 1.8} />{label}
    </button>
  );
}

function AdminOverview({ stats }: { stats: DashboardStats }) {
  const cards: { label: string; value: string; detail: string; icon: LucideIcon; color: string }[] = [
    { label: "Today’s sales", value: money(stats.sales_total), detail: "Recorded today (UTC)", icon: CircleDollarSign, color: "bg-blue-50 text-blue-600" },
    { label: "Orders today", value: String(stats.orders_today), detail: "Completed orders", icon: ReceiptText, color: "bg-violet-50 text-violet-600" },
    { label: "Items in stock", value: String(stats.units_in_stock), detail: `${stats.active_products} active products`, icon: Boxes, color: "bg-emerald-50 text-emerald-600" },
  ];
  return (
    <section className="mb-7">
      <div className="mb-4 flex items-end justify-between"><div><p className="mb-1 text-xs font-medium text-slate-400">LIVE STORE PERFORMANCE</p><h2 className="text-lg font-semibold">Your store at a glance</h2></div><span className="flex items-center gap-1 text-xs font-semibold text-blue-600"><TrendingUp size={14} /> Live data</span></div>
      <div className="grid gap-3 sm:grid-cols-3">
        {cards.map(({ label, value, detail, icon: Icon, color }) => <div key={label} className="rounded-2xl border border-slate-100 bg-white p-4"><div className="flex items-center justify-between"><span className="text-xs font-medium text-slate-500">{label}</span><span className={`grid h-8 w-8 place-items-center rounded-lg ${color}`}><Icon size={16} /></span></div><p className="mt-3 text-2xl font-semibold tracking-tight">{value}</p><p className="mt-1 text-[10px] text-slate-400">{detail}</p></div>)}
      </div>
    </section>
  );
}

function CartPanel({ items, quantities, count, subtotal, tax, total, onChange, onCheckout, onClear, isProcessing }: {
  items: Product[];
  quantities: Record<string, number>;
  count: number;
  subtotal: number;
  tax: number;
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
          <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl text-xl ${product.color}`}>{product.emoji}</div>
          <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{product.name}</p><p className="mt-1 text-[11px] text-slate-400">{money(product.price)} each</p><div className="mt-2 flex items-center gap-2"><button type="button" aria-label={`Remove one ${product.name}`} onClick={() => onChange(product.id, -1)} className="grid h-6 w-6 place-items-center rounded-md border border-slate-200 text-slate-500 hover:border-blue-300 hover:text-blue-600"><Minus size={12} /></button><span className="w-4 text-center text-xs font-semibold">{quantities[product.id]}</span><button type="button" aria-label={`Add one ${product.name}`} onClick={() => onChange(product.id, 1)} className="grid h-6 w-6 place-items-center rounded-md border border-slate-200 text-slate-500 hover:border-blue-300 hover:text-blue-600"><Plus size={12} /></button></div></div>
          <div className="flex h-full flex-col items-end justify-between gap-4"><button type="button" aria-label={`Remove ${product.name} from order`} onClick={() => onChange(product.id, -quantities[product.id])} className="text-slate-300 hover:text-red-500"><Trash2 size={14} /></button><span className="text-xs font-semibold">{money(product.price * quantities[product.id])}</span></div>
        </li>)}</ul> : <div className="flex min-h-[180px] flex-col items-center justify-center text-center"><div className="grid h-12 w-12 place-items-center rounded-full bg-blue-50 text-blue-500"><ShoppingCart size={20} /></div><p className="mt-3 text-xs font-semibold text-slate-700">Your order is empty</p><p className="mt-1 text-[11px] text-slate-400">Add a product to get started.</p></div>}
      </div>
      <div className="border-t border-slate-100 px-5 py-4">
        <div className="space-y-2.5 text-xs"><div className="flex justify-between text-slate-500"><span>Subtotal <span className="text-slate-400">({count} items)</span></span><span className="font-medium text-slate-700">{money(subtotal)}</span></div><div className="flex justify-between text-slate-500"><span>Tax <span className="text-slate-400">(8.25%)</span></span><span className="font-medium text-slate-700">{money(tax)}</span></div><div className="my-3 border-t border-dashed border-slate-200" /><div className="flex items-center justify-between"><span className="text-sm font-semibold">Total</span><span className="text-lg font-bold text-slate-900">{money(total)}</span></div></div>
        <button type="button" disabled={!count || isProcessing} onClick={onCheckout} className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 text-sm font-semibold text-white shadow-lg shadow-blue-600/15 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"><CreditCard size={17} /> {isProcessing ? "Processing…" : `Charge ${money(total)}`}</button>
        <p className="mt-3 flex items-center justify-center gap-1.5 text-[10px] text-slate-400"><WalletCards size={13} /> Secure, fast checkout</p>
      </div>
    </aside>
  );
}

function InventoryView({ products, onAdd, onRemove, onImport, isImporting }: {
  products: Product[];
  onAdd: () => void;
  onRemove: (product: Product) => void;
  onImport: (file: File) => void;
  isImporting: boolean;
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
      <p className="mb-4 text-xs text-slate-400">Import CSV or JSON with <code className="rounded bg-slate-100 px-1 py-0.5">name, category, price, stock</code> fields. Matching product names are updated.</p>
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-100 bg-white p-4"><p className="text-xs text-slate-500">Total products</p><p className="mt-2 text-2xl font-semibold">{products.length}</p></div>
        <div className="rounded-2xl border border-slate-100 bg-white p-4"><p className="text-xs text-slate-500">Units in stock</p><p className="mt-2 text-2xl font-semibold">{products.reduce((sum, product) => sum + product.stock, 0)}</p></div>
        <div className="rounded-2xl border border-slate-100 bg-white p-4"><p className="text-xs text-slate-500">Running low</p><p className="mt-2 text-2xl font-semibold">{lowStock}<span className="ml-2 text-xs font-medium text-amber-600">needs attention</span></p></div>
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="text-sm font-semibold">All products</h2><p className="mt-1 text-xs text-slate-400">{products.length} items in your catalog</p></div><span className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-500">Updated just now</span></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-xs"><thead className="bg-slate-50/70 text-[10px] font-semibold uppercase tracking-wider text-slate-400"><tr><th className="px-5 py-3">Product</th><th className="px-4 py-3">Category</th><th className="px-4 py-3">Price</th><th className="px-4 py-3">Stock</th><th className="px-5 py-3 text-right">Action</th></tr></thead><tbody className="divide-y divide-slate-100">{products.map((product) => <tr key={product.id} className="hover:bg-slate-50/50"><td className="px-5 py-3.5"><div className="flex items-center gap-3"><span className={`grid h-9 w-9 place-items-center rounded-lg text-lg ${product.color}`}>{product.emoji}</span><span className="font-semibold text-slate-700">{product.name}</span></div></td><td className="px-4 py-3.5 text-slate-500">{product.category}</td><td className="px-4 py-3.5 font-semibold">{money(product.price)}</td><td className="px-4 py-3.5"><span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${product.stock < 10 ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>{product.stock} in stock</span></td><td className="px-5 py-3.5 text-right"><button type="button" aria-label={`Remove ${product.name}`} onClick={() => onRemove(product)} className="rounded-lg p-2 text-slate-300 hover:bg-red-50 hover:text-red-500"><Trash2 size={15} /></button></td></tr>)}</tbody></table></div>
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

function OrdersView({ orders }: { orders: Order[] }) {
  return (
    <section>
      <div className="mb-6"><div className="mb-1 flex items-center gap-2 text-xs font-medium text-slate-400"><Store size={14} /> Clover &amp; Co. <span>/</span> <span className="text-blue-600">Orders</span></div><h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">Recent orders</h1><p className="mt-1 text-sm text-slate-500">A quick look at your latest transactions.</p></div>
      <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="text-sm font-semibold">Order history</h2><p className="mt-1 text-xs text-slate-400">{orders.length} recent transactions</p></div><span className="flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[11px] font-medium text-emerald-700"><Check size={13} /> All up to date</span></div>
        <div className="divide-y divide-slate-100">{orders.map((order) => <div key={order.id} className="flex items-center justify-between gap-3 px-5 py-4"><div className="flex min-w-0 items-center gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600"><ReceiptText size={18} /></div><div><p className="text-sm font-semibold">{order.id}</p><p className="mt-1 text-xs text-slate-400">{order.items} items · {order.time}</p></div></div><div className="text-right"><p className="text-sm font-semibold">{money(order.total)}</p><p className="mt-1 text-[10px] font-medium text-emerald-600">Completed</p></div></div>)}</div>
        {orders.length === 0 && <div className="py-16 text-center text-sm text-slate-400">No orders yet. Completed sales will show up here.</div>}
      </div>
    </section>
  );
}
