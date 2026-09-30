import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { toast } from "sonner";
import { useLocation } from "wouter";
import {
  Activity,
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  Bookmark,
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  CircleCheckBig,
  CreditCard,
  ClipboardCheck,
  Clock3,
  Eye,
  FileSearch,
  Download,
  ExternalLink,
  Filter,
  Gavel,
  Globe2,
  Heart,
  Inbox,
  LayoutDashboard,
  MapPinned,
  Menu,
  MessageCircle,
  MoreHorizontal,
  PackageCheck,
  PackageOpen,
  Package,
  Plus,
  Printer,
  Radio,
  RefreshCcw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Star,
  Store,
  Tags,
  Truck,
  UserRound,
  LogOut,
  Users,
  WalletCards,
  X,
  Zap,
} from "lucide-react";
import {
  activities,
  bidHistory,
  inventory,
  inventoryChanges,
  listings,
  notifications as seedNotifications,
  orders,
  riderStats,
  type Activity as ActivityItem,
  type Listing,
  type OrderStatus,
} from "@/data/merchantData";
import { philippineProvinces, municipalitiesFor } from "@/data/philippines";

type AuthUser = { id: number; name: string; email: string; role: "user" | "admin" | "rider"; province?: string | null; municipality?: string | null; walletCents: number; storeName?: string | null; storeImage?: string | null; sellerEnabled?: boolean };
type Section = "overview" | "wallet" | "marketplace" | "live" | "auction" | "detail" | "orders" | "payments" | "rider" | "inventory" | "messages" | "saved" | "bidding" | "admin";
type Tone = "coral" | "teal" | "mustard" | "lavender" | "ink";
type AppNotification = { id: string; label: string; time: string; tone: Tone; message?: string };

const navGroups = [
  {
    label: "Workspace",
    items: [
      { id: "overview" as Section, label: "Overview", icon: LayoutDashboard },
      { id: "marketplace" as Section, label: "Marketplace", icon: Store },
      { id: "live" as Section, label: "Live auctions", icon: Gavel, count: "8" },
      { id: "bidding" as Section, label: "Bidding history", icon: Activity },
      { id: "orders" as Section, label: "Orders & logistics", icon: Truck, count: "12" },
      { id: "payments" as Section, label: "Payments & labels", icon: CreditCard },
      { id: "wallet" as Section, label: "E-wallet", icon: WalletCards },
    ],
  },
  {
    label: "Manage",
    items: [
      { id: "inventory" as Section, label: "Inventory", icon: Boxes },
      { id: "messages" as Section, label: "Messages", icon: MessageCircle, count: "3" },
      { id: "saved" as Section, label: "Saved items", icon: Heart },
    ],
  },
  {
    label: "Control room",
    items: [
      { id: "rider" as Section, label: "Rider desk", icon: MapPinned },
    ],
  },
];

const sectionFromPath = (path: string): Section => {
  if (path.startsWith("/auctions")) return "live";
  if (path.startsWith("/auction/")) return "auction";
  if (path.startsWith("/item/")) return "detail";
  if (path.startsWith("/wallet")) return "wallet";
  if (path.startsWith("/marketplace")) return "marketplace";
  if (path.startsWith("/orders")) return "orders";
  if (path.startsWith("/payments")) return "payments";
  if (path.startsWith("/rider")) return "rider";
  if (path.startsWith("/inventory")) return "inventory";
  if (path.startsWith("/messages")) return "messages";
  if (path.startsWith("/saved")) return "saved";
  if (path.startsWith("/bidding")) return "bidding";
  if (path.startsWith("/admin-dashboard")) return "admin";
  return "overview";
};

const money = (value: number) => `₱${value.toLocaleString("en-PH")}`;
const formatCountdown = (seconds: number) => `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
const compact = (value: number) => value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k` : `${value}`;
const titleForSection: Record<Section, string> = {
  overview: "Overview",
  wallet: "E-wallet",
  marketplace: "Marketplace",
  live: "Live auctions",
  auction: "Auction detail",
  detail: "Item detail & checkout",
  orders: "Orders & logistics",
  payments: "Payments & labels",
  rider: "Rider desk",
  inventory: "Inventory & analytics",
  messages: "Messages",
  saved: "Saved items",
  bidding: "Bidding history",
  admin: "Admin & moderation",
};
const subtitleForSection: Record<Section, string> = {
  overview: "Here’s what’s moving across your marketplace today.",
  wallet: "Add demo funds for bids and monitor your available balance.",
  marketplace: "Compare, list, and discover what is worth bidding on.",
  live: "Watch the floor, compare momentum, and enter the right auction.",
  auction: "Follow live momentum and keep your max bid protected.",
  detail: "Review the item, choose your quantity, and check out with confidence.",
  orders: "Stay ahead of every handoff from payment to doorstep.",
  payments: "Collect globally, settle clearly, and ship every order with confidence.",
  rider: "A live view of the people and parcels in motion.",
  inventory: "Turn stock signals into the next smart move.",
  messages: "Keep buyer and seller conversations moving.",
  saved: "Your watchlist, saved searches, and price-drop alerts.",
  bidding: "Review the live auction timeline and your past bidding activity.",
  admin: "Review the moments that need a careful hand.",
};

export default function Home() {
  const [location, setLocation] = useLocation();
  const [activeSection, setActiveSection] = useState<Section>(() => sectionFromPath(location));
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [marketFilter, setMarketFilter] = useState("All items");
  const [favoriteIds, setFavoriteIds] = useState<string[]>(["leather-tote", "ceramic-set"]);
  const [readNotifications, setReadNotifications] = useState<string[]>(["n3"]);
  const [liveNotifications, setLiveNotifications] = useState<AppNotification[]>([]);
  const [currentBid, setCurrentBid] = useState(8450);
  const [bidAmount, setBidAmount] = useState("8550");
  const [maxBid, setMaxBid] = useState("9000");
  const [bidFeed, setBidFeed] = useState(bidHistory);
  const [deliveryStatuses, setDeliveryStatuses] = useState<Record<string, OrderStatus>>({});
  const [riderOnline, setRiderOnline] = useState(true);
  const [sellerMode, setSellerMode] = useState(false);
  const [ownedListingsLoaded, setOwnedListingsLoaded] = useState(false);
  const [riderOrders, setRiderOrders] = useState<any[]>([]);
  const [userListings, setUserListings] = useState<Listing[]>([]);
  const [publicListings, setPublicListings] = useState<Listing[]>([]);
  const [inventoryTab, setInventoryTab] = useState<"official" | "draft" | "deleted">("official");
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [createListingOpen, setCreateListingOpen] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null | undefined>(undefined);
  const [auctionSeconds, setAuctionSeconds] = useState(() => Math.max(0, Math.floor((new Date(listings[0].auctionEndAt ?? Date.now()).getTime() - Date.now()) / 1000)));
  const [walletCents, setWalletCents] = useState(0);
  const [sellerOnboardingOpen, setSellerOnboardingOpen] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me").then((response) => response.json()).then((payload) => { setAuthUser(payload.user ?? null); setWalletCents(payload.user?.walletCents ?? 0); setSellerMode(Boolean(payload.user?.sellerEnabled) || payload.user?.role === "admin" || payload.user?.role === "rider"); }).catch(() => setAuthUser(null));
  }, []);

  useEffect(() => {
    if (!authUser) return;
    fetch("/api/notifications").then((response) => response.json()).then((payload) => { const rows = payload.notifications ?? []; setLiveNotifications(rows.map((item: any) => ({ id: String(item.id), label: item.title, message: item.message, time: new Date(item.createdAt).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" }), tone: item.type === "auction_won" ? "mustard" : item.type === "delivery_update" ? "teal" : "coral" }))); setReadNotifications(rows.filter((item: any) => item.readAt).map((item: any) => String(item.id))); }).catch(() => undefined);
  }, [authUser]);
  useEffect(() => {
    if (!authUser || ownedListingsLoaded) return;
    fetch("/api/listings?owner=me").then((response) => response.json()).then((payload) => { setUserListings((payload.listings ?? []).map((item: Listing) => ({ ...item, seller: authUser.name }))); setOwnedListingsLoaded(true); }).catch(() => setOwnedListingsLoaded(true));
  }, [authUser, ownedListingsLoaded]);

  useEffect(() => {
    if (!authUser) return;
    const refreshPublicListings = () => fetch("/api/listings").then((response) => response.json()).then((payload) => setPublicListings((payload.listings ?? []).map((item: Listing) => ({ ...item, seller: item.seller || "MerchantHub seller" })))).catch(() => undefined);
    refreshPublicListings();
    const listingPoller = window.setInterval(refreshPublicListings, 10000);
    return () => window.clearInterval(listingPoller);
  }, [authUser]);

  useEffect(() => {
    if (authUser?.role === "rider") fetch("/api/orders/active").then((response) => response.json()).then((payload) => setRiderOrders(payload.orders ?? [])).catch(() => undefined);
  }, [authUser]);

  useEffect(() => {
    const pollBid = () => fetch("/api/bids/current?listingId=sony-xm5").then((response) => response.json()).then((payload) => { setCurrentBid(Math.round(Number(payload.currentBidCents ?? 0) / 100)); }).catch(() => undefined);
    const pollHistory = () => fetch("/api/bids/history?listingId=sony-xm5").then((response) => response.json()).then((payload) => { const rows = payload.history ?? []; if (rows.length) setBidFeed(rows.map((row: any, index: number) => ({ initials: String(row.bidder ?? "Bidder").split(" ").map((part: string) => part[0]).join("").slice(0, 2).toUpperCase(), amount: Math.round(row.amountCents / 100), time: new Date(row.createdAt).toLocaleString("en-PH", { dateStyle: "short", timeStyle: "short" }), status: index === 0 && row.status === "active" ? "Winning" : row.status === "active" ? "Active" : "Outbid" }))); }).catch(() => undefined);
    pollBid();
    pollHistory();
    const bidPoller = window.setInterval(pollBid, 3000);
    const historyPoller = window.setInterval(pollHistory, 5000);
    return () => { window.clearInterval(bidPoller); window.clearInterval(historyPoller); };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setAuctionSeconds(Math.max(0, Math.floor((new Date(listings[0].auctionEndAt ?? Date.now()).getTime() - Date.now()) / 1000))), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const next = sectionFromPath(location);
    if (next === "admin" && authUser?.role !== "admin") { setLocation("/"); return; }
    if (authUser?.role !== "rider" && !sellerMode && ["inventory", "admin"].includes(next)) {
      setLocation("/");
      return;
    }
    setActiveSection(next);
    setSidebarOpen(false);
  }, [location, sellerMode, authUser, setLocation]);

  const openListing = (id: string) => { setLocation(`/item/${id}`); setSidebarOpen(false); };

  const navigate = (section: Section) => {
    setActiveSection(section);
    setLocation(section === "overview" ? "/" : section === "live" ? "/auctions" : section === "auction" ? "/auction/sony-xm5" : section === "admin" ? "/admin-dashboard" : `/${section}`);
    setSidebarOpen(false);
  };

  const displayedNotifications: AppNotification[] = liveNotifications.length ? liveNotifications : seedNotifications as AppNotification[];
  const unreadCount = displayedNotifications.filter((item) => !readNotifications.includes(item.id)).length;
  const allListings = useMemo(() => Array.from(new Map([...publicListings, ...userListings, ...listings].map((listing) => [listing.id, listing])).values()).filter((listing) => {
    if (listing.lifecycle === "deleted" || listing.lifecycle === "draft") return false;
    if (listing.type !== "Auction" && listing.type !== "Both") return true;
    if (listing.auctionEndAt) return new Date(listing.auctionEndAt).getTime() > Date.now();
    return listing.id !== "sony-xm5" || auctionSeconds > 0;
  }), [userListings, auctionSeconds]);
  const filteredListings = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    return allListings.filter((listing) => {
      const matchesQuery = !query || `${listing.title} ${listing.category} ${listing.seller}`.toLowerCase().includes(query);
      const matchesFilter = marketFilter === "All items" || listing.type === marketFilter || listing.category === marketFilter;
      return matchesQuery && matchesFilter;
    });
  }, [allListings, marketFilter, searchQuery]);

  const toggleFavorite = (id: string) => {
    setFavoriteIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    toast.success(favoriteIds.includes(id) ? "Removed from saved items" : "Saved to your watchlist", { description: "You’ll see price and inventory changes here." });
  };


  const fundWallet = async (amountCents = 1000000) => {
    const response = await fetch("/api/wallet/fund", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amountCents }) });
    const payload = await response.json();
    if (!response.ok) { toast.error(payload.error ?? "Unable to fund demo wallet"); return; }
    setWalletCents(payload.walletCents);
    toast.success("Demo funds added", { description: `${money(amountCents / 100)} is now available for bidding.` });
  };

  const placeBid = async () => {
    const nextBid = Number(bidAmount);
    const cap = Number(maxBid);
    if (auctionSeconds === 0) { toast.error("This auction has ended"); return; }
    if (!Number.isFinite(nextBid) || nextBid < currentBid + 10) { toast.error("Minimum increment is ₱100", { description: `Your next bid must be at least ${money(currentBid + 100)}.` }); return; }
    if (!Number.isFinite(cap) || cap < nextBid) { toast.error("Max bid cap is too low", { description: "Set a ceiling at or above your next bid." }); return; }
    const response = await fetch("/api/bids/proxy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listingId: "sony-xm5", currentBidCents: currentBid * 100, maxBidCents: cap * 100, incrementCents: 1000 }) });
    const payload = await response.json();
    if (!response.ok) { toast.error(payload.error ?? "Unable to place proxy bid"); return; }
    const nextCurrent = Math.round(payload.currentBidCents / 100);
    setCurrentBid(nextCurrent); setWalletCents(payload.walletCents); setBidFeed((feed) => [{ initials: "AL", amount: nextCurrent, time: "just now", status: "Winning" }, ...feed.map((item) => ({ ...item, status: "Outbid" }))]); setBidAmount(String(nextCurrent + 10));
    toast.success("Automatic bidding is active", { description: `MerchantHub will bid by ₱10 up to ${money(cap)}.` });
  };

  const changeOrderStatus = (id: string, status: OrderStatus) => {
    setDeliveryStatuses((current) => ({ ...current, [id]: status }));
    toast.success(`Order ${id} updated`, { description: `Status is now ${status}.` });
  };

  if (signedOut) return <SignedOutScreen onReturn={() => setSignedOut(false)} />;
  if (authUser === undefined) return <AuthLoading />;
  if (authUser === null) return <AuthScreen onAuthenticated={(user) => { setAuthUser(user); setSellerMode(Boolean(user.sellerEnabled) || user.role === "admin" || user.role === "rider"); setLocation(user.role === "admin" ? "/admin-dashboard" : "/"); }} />;

  return (
    <div className="app-shell">
      <div className={`mobile-scrim ${sidebarOpen ? "is-visible" : ""}`} onClick={() => setSidebarOpen(false)} />
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><span /><i /><b /></div>
          <div><strong>Merchant<span>Hub</span></strong><small>marketplace OS</small></div>
          <button className="icon-button sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Close menu"><X size={18} /></button>
        </div>
        <div className="workspace-switcher"><div className="workspace-avatar">MH</div><div><strong>MerchantHub PH</strong><span>Operations team</span></div><ChevronDown size={15} /></div>
        <nav className="sidebar-nav" aria-label="Primary navigation">
          {navGroups.map((group) => { const visibleItems = group.items.filter((item) => sellerMode || authUser?.role === "rider" || !["inventory", "rider"].includes(item.id)); return visibleItems.length ? <div className="nav-group" key={group.label}><div className="nav-label">{group.label}</div>{visibleItems.map((item) => { const Icon = item.icon; return <button key={item.id} className={`nav-item ${activeSection === item.id ? "active" : ""}`} onClick={() => navigate(item.id)}><Icon size={17} strokeWidth={activeSection === item.id ? 2.4 : 1.9} /><span>{item.label}</span>{item.count && <em>{item.count}</em>}</button>; })}</div> : null; })}
        </nav>
        <div className="sidebar-bottom"><div className="sync-card"><div className="sync-orbit"><Radio size={14} /></div><div><strong>All systems live</strong><span>Synced 2 min ago</span></div></div><div className="mode-switch-card"><div><strong>{sellerMode ? "Seller mode on" : "Buyer mode"}</strong><span>{sellerMode ? "Seller tools are open" : "Complete store setup to sell"}</span></div><button className={`switch ${sellerMode ? "on" : ""}`} onClick={() => authUser.sellerEnabled ? toast.success("Seller mode is permanent") : setSellerOnboardingOpen(true)} aria-label="Seller mode"><span /></button></div><div className="profile-row"><div className="profile-avatar">{authUser.name.slice(0, 2).toUpperCase()}</div><div><strong>{authUser.name}</strong><span>{sellerMode ? "Seller mode on" : "Buyer mode"}</span></div><MoreHorizontal size={17} /></div></div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left"><button className="icon-button menu-trigger" onClick={() => setSidebarOpen(true)} aria-label="Open menu"><Menu size={20} /></button><div className="breadcrumb"><button className="breadcrumb-home" onClick={() => navigate("overview")}>MerchantHub</button><ChevronRight size={14} /><strong>{activeSection === "overview" ? "Overview" : titleForSection[activeSection]}</strong></div></div>
          <div className="topbar-actions"><label className="global-search"><Search size={17} /><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search listings, orders, people..." /><kbd>⌘ K</kbd></label><div className="wallet-chip"><WalletCards size={15} /><strong>{money(walletCents / 100)}</strong></div><div className="topbar-menu-wrap"><button className={`icon-button notification-button ${notificationOpen ? "is-open" : ""}`} onClick={() => { setNotificationOpen((open) => !open); setProfileOpen(false); }} aria-label="Open notifications"><Bell size={19} />{unreadCount > 0 && <span>{unreadCount}</span>}</button>{notificationOpen && <NotificationDropdown notifications={displayedNotifications} readNotifications={readNotifications} />}</div><div className="topbar-menu-wrap"><button className="top-avatar top-avatar-button" onClick={() => { setProfileOpen((open) => !open); setNotificationOpen(false); }} aria-label="Open profile menu">{authUser.name.slice(0, 2).toUpperCase()}</button>{profileOpen && <ProfileDropdown user={authUser} sellerMode={sellerMode} setSellerMode={setSellerMode} onEnableSeller={() => setSellerOnboardingOpen(true)} onLogout={() => { setProfileOpen(false); setAuthUser(null); setSignedOut(true); toast.success("You have been signed out"); }} />}</div></div>
        </header>
        <div className="page-content">
          <div className="page-heading"><div><div className="eyebrow"><span className="live-dot" /> Live marketplace overview</div><h1>{activeSection === "overview" ? `Good morning, ${authUser.name}` : titleForSection[activeSection]}</h1><p>{subtitleForSection[activeSection]}</p></div><div className="heading-actions">{(authUser.sellerEnabled || sellerMode) && <button className="button primary" onClick={() => { setCreateListingOpen(true); setSellerMode(true); }}><Plus size={17} /> Create listing</button>}</div></div>
          {activeSection === "overview" && <Overview onNavigate={navigate} favoriteIds={favoriteIds} toggleFavorite={toggleFavorite} readNotifications={readNotifications} searchQuery={searchQuery} />}
          {activeSection === "wallet" && <WalletView walletCents={walletCents} onFund={fundWallet} />}
          {activeSection === "marketplace" && <Marketplace listings={filteredListings} filter={marketFilter} setFilter={setMarketFilter} favoriteIds={favoriteIds} toggleFavorite={toggleFavorite} onOpenListing={openListing} />}
          {activeSection === "live" && <LiveAuctions favoriteIds={favoriteIds} toggleFavorite={toggleFavorite} onOpenListing={openListing} />}
          {activeSection === "detail" && <ItemDetail listingId={location.split("/").pop() ?? "sony-xm5"} customListings={userListings} authUser={authUser} onBack={() => navigate("marketplace")} />}
          {activeSection === "auction" && <AuctionDetail auctionSeconds={auctionSeconds} walletCents={walletCents} currentBid={currentBid} bidAmount={bidAmount} maxBid={maxBid} setBidAmount={setBidAmount} setMaxBid={setMaxBid} bidFeed={bidFeed} placeBid={placeBid} />}
          {activeSection === "bidding" && <BiddingHistoryView bidFeed={bidFeed} currentBid={currentBid} onOpenAuction={() => navigate("auction")} />}
          {activeSection === "orders" && <OrdersView deliveryStatuses={deliveryStatuses} changeOrderStatus={changeOrderStatus} />}
          {activeSection === "payments" && <PaymentCenter />}
          {activeSection === "rider" && <RiderDesk online={riderOnline} setOnline={setRiderOnline} deliveryStatuses={deliveryStatuses} changeOrderStatus={changeOrderStatus} authUser={authUser} riderOrders={riderOrders} /> }
          {activeSection === "inventory" && sellerMode && <InventoryView listings={userListings} initialTab={inventoryTab} onConvert={() => toast.success("Auction draft created", { description: "1 unit moved from buy-now inventory." })} onRefresh={() => fetch("/api/listings?owner=me").then((response) => response.json()).then((payload) => setUserListings((payload.listings ?? []).map((item: Listing) => ({ ...item, seller: authUser?.name ?? "" }))))} />}
          {activeSection === "messages" && <MessagesView />}
          {activeSection === "saved" && <SavedView favoriteIds={favoriteIds} toggleFavorite={toggleFavorite} />}
          {activeSection === "admin" && authUser?.role === "admin" && <AdminView />}
        </div>
      </main>
      {sellerOnboardingOpen && <SellerOnboardingModal onClose={() => setSellerOnboardingOpen(false)} onComplete={(user) => { setAuthUser(user); setSellerMode(true); setSellerOnboardingOpen(false); toast.success("Seller mode enabled permanently", { description: `${user.storeName} is ready for listings.` }); }} />}
      {createListingOpen && <CreateListingModal onClose={() => setCreateListingOpen(false)} onCreate={async (listing, lifecycle) => { const response = await fetch("/api/listings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: listing.title, description: listing.description, category: listing.category, listingType: listing.type, priceCents: Math.round(listing.price * 100), stock: listing.stock, condition: listing.condition, lifecycle, imageData: listing.image.startsWith("data:") ? listing.image : undefined, auctionEndAt: listing.auctionEndAt, reserveThresholdCents: listing.reserveThreshold == null ? undefined : Math.round(listing.reserveThreshold * 100), minimumIncrementCents: listing.minimumIncrement == null ? undefined : Math.round(listing.minimumIncrement * 100) }) }); const payload = await response.json().catch(() => ({})); if (!response.ok) { toast.error(payload.error ?? `Listing could not be ${lifecycle === "draft" ? "saved" : "published"}`); return; } const saved = { ...(payload.listing ?? listing), seller: authUser?.storeName || authUser?.name || "", lifecycle }; setUserListings((current) => [saved, ...current]); if (lifecycle === "official") setPublicListings((current) => [saved, ...current]); setInventoryTab(lifecycle); setCreateListingOpen(false); setSellerMode(true); setLocation("/inventory"); toast.success(lifecycle === "draft" ? "Draft saved" : "Listing published", { description: lifecycle === "draft" ? "Find it in Inventory → Drafts." : "Your listing is now visible in the marketplace." }); }} />}
    </div>
  );
}

function Overview({ onNavigate, favoriteIds, toggleFavorite, readNotifications, searchQuery }: { onNavigate: (section: Section) => void; favoriteIds: string[]; toggleFavorite: (id: string) => void; readNotifications: string[]; searchQuery: string }) {
  const leadListing = listings[0];
  const searchMatches = listings.filter((listing) => `${listing.title} ${listing.category} ${listing.seller}`.toLowerCase().includes(searchQuery.toLowerCase().trim())).slice(0, 3);
  return <div className="overview-grid">
    <div className="overview-main">
      <div className="metric-grid"><MetricCard label="Gross sales" value="₱248,860" delta="+18.4%" detail="vs. last 30 days" tone="coral" icon={CircleDollarSign} /><MetricCard label="Live auctions" value="24" delta="+6 today" detail="8 ending soon" tone="teal" icon={Gavel} /><MetricCard label="Orders in transit" value="12" delta="94% on time" detail="2 need attention" tone="mustard" icon={Truck} /><MetricCard label="Available stock" value="1,284" delta="+8.2%" detail="across 96 SKUs" tone="lavender" icon={Boxes} /></div>
      {searchQuery.trim() && <section className="panel search-results-panel"><div className="panel-header"><div><div className="eyebrow">Quick search</div><h2>Results for “{searchQuery}”</h2></div><button className="text-button" onClick={() => onNavigate("marketplace")}>Open marketplace <ChevronRight size={15} /></button></div><div className="search-result-list">{searchMatches.length ? searchMatches.map((listing) => <button className="search-result-item" key={listing.id} onClick={() => onNavigate(listing.type === "Buy now" ? "marketplace" : "auction")}><img src={listing.image} alt="" /><span><strong>{listing.title}</strong><small>{listing.category} · {listing.type}</small></span><b>{money(listing.currentBid ?? listing.price)}</b><ChevronRight size={15} /></button>) : <div className="empty-search">No matching listings yet. Try “audio”, “camera”, or “fashion”.</div>}</div></section>}
      <section className="panel live-auction-panel"><div className="panel-header"><div><div className="eyebrow coral-text"><span className="live-dot" /> Live now</div><h2>Auction floor</h2></div><button className="text-button" onClick={() => onNavigate("live")}>View all auctions <ChevronRight size={15} /></button></div><div className="auction-floor-body"><div className="feature-image-wrap"><img src={leadListing.image} alt={leadListing.title} /><div className="image-overlay"><span className="pill dark-pill"><Radio size={12} /> Live auction</span><span className="watchers"><Eye size={13} /> 32 watching</span></div></div><div className="auction-summary"><div className="listing-kicker">Featured listing <span>·</span> {leadListing.category}</div><h3>{leadListing.title}</h3><div className="seller-line"><span className="mini-avatar">AA</span> {leadListing.seller} <Star size={13} fill="currentColor" /> <strong>{leadListing.sellerRating}</strong></div><div className="bid-row"><div><span>Current bid</span><strong>{money(8450)}</strong><small>18 bids · reserve met</small></div><div className="countdown"><Clock3 size={15} /><span>Ends in</span><strong>01:42:18</strong></div></div><div className="progress-track"><span style={{ width: "78%" }} /></div><div className="auction-actions"><button className="button primary" onClick={() => onNavigate("auction")}><Gavel size={16} /> Place a bid</button><button className={`icon-button bordered ${favoriteIds.includes(leadListing.id) ? "favorited" : ""}`} onClick={() => toggleFavorite(leadListing.id)} aria-label="Save auction"><Heart size={18} fill={favoriteIds.includes(leadListing.id) ? "currentColor" : "none"} /></button></div></div></div></section>
      <section className="panel activity-panel"><div className="panel-header"><div><div className="eyebrow">Your marketplace</div><h2>Recent activity</h2></div><button className="icon-button"><MoreHorizontal size={18} /></button></div><div className="activity-list">{activities.map((item) => <ActivityRow key={item.id} item={item} read={readNotifications.includes(item.id)} />)}</div></section>
    </div>
    <div className="overview-side"><section className="panel pulse-panel"><div className="panel-header"><div><div className="eyebrow teal-text"><span className="live-dot teal" /> Operations pulse</div><h2>Today at a glance</h2></div><button className="icon-button"><RefreshCcw size={16} /></button></div><div className="pulse-map"><div className="map-grid" /><div className="route route-one" /><div className="route route-two" /><span className="map-pin pin-one"><Truck size={13} /></span><span className="map-pin pin-two"><PackageCheck size={13} /></span><span className="map-pin pin-three"><MapPinned size={13} /></span><div className="map-label label-one">Davao City</div><div className="map-label label-two">Tupi hub</div></div><div className="pulse-stats"><PulseStat icon={Truck} label="On the road" value="12" meta="2 arriving soon" tone="teal" /><PulseStat icon={PackageOpen} label="Ready to ship" value="18" meta="4 due today" tone="coral" /><PulseStat icon={AlertCircle} label="Needs review" value="3" meta="1 high priority" tone="mustard" /></div><button className="button full secondary" onClick={() => onNavigate("orders")}>Open logistics desk <ChevronRight size={15} /></button></section><section className="panel trend-panel"><div className="panel-header"><div><div className="eyebrow">Demand signal</div><h2>Sales momentum</h2></div><span className="trend-badge"><ArrowUpRight size={13} /> 18.4%</span></div><div className="trend-value"><strong>₱82.4k</strong><span>this month</span></div><MiniChart /><div className="chart-labels"><span>May 01</span><span>May 31</span></div></section><NotificationsPanel readNotifications={readNotifications} /><section className="saved-mini"><div className="saved-icon"><Bookmark size={17} /></div><div><strong>3 saved searches</strong><span>2 new matches today</span></div><button className="icon-button" onClick={() => onNavigate("saved")}><ChevronRight size={17} /></button></section></div>
  </div>;
}

function LiveAuctions({ favoriteIds, toggleFavorite, onOpenListing }: { favoriteIds: string[]; toggleFavorite: (id: string) => void; onOpenListing: (id: string) => void }) {
  const liveListings = listings.filter((listing) => listing.type === "Auction" || listing.type === "Both");
  return <div className="section-stack"><div className="live-auctions-banner"><div><div className="eyebrow coral-text"><span className="live-dot" /> Live floor · 8 auctions ending today</div><h2>Find the moment before it moves.</h2><p>Real-time-style bid signals, transparent reserve states, and fair anti-snipe windows.</p></div><div className="live-floor-stats"><div><strong>₱248k</strong><span>value in play</span></div><div><strong>86</strong><span>active bidders</span></div><div><strong>02:18</strong><span>next close</span></div></div></div><div className="market-summary"><div><span className="eyebrow">Live inventory</span><strong>{liveListings.length} active auctions</strong></div><div className="summary-right"><span><span className="live-dot" /> Bids updating live</span><button className="sort-button">Sort: Ending soon <ChevronDown size={15} /></button></div></div><div className="listing-grid">{liveListings.map((listing) => <ListingCard key={listing.id} listing={listing} favorite={favoriteIds.includes(listing.id)} onFavorite={() => toggleFavorite(listing.id)} onClick={() => onOpenListing(listing.id)} />)}</div><section className="panel live-feed-strip"><div className="panel-header"><div><div className="eyebrow teal-text"><span className="live-dot teal" /> Live bid feed</div><h2>Momentum across the floor</h2></div><button className="text-button">Open feed <ChevronRight size={15} /></button></div><div className="floor-feed"><span><b>MS</b> raised Sony XM5 to <strong>₱8,450</strong></span><span><b>JL</b> entered camera room with a <strong>₱43,100</strong> bid</span><span><b>KR</b> saved New Balance 990v5</span></div></section></div>;
}

function NotificationsPanel({ readNotifications }: { readNotifications: string[] }) {
  return <section className="panel notifications-panel"><div className="panel-header"><div><div className="eyebrow">Stay in the loop</div><h2>Notifications</h2></div><span className="notification-count">{seedNotifications.filter((item) => !readNotifications.includes(item.id)).length} unread</span></div><div className="notification-list">{seedNotifications.map((item) => <div className={`notification-row ${readNotifications.includes(item.id) ? "read" : ""}`} key={item.id}><span className={`note-icon ${item.tone}`}><Bell size={14} /></span><div><strong>{item.label}</strong><span>{item.time} · {readNotifications.includes(item.id) ? "Read" : "Unread"}</span></div>{!readNotifications.includes(item.id) && <i />}</div>)}</div></section>;
}

function Marketplace({ listings: items, filter, setFilter, favoriteIds, toggleFavorite, onOpenListing }: { listings: Listing[]; filter: string; setFilter: (filter: string) => void; favoriteIds: string[]; toggleFavorite: (id: string) => void; onOpenListing: (id: string) => void }) {
  const filters = ["All items", "Auction", "Buy now", "Both", "Audio", "Fashion"];
  return <div className="section-stack"><div className="toolbar-row"><div className="filter-tabs">{filters.map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}</button>)}</div><button className="button secondary"><SlidersHorizontal size={15} /> More filters <span className="filter-count">2</span></button></div><div className="market-summary"><div><span className="eyebrow">Showing</span><strong>{items.length} curated listings</strong></div><div className="summary-right"><span><span className="live-dot" /> 8 auctions live</span><button className="sort-button">Sort: Recommended <ChevronDown size={15} /></button></div></div><div className="listing-grid">{items.map((listing) => <ListingCard key={listing.id} listing={listing} favorite={favoriteIds.includes(listing.id)} onFavorite={() => toggleFavorite(listing.id)} onClick={() => onOpenListing(listing.id)} onAddToCart={listing.buyNow ? () => toast.success(`${listing.title} added to cart`, { description: "Ready for checkout from Saved items." }) : undefined} />)}</div>{items.length === 0 && <div className="empty-state"><Search size={22} /><strong>No listings found</strong><span>Try a different search or remove a filter.</span></div>}</div>;
}

function AuthLoading() {
  return <div className="auth-screen"><div className="auth-card loading-card"><div className="brand-mark"><span /><i /><b /></div><div className="eyebrow teal-text">MerchantHub</div><h1>Loading your workspace…</h1><p>Checking your saved account session.</p></div></div>;
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: (user: AuthUser) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [province, setProvince] = useState("South Cotabato");
  const [municipality, setMunicipality] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setError(""); try { const response = await fetch(`/api/auth/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(mode === "login" ? { email, password } : { name, email, password, province, municipality }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? "Unable to continue"); onAuthenticated(payload.user); toast.success(mode === "login" ? "Welcome back" : "Account created", { description: mode === "login" ? "Your saved MerchantHub session is active." : "Your buyer account starts with a ₱0 e-wallet balance." }); } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to continue"); } finally { setBusy(false); } };
  return <div className="auth-screen"><div className="auth-card"><div className="auth-brand"><div className="brand-mark"><span /><i /><b /></div><div><strong>Merchant<span>Hub</span></strong><small>marketplace OS</small></div></div><div className="eyebrow teal-text">{mode === "login" ? "Welcome back" : "Buyer registration"}</div><h1>{mode === "login" ? "Sign in to trade smarter." : "Create your buyer account."}</h1><p>{mode === "login" ? "Your wallet, bids, orders, and listings stay saved to your account." : "Start as a buyer, then turn on seller mode whenever you are ready."}</p><form onSubmit={submit}>{mode === "register" && <label className="field-label">Full name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Alex Rivera" required /></label>}<label className="field-label">Email<input value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="you@example.com" required /></label><label className="field-label">Password<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder={mode === "register" ? "At least 6 characters" : "Your password"} required /></label>{mode === "register" && <div className="field-two"><label className="field-label">Province<select value={province} onChange={(event) => { setProvince(event.target.value); setMunicipality(""); }} required>{philippineProvinces.map((item) => <option key={item}>{item}</option>)}</select></label><label className="field-label">Municipality / City<select value={municipality} onChange={(event) => setMunicipality(event.target.value)} required><option value="">Select municipality</option>{municipalitiesFor(province).map((item) => <option key={item}>{item}</option>)}</select></label></div>}{error && <div className="auth-error"><AlertCircle size={14} />{error}</div>}<button className="button primary full" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</button></form><button className="auth-switch" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>{mode === "login" ? "New to MerchantHub? Create an account" : "Already have an account? Sign in"}</button>{mode === "login" && <div className="admin-hint"><ShieldCheck size={14} /><span>Admin dashboard access uses the dedicated account configured by your administrator.</span></div>}</div></div>;
}

function NotificationDropdown({ notifications, readNotifications }: { notifications: AppNotification[]; readNotifications: string[] }) {
  return <div className="header-dropdown notification-dropdown"><div className="header-dropdown-head"><div><strong>Notifications</strong><span>{notifications.filter((item) => !readNotifications.includes(item.id)).length} unread</span></div><Bell size={16} className="coral-text" /></div><div className="header-notification-list">{notifications.map((item) => <div className={`header-notification-row ${readNotifications.includes(item.id) ? "read" : ""}`} key={item.id}><span className={`note-icon ${item.tone}`}><Bell size={13} /></span><div><strong>{item.label}</strong><span>{item.time} · {readNotifications.includes(item.id) ? "Read" : "Unread"}</span></div>{!readNotifications.includes(item.id) && <i />}</div>)}</div><div className="header-dropdown-foot">Tap the bell anytime to review updates. Notifications stay unread until you choose to manage them.</div></div>;
}

function WalletView({ walletCents, onFund }: { walletCents: number; onFund: (amountCents?: number) => void }) {
  const [amount, setAmount] = useState("10000");
  return <div className="section-stack"><section className="wallet-hero panel"><div className="wallet-orbit"><WalletCards size={30} /></div><div><div className="eyebrow teal-text">Demo wallet</div><h2>Funds available for bidding</h2><p>This demo balance controls the maximum amount your automatic bidding proxy can commit.</p></div><strong>{money(walletCents / 100)}</strong></section><section className="panel wallet-fund-panel"><div className="panel-header"><div><div className="eyebrow">Add funds</div><h2>Top up your e-wallet</h2></div><span className="sandbox-badge"><CircleCheckBig size={13} /> Demo only</span></div><div className="wallet-topup-grid"><label className="field-label">Amount in pesos<input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="numeric" min="100" type="number" /></label><button className="button primary" onClick={() => onFund(Math.round(Number(amount) * 100))}><Plus size={16} /> Add {money(Number(amount) || 0)}</button></div><p className="checkout-note">Demo top-ups are stored to your account and can be used for proxy bids. No real money is charged.</p></section></div>;
}

function ProfileDropdown({ user, sellerMode, setSellerMode, onEnableSeller, onLogout }: { user: AuthUser; sellerMode: boolean; setSellerMode: (value: boolean) => void; onEnableSeller: () => void; onLogout: () => void }) {
  return <div className="header-dropdown profile-dropdown"><div className="profile-dropdown-head"><div className="profile-avatar">{user.name.slice(0, 2).toUpperCase()}</div><div><strong>{user.name}</strong><span>{sellerMode ? `Seller · ${user.storeName ?? "Store"}` : "Buyer mode"}</span></div></div>{user.sellerEnabled ? <div className="profile-menu-item"><Store size={15} /><span>Seller mode is permanent</span><span className="switch mini-switch on"><span /></span></div> : <button className="profile-menu-item" onClick={onEnableSeller}><Store size={15} /><span>Turn on seller mode</span><ChevronRight size={14} /></button>}<button className="profile-menu-item" onClick={() => toast.success("Profile settings opened")}><UserRound size={15} /><span>Profile settings</span><ChevronRight size={14} /></button><button className="profile-menu-item danger" onClick={onLogout}><LogOut size={15} /><span>Log out</span></button></div>;
}

function SellerOnboardingModal({ onClose, onComplete }: { onClose: () => void; onComplete: (user: AuthUser) => void }) {
  const [storeName, setStoreName] = useState(""); const [storeImage, setStoreImage] = useState(""); const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); setBusy(true); const response = await fetch("/api/auth/seller-profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeName, storeImage: storeImage || undefined }) }); const payload = await response.json().catch(() => ({})); setBusy(false); if (!response.ok) { toast.error(payload.error ?? "Store profile could not be saved"); return; } onComplete(payload.user); };
  const selectImage = (event: React.ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => setStoreImage(String(reader.result)); reader.readAsDataURL(file); };
  return <div className="modal-scrim"><form className="create-listing-modal" onSubmit={submit}><div className="modal-header"><div><div className="eyebrow teal-text">Seller onboarding</div><h2>Set up your store</h2><p>Seller mode stays enabled after you complete this form.</p></div><button type="button" className="icon-button" onClick={onClose}><X size={18} /></button></div><label className="field-label">Store name *<input value={storeName} onChange={(event) => setStoreName(event.target.value)} placeholder="Example: Rishelle Finds" required /></label><label className="field-label">Store picture<input type="file" accept="image/png,image/jpeg,image/webp" onChange={selectImage} /><small className="field-help">JPG, PNG, or WebP</small></label>{storeImage && <img className="listing-image-preview" src={storeImage} alt="Store preview" />}<div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={busy}>{busy ? "Saving…" : "Finish store setup"}</button></div></form></div>;
}

function SignedOutScreen({ onReturn }: { onReturn: () => void }) {
  return <div className="signed-out-screen"><div className="signed-out-card"><div className="brand-mark" aria-hidden="true"><span /><i /><b /></div><div className="eyebrow teal-text">Session ended</div><h1>You’re signed out.</h1><p>Your MerchantHub workspace is safe. Return to the sign-in screen to continue.</p><button className="button primary" onClick={onReturn}><UserRound size={16} /> Return to sign in</button></div></div>;
}

function CreateListingModal({ onClose, onCreate }: { onClose: () => void; onCreate: (listing: Listing, lifecycle: "draft" | "official") => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Audio");
  const [type, setType] = useState<Listing["type"]>("Buy now");
  const [price, setPrice] = useState("");
  const [condition, setCondition] = useState<Listing["condition"]>("New");
  const [stock, setStock] = useState("1");
  const [auctionEndAt, setAuctionEndAt] = useState("");
  const [reserveThreshold, setReserveThreshold] = useState("");
  const [minimumIncrement, setMinimumIncrement] = useState("10");
  const [image, setImage] = useState("");
  const auctionEnabled = type === "Auction" || type === "Both";
  const onImageSelected = (event: React.ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (!file) return; if (!file.type.startsWith("image/")) { toast.error("Choose an image file"); return; } if (file.size > 5 * 1024 * 1024) { toast.error("Image must be 5 MB or smaller"); return; } const reader = new FileReader(); reader.onload = () => setImage(String(reader.result)); reader.readAsDataURL(file); };
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const amount = Number(price); const quantity = Number(stock); const reserve = Number(reserveThreshold); const increment = Number(minimumIncrement); if (!title.trim() || !description.trim() || !Number.isFinite(amount) || amount <= 0 || !Number.isFinite(quantity) || quantity < 1) { toast.error("Complete the required listing fields", { description: "Add a title, description, price, and at least one unit." }); return; } if (auctionEnabled && (!auctionEndAt || !Number.isFinite(reserve) || reserve < 0 || !Number.isFinite(increment) || increment < 1)) { toast.error("Complete the auction settings", { description: "Choose an end time, reserve threshold, and minimum increment of at least ₱1." }); return; } const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null; const lifecycle = submitter?.value === "draft" ? "draft" : "official"; const slug = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}-${Date.now()}`; onCreate({ id: slug, title: title.trim(), description: description.trim(), category, type, price: amount, startingBid: auctionEnabled ? amount : undefined, buyNow: type === "Buy now" || type === "Both" ? amount : undefined, auctionEndAt: auctionEnabled ? auctionEndAt : undefined, reserveThreshold: auctionEnabled ? reserve : undefined, minimumIncrement: auctionEnabled ? increment : undefined, image: image || listings.find((item) => item.category === category)?.image || listings[0].image, seller: "", sellerRating: 5, condition, stock: quantity, accent: "coral" }, lifecycle); };
  return <div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><form className="create-listing-modal" onSubmit={submit}><div className="modal-header"><div><div className="eyebrow coral-text">Seller workspace</div><h2>Create a listing</h2><p>Give buyers the details they need to buy or bid with confidence.</p></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close create listing"><X size={18} /></button></div><div className="listing-form-grid"><label className="field-label field-span-2">Title *<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Vintage film camera" /></label><label className="field-label field-span-2">Description *<textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Describe condition, inclusions, warranty, and any important notes." rows={4} /></label><label className="field-label field-span-2">Product image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={onImageSelected} /><small className="field-help">Add an image from your device · JPG, PNG, or WebP up to 5 MB</small>{image && <img className="listing-image-preview" src={image} alt="Selected listing preview" />}</label><label className="field-label">Category<select value={category} onChange={(event) => setCategory(event.target.value)}><option>Audio</option><option>Cameras</option><option>Fashion</option><option>Footwear</option><option>Homeware</option><option>Collectibles</option></select></label><label className="field-label">Listing type<select value={type} onChange={(event) => setType(event.target.value as Listing["type"])}><option>Buy now</option><option>Auction</option><option>Both</option></select></label><label className="field-label">{type === "Auction" ? "Starting price" : "Price"} *<input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="numeric" placeholder="₱ 0" /></label><label className="field-label">Condition<select value={condition} onChange={(event) => setCondition(event.target.value as Listing["condition"])}><option>New</option><option>Like new</option><option>Good</option></select></label><label className="field-label">Quantity *<input value={stock} onChange={(event) => setStock(event.target.value)} inputMode="numeric" min="1" type="number" /></label>{auctionEnabled && <><label className="field-label">Auction ends *<input type="datetime-local" value={auctionEndAt} onChange={(event) => setAuctionEndAt(event.target.value)} /><small className="field-help">Use your local Philippine time</small></label><label className="field-label">Reserve threshold *<input value={reserveThreshold} onChange={(event) => setReserveThreshold(event.target.value)} inputMode="numeric" placeholder="₱ 0" /><small className="field-help">Minimum amount you will accept</small></label><label className="field-label">Minimum increment *<input value={minimumIncrement} onChange={(event) => setMinimumIncrement(event.target.value)} inputMode="numeric" placeholder="₱ 100" /><small className="field-help">At least ₱1 per bid</small></label></>}</div><div className="listing-type-help"><Gavel size={15} /><span><strong>{type === "Buy now" ? "Buy now" : type === "Auction" ? "Auction" : "Auction + Buy now"}</strong> · {auctionEnabled ? "Set the close time, reserve threshold, and minimum increment so bidding rules are clear." : "Buyers can check out instantly."}</span></div><div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="submit" value="draft" className="button secondary">Save as draft</button><button type="submit" value="official" className="button primary"><Plus size={16} /> Publish official</button></div></form></div>;
}
function ItemDetail({ listingId, customListings, authUser, onBack }: { listingId: string; customListings: Listing[]; authUser: AuthUser | null; onBack: () => void }) {
  const listing = [...customListings, ...listings].find((item) => item.id === listingId) ?? listings[0];
  const [quantity, setQuantity] = useState(1);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<"E-wallet" | "Cash on Delivery">("E-wallet");
  const [checkoutAddress, setCheckoutAddress] = useState("");
  const isAuction = listing.type === "Auction" || listing.type === "Both";
  const price = listing.buyNow ?? listing.price;
  const total = price * quantity;
  const checkout = async () => { const response = await fetch("/api/orders/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listingId: listing.id, sellerId: listing.ownerId || 1, quantity, amountCents: Math.round(total * 100), payment: paymentMethod === "Cash on Delivery" ? "COD" : "Online", province: authUser?.province, municipality: authUser?.municipality, addressDetails: checkoutAddress }) }); const payload = await response.json(); if (!response.ok) { toast.error(payload.error ?? "Checkout could not be created"); return; } setCheckoutOpen(true); toast.success("Order created", { description: `${quantity} × ${listing.title} · ${paymentMethod} · ${payload.orderId}.` }); };
  return <div className="section-stack"><button className="back-link" onClick={onBack}><ChevronRight size={15} className="rotate-180" /> Back to marketplace</button><div className="item-detail-grid"><section className="panel item-visual-panel"><div className="item-detail-image"><img src={listing.image} alt={listing.title} /><div className="image-overlay"><span className={`pill ${isAuction ? "dark-pill" : "buy-detail-pill"}`}>{isAuction ? <Gavel size={12} /> : <ShoppingBag size={12} />} {listing.type}</span><span className="watchers"><Eye size={13} /> {listing.bidders ? `${listing.bidders} watching` : "Popular item"}</span></div></div><div className="item-thumb-row"><div className="thumbnail active"><img src={listing.image} alt="" /></div><div className="item-detail-note"><ShieldCheck size={15} /><span>Buyer protection included</span></div></div></section><section className="item-detail-copy"><div className="detail-kicker"><span className="pill coral-pill">{listing.category}</span><span>{listing.condition} · {listing.stock} available</span></div><h2>{listing.title}</h2><div className="seller-line"><span className="mini-avatar">{listing.seller.slice(0, 2).toUpperCase()}</span> {listing.seller} <Star size={13} fill="currentColor" /><strong>{listing.sellerRating}</strong><span className="seller-verified"><ShieldCheck size={13} /> Verified seller</span></div><p className="detail-description">{listing.description ?? "A carefully selected MerchantHub listing with clear condition notes, protected checkout, and delivery coverage across the Philippines."}</p><div className="detail-metrics"><div><span>{isAuction ? "Current bid" : "Price"}</span><strong>{money(listing.currentBid ?? listing.price)}</strong><small>{isAuction ? `${listing.bidders ?? 0} bids` : "Secure checkout"}</small></div><div><span>Condition</span><strong className="teal-text">{listing.condition}</strong><small>Seller verified</small></div><div><span>Delivery</span><strong>1–3d</strong><small>Rider network</small></div></div>{!isAuction && <div className="quantity-picker"><div><span>Quantity</span><strong>{quantity} <small>of {listing.stock} available</small></strong></div><div className="quantity-buttons"><button onClick={() => setQuantity((value) => Math.max(1, value - 1))} disabled={quantity <= 1}>−</button><button onClick={() => setQuantity((value) => Math.min(listing.stock, value + 1))} disabled={quantity >= listing.stock}><Plus size={15} /></button></div></div>}<div className="checkout-location-editor"><div className="eyebrow teal-text">Delivery location</div><strong>{authUser?.province ?? "South Cotabato"} · {authUser?.municipality ?? "Polomolok"}</strong><input value={checkoutAddress} onChange={(event) => setCheckoutAddress(event.target.value)} placeholder="Optional house, street, barangay, or landmark details" /></div><div className="detail-checkout-box"><div className="detail-checkout-head"><div><span className="eyebrow teal-text">{checkoutOpen ? "Ready to pay" : "Protected checkout"}</span><strong>{money(total)}</strong></div><CreditCard size={21} /></div>{checkoutOpen ? <div className="checkout-ready"><CircleCheckBig size={16} /><span>{paymentMethod === "Cash on Delivery" ? "Cash on Delivery selected. Pay the rider when your order arrives." : "E-wallet selected. Your wallet will be checked before payment."}</span></div> : <><div className="checkout-line"><span>{isAuction ? "Starting bid" : `${quantity} item${quantity > 1 ? "s" : ""}`}</span><b>{isAuction ? money(listing.startingBid ?? listing.price) : money(total)}</b></div>{!isAuction && <div className="payment-methods"><button type="button" className={`payment-method-option ${paymentMethod === "E-wallet" ? "active" : ""}`} onClick={() => setPaymentMethod("E-wallet")}><WalletCards size={14} /><span><strong>E-wallet</strong><small>Protected online payment</small></span></button><button type="button" className={`payment-method-option ${paymentMethod === "Cash on Delivery" ? "active" : ""}`} onClick={() => setPaymentMethod("Cash on Delivery")}><Truck size={14} /><span><strong>Cash on Delivery</strong><small>Pay the rider at delivery</small></span></button></div>}<button className="button primary full" onClick={checkout}>{isAuction ? <Gavel size={16} /> : <CreditCard size={16} />}{isAuction ? "Place a bid" : `Checkout · ${money(total)}`}</button></>}</div><div className="item-trust-row"><span><ShieldCheck size={14} /> Buyer protection</span><span><Truck size={14} /> Tracked delivery</span><span><RefreshCcw size={14} /> Easy returns</span></div></section></div><section className="panel item-description-panel"><div className="panel-header"><div><div className="eyebrow">Why buy here</div><h2>Everything is clear before you pay.</h2></div><Check size={19} className="teal-text" /></div><div className="item-benefits"><div><span className="note-icon teal"><ShieldCheck size={15} /></span><strong>Protected checkout</strong><p>Your payment stays protected until delivery is confirmed.</p></div><div><span className="note-icon coral"><Truck size={15} /></span><strong>Local rider network</strong><p>Track the handoff from seller to doorstep in one place.</p></div><div><span className="note-icon lavender"><Star size={15} /></span><strong>Trusted seller</strong><p>See ratings, condition, and listing details before you commit.</p></div></div></section></div>;
}

function BiddingHistoryView({ bidFeed, currentBid, onOpenAuction }: { bidFeed: typeof bidHistory; currentBid: number; onOpenAuction: () => void }) {
  return <div className="section-stack"><section className="panel"><div className="panel-header"><div><div className="eyebrow teal-text"><span className="live-dot teal" /> Live bidding overview</div><h2>{currentBid ? `${money(currentBid)} current highest bid` : "No bids yet"}</h2><span className="field-help">Updates automatically while the auction is active.</span></div><button className="button primary" onClick={onOpenAuction}><Gavel size={15} /> Open live auction</button></div><div className="bid-timeline">{bidFeed.length ? bidFeed.map((bid, index) => <div className={`bid-event ${index === 0 ? "leading" : ""}`} key={`${bid.initials}-${bid.amount}-${bid.time}-${index}`}><div className="timeline-line" /><span className={`mini-avatar ${index === 0 ? "coral-avatar" : ""}`}>{bid.initials}</span><div><strong>{money(bid.amount)}</strong><span>Bidder {bid.initials} · {bid.time}</span></div><em className={index === 0 ? "winning" : "outbid"}>{bid.status}</em></div>) : <div className="empty-state"><Gavel size={22} /><strong>No persisted bids yet</strong><span>Place the first bid to start the timeline.</span></div>}</div></section><section className="panel"><div className="panel-header"><div><div className="eyebrow">How to bid</div><h2>Use the timeline to choose your next bid</h2></div><Activity size={19} className="teal-text" /></div><p className="detail-description">The current highest bid comes from the shared database. Each bidder’s proxy submission is recorded with its amount, status, and timestamp so all users can follow the auction history.</p></section></div>;
}

function AuctionDetail({ auctionSeconds, walletCents, currentBid, bidAmount, maxBid, setBidAmount, setMaxBid, bidFeed, placeBid }: { auctionSeconds: number; walletCents: number; currentBid: number; bidAmount: string; maxBid: string; setBidAmount: (value: string) => void; setMaxBid: (value: string) => void; bidFeed: typeof bidHistory; placeBid: () => void }) {
  const listing = listings[0];
  const visibleCurrentBid = currentBid || listing.startingBid || listing.price;
  return <div className="section-stack"><button className="back-link"><ChevronRight size={15} className="rotate-180" /> Back to live auctions</button><div className="auction-detail-grid"><section className="panel auction-visual-panel"><div className="detail-image"><img src={listing.image} alt={listing.title} /><div className="image-overlay"><span className="pill dark-pill"><Radio size={12} /> Live now</span><span className="watchers"><Eye size={13} /> 32 watching</span></div></div><div className="thumbnail-row"><div className="thumbnail active"><img src={listing.image} alt="" /></div><div className="thumbnail"><img src="https://images.unsplash.com/photo-1583394838336-acd977736f90?auto=format&fit=crop&w=120&q=80" alt="" /></div><div className="thumbnail"><img src="https://images.unsplash.com/photo-1546435770-a3e426bf472b?auto=format&fit=crop&w=120&q=80" alt="" /></div><span className="photo-count">+4 photos</span></div></section><section className="auction-detail-copy"><div className="detail-kicker"><span className="pill coral-pill">Auction</span><span>Audio · Like new</span></div><h2>{listing.title}</h2><div className="seller-line"><span className="mini-avatar">AA</span> {listing.seller} <Star size={13} fill="currentColor" /> <strong>{listing.sellerRating}</strong><span className="seller-verified"><ShieldCheck size={13} /> Verified seller</span></div><p className="detail-description">Studio-grade sound with adaptive noise cancellation. Gently used, complete with the original case, cable, and 11-month local warranty.</p><div className="detail-metrics"><div><span>{currentBid ? "Current highest bid" : "Starting bid"}</span><strong>{money(visibleCurrentBid)}</strong><small>{bidFeed.length} recorded bids</small></div><div><span>Reserve price</span><strong className="teal-text">Met</strong><small>Eligible to win</small></div><div><span>Ends in</span><strong>{formatCountdown(auctionSeconds)}</strong><small>{auctionSeconds === 0 ? "Auction ended" : "Live countdown · anti-snipe on"}</small></div></div><div className="bid-box"><div className="bid-box-head"><div><span className="eyebrow coral-text"><span className="live-dot" /> Live bidding</span><strong>Choose your next bid from the timeline</strong><small className="wallet-balance">E-wallet available: {money(walletCents / 100)}</small></div><Zap size={20} /></div><div className="bid-fields"><label>Next bid<input value={bidAmount} onChange={(event) => setBidAmount(event.target.value)} inputMode="numeric" /></label><label>Maximum bid cap<input value={maxBid} onChange={(event) => setMaxBid(event.target.value)} inputMode="numeric" /></label></div><button className="button primary full" onClick={placeBid} disabled={auctionSeconds === 0}><Gavel size={16} /> {auctionSeconds === 0 ? "Auction ended" : `Activate proxy · ${money(Number(bidAmount) || 0)}`}</button><small className="bid-helper">Need more balance? Open E-wallet from the sidebar to add demo funds.</small><small className="bid-helper">Minimum increment ₱10 · automatic bids stop at your cap</small></div></section></div><div className="auction-lower-grid"><section className="panel"><div className="panel-header"><div><div className="eyebrow">Transparent by design</div><h2>Bid history</h2></div><span className="live-feed-label"><span className="live-dot teal" /> Live feed</span></div><div className="bid-timeline">{bidFeed.map((bid, index) => <div className={`bid-event ${index === 0 ? "leading" : ""}`} key={`${bid.initials}-${bid.amount}-${bid.time}`}><div className="timeline-line" /><span className={`mini-avatar ${index === 0 ? "coral-avatar" : ""}`}>{bid.initials}</span><div><strong>{money(bid.amount)}</strong><span>Bidder {bid.initials} · {bid.time}</span></div><em className={index === 0 ? "winning" : "outbid"}>{bid.status}</em></div>)}</div></section><section className="panel auction-notes"><div className="panel-header"><div><div className="eyebrow">Seller protection</div><h2>Good to know</h2></div><ShieldCheck size={19} className="teal-text" /></div><div className="note-row"><span className="note-icon teal"><Check size={15} /></span><div><strong>Reserve price met</strong><span>This item is eligible to win at auction close.</span></div></div><div className="note-row"><span className="note-icon coral"><Clock3 size={15} /></span><div><strong>Anti-snipe extension on</strong><span>A final-second bid adds 2 minutes for fair play.</span></div></div><div className="note-row"><span className="note-icon lavender"><MessageCircle size={15} /></span><div><strong>Ask the seller</strong><span>Start a private chat about condition or shipping.</span></div></div><div className="note-row"><span className="note-icon mustard"><Sparkles size={15} /></span><div><strong>Second chance offers</strong><span>If reserve is not met, the next eligible bidder can receive an offer.</span></div></div><div className="note-row"><span className="note-icon teal"><RefreshCcw size={15} /></span><div><strong>Relist ready</strong><span>Unsold inventory can be relisted in one click after close.</span></div></div><button className="button secondary full"><MessageCircle size={15} /> Open live chat</button></section></div></div>;
}

function OrdersView({ deliveryStatuses, changeOrderStatus }: { deliveryStatuses: Record<string, OrderStatus>; changeOrderStatus: (id: string, status: OrderStatus) => void }) {
  const tabs = ["All orders", "Needs action", "In transit", "Delivered"];
  const [tab, setTab] = useState("All orders");
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const filtered = orders.filter((order) => tab === "All orders" || (tab === "Needs action" ? ["Processing", "Rider assigned", "Disputed"].includes(order.status) : tab === "In transit" ? ["Rider assigned", "Picked up", "In transit"].includes(order.status) : order.status === "Delivered"));
  return <div className="section-stack"><div className="toolbar-row"><div className="filter-tabs">{tabs.map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}{item === "Needs action" && <span className="tab-count">3</span>}</button>)}</div><button className="button secondary"><Filter size={15} /> Filter orders</button></div><div className="order-kpis"><MetricCard label="Gross order value" value="₱128,420" delta="+12.8%" detail="this month" tone="teal" icon={WalletCards} /><MetricCard label="Average delivery" value="1.8d" delta="-0.3d" detail="vs. last month" tone="coral" icon={Clock3} /><MetricCard label="Escrow held" value="₱42,780" delta="18 orders" detail="released on delivery" tone="lavender" icon={ShieldCheck} /></div><section className="panel table-panel"><div className="panel-header"><div><div className="eyebrow">Order queue</div><h2>{filtered.length} orders in view</h2></div></div><div className="responsive-table"><table><thead><tr><th>Order</th><th>Customer / item</th><th>Amount</th><th>Status</th><th>Tracking</th><th>Delivery / rider</th><th /></tr></thead><tbody>{filtered.map((order) => { const status = deliveryStatuses[order.id] ?? order.status; const rider = assignments[order.id] ?? order.rider ?? "Unassigned"; return <tr key={order.id}><td><strong className="mono">{order.id}</strong><span className="table-sub">{order.payment} payment</span></td><td><strong>{order.customer}</strong><span className="table-sub">{order.item}</span></td><td><strong>{money(order.amount)}</strong><span className="table-sub">Escrow protected</span></td><td><StatusBadge status={status} /></td><td><strong className="mono">{order.tracking}</strong><span className="table-sub">Live tracking</span></td><td><div className="delivery-cell"><span>{order.location}</span><small>{order.eta}</small><select className="assignment-select" value={rider} onChange={(event) => { setAssignments((current) => ({ ...current, [order.id]: event.target.value })); toast.success(`${order.id} rider updated`, { description: event.target.value }); }}><option>Unassigned</option><option>Paolo R.</option><option>Nina C.</option><option>Marc D.</option></select></div></td><td><button className="icon-button"><MoreHorizontal size={17} /></button></td></tr>; })}</tbody></table></div></section><div className="order-note"><div className="note-icon teal"><ShieldCheck size={15} /></div><div><strong>Escrow is active on all online payments.</strong><span>Funds release when the buyer confirms delivery or the protection window closes.</span></div><button className="text-button">Learn about escrow <ChevronRight size={14} /></button></div></div>;
}

function RiderDesk({ online, setOnline, deliveryStatuses, changeOrderStatus, authUser, riderOrders }: { online: boolean; setOnline: (value: boolean) => void; deliveryStatuses: Record<string, OrderStatus>; changeOrderStatus: (id: string, status: OrderStatus) => void; authUser: AuthUser | null | undefined; riderOrders: any[] }) {
  const [acceptedOrder, setAcceptedOrder] = useState<any>(riderOrders.find((order) => order.status === "Rider assigned") ?? null);
  const [position, setPosition] = useState<[number, number]>([6.228, 125.068]);
  const [moving, setMoving] = useState(false);
  useEffect(() => { if (!acceptedOrder || !navigator.geolocation) return; let last: [number, number] | null = null; const watcher = navigator.geolocation.watchPosition((current) => { const next: [number, number] = [current.coords.latitude, current.coords.longitude]; const moved = !!last && Math.abs(next[0] - last[0]) + Math.abs(next[1] - last[1]) > 0.00001; last = next; setPosition(next); setMoving(moved); fetch("/api/rider/location", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ latitude: next[0], longitude: next[1], accuracy: current.coords.accuracy, moving: moved }) }).catch(() => undefined); }, () => toast.error("Location permission is needed for live rider tracking"), { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }); return () => navigator.geolocation.clearWatch(watcher); }, [acceptedOrder]);
  const accept = async (orderId: string) => { const response = await fetch(`/api/orders/${orderId}/accept`, { method: "POST" }); const payload = await response.json(); if (!response.ok) { toast.error(payload.error ?? "Unable to accept delivery"); return; } setAcceptedOrder(payload.order); toast.success("Delivery accepted", { description: "Location tracking is now active after permission is granted." }); };
  const visibleOrders = riderOrders.length ? riderOrders : orders.filter((order) => order.status !== "Delivered").slice(0, 3).map((order) => ({ orderId: order.id, item: order.item, customer: order.customer, province: "South Cotabato", municipality: "Polomolok", status: "Processing" }));
  return <div className="section-stack"><div className="rider-hero"><div><div className="eyebrow teal-text"><span className="live-dot teal" /> Rider network · {online ? "Live" : "Paused"}</div><h2>Live delivery control.</h2><p>Accept a delivery to start browser geolocation. The map updates when your device reports movement.</p></div><div className="availability-control"><div className="profile-avatar rider-avatar">MR</div><div><strong>{authUser?.name ?? "MerchantHub Rider"}</strong><span>rider@gmail.com · South Cotabato</span></div><button className={`switch ${online ? "on" : ""}`} onClick={() => setOnline(!online)} aria-label="Toggle rider availability"><span /></button></div></div><div className="rider-grid"><section className="panel map-panel"><div className="panel-header"><div><div className="eyebrow">Leaflet live geolocation</div><h2>{acceptedOrder ? "Tracking accepted order" : "Waiting for accepted delivery"}</h2></div><span className="location-chip"><span className={`live-dot ${moving ? "teal" : ""}`} /> {moving ? "Moving now" : "Stationary"}</span></div><RiderLeafletMap position={position} /><div className="map-footer"><span><span className="legend-dot teal" /> Rider position</span><span>{acceptedOrder ? `${acceptedOrder.province ?? "South Cotabato"} · ${acceptedOrder.municipality ?? "Polomolok"}` : "Accept an order to begin"}</span></div></section><section className="panel delivery-queue"><div className="panel-header"><div><div className="eyebrow">Available deliveries</div><h2>{visibleOrders.length} orders</h2></div><span className="queue-count">Rider only</span></div>{visibleOrders.map((order: any, index: number) => <div className="delivery-card" key={order.orderId ?? order.id}><div className="stop-index">0{index + 1}</div><div className="delivery-card-main"><div className="delivery-title"><strong>{order.item}</strong><StatusBadge status={order.status === "Processing" ? "Processing" : "Rider assigned"} /></div><span>{order.customer ?? "Buyer"} · {order.province ?? "South Cotabato"} · {order.municipality ?? "Polomolok"}</span><small><MapPinned size={13} /> Buyer location is visible after checkout</small></div>{order.status === "Processing" && <button className="queue-action" onClick={() => accept(order.orderId ?? order.id)}>Accept</button>}</div>)}</section></div></div>;
}
function RiderLeafletMap({ position }: { position: [number, number] }) {
  const element = useRef<HTMLDivElement | null>(null); const map = useRef<L.Map | null>(null); const marker = useRef<L.Marker | null>(null);
  useEffect(() => { if (!element.current || map.current) return; map.current = L.map(element.current).setView(position, 13); L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap contributors" }).addTo(map.current); const arrow = L.divIcon({ className: "rider-arrow-marker", html: "➤", iconSize: [28, 28], iconAnchor: [14, 14] }); marker.current = L.marker(position, { icon: arrow }).addTo(map.current).bindPopup("MerchantHub rider"); return () => { map.current?.remove(); map.current = null; }; }, []);
  useEffect(() => { marker.current?.setLatLng(position); map.current?.panTo(position); }, [position]);
  return <div className="leaflet-rider-map" ref={element} />;
}
function InventoryView({ listings: ownedListings, initialTab, onConvert, onRefresh }: { listings: Listing[]; initialTab: "official" | "draft" | "deleted"; onConvert: () => void; onRefresh: () => void }) {
  const [tab, setTab] = useState<"official" | "draft" | "deleted">(initialTab); const visible = ownedListings.filter((item) => (item.lifecycle ?? "official") === tab);
  const update = async (listing: Listing, lifecycle: "draft" | "official" | "deleted") => { const response = await fetch(`/api/listings/${listing.id}`, { method: lifecycle === "deleted" ? "DELETE" : "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lifecycle }) }); const payload = await response.json(); if (!response.ok) { toast.error(payload.error ?? "Unable to update listing"); return; } toast.success(lifecycle === "official" ? "Listing is now official" : lifecycle === "deleted" ? "Moved to recycle bin" : "Listing saved as draft"); onRefresh(); };
  return <div className="section-stack"><div className="inventory-banner"><div className="inventory-banner-icon"><Sparkles size={20} /></div><div><strong>Your seller inventory.</strong><span>Only listings created by your account appear here. Official listings are visible in Marketplace; drafts stay private.</span></div><button className="button dark" onClick={onConvert}><Gavel size={15} /> Create auction draft</button></div><section className="panel inventory-cards-panel"><div className="panel-header"><div><div className="eyebrow">Seller-owned listings</div><h2>{visible.length} {tab} listings</h2></div><div className="filter-tabs">{(["official", "draft", "deleted"] as const).map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item === "deleted" ? "Recycle bin" : item}</button>)}</div></div>{visible.length ? <div className="inventory-card-grid">{visible.map((listing) => <article className="inventory-card" key={listing.id}><div className="inventory-card-image"><img src={listing.image || listings[0].image} alt={listing.title} /><span className="status-badge">{tab}</span></div><div className="inventory-card-body"><div className="inventory-card-top"><span>{listing.category}</span><span>{listing.type}</span></div><h3>{listing.title}</h3><p className="field-help">{listing.description}</p>{listing.auctionEndAt && <small className="field-help">Ends {new Date(listing.auctionEndAt).toLocaleString("en-PH")}</small>}<div className="inventory-manage-actions">{tab === "draft" && <button className="button primary" onClick={() => update(listing, "official")}>Make official</button>}{tab === "official" && <button className="button secondary" onClick={() => update(listing, "draft")}>Move to draft</button>}{tab !== "deleted" && <button className="button secondary" onClick={() => update(listing, "deleted")}>Delete listing</button>}{tab === "deleted" && <button className="button secondary" onClick={() => update(listing, "draft")}>Restore draft</button>}</div></div></article>)}</div> : <div className="empty-state"><Boxes size={22} /><strong>No {tab} listings</strong><span>Create a listing to manage it here.</span></div>}</section></div>;
}

function MessagesView() {
  const [active, setActive] = useState("mika");
  const [draft, setDraft] = useState("");
  const [sentMessages, setSentMessages] = useState<Record<string, string[]>>({});
  const conversations = [
    { id: "mika", initials: "MS", name: "Mika Santos", subject: "Sony WH-1000XM5", preview: "Can you ship to Davao?", time: "8m", image: listings[0].image, bid: 8450, received: ["Hi! Is the warranty still valid, and can you ship to Davao City?", "That works for me. I’m watching the auction now. Thanks!"], reply: "Hi Mika — yes, it has 11 months left. Shipping to Davao is ₱180 via our rider network." },
    { id: "luna", initials: "LC", name: "Luna Clay", subject: "Ceramic Set", preview: "Your order is packed.", time: "1h", image: listings.find((item) => item.id === "ceramic-set")?.image ?? listings[0].image, bid: 2400, received: ["Your order is packed and ready for pickup.", "I’ll send the tracking number once the rider accepts it."], reply: "Thanks Luna — please send the tracking details when ready." },
    { id: "jessa", initials: "JN", name: "Jessa Navarro", subject: "Fujifilm X100V", preview: "Is the reserve price met?", time: "3h", image: listings.find((item) => item.id === "fujifilm-x100")?.image ?? listings[0].image, bid: 43100, received: ["Is the reserve price met?", "I’m considering placing a proxy bid before the auction ends."], reply: "The reserve status is shown on the auction page." },
  ];
  const selected = conversations.find((item) => item.id === active) ?? conversations[0];
  const sendMessage = () => { if (!draft.trim()) return; setSentMessages((current) => ({ ...current, [active]: [...(current[active] ?? []), draft.trim()] })); setDraft(""); toast.success("Message sent", { description: `${selected.name} will see your reply in this conversation.` }); };
  return <div className="message-layout"><section className="panel conversation-list"><div className="panel-header"><div><div className="eyebrow">Inbox</div><h2>{conversations.length} conversations</h2></div><button className="icon-button"><Plus size={18} /></button></div><label className="inbox-search"><Search size={15} /><input placeholder="Search messages" /></label>{conversations.map((item) => <button className={`conversation-item ${active === item.id ? "active" : ""}`} onClick={() => { setActive(item.id); setDraft(""); }} key={item.id}><span className="mini-avatar">{item.initials}</span><span><strong>{item.name}</strong><small>{item.subject}</small><em>{item.preview}</em></span><time>{item.time}</time>{item.id === "mika" && <i />}</button>)}</section><section className="panel chat-panel"><div className="chat-header"><div className="profile-avatar">{selected.initials}</div><div><strong>{selected.name}</strong><span>About {selected.subject} · <span className="teal-text">online</span></span></div><button className="icon-button"><MoreHorizontal size={18} /></button></div><div className="chat-body"><div className="chat-day">Today</div>{selected.received.map((message, index) => <div className="chat-bubble received" key={`${selected.id}-received-${index}`}>{message}<time>{index ? "10:24 AM" : "10:21 AM"}</time></div>)}<div className="chat-bubble sent">{selected.reply}<time>10:23 AM</time></div><div className="product-preview"><img src={selected.image} alt="" /><div><strong>{selected.subject}</strong><span>Current value · {money(selected.bid)}</span></div><button className="text-button">Open listing <ChevronRight size={14} /></button></div>{(sentMessages[active] ?? []).map((message, index) => <div className="chat-bubble sent" key={`${active}-${message}-${index}`}>{message}<time>just now</time></div>)}</div><div className="chat-compose"><button className="icon-button"><Plus size={17} /></button><input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") sendMessage(); }} placeholder={`Write to ${selected.name}...`} /><button className="send-button" onClick={sendMessage} aria-label="Send message"><Send size={16} /></button></div></section></div>;
}
function SavedView({ favoriteIds, toggleFavorite }: { favoriteIds: string[]; toggleFavorite: (id: string) => void }) {
  const savedListings = listings.filter((listing) => favoriteIds.includes(listing.id));
  return <div className="section-stack"><div className="saved-summary"><div className="saved-summary-icon"><Heart size={19} fill="currentColor" /></div><div><strong>{savedListings.length} saved items</strong><span>We’ll alert you when prices drop or stock changes.</span></div><button className="button secondary" onClick={() => toast.success("Saved search manager opened")}><Bookmark size={15} /> Manage searches</button></div><div className="saved-grid">{savedListings.map((listing) => <ListingCard key={listing.id} listing={listing} favorite onFavorite={() => toggleFavorite(listing.id)} onClick={() => window.location.assign(`/item/${listing.id}`)} onAddToCart={listing.buyNow ? () => toast.success(`${listing.title} added to cart`) : undefined} />)}</div><section className="panel saved-search-panel"><div className="panel-header"><div><div className="eyebrow">Automated discovery</div><h2>Saved searches</h2></div><button className="button secondary" onClick={() => toast.success("Saved search created", { description: "Add filters to start receiving matches." })}><Plus size={15} /> New search</button></div><div className="saved-search-row"><div className="saved-search-icon small"><Search size={16} /></div><div><strong>“camera mirrorless under ₱50,000”</strong><span>2 new listings this week · notify in-app + email</span></div><span className="saved-search-status">Active</span><button className="icon-button"><MoreHorizontal size={17} /></button></div><div className="saved-search-row"><div className="saved-search-icon small"><Tags size={16} /></div><div><strong>“handmade homeware”</strong><span>5 matching listings · last checked today</span></div><span className="saved-search-status">Active</span><button className="icon-button"><MoreHorizontal size={17} /></button></div></section></div>;
}


const paymentCurrencies = {
  PHP: { code: "PHP", symbol: "₱", rate: 1, locale: "en-PH" },
} as const;
type PaymentCurrency = keyof typeof paymentCurrencies;
type GeneratedLabel = { labelId: string; orderId: string; tracking: string; carrier: string; service: string; destination: string; packageType: string; weightKg: number; labelUrl: string };
type PaymentRecord = { id: string; sessionId: string; item: string; amountMinor: number; currency: string; status: string; customerName: string; createdAt: string };

function formatGatewayAmount(value: number, currency: PaymentCurrency) {
  const details = paymentCurrencies[currency];
  return new Intl.NumberFormat(details.locale, { style: "currency", currency: details.code, maximumFractionDigits: 2 }).format(value * details.rate);
}

function PaymentCenter() {
  const [currency, setCurrency] = useState<PaymentCurrency>("PHP");
  const [checkoutState, setCheckoutState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [checkoutMessage, setCheckoutMessage] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState(orders[0].id);
  const [carrier, setCarrier] = useState("Ninja Van");
  const [service, setService] = useState("Next day");
  const [packageType, setPackageType] = useState("Small parcel");
  const [destination, setDestination] = useState("Davao City");
  const [weightKg, setWeightKg] = useState("1.2");
  const [labelState, setLabelState] = useState<"idle" | "loading" | "error">("idle");
  const [labelMessage, setLabelMessage] = useState("");
  const [lastLabel, setLastLabel] = useState<GeneratedLabel | null>(null);
  const [generatedLabels, setGeneratedLabels] = useState<GeneratedLabel[]>([]);
  const [paymentHistory, setPaymentHistory] = useState<PaymentRecord[]>([]);
  const selectedOrder = orders.find((order) => order.id === selectedOrderId) ?? orders[0];
  const amount = selectedOrder.amount;
  const currencyDetails = paymentCurrencies[currency];

  const loadPaymentHistory = async () => {
    try {
      const response = await fetch("/api/payments/history");
      const data = await response.json() as { ok?: boolean; payments?: PaymentRecord[] };
      if (response.ok && data.ok) setPaymentHistory(data.payments ?? []);
    } catch {
      setPaymentHistory([]);
    }
  };

  useEffect(() => { void loadPaymentHistory(); }, []);

  const startCheckout = async () => {
    const checkoutWindow = window.open("about:blank", "_blank", "noopener,noreferrer");
    setCheckoutState("loading");
    setCheckoutMessage("");
    try {
      const response = await fetch("/api/payments/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: selectedOrder.id, currency: currency.toLowerCase(), customerEmail: "alex@example.com", customerName: "Alex Rivera" }) });
      const data = await response.json() as { ok?: boolean; checkoutUrl?: string; error?: string };
      if (!response.ok || !data.checkoutUrl) throw new Error(data.error ?? "Checkout could not be created");
      if (checkoutWindow) checkoutWindow.location.href = data.checkoutUrl;
      setCheckoutState("success");
      await loadPaymentHistory();
      setCheckoutMessage(`Secure ${currencyDetails.code} checkout opened in a new tab.`);
    } catch (error) {
      checkoutWindow?.close();
      setCheckoutState("error");
      setCheckoutMessage(error instanceof Error ? error.message : "Payment gateway is temporarily unavailable");
    }
  };

  const generateLabel = async () => {
    setLabelState("loading");
    setLabelMessage("");
    try {
      const response = await fetch("/api/shipping/labels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: selectedOrder.id, destination, carrier, service, packageType, weightKg: Number(weightKg) }) });
      const data = await response.json() as GeneratedLabel & { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Label could not be generated");
      setLastLabel(data);
      setGeneratedLabels((current) => [data, ...current.filter((label) => label.labelId !== data.labelId)]);
      setLabelState("idle");
      setLabelMessage(`${data.tracking} is ready to print.`);
      toast.success("Shipping label generated", { description: `${data.carrier} · ${data.service} · ${data.tracking}` });
    } catch (error) {
      setLabelState("error");
      setLabelMessage(error instanceof Error ? error.message : "Shipping service is temporarily unavailable");
    }
  };

  return <div className="section-stack payment-center">
    <div className="payments-hero"><div><div className="eyebrow"><span className="live-dot teal" /> Stripe sandbox connected</div><h2>Collect in Philippine pesos. Ship from one control room.</h2><p>Payments, orders, and shipping labels are configured for the Philippines.</p></div><div className="payments-hero-mark"><Globe2 size={30} /><strong>₱</strong><span>PHP only</span></div></div>
    <div className="payment-grid">
      <section className="panel checkout-panel"><div className="panel-header"><div><div className="eyebrow">Gateway checkout</div><h2>Take a secure payment</h2></div><span className="sandbox-badge"><CircleCheckBig size={13} /> Test mode</span></div><div className="checkout-product"><img src={listings[0].image} alt="" /><div><strong>{selectedOrder.item}</strong><span>{selectedOrder.id} · Escrow protected</span></div><b>{formatGatewayAmount(amount, currency)}</b></div><label className="field-label">Order to collect<select value={selectedOrderId} onChange={(event) => setSelectedOrderId(event.target.value)}>{orders.filter((order) => order.status !== "Delivered").map((order) => <option value={order.id} key={order.id}>{order.id} · {order.item}</option>)}</select></label><div className="currency-heading"><span className="field-label">Settlement currency</span><span className="currency-rate">1 PHP ≈ {currencyDetails.rate.toFixed(4)} {currency}</span></div><div className="currency-grid">{(Object.keys(paymentCurrencies) as PaymentCurrency[]).map((item) => <button key={item} className={`currency-option ${currency === item ? "active" : ""}`} onClick={() => setCurrency(item)}><strong>{paymentCurrencies[item].symbol}</strong><span>{item}</span></button>)}</div><div className="checkout-summary"><span>Order subtotal <b>{formatGatewayAmount(amount, currency)}</b></span><span>Gateway <b>Stripe Checkout</b></span><span>Promotion codes <b className="teal-text">Enabled</b></span><strong>Total <b>{formatGatewayAmount(amount, currency)}</b></strong></div><button className="button primary full" onClick={startCheckout} disabled={checkoutState === "loading"}><CreditCard size={16} />{checkoutState === "loading" ? "Creating secure checkout…" : `Pay ${formatGatewayAmount(amount, currency)}`} <ExternalLink size={14} /></button>{checkoutMessage && <div className={`inline-feedback ${checkoutState === "error" ? "error" : "success"}`}>{checkoutState === "error" ? <AlertCircle size={14} /> : <CircleCheckBig size={14} />}<span>{checkoutMessage}</span></div>}<p className="checkout-note">Test card: <strong>4242 4242 4242 4242</strong> · any future date · any CVC</p></section>
      <section className="panel label-generator-panel"><div className="panel-header"><div><div className="eyebrow">Automated fulfillment</div><h2>Generate a shipping label</h2></div><Printer size={19} className="teal-text" /></div><label className="field-label">Paid order<select value={selectedOrderId} onChange={(event) => setSelectedOrderId(event.target.value)}>{orders.map((order) => <option value={order.id} key={order.id}>{order.id} · {order.customer}</option>)}</select></label><div className="field-two"><label className="field-label">Carrier<select value={carrier} onChange={(event) => setCarrier(event.target.value)}><option>Ninja Van</option><option>J&amp;T Express</option><option>LBC Express</option><option>GrabExpress</option></select></label><label className="field-label">Service<select value={service} onChange={(event) => setService(event.target.value)}><option>Next day</option><option>Standard</option><option>Same day</option></select></label></div><div className="field-two"><label className="field-label">Package<select value={packageType} onChange={(event) => setPackageType(event.target.value)}><option>Small parcel</option><option>Box</option><option>Document pouch</option><option>Large parcel</option></select></label><label className="field-label">Weight (kg)<input value={weightKg} onChange={(event) => setWeightKg(event.target.value)} inputMode="decimal" /></label></div><label className="field-label">Destination<input value={destination} onChange={(event) => setDestination(event.target.value)} placeholder="City or delivery hub" /></label><button className="button dark full" onClick={generateLabel} disabled={labelState === "loading"}><Package size={16} />{labelState === "loading" ? "Generating label…" : "Generate label"}<Printer size={14} /></button>{labelMessage && <div className={`inline-feedback ${labelState === "error" ? "error" : "success"}`}>{labelState === "error" ? <AlertCircle size={14} /> : <CircleCheckBig size={14} />}<span>{labelMessage}</span></div>}{lastLabel && <div className="label-result"><div className="label-result-icon"><Package size={17} /></div><div><strong>{lastLabel.tracking}</strong><span>{lastLabel.carrier} · {lastLabel.service} · {lastLabel.weightKg} kg</span></div><a className="button secondary tiny" href={lastLabel.labelUrl} target="_blank" rel="noreferrer"><Download size={13} /> Print</a></div>}</section>
    </div>
    <div className="payments-lower-grid"><section className="panel"><div className="panel-header"><div><div className="eyebrow">Payment history</div><h2>Recent gateway activity</h2></div></div><div className="payment-history">{paymentHistory.length ? paymentHistory.map((payment) => { const paymentCurrency = (payment.currency in paymentCurrencies ? payment.currency : "PHP") as PaymentCurrency; return <div className="payment-history-row" key={payment.sessionId}><span className="payment-method-icon"><CreditCard size={15} /></span><div><strong>{payment.item}</strong><span>{payment.id} · {new Date(payment.createdAt).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}</span></div><b>{formatGatewayAmount(payment.amountMinor / 100 / paymentCurrencies[paymentCurrency].rate, paymentCurrency)}<small>{payment.currency}</small></b><span className={`status-badge ${payment.status}`}><span />{payment.status}</span></div>; }) : <div className="empty-labels"><CreditCard size={21} /><strong>No gateway records yet</strong><span>Create a test checkout to populate durable payment history.</span></div>}</div></section><section className="panel"><div className="panel-header"><div><div className="eyebrow">Generated labels</div><h2>{generatedLabels.length || 12} labels this week</h2></div><span className="trend-badge"><ArrowUpRight size={13} /> 18.4%</span></div>{generatedLabels.length ? <div className="generated-label-list">{generatedLabels.map((label) => <div className="generated-label-row" key={label.labelId}><span className="payment-method-icon"><Printer size={15} /></span><div><strong>{label.tracking}</strong><span>{label.orderId} · {label.destination}</span></div><a href={label.labelUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /></a></div>)}</div> : <div className="empty-labels"><Printer size={21} /><strong>Labels appear here after generation</strong><span>Every label includes a tracking number and printable SVG.</span></div>}</section></div>
  </div>;
}

function AdminView() {
  const [reviewed, setReviewed] = useState<string[]>([]);
  const userRows = [{ name: "Mika Santos", role: "Buyer", status: "Active" }, { name: "North Star Cameras", role: "Seller", status: "Verified" }, { name: "Theo Cruz", role: "Buyer", status: "Pending" }, { name: "Paolo Rivera", role: "Rider", status: "Active" }];
  const review = (title: string) => { setReviewed((current) => [...current, title]); toast.success("Queue item reviewed", { description: title }); };
  return <div className="section-stack"><div className="admin-alert"><div className="note-icon mustard"><ShieldCheck size={15} /></div><div><strong>3 items need your review.</strong><span>Keep the marketplace trusted by clearing the moderation queue today.</span></div><button className="button dark" onClick={() => toast.success("Moderation queue opened")}>Review queue <ChevronRight size={15} /></button></div><div className="admin-grid"><MetricCard label="Active members" value="4,892" delta="+8.4%" detail="this month" tone="teal" icon={Users} /><MetricCard label="Pending reviews" value="18" delta="3 urgent" detail="moderation queue" tone="mustard" icon={ClipboardCheck} /><MetricCard label="Cancellation requests" value="6" delta="-2 today" detail="awaiting admin" tone="coral" icon={RefreshCcw} /><MetricCard label="Trust score" value="98.2%" delta="+1.2%" detail="system average" tone="lavender" icon={ShieldCheck} /></div><div className="admin-lower"><section className="panel table-panel"><div className="panel-header"><div><div className="eyebrow">Needs attention</div><h2>Moderation queue</h2></div><button className="text-button" onClick={() => toast.success("All moderation items loaded")}>View all <ChevronRight size={15} /></button></div><div className="moderation-list"><ModerationRow title="Bid cancellation request" detail="Bidder MS · Sony WH-1000XM5 · #BC-103" time="8m ago" tone="coral" reviewed={reviewed.includes("Bid cancellation request")} onReview={() => review("Bid cancellation request")} /><ModerationRow title="Listing image review" detail="Fujifilm X100V Silver · seller North Star Cameras" time="32m ago" tone="mustard" reviewed={reviewed.includes("Listing image review")} onReview={() => review("Listing image review")} /><ModerationRow title="Second chance offer expired" detail="Vintage Walnut Record Player · offer #SC-018" time="1h ago" tone="lavender" reviewed={reviewed.includes("Second chance offer expired")} onReview={() => review("Second chance offer expired")} /></div></section><section className="panel system-panel"><div className="panel-header"><div><div className="eyebrow">System health</div><h2>Services</h2></div><span className="status-dot-label"><span className="live-dot teal" /> All good</span></div>{["Payments & escrow", "Notifications", "Live bid feed", "Rider geolocation"].map((label) => <div className="system-row" key={label}><span>{label}</span><strong><span className="tiny-check"><Check size={11} /></span> Operational</strong></div>)}<button className="button secondary full" onClick={() => toast.success("System analytics opened")}>Open system analytics <ChevronRight size={15} /></button></section></div><section className="panel user-status-panel"><div className="panel-header"><div><div className="eyebrow">Account control</div><h2>User status</h2></div><button className="text-button" onClick={() => toast.success("User directory opened")}>Manage users <ChevronRight size={15} /></button></div><div className="user-status-grid">{userRows.map((user) => <div className="user-status-row" key={user.name}><span className="mini-avatar">{user.name.slice(0, 2).toUpperCase()}</span><div><strong>{user.name}</strong><span>{user.role}</span></div><select value={user.status} onChange={(event) => toast.success(`${user.name} marked ${event.target.value}`)}><option>Active</option><option>Verified</option><option>Pending</option><option>Suspended</option></select></div>)}</div></section></div>;
}

function MetricCard({ label, value, delta, detail, tone, icon: Icon }: { label: string; value: string; delta: string; detail: string; tone: Tone; icon: typeof Activity }) {
  return <div className={`metric-card ${tone}`}><div className="metric-top"><span>{label}</span><span className="metric-icon"><Icon size={16} /></span></div><strong>{value}</strong><div className="metric-bottom"><span className={delta.startsWith("-") ? "delta negative" : "delta"}><ArrowUpRight size={13} /> {delta}</span><small>{detail}</small></div></div>;
}

function ListingCard({ listing, favorite, onFavorite, onClick, onAddToCart }: { listing: Listing; favorite: boolean; onFavorite: () => void; onClick?: () => void; onAddToCart?: () => void }) {
  return <article className={`listing-card ${onClick ? "is-tappable" : ""}`} onClick={onClick}><button className="listing-image" onClick={(event) => { event.stopPropagation(); onClick?.(); }}><img src={listing.image} alt={listing.title} /><span className={`listing-type ${listing.type === "Auction" || listing.type === "Both" ? "auction-type" : "buy-type"}`}>{listing.type === "Auction" || listing.type === "Both" ? <Gavel size={12} /> : <ShoppingBag size={12} />}{listing.type}</span><span className="listing-condition">{listing.condition}</span></button><div className="listing-card-body"><div className="listing-card-meta"><span>{listing.category}</span><button className={`favorite-button ${favorite ? "is-favorite" : ""}`} onClick={(event) => { event.stopPropagation(); onFavorite(); }} aria-label={favorite ? "Remove from saved" : "Save item"}><Heart size={17} fill={favorite ? "currentColor" : "none"} /></button></div><h3>{listing.title}</h3><div className="listing-seller"><span className="mini-avatar">{listing.seller.slice(0, 2).toUpperCase()}</span>{listing.seller}<Star size={12} fill="currentColor" /><strong>{listing.sellerRating}</strong></div><div className="listing-price-row"><div><span>{listing.currentBid ? "Current bid" : "Price"}</span><strong>{money(listing.currentBid ?? listing.price)}</strong></div>{listing.currentBid ? <div className="listing-countdown"><Clock3 size={13} /><span>{listing.timeLeft}</span></div> : <span className="stock-label">{listing.stock} in stock</span>}</div>{onAddToCart && <button className="mini-action" onClick={(event) => { event.stopPropagation(); onAddToCart(); }}><ShoppingBag size={13} /> Add to cart · {money(listing.buyNow ?? listing.price)}</button>}</div></article>;
}

function ActivityRow({ item, read }: { item: ActivityItem; read: boolean }) {
  return <div className={`activity-row ${read ? "read" : ""}`}><span className={`mini-avatar ${item.tone}-avatar`}>{item.initials}</span><div><strong>{item.title}</strong><span>{item.meta}</span></div><time>{item.time}</time>{!read && <i />}</div>;
}

function PulseStat({ icon: Icon, label, value, meta, tone }: { icon: typeof Truck; label: string; value: string; meta: string; tone: Tone }) {
  return <div className="pulse-stat"><span className={`pulse-icon ${tone}`}><Icon size={15} /></span><div><span>{label}</span><strong>{value}</strong><small>{meta}</small></div></div>;
}

function MiniChart() {
  return <div className="mini-chart"><div className="chart-line" /><div className="chart-fill" /><span className="chart-point point-a" /><span className="chart-point point-b" /><span className="chart-point point-c" /><span className="chart-point point-d" /></div>;
}

function StatusBadge({ status }: { status: string }) {
  const tone = status.toLowerCase().replaceAll(" ", "-");
  return <span className={`status-badge ${tone}`}><span />{status}</span>;
}

function ModerationRow({ title, detail, time, tone, reviewed, onReview }: { title: string; detail: string; time: string; tone: Tone; reviewed: boolean; onReview: () => void }) {
  return <div className="moderation-row"><span className={`note-icon ${tone}`}><AlertCircle size={15} /></span><div><strong>{title}</strong><span>{detail}</span></div><time>{time}</time>{reviewed ? <span className="reviewed-label"><Check size={12} /> Reviewed</span> : <button className="button tiny secondary" onClick={onReview}>Review</button>}</div>;
}
