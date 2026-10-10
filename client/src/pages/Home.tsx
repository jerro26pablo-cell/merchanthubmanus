import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { toast } from "sonner";
import { useLocation } from "wouter";
import {
  Activity,
  AlertCircle,
  ArrowDownRight,
  ArrowLeftRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  Bookmark,
  Boxes,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  CircleCheckBig,
  CreditCard,
  ClipboardCheck,
  Clock3,
  Eye,
  EyeOff,
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
import { philippineDateTimeToUtcIso, utcIsoToPhilippineDateTime } from "@/data/auctionDateTime";
import { filterRiderOrders, riderQueueFilters, type RiderQueueFilter } from "@/data/riderQueue";

type AuthUser = { id: number; name: string; email: string; role: "user" | "admin" | "rider"; province?: string | null; municipality?: string | null; walletCents: number; storeName?: string | null; storeImage?: string | null; sellerEnabled?: boolean; sellerApplicationStatus?: "none" | "pending" | "approved" | "denied" };
type Section = "overview" | "wallet" | "marketplace" | "live" | "auction" | "detail" | "compare" | "checkout" | "order-detail" | "orders" | "payments" | "rider" | "inventory" | "store" | "messages" | "saved" | "bidding" | "admin" | "seller-applications" | "manage-users";
type Tone = "coral" | "teal" | "mustard" | "lavender" | "ink";
type AppNotification = { id: string; label: string; time: string; tone: Tone; message?: string; entityId?: string; type?: string };
type OverviewMetrics = { grossSalesCents: number; liveAuctions: number; ordersInTransit: number; availableStock: number; skuCount: number };
type InventoryTab = "official" | "draft" | "auction-ended" | "sold" | "canceled" | "deleted";
type SecondChanceOffer = { bidId: number; listingId: string; amountCents: number; title: string; category: string };
type BidFeedItem = { id: number; bidder: string; initials: string; amount: number; time: string; status: string; isCurrentUser: boolean; cancellationReason?: string | null };
type AuctionDeliveryDetails = { phone: string; province: string; municipality: string; addressDetails: string; latitude: number; longitude: number; autoCheckoutConsent: true };
const toBidFeedItems = (rows: any[]): BidFeedItem[] => rows.map((row) => {
  const bidder = String(row.bidder ?? "Bidder");
  const bidderNumber = bidder.match(/^Bidder (\d+)$/)?.[1];
  const initials = bidder === "You" ? "You" : bidderNumber ? `B${bidderNumber}` : bidder.split(" ").map((part: string) => part[0]).join("").slice(0, 2).toUpperCase();
  return { id: Number(row.id), bidder, initials, amount: Math.round(Number(row.amountCents ?? row.currentBidCents ?? 0) / 100), time: new Date(row.createdAt).toLocaleString("en-PH", { dateStyle: "short", timeStyle: "short" }), status: String(row.displayStatus ?? (row.status === "active" ? "Winning" : row.status === "won" ? "Winner" : "Outbid")), isCurrentUser: Boolean(row.isCurrentUser), cancellationReason: row.cancellationReason ?? null };
});

const isLiveAuctionListing = (listing: Listing) => {
  const type = String(listing.type ?? "").trim().toLowerCase();
  if (["deleted", "draft", "auction-ended", "sold", "canceled"].includes(listing.lifecycle ?? "") || (type !== "auction" && type !== "both")) return false;
  return (!listing.auctionStartAt || new Date(listing.auctionStartAt).getTime() <= Date.now()) && (!listing.auctionEndAt || new Date(listing.auctionEndAt).getTime() > Date.now());
};

const navGroups = [
  {
    label: "Workspace",
    items: [
      { id: "overview" as Section, label: "Overview", icon: LayoutDashboard },
      { id: "marketplace" as Section, label: "Marketplace", icon: Store },
      { id: "live" as Section, label: "Live auctions", icon: Gavel },
      { id: "bidding" as Section, label: "Bidding history", icon: Activity },
      { id: "orders" as Section, label: "Orders & logistics", icon: Truck },
      { id: "wallet" as Section, label: "E-wallet", icon: WalletCards },
    ],
  },
  {
    label: "Manage",
    items: [
      { id: "inventory" as Section, label: "Inventory", icon: Boxes },
      { id: "store" as Section, label: "My Store", icon: Store },
      { id: "messages" as Section, label: "Messages", icon: MessageCircle },
      { id: "saved" as Section, label: "Saved items & searches", icon: Heart },
    ],
  },
  {
    label: "Control room",
    items: [
      { id: "rider" as Section, label: "Rider desk", icon: MapPinned },
      { id: "seller-applications" as Section, label: "Seller applications", icon: ClipboardCheck },
      { id: "manage-users" as Section, label: "Manage users", icon: Users },
    ],
  },
];

const sectionFromPath = (path: string): Section => {
  if (path.startsWith("/auctions")) return "live";
  if (path.startsWith("/auction/")) return "auction";
  if (path.startsWith("/compare/")) return "compare";
  if (path.startsWith("/item/")) return "detail";
  if (path.startsWith("/checkout/")) return "checkout";
  if (path.startsWith("/order/")) return "order-detail";
  if (path.startsWith("/wallet")) return "wallet";
  if (path.startsWith("/marketplace")) return "marketplace";
  if (path.startsWith("/orders")) return "orders";
  if (path.startsWith("/payments")) return "payments";
  if (path.startsWith("/rider")) return "rider";
  if (path.startsWith("/inventory")) return "inventory";
  if (path.startsWith("/store")) return "store";
  if (path.startsWith("/messages")) return "messages";
  if (path.startsWith("/saved")) return "saved";
  if (path.startsWith("/bidding")) return "bidding";
  if (path.startsWith("/admin-dashboard")) return "admin";
  if (path.startsWith("/seller-applications")) return "seller-applications";
  if (path.startsWith("/manage-users")) return "manage-users";
  return "overview";
};

const money = (value: number) => `₱${value.toLocaleString("en-PH")}`;
async function readJson<T = any>(response: Response): Promise<T> { const text = await response.text(); try { return JSON.parse(text) as T; } catch { return {} as T; } }
const formatCountdown = (seconds: number) => `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
const compact = (value: number) => value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k` : `${value}`;
const titleForSection: Record<Section, string> = {
  overview: "Overview",
  wallet: "E-wallet",
  marketplace: "Marketplace",
  live: "Live auctions",
  auction: "Auction detail",
  detail: "Item detail",
  compare: "Compare items",
  checkout: "Checkout & delivery",
  "order-detail": "Order receipt",
  orders: "Orders & logistics",
  payments: "Payments & labels",
  rider: "Rider desk",
  inventory: "Inventory & analytics",
  store: "My Store",
  messages: "Messages",
  saved: "Saved items",
  bidding: "Bidding history",
  admin: "Admin & moderation",
  "seller-applications": "Seller applications",
  "manage-users": "Manage users",
};
const subtitleForSection: Record<Section, string> = {
  overview: "Here’s what’s moving across your marketplace today.",
  wallet: "Add demo funds for bids and monitor your available balance.",
  marketplace: "Compare, list, and discover what is worth bidding on.",
  live: "Watch the floor, compare momentum, and enter the right auction.",
  auction: "Follow live momentum and keep your max bid protected.",
  detail: "Review the item, choose your quantity, and check out with confidence.",
  compare: "Choose a similar listing, then compare both items side by side.",
  checkout: "Add delivery details before placing your order.",
  "order-detail": "Review the complete order receipt and delivery status.",
  orders: "Stay ahead of every handoff from payment to doorstep.",
  payments: "Collect globally, settle clearly, and ship every order with confidence.",
  rider: "A live view of the people and parcels in motion.",
  inventory: "Turn stock signals into the next smart move.",
  store: "Your public storefront with official listings only.",
  messages: "Keep buyer and seller conversations moving.",
  saved: "Your watchlist, saved searches, and price-drop alerts.",
  bidding: "Review the live auction timeline and your past bidding activity.",
  admin: "Review the moments that need a careful hand.",
  "seller-applications": "Review seller applications before seller tools are enabled.",
  "manage-users": "Deactivate marketplace accounts without deleting their history.",
};

export default function Home() {
  const [location, setLocation] = useLocation();
  const [activeSection, setActiveSection] = useState<Section>(() => sectionFromPath(location));
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [marketFilter, setMarketFilter] = useState("All items");
  const [marketProvince, setMarketProvince] = useState("");
  const [marketMunicipality, setMarketMunicipality] = useState("");
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [wishlistPriceChanges, setWishlistPriceChanges] = useState<Record<string, any[]>>({});
  const [followedStoreIds, setFollowedStoreIds] = useState<number[]>([]);
  const [readNotifications, setReadNotifications] = useState<string[]>(["n3"]);
  const [liveNotifications, setLiveNotifications] = useState<AppNotification[]>([]);
  const [secondChanceOffers, setSecondChanceOffers] = useState<SecondChanceOffer[]>([]);
  const [savedSearches, setSavedSearches] = useState<any[]>([]);
  const [activityItems, setActivityItems] = useState<ActivityItem[]>([]);
  const [currentBid, setCurrentBid] = useState(0);
  const [bidAmount, setBidAmount] = useState("");
  const [maxBid, setMaxBid] = useState("");
  const [bidIncrement, setBidIncrement] = useState("");
  const [automaticBidding, setAutomaticBidding] = useState(false);
  const [bidFeed, setBidFeed] = useState<BidFeedItem[]>([]);
  const [viewerBidStatus, setViewerBidStatus] = useState("You have not bid");
  const [viewerBidCurrentCents, setViewerBidCurrentCents] = useState(0);
  const [viewerMaxBidCents, setViewerMaxBidCents] = useState(0);
  const [auctionSummary, setAuctionSummary] = useState<any>(null);
  const [myBidHistory, setMyBidHistory] = useState<any[]>([]);
  const [deliveryStatuses, setDeliveryStatuses] = useState<Record<string, OrderStatus>>({});
  const [riderOnline, setRiderOnline] = useState(true);
  const [sellerMode, setSellerMode] = useState(false);
  const [riderOrders, setRiderOrders] = useState<any[]>([]);
  const [accountOrders, setAccountOrders] = useState<any[]>([]);
  const [userListings, setUserListings] = useState<Listing[]>([]);
  const [publicListings, setPublicListings] = useState<Listing[]>([]);
  const [inventoryTab, setInventoryTab] = useState<InventoryTab>(() => { const requested = new URLSearchParams(window.location.search).get("tab"); return ["official", "draft", "auction-ended", "sold", "deleted"].includes(requested ?? "") ? requested as InventoryTab : "official"; });
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [createListingOpen, setCreateListingOpen] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [cancelReasonBidId, setCancelReasonBidId] = useState<number | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [authUser, setAuthUser] = useState<AuthUser | null | undefined>(undefined);
  const [auctionSeconds, setAuctionSeconds] = useState(0);
  const [auctionStartSeconds, setAuctionStartSeconds] = useState(0);
  const [walletCents, setWalletCents] = useState(0);
  const [sellerOnboardingOpen, setSellerOnboardingOpen] = useState(false);
  const [overviewMetrics, setOverviewMetrics] = useState<OverviewMetrics>({ grossSalesCents: 0, liveAuctions: 0, ordersInTransit: 0, availableStock: 0, skuCount: 0 });
  const comparisonListings = useMemo(() => Array.from(new Map([...publicListings, ...userListings].map((listing) => [listing.id, listing])).values()).filter((listing) => (listing.lifecycle ?? "official") !== "deleted"), [publicListings, userListings]);
  const liveAuctionListings = useMemo(() => Array.from(new Map([...publicListings, ...userListings].map((listing) => [listing.id, listing])).values()).filter((listing) => Number(listing.stock) > 0 && isLiveAuctionListing(listing)), [publicListings, userListings, auctionSeconds]);
  const auctionPathId = location.startsWith("/auction/") ? location.split("/").pop() : undefined;
  const selectedAuction = (auctionPathId ? [...publicListings, ...userListings].find((listing) => listing.id === auctionPathId) : undefined) ?? liveAuctionListings[0];

  useEffect(() => {
    fetch("/api/auth/me").then((response) => readJson(response)).then((payload) => { setAuthUser(payload.user ?? null); setWalletCents(payload.user?.walletCents ?? 0); setSellerMode(Boolean(payload.user?.sellerEnabled) || payload.user?.role === "admin"); }).catch(() => setAuthUser(null));
  }, []);

  useEffect(() => {
    if (!authUser) return;
    const refreshWallet = () => fetch("/api/wallet").then((response) => readJson(response)).then((payload) => { if (typeof payload.walletCents === "number") setWalletCents(payload.walletCents); }).catch(() => undefined);
    refreshWallet(); const walletPoller = window.setInterval(refreshWallet, 5000); return () => window.clearInterval(walletPoller);
  }, [authUser]);
  useEffect(() => {
    if (!authUser) return;
    const refreshWishlist = () => fetch("/api/wishlist").then((response) => readJson(response)).then((payload) => {
      setFavoriteIds(payload.listingIds ?? []);
      const grouped: Record<string, any[]> = {};
      for (const row of payload.priceChanges ?? []) (grouped[row.listingId] ??= []).push(row);
      setWishlistPriceChanges(grouped);
    }).catch(() => undefined);
    refreshWishlist();
    const wishlistPoller = window.setInterval(refreshWishlist, 15000);
    fetch("/api/saved-searches").then((response) => readJson(response)).then((payload) => setSavedSearches(payload.searches ?? [])).catch(() => setSavedSearches([]));
    fetch("/api/stores/following").then((response) => readJson(response)).then((payload) => setFollowedStoreIds(payload.sellerIds ?? [])).catch(() => setFollowedStoreIds([]));
    const refreshNotifications = () => fetch("/api/notifications").then((response) => readJson(response)).then((payload) => { const rows = payload.notifications ?? []; setLiveNotifications(rows.map((item: any) => ({ id: String(item.id), entityId: item.entityId, type: item.type, label: item.title, message: item.message, time: new Date(item.createdAt).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" }), tone: item.type === "auction_won" ? "mustard" : item.type === "delivery_update" ? "teal" : item.title?.toLowerCase().includes("message") ? "lavender" : "coral" }))); setActivityItems(rows.map((item: any) => ({ id: String(item.id), entityId: item.entityId, initials: authUser.name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase(), title: item.title, meta: item.message, time: new Date(item.createdAt).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" }), tone: item.type === "auction_won" ? "mustard" : item.type === "delivery_update" ? "teal" : item.title?.toLowerCase().includes("message") ? "lavender" : "coral" }))); setReadNotifications(rows.filter((item: any) => item.readAt).map((item: any) => String(item.id))); }).catch(() => undefined);
    refreshNotifications(); const notificationPoller = window.setInterval(refreshNotifications, 3000);
    return () => { window.clearInterval(notificationPoller); window.clearInterval(wishlistPoller); };
  }, [authUser]);
  useEffect(() => {
    if (!authUser) return;
    const refresh = () => fetch("/api/listings?owner=me").then((response) => readJson(response)).then((payload) => setUserListings((payload.listings ?? []).map((item: Listing) => ({ ...item, seller: authUser.storeName || authUser.name })))).catch(() => undefined);
    refresh(); const poller = window.setInterval(refresh, 3000); return () => window.clearInterval(poller);
  }, [authUser]);
  useEffect(() => {
    if (!authUser) return;
    const refresh = () => fetch("/api/bids/second-chance/offers").then((response) => readJson(response)).then((payload) => setSecondChanceOffers(payload.offers ?? [])).catch(() => setSecondChanceOffers([]));
    refresh(); const poller = window.setInterval(refresh, 3000); return () => window.clearInterval(poller);
  }, [authUser]);

  useEffect(() => {
    if (!authUser) return;
    const refresh = () => fetch("/api/metrics/overview").then((response) => readJson(response)).then((payload) => { if (payload.metrics) setOverviewMetrics(payload.metrics); }).catch(() => undefined);
    refresh(); const poller = window.setInterval(refresh, 5000); return () => window.clearInterval(poller);
  }, [authUser]);
  useEffect(() => {
    if (!authUser) return;
    const refresh = () => fetch("/api/bids/my-history").then((response) => readJson(response)).then((payload) => setMyBidHistory(payload.history ?? [])).catch(() => undefined);
    refresh(); const poller = window.setInterval(refresh, 3000); return () => window.clearInterval(poller);
  }, [authUser]);

  useEffect(() => {
    if (!authUser) return;
    const refreshPublicListings = () => fetch("/api/listings").then((response) => readJson(response)).then((payload) => setPublicListings((payload.listings ?? []).map((item: Listing) => ({ ...item, seller: item.seller || "MerchantHub seller" })))).catch(() => undefined);
    refreshPublicListings();
    const listingPoller = window.setInterval(refreshPublicListings, 3000);
    return () => window.clearInterval(listingPoller);
  }, [authUser]);

  useEffect(() => {
    if (authUser?.role !== "rider") return;
    const refresh = () => fetch("/api/orders/active").then((response) => readJson(response)).then((payload) => setRiderOrders(payload.orders ?? [])).catch(() => undefined);
    refresh(); const poller = window.setInterval(refresh, 5000); return () => window.clearInterval(poller);
  }, [authUser]);
  useEffect(() => {
    if (!authUser || authUser.role === "rider") return;
    const refresh = () => fetch("/api/orders/active").then((response) => readJson(response)).then((payload) => setAccountOrders(payload.orders ?? [])).catch(() => undefined);
    refresh(); const poller = window.setInterval(refresh, 10000); return () => window.clearInterval(poller);
  }, [authUser]);

  useEffect(() => {
    if (!selectedAuction) { setAuctionSeconds(0); setAuctionStartSeconds(0); return; }
    const endAt = selectedAuction.auctionEndAt ? new Date(selectedAuction.auctionEndAt).getTime() : 0;
    const startAt = selectedAuction.auctionStartAt ? new Date(selectedAuction.auctionStartAt).getTime() : 0;
    const update = () => { const now = Date.now(); setAuctionSeconds(endAt ? Math.max(0, Math.floor((endAt - now) / 1000)) : 0); setAuctionStartSeconds(startAt ? Math.max(0, Math.floor((startAt - now) / 1000)) : 0); };
    update(); const timer = window.setInterval(update, 1000); return () => window.clearInterval(timer);
  }, [selectedAuction?.id, selectedAuction?.auctionStartAt, selectedAuction?.auctionEndAt]);
  useEffect(() => {
    if (!selectedAuction) { setBidFeed([]); setCurrentBid(0); setBidAmount(""); setMaxBid(""); setBidIncrement(""); setAutomaticBidding(false); setViewerBidStatus("You have not bid"); setViewerBidCurrentCents(0); setViewerMaxBidCents(0); return; }
    const openingBid = Math.max(1, Math.round(selectedAuction.startingBid ?? selectedAuction.price));
    const increment = Math.max(1, Math.round(selectedAuction.minimumIncrement ?? 1));
    setCurrentBid(0);
    setAutomaticBidding(false);
    setViewerBidStatus("You have not bid"); setViewerBidCurrentCents(0); setViewerMaxBidCents(0);
    setBidAmount(String(openingBid));
    setMaxBid(String(openingBid + increment * 10));
    setBidIncrement(String(increment));
    const listingId = selectedAuction.id;
    const syncSuggestedBid = (current: number, hasBids: boolean) => {
      const minimum = hasBids ? current + increment : openingBid;
      setBidAmount((value) => Number(value) < minimum ? String(minimum) : value);
    };
    const pollBid = () => fetch(`/api/bids/current?listingId=${encodeURIComponent(listingId)}`).then((response) => readJson(response)).then((payload) => { const current = Math.round(Number(payload.currentBidCents ?? 0) / 100); setCurrentBid(current); syncSuggestedBid(current, Boolean(payload.hasBids)); }).catch(() => undefined);
    const pollHistory = () => fetch(`/api/bids/history?listingId=${encodeURIComponent(listingId)}`).then((response) => readJson(response)).then((payload) => { setBidFeed(toBidFeedItems(payload.history ?? [])); setViewerBidStatus(payload.viewerBidStatus ?? "You have not bid"); setViewerBidCurrentCents(Number(payload.viewerBidCurrentCents ?? 0)); setViewerMaxBidCents(Number(payload.viewerMaxBidCents ?? 0)); }).catch(() => undefined);
    const restoreAutomaticProxy = () => fetch(`/api/bids/proxy?listingId=${encodeURIComponent(listingId)}`).then((response) => readJson(response)).then((payload) => { const proxy = payload.proxy; if (proxy?.isAutomatic) { setAutomaticBidding(true); setMaxBid(String(Math.round(Number(proxy.maxBidCents) / 100))); setBidIncrement(String(Math.max(1, Math.round(Number(proxy.incrementCents) / 100)))); } }).catch(() => undefined);
    pollBid(); pollHistory(); restoreAutomaticProxy(); const stream = new EventSource(`/api/bids/stream?listingId=${encodeURIComponent(listingId)}`); stream.onmessage = (event) => { try { const payload = JSON.parse(event.data); const current = Math.round(Number(payload.currentBidCents ?? 0) / 100); setCurrentBid(current); syncSuggestedBid(current, Number(payload.activeBids ?? 0) > 0); if (payload.viewerBidStatus) setViewerBidStatus(payload.viewerBidStatus); if (payload.viewerBidCurrentCents != null) setViewerBidCurrentCents(Number(payload.viewerBidCurrentCents)); if (payload.viewerMaxBidCents != null) setViewerMaxBidCents(Number(payload.viewerMaxBidCents)); pollHistory(); if (selectedAuction.ownerId === authUser?.id) fetch(`/api/bids/summary?listingId=${encodeURIComponent(listingId)}`).then((response) => readJson(response)).then((data) => setAuctionSummary(data.summary ?? data)).catch(() => undefined); } catch { /* ignore malformed heartbeat */ } }; const historyPoller = window.setInterval(pollHistory, 15000); return () => { stream.close(); window.clearInterval(historyPoller); };
  }, [selectedAuction?.id]);
  useEffect(() => {
    if (!selectedAuction || selectedAuction.ownerId !== authUser?.id) { setAuctionSummary(null); return; }
    const load = () => fetch(`/api/bids/summary?listingId=${encodeURIComponent(selectedAuction.id)}`).then((response) => readJson(response)).then((payload) => setAuctionSummary(payload.summary ?? payload)).catch(() => setAuctionSummary(null));
    load(); const timer = window.setInterval(load, 5000); return () => window.clearInterval(timer);
  }, [selectedAuction?.id, selectedAuction?.ownerId, authUser?.id]);

  useEffect(() => {
    const next = sectionFromPath(location);
    if (["admin", "seller-applications", "manage-users"].includes(next) && !(authUser?.role === "admin" && authUser.email.toLowerCase() === "admin@gmail.com")) { setLocation("/"); return; }
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
    setLocation(section === "overview" ? "/" : section === "live" ? "/auctions" : section === "auction" ? "/auction" : section === "admin" ? "/admin-dashboard" : `/${section}`);
    setSidebarOpen(false);
  };

  const respondSecondChance = async (listingId: string, action: "accept" | "decline") => { const response = await fetch(`/api/bids/second-chance/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listingId }) }); const payload = await readJson(response); if (!response.ok) { toast.error(payload.error ?? "Second-chance response failed"); return; } setSecondChanceOffers((current) => current.filter((offer) => offer.listingId !== listingId)); toast.success(action === "accept" ? "Second-chance offer accepted" : "Second-chance offer declined", { description: action === "accept" ? "The item is now marked sold." : "The seller can now re-auction the item." }); };
  const requestBidCancellation = async (bidId: number) => { const reason = window.prompt("Why should this active bid be cancelled?"); if (!reason?.trim()) return; const response = await fetch(`/api/bids/${bidId}/cancellation-request`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) }); const payload = await readJson(response); if (!response.ok) { toast.error(payload.error ?? "Cancellation request failed"); return; } toast.success("Cancellation request submitted", { description: "The seller has been notified for review." }); };
  const openCancelReason = (bidId: number) => { setCancelReasonBidId(bidId); setCancelReason(""); };
  const cancelWonBid = async (bidId: number, reason: string) => { const response = await fetch(`/api/bids/${bidId}/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) }); const payload = await readJson(response); if (!response.ok) { toast.error(payload.error ?? "Won item could not be cancelled"); return; } toast.success(payload.offerSent ? "Second-chance offer sent" : "Auction returned to unsold inventory", { description: payload.offerSent ? "The next-highest bidder can accept or decline from their notifications." : "The seller can re-auction the item from Inventory." }); fetch("/api/bids/my-history").then((result) => readJson(result)).then((data) => setMyBidHistory(data.history ?? [])).catch(() => undefined); };
  const displayedNotifications: AppNotification[] = liveNotifications.filter((item) => item.label !== "Second-chance offer" || secondChanceOffers.some((offer) => offer.listingId === item.entityId));
  const unreadCount = displayedNotifications.filter((item) => !readNotifications.includes(item.id)).length;
  const openAuctionResult = (item: AppNotification | ActivityItem) => {
    const title = "label" in item ? item.label : item.title;
    const message = "message" in item ? item.message ?? "" : "meta" in item ? item.meta : "";
    const entityId = (item as any).entityId as string | undefined;
    const text = `${title} ${message}`.toLowerCase();
    const ownsListing = Boolean(entityId && userListings.some((listing) => listing.id === entityId && listing.ownerId === authUser?.id));
    if (entityId && (text.includes("ended without a sale") || text.includes("offer declined"))) { if (ownsListing) { setSellerMode(true); setInventoryTab("auction-ended"); setLocation("/inventory?tab=auction-ended"); } else setLocation(`/bidding/${entityId}`); setNotificationOpen(false); return; }
    if (entityId && (text.includes("you are winning") || text.includes("winner of this item") || text.includes("auction won") || text.includes("auction ended with a winner") || text.includes("offer accepted"))) { if (!ownsListing) setSellerMode(false); setLocation(ownsListing ? `/auction/${entityId}` : `/bidding/${entityId}`); setNotificationOpen(false); return; }
    if (entityId && text.includes("auction cancellation confirmed")) { setLocation(`/bidding/${entityId}`); setNotificationOpen(false); return; }
    if (entityId && (text.includes("saved search match") || text.includes("upcoming auction from a store you follow"))) { setLocation(`/item/${entityId}`); setNotificationOpen(false); return; }
    if (text.includes("saved item price")) { setLocation("/saved"); setNotificationOpen(false); return; }
    if (entityId && (text.includes("order") || text.includes("delivery"))) { setLocation(`/order/${entityId}`); setNotificationOpen(false); return; }
    if (text.includes("message")) navigate("messages"); else navigate("overview");
  };
  const markNotificationRead = async (id: string) => {
    if (readNotifications.includes(id)) return;
    setReadNotifications((current) => current.includes(id) ? current : [...current, id]);
    try {
      const response = await fetch(`/api/notifications/${encodeURIComponent(id)}/read`, { method: "POST" });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(payload.error ?? "Notification could not be marked as read");
    } catch (error) {
      setReadNotifications((current) => current.filter((item) => item !== id));
      toast.error(error instanceof Error ? error.message : "Notification could not be marked as read");
    }
  };
  const markAllNotificationsRead = async () => {
    await Promise.all(displayedNotifications.filter((item) => !readNotifications.includes(item.id)).map((item) => markNotificationRead(item.id)));
  };
  const openNotification = (item: AppNotification) => { void markNotificationRead(item.id); openAuctionResult(item); };
  const openActivity = (item: ActivityItem) => { void markNotificationRead(item.id); openAuctionResult(item); };

  const allListings = useMemo(() => Array.from(new Map([...publicListings, ...userListings].map((listing) => [listing.id, listing])).values()).filter((listing) => {
    if (["deleted", "draft", "auction-ended", "sold", "canceled"].includes(listing.lifecycle ?? "")) return false;
    if (listing.type !== "Auction" && listing.type !== "Both") return true;
    if (listing.auctionEndAt) return new Date(listing.auctionEndAt).getTime() > Date.now();
    return false;
  }), [publicListings, userListings, auctionSeconds]);
  const filteredListings = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    return allListings.filter((listing) => {
      if (Number(listing.stock) <= 0) return false;
      const matchesQuery = !query || `${listing.title} ${listing.description ?? ""} ${listing.category} ${listing.seller}`.toLowerCase().includes(query);
      const matchesFilter = marketFilter === "All items" || listing.type === marketFilter || listing.category === marketFilter;
      const matchesProvince = !marketProvince || listing.sellerProvince?.toLocaleLowerCase() === marketProvince.toLocaleLowerCase();
      const matchesMunicipality = !marketMunicipality || listing.sellerMunicipality?.toLocaleLowerCase() === marketMunicipality.toLocaleLowerCase();
      return matchesQuery && matchesFilter && matchesProvince && matchesMunicipality;
    });
  }, [allListings, marketFilter, marketProvince, marketMunicipality, searchQuery]);

  const toggleFavorite = async (id: string) => {
    const wasSaved = favoriteIds.includes(id);
    setFavoriteIds((current) => wasSaved ? current.filter((item) => item !== id) : [...current, id]);
    const response = await fetch("/api/wishlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listingId: id }) });
    if (!response.ok) setFavoriteIds((current) => wasSaved ? [...current, id] : current.filter((item) => item !== id));
    else toast.success(wasSaved ? "Removed from saved items" : "Saved to your watchlist", { description: "Your saved list is tied to this account." });
  };

  const toggleStoreFollow = async (sellerId: number, following: boolean): Promise<number | null> => {
    const response = await fetch(`/api/stores/${sellerId}/follow`, { method: following ? "DELETE" : "POST" });
    const payload = await readJson(response);
    if (!response.ok) { toast.error(payload.error ?? "Store follow could not be updated"); return null; }
    setFollowedStoreIds((current) => following ? current.filter((id) => id !== sellerId) : current.includes(sellerId) ? current : [...current, sellerId]);
    toast.success(following ? "Store unfollowed" : "Store followed", { description: following ? "You will no longer receive its upcoming-auction alerts." : "We’ll notify you when this store publishes a scheduled auction." });
    return Number(payload.followerCount ?? 0);
  };

  const saveCurrentSearch = async () => {
    const query = searchQuery.trim();
    if (!query && marketFilter === "All items" && !marketProvince) { toast.error("Add a search term, choose a filter, or select a location first"); return; }
    const response = await fetch("/api/saved-searches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, filter: marketFilter, province: marketProvince || null, municipality: marketMunicipality || null }) });
    const payload = await readJson(response);
    if (!response.ok) { toast.error(payload.error ?? "Search could not be saved"); return; }
    if (payload.search && !savedSearches.some((item) => item.id === payload.search.id)) setSavedSearches((current) => [payload.search, ...current]);
    toast.success(payload.existing ? "Search already saved" : "Search saved", { description: "You will be notified when a matching listing is published." });
  };
  const deleteSavedSearch = async (id: number) => { const response = await fetch(`/api/saved-searches/${id}`, { method: "DELETE" }); if (!response.ok) { toast.error("Saved search could not be removed"); return; } setSavedSearches((current) => current.filter((item) => item.id !== id)); };


  const fundWallet = async (amountCents = 1000000) => {
    const response = await fetch("/api/wallet/fund", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amountCents }) });
    const payload = await readJson(response);
    if (!response.ok) { toast.error(payload.error ?? "Unable to fund demo wallet"); return; }
    setWalletCents(payload.walletCents);
    toast.success("Demo funds added", { description: `${money(amountCents / 100)} is now available for bidding.` });
  };

  const placeBid = async (delivery?: AuctionDeliveryDetails) => {
    const nextBid = Number(bidAmount);
    const cap = Number(maxBid);
    const incrementValue = Number(bidIncrement);
    if (selectedAuction?.auctionStartAt && Date.parse(selectedAuction.auctionStartAt) > Date.now()) { toast.error("Bidding has not started yet", { description: "Return at the scheduled start time." }); return; }
    if (auctionSeconds === 0) { toast.error("This auction has ended"); return; }
    if (!Number.isFinite(nextBid) || nextBid <= currentBid) { toast.error("Enter a higher bid", { description: `Your bid must be above ${money(currentBid)}.` }); return; }
    if (automaticBidding && (!Number.isFinite(cap) || cap < nextBid)) { toast.error("Max bid cap is too low", { description: "Set a ceiling at or above your next bid." }); return; }
    if (automaticBidding && (!Number.isFinite(incrementValue) || incrementValue <= 0)) { toast.error("Enter an automatic bid increment"); return; }
    const { autoCheckoutConsent, ...deliveryPayload } = delivery ?? { autoCheckoutConsent: undefined } as any;
    const response = await fetch("/api/bids/proxy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listingId: selectedAuction?.id, mode: automaticBidding ? "proxy" : "simple", bidCents: nextBid * 100, maxBidCents: automaticBidding ? cap * 100 : undefined, incrementCents: automaticBidding ? incrementValue * 100 : undefined, delivery: delivery ? deliveryPayload : undefined, autoCheckoutConsent }) });
    const payload = await readJson(response);
    if (!response.ok) { toast.error(payload.error ?? "Unable to place proxy bid"); return; }
    const nextCurrent = Math.round(payload.currentBidCents / 100);
    setCurrentBid(nextCurrent); setWalletCents(payload.walletCents); setViewerBidStatus(payload.leadingUserId === authUser?.id ? "Winning" : "Outbid"); setViewerBidCurrentCents(payload.leadingUserId === authUser?.id ? nextCurrent * 100 : 0); setViewerMaxBidCents(Math.round((automaticBidding ? cap : nextBid) * 100)); setBidAmount(String(nextCurrent + Math.max(1, Math.round(selectedAuction?.minimumIncrement ?? 1))));
    const historyResponse = await fetch(`/api/bids/history?listingId=${encodeURIComponent(selectedAuction!.id)}`); const historyPayload = await readJson(historyResponse); if (historyResponse.ok) { setBidFeed(toBidFeedItems(historyPayload.history ?? [])); setViewerBidStatus(historyPayload.viewerBidStatus ?? "You have not bid"); setViewerBidCurrentCents(Number(historyPayload.viewerBidCurrentCents ?? 0)); setViewerMaxBidCents(Number(historyPayload.viewerMaxBidCents ?? 0)); }
    toast.success(automaticBidding ? "Automatic bidding is active" : "Bid placed", { description: selectedAuction?.winnerCancellationAllowed === false ? `Up to ${money((automaticBidding ? cap : nextBid))} is reserved from your available demo-wallet funds. If you win, MerchantHub will automatically check out and create the order; this auction does not allow change-of-mind cancellation.` : automaticBidding ? `MerchantHub will automatically respond to competing bids up to your ${money(cap)} cap.` : `Your one-time bid of ${money(nextBid)} is now active. You can cancel a win only if you complete checkout and the seller allows cancellation.` });
  };

  const changeOrderStatus = (id: string, status: OrderStatus) => {
    setDeliveryStatuses((current) => ({ ...current, [id]: status }));
    toast.success(`Order ${id} updated`, { description: `Status is now ${status}.` });
  };

  if (signedOut) return <SignedOutScreen onReturn={() => setSignedOut(false)} />;
  if (authUser === undefined) return <AuthLoading />;
  if (authUser === null) return <AuthScreen onAuthenticated={(user) => { setAuthUser(user); setSellerMode(Boolean(user.sellerEnabled) || user.role === "admin"); setLocation(user.role === "admin" ? "/admin-dashboard" : "/"); }} />;
  if (authUser.role === "rider") return <RiderOnlyShell authUser={authUser} riderOrders={riderOrders} onLogout={() => { setAuthUser(null); setSignedOut(false); }} />;

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
          {navGroups.map((group) => { const visibleItems = group.items.filter((item) => authUser?.role === "admin" && authUser.email.toLowerCase() === "admin@gmail.com" ? ["overview", "marketplace", "seller-applications", "manage-users"].includes(item.id) : item.id === "rider" ? authUser?.role === "rider" : item.id === "inventory" ? sellerMode : !["seller-applications", "manage-users"].includes(item.id)); return visibleItems.length ? <div className="nav-group" key={group.label}><div className="nav-label">{authUser?.role === "admin" && authUser.email.toLowerCase() === "admin@gmail.com" ? "Administration" : group.label}</div>{visibleItems.map((item) => { const Icon = sellerMode && item.id === "bidding" ? Gavel : item.icon; const liveCount = item.id === "live" ? liveAuctionListings.length : item.id === "orders" ? accountOrders.filter((order) => !["Delivered", "Cancelled"].includes(order.status)).length : 0; const counterTitle = item.id === "live" ? "All currently live auctions in the marketplace" : item.id === "orders" ? "Your active orders and deliveries" : undefined; return <button key={item.id} title={counterTitle} className={`nav-item ${activeSection === item.id ? "active" : ""}`} onClick={() => navigate(item.id)}><Icon size={17} strokeWidth={activeSection === item.id ? 2.4 : 1.9} /><span>{item.id === "seller-applications" ? "Seller applications" : item.id === "manage-users" ? "Manage users" : item.label}</span>{(item.id === "live" || item.id === "orders") && liveCount > 0 && <em>{liveCount}</em>}</button>; })}</div> : null; })}
        </nav>
        <div className="sidebar-bottom"><div className="sync-card"><div className="sync-orbit"><Radio size={14} /></div><div><strong>All systems live</strong><span>Synced 2 min ago</span></div></div><div className="mode-switch-card"><div><strong>{sellerMode ? "Seller mode on" : authUser.sellerApplicationStatus === "pending" ? "Seller application pending" : "Buyer mode"}</strong><span>{sellerMode ? "Seller tools are open" : authUser.sellerApplicationStatus === "pending" ? "Waiting for admin approval" : "Apply to sell on MerchantHub"}</span></div><button className={`switch ${sellerMode ? "on" : ""}`} disabled={authUser.sellerApplicationStatus === "pending"} onClick={() => authUser.sellerEnabled ? toast.success("Seller mode is permanent") : setSellerOnboardingOpen(true)} aria-label="Seller mode"><span /></button></div><div className="profile-row"><div className="profile-avatar">{authUser.name.slice(0, 2).toUpperCase()}</div><div><strong>{authUser.name}</strong><span>{sellerMode ? "Seller mode on" : "Buyer mode"}</span></div><MoreHorizontal size={17} /></div></div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left"><button className="icon-button menu-trigger" onClick={() => setSidebarOpen(true)} aria-label="Open menu"><Menu size={20} /></button><div className="breadcrumb"><button className="breadcrumb-home" onClick={() => navigate("overview")}>MerchantHub</button><ChevronRight size={14} /><strong>{activeSection === "overview" ? "Overview" : titleForSection[activeSection]}</strong></div></div>
          <div className="topbar-actions"><label className="global-search"><Search size={17} /><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search listings, orders, people..." /><kbd>⌘ K</kbd></label><div className="wallet-chip"><WalletCards size={15} /><strong>{money(walletCents / 100)}</strong></div><div className="topbar-menu-wrap"><button className={`icon-button notification-button ${notificationOpen ? "is-open" : ""}`} onClick={() => { setNotificationOpen((open) => !open); setProfileOpen(false); }} aria-label="Open notifications"><Bell size={19} />{unreadCount > 0 && <span>{unreadCount}</span>}</button>{notificationOpen && <NotificationDropdown notifications={displayedNotifications} readNotifications={readNotifications} offers={secondChanceOffers} onOpen={openNotification} onMarkRead={markNotificationRead} onMarkAllRead={markAllNotificationsRead} onSecondChance={respondSecondChance} />}</div><div className="topbar-menu-wrap"><button className="top-avatar top-avatar-button" onClick={() => { setProfileOpen((open) => !open); setNotificationOpen(false); }} aria-label="Open profile menu">{authUser.name.slice(0, 2).toUpperCase()}</button>{profileOpen && <ProfileDropdown user={authUser} sellerMode={sellerMode} setSellerMode={setSellerMode} onEnableSeller={() => setSellerOnboardingOpen(true)} onProfile={() => { setProfileOpen(false); setProfileModalOpen(true); }} onLogout={() => { setProfileOpen(false); setAuthUser(null); setSignedOut(true); toast.success("You have been signed out"); }} />}</div></div>
        </header>
        <div className="page-content">
          <div className="page-heading"><div><div className="eyebrow"><span className="live-dot" /> Live marketplace overview</div><h1>{activeSection === "overview" ? `Good morning, ${authUser.name}` : activeSection === "bidding" && sellerMode ? "Bid overview" : titleForSection[activeSection]}</h1><p>{subtitleForSection[activeSection]}</p></div><div className="heading-actions">{(authUser.sellerEnabled || sellerMode) && <button className="button primary" onClick={() => { setCreateListingOpen(true); setSellerMode(true); }}><Plus size={17} /> Create listing</button>}</div></div>
          {activeSection === "overview" && <Overview metrics={overviewMetrics} sellerMode={sellerMode} activeBidCount={new Set(myBidHistory.filter((bid) => bid.auctionState === "Auction ongoing" && ["Winning", "Losing"].includes(bid.bidderStatus)).map((bid) => bid.listingId)).size} openOrderCount={accountOrders.filter((order) => order.buyerId === authUser.id && !["Delivered", "Cancelled"].includes(order.status)).length} onNavigate={navigate} onActivity={openActivity} onNotification={openNotification} onMarkRead={markNotificationRead} onMarkAllRead={markAllNotificationsRead} favoriteIds={favoriteIds} toggleFavorite={toggleFavorite} readNotifications={readNotifications} searchQuery={searchQuery} liveListings={sellerMode ? userListings.filter(isLiveAuctionListing) : publicListings.filter(isLiveAuctionListing)} activityItems={activityItems} notifications={displayedNotifications} secondChanceOffers={secondChanceOffers} onSecondChance={respondSecondChance} onOpenAuction={(id) => setLocation(`/auction/${id}`)} />}
          {activeSection === "wallet" && <WalletView walletCents={walletCents} onFund={fundWallet} />}
          {activeSection === "marketplace" && <Marketplace listings={filteredListings} filter={marketFilter} setFilter={setMarketFilter} searchQuery={searchQuery} savedSearches={savedSearches} province={marketProvince} setProvince={(value) => { setMarketProvince(value); setMarketMunicipality(""); }} municipality={marketMunicipality} setMunicipality={setMarketMunicipality} onSaveSearch={saveCurrentSearch} onDeleteSavedSearch={deleteSavedSearch} favoriteIds={favoriteIds} toggleFavorite={toggleFavorite} onOpenListing={openListing} onCompare={(id) => setLocation(`/compare/${id}`)} onBuyNow={(id) => setLocation(`/checkout/${id}?quantity=1`)} />}
          {activeSection === "live" && <LiveAuctions items={liveAuctionListings} favoriteIds={favoriteIds} toggleFavorite={toggleFavorite} onOpenListing={(id) => { const listing = liveAuctionListings.find((item) => item.id === id); setLocation(listing?.ownerId === authUser?.id ? `/auction/${id}` : `/item/${id}`); }} />}
          {activeSection === "checkout" && <CheckoutPage listingId={location.split("/").pop()?.split("?")[0] ?? ""} customListings={allListings} authUser={authUser} onBack={() => navigate("marketplace")} onOrder={(orderId: string) => setLocation(`/order/${orderId}`)} />}
          {activeSection === "order-detail" && <OrderReceipt orderId={location.split("/").pop() ?? ""} accountOrders={accountOrders} onBack={() => navigate("orders")} />}
          {activeSection === "detail" && <ItemDetail listingId={location.split("/").pop() ?? ""} customListings={allListings} authUser={authUser} onVisitStore={(ownerId) => setLocation(`/store/${ownerId}`)} onCompare={(id) => setLocation(`/compare/${id}`)} onMessageSeller={(listing) => setLocation(`/messages?recipient=${listing.ownerId ?? ""}&listing=${listing.id}`)} onAuction={(id) => setLocation(`/auction/${id}`)} onCheckout={(id, qty) => setLocation(`/checkout/${id}?quantity=${qty}`)} onBack={() => navigate("marketplace")} />}
          {activeSection === "compare" && <ComparisonView baseListingId={location.split("/")[2] ?? ""} candidateListingId={location.split("/")[3]} listings={comparisonListings} onChoose={(id) => setLocation(`/compare/${location.split("/")[2] ?? ""}/${id}`)} onBackToPicker={() => setLocation(`/compare/${location.split("/")[2] ?? ""}`)} onBack={() => setLocation(`/item/${location.split("/")[2] ?? ""}`)} onOpenItem={openListing} />}
          {activeSection === "auction" && <AuctionDetail listing={selectedAuction} sellerView={selectedAuction?.ownerId === authUser?.id} auctionSummary={auctionSummary} auctionSeconds={auctionSeconds} auctionStartSeconds={auctionStartSeconds} walletCents={walletCents} currentBid={currentBid} viewerBidStatus={viewerBidStatus} viewerBidCurrentCents={viewerBidCurrentCents} viewerMaxBidCents={viewerMaxBidCents} bidAmount={bidAmount} maxBid={maxBid} bidIncrement={bidIncrement} automaticBidding={automaticBidding} authUser={authUser} setAutomaticBidding={setAutomaticBidding} setBidAmount={setBidAmount} setMaxBid={setMaxBid} setBidIncrement={setBidIncrement} bidFeed={bidFeed} placeBid={placeBid} />}
          {activeSection === "bidding" && (sellerMode ? <SellerBiddingOverview listings={userListings} onOpenAuction={(id) => setLocation(`/auction/${id}`)} /> : location.startsWith("/bidding/") ? <BiddingDetailView listingId={location.split("/").pop() ?? ""} history={myBidHistory} authUser={authUser} walletCents={walletCents} onBack={() => navigate("bidding")} onCancelWon={openCancelReason} onOpenOrder={(orderId) => setLocation(`/order/${orderId}`)} onVisitStore={(ownerId) => setLocation(`/store/${ownerId}`)} onMessageSeller={(listing) => setLocation(`/messages?recipient=${listing.ownerId ?? ""}&listing=${listing.id}`)} /> : <BiddingHistoryView history={myBidHistory} onOpenAuction={(bid) => setLocation(`/bidding/${bid.listingId}`)} onRequestCancellation={requestBidCancellation} onCancelWon={openCancelReason} />)}
          {activeSection === "orders" && <OrdersView orders={accountOrders} deliveryStatuses={deliveryStatuses} changeOrderStatus={changeOrderStatus} onOpenOrder={(id) => setLocation(`/order/${id}`)} />}
          {activeSection === "payments" && <PaymentCenter />}
          {activeSection === "rider" && <RiderDesk online={riderOnline} setOnline={setRiderOnline} deliveryStatuses={deliveryStatuses} changeOrderStatus={changeOrderStatus} authUser={authUser} riderOrders={riderOrders} /> }
          {activeSection === "store" && <MyStore ownerId={location.startsWith("/store/") ? Number(location.split("/").pop()) : authUser.id} authUser={authUser} listings={location.startsWith("/store/") ? publicListings.filter((item) => item.ownerId === Number(location.split("/").pop())) : userListings} isFollowing={followedStoreIds.includes(location.startsWith("/store/") ? Number(location.split("/").pop()) : authUser.id)} onToggleFollow={toggleStoreFollow} onOpenListing={openListing} />}
          {activeSection === "inventory" && sellerMode && <InventoryView listings={userListings} initialTab={inventoryTab} onTabChange={setInventoryTab} onOpenListing={(id) => setLocation(`/auction/${id}`)} onCompareListing={(id) => setLocation(`/compare/${id}`)} onCreateListing={() => setCreateListingOpen(true)} onRefresh={() => fetch("/api/listings?owner=me").then((response) => readJson(response)).then((payload) => setUserListings((payload.listings ?? []).map((item: Listing) => ({ ...item, seller: authUser?.storeName || authUser?.name || "" }))))} />}
          {activeSection === "messages" && <MessagesView authUser={authUser} />}
          {activeSection === "saved" && <SavedView listings={allListings} favoriteIds={favoriteIds} toggleFavorite={toggleFavorite} savedSearches={savedSearches} priceChanges={wishlistPriceChanges} onDeleteSavedSearch={deleteSavedSearch} onOpenListing={openListing} />}
          {activeSection === "admin" && authUser?.role === "admin" && authUser.email.toLowerCase() === "admin@gmail.com" && <AdminView />}
          {activeSection === "seller-applications" && authUser?.role === "admin" && authUser.email.toLowerCase() === "admin@gmail.com" && <SellerApplicationsView />}
          {activeSection === "manage-users" && authUser?.role === "admin" && authUser.email.toLowerCase() === "admin@gmail.com" && <ManageUsersView />}
        </div>
      </main>
      {profileModalOpen && <ProfileModal user={authUser} onClose={() => setProfileModalOpen(false)} onComplete={(user) => { setAuthUser(user); setProfileModalOpen(false); }} />}
      {sellerOnboardingOpen && <SellerOnboardingModal onClose={() => setSellerOnboardingOpen(false)} onComplete={(user) => { setAuthUser(user); setSellerMode(Boolean(user.sellerEnabled) || user.role === "admin"); setSellerOnboardingOpen(false); toast.success(user.sellerEnabled ? "Seller mode enabled" : "Seller application submitted", { description: user.sellerEnabled ? `${user.storeName} is ready for listings.` : "An admin must approve your application before seller tools are enabled." }); }} />}
      {cancelReasonBidId !== null && <div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) setCancelReasonBidId(null); }}><form className="create-listing-modal cancellation-reason-modal" onSubmit={(event) => { event.preventDefault(); const reason = cancelReason.trim(); if (!reason) { toast.error("Please enter a reason before canceling."); return; } const bidId = cancelReasonBidId; setCancelReasonBidId(null); void cancelWonBid(bidId, reason); }}><div className="modal-header"><div><div className="eyebrow coral-text">Buyer cancellation</div><h2>Why are you canceling?</h2><p>The seller will see this reason with the cancellation notification.</p></div><button type="button" className="icon-button" onClick={() => setCancelReasonBidId(null)} aria-label="Close cancellation reason dialog"><X size={18} /></button></div><label className="field-label">Cancellation reason *<textarea value={cancelReason} onChange={(event) => setCancelReason(event.target.value.slice(0, 500))} placeholder="Tell the seller why you need to cancel this winning item…" minLength={3} maxLength={500} required autoFocus /><small className="field-help">{cancelReason.length}/500 characters</small></label><div className="modal-actions"><button type="button" className="button secondary" onClick={() => setCancelReasonBidId(null)}>Keep order</button><button type="submit" className="button primary">Submit cancellation</button></div></form></div>}
      {createListingOpen && <CreateListingModal onClose={() => setCreateListingOpen(false)} onCreate={async (listing, lifecycle) => { const response = await fetch("/api/listings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: listing.title, description: listing.description, category: listing.category, subcategory: listing.subcategory, listingType: listing.type, priceCents: Math.round(listing.price * 100), buyNowPriceCents: listing.type === "Both" && listing.buyNow != null ? Math.round(listing.buyNow * 100) : undefined, stock: listing.stock, condition: listing.condition, lifecycle, photos: listing.photos?.filter((photo) => photo.startsWith("data:")), auctionStartAt: listing.auctionStartAt, auctionEndAt: listing.auctionEndAt, reserveThresholdCents: listing.reserveThreshold == null ? undefined : Math.round(listing.reserveThreshold * 100), minimumIncrementCents: listing.minimumIncrement == null ? undefined : Math.round(listing.minimumIncrement * 100), antiSnipeSeconds: listing.antiSnipeSeconds, winnerCancellationAllowed: listing.winnerCancellationAllowed !== false }) }); const payload = await readJson(response).catch(() => ({})); if (!response.ok) { toast.error(payload.error ?? `Listing could not be ${lifecycle === "draft" ? "saved" : "published"}`); return; } const saved = { ...(payload.listing ?? listing), seller: authUser?.storeName || authUser?.name || "", lifecycle }; setUserListings((current) => [saved, ...current]); if (lifecycle === "official") setPublicListings((current) => [saved, ...current]); setInventoryTab(lifecycle); setCreateListingOpen(false); setSellerMode(true); setLocation("/inventory"); toast.success(lifecycle === "draft" ? "Draft saved" : "Listing published", { description: lifecycle === "draft" ? "Find it in Inventory → Drafts." : "Your listing is now visible in the marketplace." }); }} />}
    </div>
  );
}

function Overview({ metrics, sellerMode, activeBidCount, openOrderCount, onNavigate, onActivity, onNotification, onMarkRead, onMarkAllRead, onSecondChance, onOpenAuction, favoriteIds, toggleFavorite, readNotifications, searchQuery, liveListings, activityItems, notifications, secondChanceOffers }: { metrics: OverviewMetrics; sellerMode: boolean; activeBidCount: number; openOrderCount: number; onNavigate: (section: Section) => void; onActivity: (item: ActivityItem) => void; onNotification: (item: AppNotification) => void; onMarkRead: (id: string) => void; onMarkAllRead: () => void; onSecondChance: (listingId: string, action: "accept" | "decline") => void; onOpenAuction: (listingId: string) => void; favoriteIds: string[]; toggleFavorite: (id: string) => void; readNotifications: string[]; searchQuery: string; liveListings: Listing[]; activityItems: ActivityItem[]; notifications: AppNotification[]; secondChanceOffers: SecondChanceOffer[] }) {
  const leadListing = liveListings[0] ?? { id: "", title: "No live auctions yet", category: "", type: "Auction" as const, price: 0, image: "", seller: "", sellerRating: 0, condition: "New" as const, stock: 0, accent: "teal" };
  const searchMatches = liveListings.filter((listing) => `${listing.title} ${listing.category} ${listing.seller}`.toLowerCase().includes(searchQuery.toLowerCase().trim())).slice(0, 3);
  const [spotlightSeconds, setSpotlightSeconds] = useState(0);
  useEffect(() => {
    const endAt = leadListing.auctionEndAt ? new Date(leadListing.auctionEndAt).getTime() : 0;
    const update = () => setSpotlightSeconds(endAt ? Math.max(0, Math.floor((endAt - Date.now()) / 1000)) : 0);
    update();
    if (!endAt) return;
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [leadListing.id, leadListing.auctionEndAt]);
  return <div className="overview-grid">
    <div className="overview-main">
      <div className="metric-grid">{sellerMode ? <><MetricCard label="Gross sales" value={money(metrics.grossSalesCents / 100)} delta="Live data" detail="from your orders" tone="coral" icon={CircleDollarSign} /><MetricCard label="Live auctions" value={String(metrics.liveAuctions)} delta="Active now" detail="from official listings" tone="teal" icon={Gavel} /><MetricCard label="Orders in transit" value={String(metrics.ordersInTransit)} delta="Live data" detail="your connected orders" tone="mustard" icon={Truck} /><MetricCard label="Available stock" value={metrics.availableStock.toLocaleString("en-PH")} delta="Live data" detail={`across ${metrics.skuCount} SKUs`} tone="lavender" icon={Boxes} /></> : <><MetricCard label="Active bids" value={String(activeBidCount)} delta="Live status" detail="auctions you’re bidding on" tone="coral" icon={Gavel} /><MetricCard label="Live auctions" value={String(liveListings.length)} delta="Open now" detail="available to browse" tone="teal" icon={Activity} /><MetricCard label="Open orders" value={String(openOrderCount)} delta="Your purchases" detail="not yet delivered or cancelled" tone="mustard" icon={PackageCheck} /><MetricCard label="Saved items" value={String(favoriteIds.length)} delta="Your watchlist" detail="items saved for later" tone="lavender" icon={Bookmark} /></>}</div>
      {searchQuery.trim() && <section className="panel search-results-panel"><div className="panel-header"><div><div className="eyebrow">Quick search</div><h2>Results for “{searchQuery}”</h2></div><button className="text-button" onClick={() => onNavigate("marketplace")}>Open marketplace <ChevronRight size={15} /></button></div><div className="search-result-list">{searchMatches.length ? searchMatches.map((listing) => <button className="search-result-item" key={listing.id} onClick={() => onNavigate(listing.type === "Buy now" ? "marketplace" : "auction")}><img src={listing.image} alt="" /><span><strong>{listing.title}</strong><small>{listing.category} · {listing.type}</small></span><b>{money(listing.currentBid ?? listing.price)}</b><ChevronRight size={15} /></button>) : <div className="empty-search">No matching listings yet. Try “audio”, “camera”, or “fashion”.</div>}</div></section>}
      {leadListing.id ? <section className="panel live-auction-panel"><div className="panel-header"><div><div className="eyebrow coral-text"><span className="live-dot" /> Live now</div><h2>{sellerMode ? "Your auction floor" : "Live auction spotlight"}</h2></div><button className="text-button" onClick={() => onNavigate("live")}>{sellerMode ? "View your auctions" : "Browse all auctions"} <ChevronRight size={15} /></button></div><div className="auction-floor-body"><div className="feature-image-wrap"><img src={leadListing.image} alt={leadListing.title} /><div className="image-overlay"><span className="pill dark-pill"><Radio size={12} /> Live auction</span></div></div><div className="auction-summary"><div className="listing-kicker">{sellerMode ? "Your listing" : "Live auction"} <span>·</span> {leadListing.category}</div><h3>{leadListing.title}</h3><div className="seller-line"><span className="mini-avatar">{leadListing.seller.slice(0, 2).toUpperCase()}</span> {leadListing.seller}</div><div className="bid-row"><div><span>Current bid</span><strong>{money(leadListing.currentBid ?? leadListing.price)}</strong><small>{leadListing.bidders ?? 0} bids</small></div><div className="countdown"><Clock3 size={15} /><span>Ends in</span><strong>{leadListing.auctionEndAt ? formatCountdown(spotlightSeconds) : "—"}</strong></div></div><div className="auction-actions"><button className="button primary" onClick={() => onOpenAuction(leadListing.id)}><Gavel size={16} /> {sellerMode ? "Open your auction" : "View auction"}</button><button className={`icon-button bordered ${favoriteIds.includes(leadListing.id) ? "favorited" : ""}`} onClick={() => toggleFavorite(leadListing.id)} aria-label="Save auction"><Heart size={18} fill={favoriteIds.includes(leadListing.id) ? "currentColor" : "none"} /></button></div></div></div></section> : <section className="panel empty-state"><Gavel size={22} /><strong>{sellerMode ? "No live auctions in your account" : "No live auctions right now"}</strong><span>{sellerMode ? "Publish an auction listing to see its timer and bidding activity here." : "Check the marketplace for buy-now items while sellers prepare their next auction."}</span>{!sellerMode && <button className="button secondary" onClick={() => onNavigate("marketplace")}>Browse marketplace</button>}</section>}
      <section className="panel activity-panel"><div className="panel-header"><div><div className="eyebrow">Your marketplace</div><h2>Recent activity</h2></div><button className="icon-button"><MoreHorizontal size={18} /></button></div><div className="activity-list">{activityItems.map((item) => <ActivityRow key={item.id} item={item} read={readNotifications.includes(item.id)} onOpen={() => onActivity(item)} />)}</div></section>
    </div>
    <div className="overview-side">
      {sellerMode ? <section className="panel pulse-panel"><div className="panel-header"><div><div className="eyebrow teal-text"><span className="live-dot teal" /> Operations pulse</div><h2>Today at a glance</h2></div><button className="icon-button" aria-label="Refresh operations snapshot"><RefreshCcw size={16} /></button></div><div className="pulse-map"><div className="map-grid" /><div className="route route-one" /><div className="route route-two" /><span className="map-pin pin-one"><Truck size={13} /></span><span className="map-pin pin-two"><PackageCheck size={13} /></span><span className="map-pin pin-three"><MapPinned size={13} /></span><div className="map-label label-one">Davao City</div><div className="map-label label-two">Tupi hub</div></div><div className="pulse-stats"><PulseStat icon={Truck} label="On the road" value={String(metrics.ordersInTransit)} meta="your connected orders" tone="teal" /><PulseStat icon={PackageOpen} label="Ready to ship" value={String(metrics.availableStock)} meta="your available stock" tone="coral" /><PulseStat icon={AlertCircle} label="Needs review" value="0" meta="no pending alerts" tone="mustard" /></div><button className="button full secondary" onClick={() => onNavigate("orders")}>Open logistics desk <ChevronRight size={15} /></button></section> : <section className="panel pulse-panel buyer-pulse-panel"><div className="panel-header"><div><div className="eyebrow teal-text"><span className="live-dot teal" /> Buyer activity</div><h2>Your marketplace snapshot</h2></div></div><div className="pulse-stats"><PulseStat icon={Gavel} label="Live auctions" value={String(liveListings.length)} meta="open for bidding" tone="teal" /><PulseStat icon={Activity} label="Active bids" value={String(activeBidCount)} meta="your ongoing auctions" tone="coral" /><PulseStat icon={PackageCheck} label="Open orders" value={String(openOrderCount)} meta="your purchases" tone="mustard" /></div><button className="button full secondary" onClick={() => onNavigate("live")}>Browse live auctions <ChevronRight size={15} /></button></section>}
      {sellerMode && <section className="panel trend-panel"><div className="panel-header"><div><div className="eyebrow">Demand signal</div><h2>Sales momentum</h2></div><span className="trend-badge"><ArrowUpRight size={13} /> 18.4%</span></div><div className="trend-value"><strong>₱82.4k</strong><span>this month</span></div><MiniChart /><div className="chart-labels"><span>May 01</span><span>May 31</span></div></section>}
      <NotificationsPanel notifications={notifications} readNotifications={readNotifications} onOpen={onNotification} onMarkRead={onMarkRead} onMarkAllRead={onMarkAllRead} offers={secondChanceOffers} onSecondChance={onSecondChance} /><section className="saved-mini"><div className="saved-icon"><Bookmark size={17} /></div><div><strong>{favoriteIds.length} saved items</strong><span>Saved to your account</span></div><button className="icon-button" onClick={() => onNavigate("saved")}><ChevronRight size={17} /></button></section>
    </div>
  </div>;
}

function LiveAuctions({ items, favoriteIds, toggleFavorite, onOpenListing }: { items: Listing[]; favoriteIds: string[]; toggleFavorite: (id: string) => void; onOpenListing: (id: string) => void }) {
  const liveListings = items.filter(isLiveAuctionListing);
  return <div className="section-stack"><div className="live-auctions-banner"><div><div className="eyebrow coral-text"><span className="live-dot" /> Live floor · {liveListings.length} auctions active</div><h2>Find the moment before it moves.</h2><p>Real-time-style bid signals, transparent reserve states, and fair anti-snipe windows.</p></div><div className="live-floor-stats"><div><strong>{money(liveListings.reduce((sum, item) => sum + (item.currentBid ?? item.price), 0))}</strong><span>value in play</span></div><div><strong>{liveListings.reduce((sum, item) => sum + (item.bidders ?? 0), 0)}</strong><span>active bidders</span></div><div><strong>{liveListings.length ? "Live" : "—"}</strong><span>next close</span></div></div></div><div className="market-summary"><div><span className="eyebrow">Live inventory</span><strong>{liveListings.length} active auctions</strong></div><div className="summary-right"><span><span className="live-dot" /> Bids updating live</span><button className="sort-button">Sort: Ending soon <ChevronDown size={15} /></button></div></div><div className="listing-grid">{liveListings.map((listing) => <ListingCard key={listing.id} listing={listing} favorite={favoriteIds.includes(listing.id)} onFavorite={() => toggleFavorite(listing.id)} onClick={() => onOpenListing(listing.id)} />)}</div><section className="panel live-feed-strip"><div className="panel-header"><div><div className="eyebrow teal-text"><span className="live-dot teal" /> Live bid feed</div><h2>Momentum across the floor</h2></div><button className="text-button">Open feed <ChevronRight size={15} /></button></div><div className="floor-feed">{liveListings.slice(0, 3).map((item) => <span key={item.id}><b>{item.seller.slice(0, 2).toUpperCase()}</b> {item.currentBid ? "raised" : "opened"} {item.title} at <strong>{money(item.currentBid ?? item.startingBid ?? item.price)}</strong></span>)}{!liveListings.length && <span>No live bid activity yet.</span>}</div></section></div>;
}

function NotificationsPanel({ notifications, readNotifications, onOpen, onMarkRead, onMarkAllRead, offers, onSecondChance }: { notifications: AppNotification[]; readNotifications: string[]; onOpen: (item: AppNotification) => void; onMarkRead: (id: string) => void; onMarkAllRead: () => void; offers: SecondChanceOffer[]; onSecondChance: (listingId: string, action: "accept" | "decline") => void }) {
  return <section className="panel notifications-panel"><div className="panel-header"><div><div className="eyebrow">Stay in the loop</div><h2>Notifications</h2></div><div className="notification-header-actions">{notifications.some((item) => !readNotifications.includes(item.id)) && <button className="text-button" onClick={onMarkAllRead}>Mark all as read</button>}<span className="notification-count">{notifications.filter((item) => !readNotifications.includes(item.id)).length} unread</span></div></div><div className="notification-list">{notifications.map((item) => { const offer = offers.find((candidate) => candidate.listingId === item.entityId); return <div className={`notification-row ${readNotifications.includes(item.id) ? "read" : ""}`} role="button" tabIndex={0} key={item.id} onClick={() => onOpen(item)} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) onOpen(item); }}><span className={`note-icon ${item.tone}`}><Bell size={14} /></span><div><strong>{item.label}</strong><span>{item.message || item.time}</span><small>{item.time} · {readNotifications.includes(item.id) ? "Read" : "Unread"}</small>{!readNotifications.includes(item.id) && <button type="button" className="text-button notification-mark-read" onClick={(event) => { event.stopPropagation(); onMarkRead(item.id); }}>Mark as read</button>}{offer && <span className="notification-actions"><button type="button" onClick={(event) => { event.stopPropagation(); onSecondChance(offer.listingId, "accept"); }}>Accept · {money(offer.amountCents / 100)}</button><button type="button" onClick={(event) => { event.stopPropagation(); onSecondChance(offer.listingId, "decline"); }}>Decline</button></span>}</div>{!readNotifications.includes(item.id) && <i />}</div>; })}</div></section>;
}

function Marketplace({ listings: items, filter, setFilter, searchQuery, savedSearches, province, setProvince, municipality, setMunicipality, onSaveSearch, onDeleteSavedSearch, favoriteIds, toggleFavorite, onOpenListing, onCompare, onBuyNow }: { listings: Listing[]; filter: string; setFilter: (filter: string) => void; searchQuery: string; savedSearches: any[]; province: string; setProvince: (province: string) => void; municipality: string; setMunicipality: (municipality: string) => void; onSaveSearch: () => void; onDeleteSavedSearch: (id: number) => void; favoriteIds: string[]; toggleFavorite: (id: string) => void; onOpenListing: (id: string) => void; onCompare: (listingId: string) => void; onBuyNow: (listingId: string) => void }) {
  const filters = ["All items", "Auction", "Buy now", "Both", "Audio", "Fashion"];
  const canSave = Boolean(searchQuery.trim() || filter !== "All items" || province);
  return <div className="section-stack">
    <div className="toolbar-row"><div className="filter-tabs">{filters.map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}</button>)}</div><div className="toolbar-actions"><button className="button secondary" onClick={onSaveSearch} disabled={!canSave}><Bookmark size={15} /> Save search</button></div></div>
    <section className="panel market-location-filter"><div><div className="eyebrow">Shop nearby</div><strong>Filter by seller location</strong><span>Only listings from stores in the selected area will appear.</span></div><div className="field-two"><label className="field-label">Province<select value={province} onChange={(event) => setProvince(event.target.value)}><option value="">All provinces</option>{philippineProvinces.map((item) => <option key={item}>{item}</option>)}</select></label><label className="field-label">Municipality / City<select value={municipality} onChange={(event) => setMunicipality(event.target.value)} disabled={!province}><option value="">All municipalities</option>{province && municipalitiesFor(province).map((item) => <option key={item}>{item}</option>)}</select></label></div></section>
    {savedSearches.length > 0 && <section className="panel saved-search-panel"><div className="panel-header"><div><div className="eyebrow lavender-text">Personal discovery</div><h2>Saved searches</h2></div><span>{savedSearches.length} active</span></div><div className="saved-search-list">{savedSearches.map((saved) => <div className="saved-search-row" key={saved.id}><span className="saved-search-icon"><Bookmark size={15} /></span><div><strong>{saved.name}</strong><span>{saved.query || "All products"} · {saved.filter}{saved.municipality || saved.province ? ` · ${[saved.municipality, saved.province].filter(Boolean).join(", ")}` : ""}</span></div><span className="saved-search-status">Alerts on</span><button className="icon-button" onClick={() => onDeleteSavedSearch(saved.id)} aria-label={`Delete saved search ${saved.name}`}><X size={14} /></button></div>)}</div></section>}
    <div className="market-summary"><div><span className="eyebrow">Showing</span><strong>{items.length} curated listings</strong></div><div className="summary-right"><span><span className="live-dot" /> {items.filter((item) => (item.type === "Auction" || item.type === "Both") && (!item.auctionStartAt || Date.parse(item.auctionStartAt) <= Date.now())).length} auctions live</span><span>{[municipality, province].filter(Boolean).join(", ") || "All locations"}</span></div></div>
    <div className="listing-grid">{items.map((listing) => <ListingCard key={listing.id} listing={listing} favorite={favoriteIds.includes(listing.id)} onFavorite={() => toggleFavorite(listing.id)} onClick={() => onOpenListing(listing.id)} onCompare={() => onCompare(listing.id)} onAddToCart={listing.buyNow ? () => toggleFavorite(listing.id) : undefined} onBuyNow={listing.buyNow ? () => onBuyNow(listing.id) : undefined} />)}</div>
    {items.length === 0 && <div className="empty-state"><Search size={22} /><strong>No listings found</strong><span>Try another item, province, municipality, or listing type.</span></div>}
  </div>;
}
function AuthLoading() {
  return <div className="auth-screen"><div className="auth-card loading-card"><div className="brand-mark"><span /><i /><b /></div><div className="eyebrow teal-text">MerchantHub</div><h1>Loading your workspace…</h1><p>Checking your saved account session.</p></div></div>;
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: (user: AuthUser) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [province, setProvince] = useState("South Cotabato");
  const [municipality, setMunicipality] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setError(""); try { const response = await fetch(`/api/auth/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(mode === "login" ? { email, password } : { name, email, password, province, municipality }) }); const payload = await readJson(response); if (!response.ok) throw new Error(payload.error ?? "Unable to continue"); onAuthenticated(payload.user); toast.success(mode === "login" ? "Welcome back" : "Account created", { description: mode === "login" ? "Your saved MerchantHub session is active." : "Your buyer account starts with a ₱0 e-wallet balance." }); } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to continue"); } finally { setBusy(false); } };
  return <div className="auth-screen"><div className="auth-card"><div className="auth-brand"><div className="brand-mark"><span /><i /><b /></div><div><strong>Merchant<span>Hub</span></strong><small>marketplace OS</small></div></div><div className="eyebrow teal-text">{mode === "login" ? "Welcome back" : "Buyer registration"}</div><h1>{mode === "login" ? "Sign in to trade smarter." : "Create your buyer account."}</h1><p>{mode === "login" ? "Your wallet, bids, orders, and listings stay saved to your account." : "Start as a buyer, then turn on seller mode whenever you are ready."}</p><form onSubmit={submit}>{mode === "register" && <label className="field-label">Full name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Alex Rivera" required /></label>}<label className="field-label">Email<input value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="you@example.com" required /></label><label className="field-label">Password<div className="password-field"><input value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? "text" : "password"} placeholder={mode === "register" ? "At least 6 characters" : "Your password"} required /><button type="button" className="password-toggle" onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={15} /> : <Eye size={15} />}</button></div></label>{mode === "register" && <div className="field-two"><label className="field-label">Province<select value={province} onChange={(event) => { setProvince(event.target.value); setMunicipality(""); }} required>{philippineProvinces.map((item) => <option key={item}>{item}</option>)}</select></label><label className="field-label">Municipality / City<select value={municipality} onChange={(event) => setMunicipality(event.target.value)} required><option value="">Select municipality</option>{municipalitiesFor(province).map((item) => <option key={item}>{item}</option>)}</select></label></div>}{error && <div className="auth-error"><AlertCircle size={14} />{error}</div>}<button className="button primary full" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</button></form><button className="auth-switch" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>{mode === "login" ? "New to MerchantHub? Create an account" : "Already have an account? Sign in"}</button>{mode === "login" && <div className="admin-hint"><ShieldCheck size={14} /><span>Admin dashboard access uses the dedicated account configured by your administrator.</span></div>}</div></div>;
}

function NotificationDropdown({ notifications, readNotifications, offers, onOpen, onMarkRead, onMarkAllRead, onSecondChance }: { notifications: AppNotification[]; readNotifications: string[]; offers: SecondChanceOffer[]; onOpen: (item: AppNotification) => void; onMarkRead: (id: string) => void; onMarkAllRead: () => void; onSecondChance: (listingId: string, action: "accept" | "decline") => void }) {
  return <div className="header-dropdown notification-dropdown"><div className="header-dropdown-head"><div><strong>Notifications</strong><span>{notifications.filter((item) => !readNotifications.includes(item.id)).length} unread</span></div>{notifications.some((item) => !readNotifications.includes(item.id)) && <button className="text-button" onClick={onMarkAllRead}>Mark all read</button>}<Bell size={16} className="coral-text" /></div><div className="header-notification-list">{notifications.map((item) => { const offer = offers.find((candidate) => candidate.listingId === item.entityId); return <div className={`header-notification-row ${readNotifications.includes(item.id) ? "read" : ""}`} role="button" tabIndex={0} key={item.id} onClick={() => onOpen(item)} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) onOpen(item); }}><span className={`note-icon ${item.tone}`}><Bell size={13} /></span><div><strong>{item.label}</strong><span>{item.message || item.time}</span>{!readNotifications.includes(item.id) && <button type="button" className="text-button notification-mark-read" onClick={(event) => { event.stopPropagation(); onMarkRead(item.id); }}>Mark as read</button>}{offer && <span className="notification-actions"><button type="button" onClick={(event) => { event.stopPropagation(); onSecondChance(offer.listingId, "accept"); }}>Accept · {money(offer.amountCents / 100)}</button><button type="button" onClick={(event) => { event.stopPropagation(); onSecondChance(offer.listingId, "decline"); }}>Decline</button></span>}</div>{!readNotifications.includes(item.id) && <i />}</div>; })}</div><div className="header-dropdown-foot">Open an alert to review it, or mark it as read without opening.</div></div>;
}

function WalletView({ walletCents, onFund }: { walletCents: number; onFund: (amountCents?: number) => void }) {
  const [amount, setAmount] = useState("10000");
  return <div className="section-stack"><section className="wallet-hero panel"><div className="wallet-orbit"><WalletCards size={30} /></div><div><div className="eyebrow teal-text">Demo wallet</div><h2>Funds available for bidding</h2><p>Reserved maximum bids on no-cancellation auctions are excluded from the available balance until the auction ends.</p></div><strong>{money(walletCents / 100)}</strong></section><section className="panel wallet-fund-panel"><div className="panel-header"><div><div className="eyebrow">Add funds</div><h2>Top up your e-wallet</h2></div><span className="sandbox-badge"><CircleCheckBig size={13} /> Demo only</span></div><div className="wallet-topup-grid"><label className="field-label">Amount in pesos<input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="numeric" min="100" type="number" /></label><button className="button primary" onClick={() => onFund(Math.round(Number(amount) * 100))}><Plus size={16} /> Add {money(Number(amount) || 0)}</button></div><p className="checkout-note">Demo top-ups are stored to your account and can be used for proxy bids. No real money is charged.</p></section></div>;
}

function ProfileDropdown({ user, sellerMode, setSellerMode, onEnableSeller, onProfile, onLogout }: { user: AuthUser; sellerMode: boolean; setSellerMode: (value: boolean) => void; onEnableSeller: () => void; onProfile: () => void; onLogout: () => void }) {
  return <div className="header-dropdown profile-dropdown"><div className="profile-dropdown-head"><div className="profile-avatar">{user.name.slice(0, 2).toUpperCase()}</div><div><strong>{user.name}</strong><span>{sellerMode ? `Seller · ${user.storeName ?? "Store"}` : "Buyer mode"}</span></div></div>{user.sellerEnabled ? <div className="profile-menu-item"><Store size={15} /><span>Seller mode is permanent</span><span className="switch mini-switch on"><span /></span></div> : <button className="profile-menu-item" onClick={onEnableSeller}><Store size={15} /><span>Turn on seller mode</span><ChevronRight size={14} /></button>}<button className="profile-menu-item" onClick={onProfile}><UserRound size={15} /><span>Profile settings</span><ChevronRight size={14} /></button><button className="profile-menu-item danger" onClick={onLogout}><LogOut size={15} /><span>Log out</span></button></div>;
}

function ProfileModal({ user, onClose, onComplete }: { user: AuthUser; onClose: () => void; onComplete: (user: AuthUser) => void }) {
  const [name, setName] = useState(user.name); const [email, setEmail] = useState(user.email); const [province, setProvince] = useState(user.province ?? ""); const [municipality, setMunicipality] = useState(user.municipality ?? ""); const [image, setImage] = useState(user.storeImage ?? ""); const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); setBusy(true); const response = await fetch("/api/auth/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, email, province, municipality, storeImage: image || null }) }); const payload = await readJson(response); setBusy(false); if (!response.ok) { toast.error(payload.error ?? "Profile could not be saved"); return; } toast.success("Profile updated"); onComplete(payload.user); };
  const selectImage = (event: React.ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => setImage(String(reader.result)); reader.readAsDataURL(file); };
  return <div className="modal-scrim"><form className="create-listing-modal" onSubmit={submit}><div className="modal-header"><div><div className="eyebrow teal-text">Your account</div><h2>Edit profile</h2><p>These details are saved to this account only.</p></div><button type="button" className="icon-button" onClick={onClose}><X size={18} /></button></div>{image && <img className="listing-image-preview" src={image} alt="Profile preview" />}<label className="field-label">Profile image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={selectImage} /></label><label className="field-label">Username / display name<input value={name} onChange={(event) => setName(event.target.value)} required /></label><label className="field-label">Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><div className="field-two"><label className="field-label">Province<select value={province} onChange={(event) => { setProvince(event.target.value); setMunicipality(""); }}>{philippineProvinces.map((item) => <option key={item}>{item}</option>)}</select></label><label className="field-label">Municipality / City<select value={municipality} onChange={(event) => setMunicipality(event.target.value)}><option value="">Select municipality</option>{municipalitiesFor(province).map((item) => <option key={item}>{item}</option>)}</select></label></div><div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={busy}>{busy ? "Saving…" : "Save profile"}</button></div></form></div>;
}

function SellerOnboardingModal({ onClose, onComplete }: { onClose: () => void; onComplete: (user: AuthUser) => void }) {
  const [storeName, setStoreName] = useState(""); const [storeImage, setStoreImage] = useState(""); const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); setBusy(true); const response = await fetch("/api/auth/seller-profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeName, storeImage: storeImage || undefined }) }); const payload = await readJson(response).catch(() => ({})); setBusy(false); if (!response.ok) { toast.error(payload.error ?? "Store profile could not be saved"); return; } onComplete(payload.user); };
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
  const [subcategory, setSubcategory] = useState("Headphones");
  const [type, setType] = useState<Listing["type"]>("Buy now");
  const [price, setPrice] = useState("");
  const [buyNowPrice, setBuyNowPrice] = useState("");
  const [condition, setCondition] = useState<Listing["condition"]>("New");
  const [stock, setStock] = useState("1");
  const [auctionStartAt, setAuctionStartAt] = useState("");
  const [auctionEndAt, setAuctionEndAt] = useState("");
  const [reserveThreshold, setReserveThreshold] = useState("");
  const [minimumIncrement, setMinimumIncrement] = useState("10");
  const [antiSnipeSeconds, setAntiSnipeSeconds] = useState("120");
  const [winnerCancellationAllowed, setWinnerCancellationAllowed] = useState(true);
  const [photos, setPhotos] = useState<string[]>([]);
  const auctionEnabled = type === "Auction" || type === "Both";
  const onImageSelected = (event: React.ChangeEvent<HTMLInputElement>) => { const files = Array.from(event.target.files ?? []).slice(0, 5); if (!files.length) return; if (files.some((file) => !file.type.startsWith("image/"))) { toast.error("Choose image files only"); return; } if (files.some((file) => file.size > 5 * 1024 * 1024)) { toast.error("Each image must be 5 MB or smaller"); return; } Promise.all(files.map((file) => new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(file); }))).then(setPhotos); };
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const amount = Number(price); const buyNowAmount = Number(buyNowPrice); const quantity = Number(stock); const reserve = Number(reserveThreshold); const increment = Number(minimumIncrement); if (!title.trim() || !description.trim() || !Number.isFinite(amount) || amount <= 0 || !Number.isFinite(quantity) || quantity < 1) { toast.error("Complete the required listing fields", { description: "Add a title, description, price, and at least one unit." }); return; } if (type === "Both" && (!Number.isFinite(buyNowAmount) || buyNowAmount <= 0)) { toast.error("Add a separate Buy-now price for Both listings"); return; } const auctionStartUtc = auctionEnabled && auctionStartAt ? philippineDateTimeToUtcIso(auctionStartAt) : null; const auctionEndUtc = auctionEnabled ? philippineDateTimeToUtcIso(auctionEndAt) : null; if (auctionEnabled && (!auctionEndUtc || Date.parse(auctionEndUtc) <= Date.now() || (auctionStartAt && (!auctionStartUtc || Date.parse(auctionStartUtc) <= Date.now() || Date.parse(auctionStartUtc) >= Date.parse(auctionEndUtc))) || !Number.isFinite(reserve) || reserve < 0 || !Number.isFinite(increment) || increment < 1)) { toast.error("Complete the auction settings", { description: "Choose an optional future start and a later closing time in Philippine time (UTC+8)." }); return; } const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null; const lifecycle = submitter?.value === "draft" ? "draft" : "official"; const slug = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}-${Date.now()}`; const gallery = photos.length ? photos : [""]; onCreate({ id: slug, title: title.trim(), description: description.trim(), category, subcategory: subcategory || undefined, type, price: amount, startingBid: auctionEnabled ? amount : undefined, buyNow: type === "Buy now" ? amount : type === "Both" ? buyNowAmount : undefined, auctionStartAt: auctionStartUtc ?? undefined, auctionEndAt: auctionEndUtc ?? undefined, reserveThreshold: auctionEnabled ? reserve : undefined, minimumIncrement: auctionEnabled ? increment : undefined, antiSnipeSeconds: auctionEnabled ? Number(antiSnipeSeconds) : undefined, winnerCancellationAllowed: auctionEnabled ? winnerCancellationAllowed : undefined, image: gallery[0], photos: gallery, seller: "", sellerRating: 5, condition, stock: quantity, accent: "coral" }, lifecycle); };
  return <div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><form className="create-listing-modal" onSubmit={submit}><div className="modal-header"><div><div className="eyebrow coral-text">Seller workspace</div><h2>Create a listing</h2><p>Give buyers the details they need to buy or bid with confidence.</p></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close create listing"><X size={18} /></button></div><div className="listing-form-grid"><label className="field-label field-span-2">Title *<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Vintage film camera" /></label><label className="field-label field-span-2">Description *<textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Describe condition, inclusions, warranty, and any important notes." rows={4} /></label><label className="field-label field-span-2">Product photos (optional · up to 5)<input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={onImageSelected} /><small className="field-help">Choose 1, 2, or up to 5 images, or leave this empty · JPG, PNG, or WebP · 5 MB each</small>{photos.length > 0 && <div className="listing-photo-strip">{photos.map((photo, index) => <img className="listing-image-preview" key={`${photo.slice(0, 20)}-${index}`} src={photo} alt={`Product angle ${index + 1}`} />)}</div>}</label><label className="field-label">Category<select value={category} onChange={(event) => { setCategory(event.target.value); setSubcategory(""); }}><option>Audio</option><option>Cameras</option><option>Clothing</option><option>Footwear</option><option>Homeware</option><option>Collectibles</option></select></label>{<label className="field-label">{category === "Clothing" ? "Clothing type" : `${category} type`}<select value={subcategory} onChange={(event) => setSubcategory(event.target.value)}>{(category === "Clothing" ? ["T-shirt", "Jacket", "Dress", "Pants", "Skirt", "Sweater", "Activewear"] : category === "Footwear" ? ["Sneakers", "Sandals", "Boots", "Formal shoes"] : category === "Cameras" ? ["Mirrorless", "DSLR", "Film camera", "Lens"] : category === "Audio" ? ["Headphones", "Earbuds", "Speaker", "Microphone"] : ["General"]).map((item) => <option key={item}>{item}</option>)}</select></label>}<label className="field-label">Listing type<select value={type} onChange={(event) => setType(event.target.value as Listing["type"])}><option>Buy now</option><option>Auction</option><option>Both</option></select></label><label className="field-label">{type === "Auction" || type === "Both" ? "Starting bid" : "Price"} *<input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="numeric" placeholder="₱ 0" /></label>{type === "Both" && <label className="field-label">Buy-now price *<input value={buyNowPrice} onChange={(event) => setBuyNowPrice(event.target.value)} inputMode="numeric" placeholder="₱ 0" /><small className="field-help">The instant-purchase price is separate from the auction.</small></label>}<label className="field-label">Condition<select value={condition} onChange={(event) => setCondition(event.target.value as Listing["condition"])}><option>New</option><option>Like new</option><option>Good</option></select></label><label className="field-label">Quantity *<input value={stock} onChange={(event) => setStock(event.target.value)} inputMode="numeric" min="1" type="number" /></label>{auctionEnabled && <><label className="field-label">Bidding starts (optional)<input type="datetime-local" value={auctionStartAt} onChange={(event) => setAuctionStartAt(event.target.value)} /><small className="field-help">Leave blank to start immediately. Times use Philippine Standard Time (UTC+8).</small></label><label className="field-label">Auction ends *<input type="datetime-local" value={auctionEndAt} onChange={(event) => setAuctionEndAt(event.target.value)} /><small className="field-help">Must be later than the scheduled start.</small></label><label className="field-label">Reserve threshold *<input value={reserveThreshold} onChange={(event) => setReserveThreshold(event.target.value)} inputMode="numeric" placeholder="₱ 0" /><small className="field-help">Minimum amount you will accept</small></label><label className="field-label">Minimum increment *<input value={minimumIncrement} onChange={(event) => setMinimumIncrement(event.target.value)} inputMode="numeric" placeholder="₱ 100" /><small className="field-help">Seller baseline; buyers may choose a higher increment.</small></label><label className="field-label">Anti-sniping extension (seconds)<input type="number" min="0" value={antiSnipeSeconds} onChange={(event) => setAntiSnipeSeconds(event.target.value)} /><small className="field-help">Extend the auction by this many seconds when a bid arrives in the final window.</small></label><div className="field-span-2 auction-policy-choice"><strong>Winner cancellation policy</strong><label><input type="radio" name="winnerCancellationAllowed" checked={winnerCancellationAllowed} onChange={() => setWinnerCancellationAllowed(true)} /> Winner may cancel before delivery starts</label><label><input type="radio" name="winnerCancellationAllowed" checked={!winnerCancellationAllowed} onChange={() => setWinnerCancellationAllowed(false)} /> No change-of-mind cancellation after winning</label><small className="field-help">For no-change-of-mind-cancellation auctions, buyers enter delivery/contact details and pin their location before bidding. If they win, the reserved demo-wallet amount is charged automatically and an order is created. This does not waive applicable consumer-protection rights.</small></div></>}</div><div className="listing-type-help"><Gavel size={15} /><span><strong>{type === "Buy now" ? "Buy now" : type === "Auction" ? "Auction" : "Auction + Buy now"}</strong> · {auctionEnabled ? "Choose when bidding opens and closes, plus the reserve threshold and minimum increment." : "Buyers can check out instantly."}</span></div><div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="submit" value="draft" className="button secondary">Save as draft</button><button type="submit" value="official" className="button primary"><Plus size={16} /> Publish official</button></div></form></div>;
}
function ItemDetail({ listingId, customListings, authUser, onVisitStore, onCompare, onMessageSeller, onAuction, onCheckout, onBack }: { listingId: string; customListings: Listing[]; authUser: AuthUser | null; onVisitStore: (ownerId: number) => void; onCompare: (listingId: string) => void; onMessageSeller: (listing: Listing) => void; onAuction: (listingId: string) => void; onCheckout: (listingId: string, quantity: number) => void; onBack: () => void }) {
  const listing = customListings.find((item) => item.id === listingId);
  const [quantity, setQuantity] = useState(1);
  const [selectedPhoto, setSelectedPhoto] = useState(0);
  const [galleryTouchStart, setGalleryTouchStart] = useState<number | null>(null);
  const availableStock = listing ? Math.max(0, Math.floor(Number(listing.stock) || 0)) : 0;
  useEffect(() => { setQuantity((current) => availableStock > 0 ? Math.min(Math.max(1, current), availableStock) : 0); }, [listingId, availableStock]);
  if (!listing) return <div className="section-stack"><button className="back-link" onClick={onBack}><ChevronRight size={15} className="rotate-180" /> Back to marketplace</button><section className="panel empty-state"><Search size={22} /><strong>Listing not found</strong><span>This listing may have ended or been removed from the marketplace.</span></section></div>;
  const gallery = listing.photos?.filter(Boolean).length ? listing.photos.filter(Boolean) : listing.image ? [listing.image] : [];
  const isOwner = listing.ownerId === authUser?.id;
  const isAuction = (listing.type === "Auction" || listing.type === "Both") && !isOwner && availableStock > 0;
  const isAuctionScheduled = Boolean(listing.auctionStartAt && Date.parse(listing.auctionStartAt) > Date.now());
  const canBuyNow = (listing.type === "Buy now" || listing.type === "Both") && !isOwner && availableStock > 0;
  const price = listing.buyNow ?? listing.price;
  const changePhotoBySwipe = (endX: number) => { if (galleryTouchStart == null || gallery.length < 2) return; const delta = endX - galleryTouchStart; if (Math.abs(delta) > 35) setSelectedPhoto((current) => (current + (delta < 0 ? 1 : -1) + gallery.length) % gallery.length); setGalleryTouchStart(null); };
  const similarCount = customListings.filter((item) => item.id !== listing.id && item.category.trim().toLowerCase() === listing.category.trim().toLowerCase() && item.type === listing.type).length;
  return <div className="section-stack"><button className="back-link" onClick={onBack}><ChevronRight size={15} className="rotate-180" /> Back to marketplace</button><div className="item-detail-grid"><section className="panel item-visual-panel"><div className="item-detail-image gallery-touch-area" onTouchStart={(event) => setGalleryTouchStart(event.touches[0]?.clientX ?? null)} onTouchEnd={(event) => changePhotoBySwipe(event.changedTouches[0]?.clientX ?? 0)}><img src={gallery[selectedPhoto] || listing.image} alt={listing.title} /></div>{gallery.length > 1 && <div className="item-thumb-row">{gallery.map((photo, index) => <button className={`thumbnail ${index === selectedPhoto ? "active" : ""}`} key={`${photo.slice(0, 20)}-${index}`} onClick={() => setSelectedPhoto(index)}><img src={photo} alt={`${listing.title} angle ${index + 1}`} /></button>)}<span className="photo-count">{gallery.length} photos</span></div>}</section><section className="item-detail-copy"><div className="detail-kicker"><span className="pill coral-pill">{listing.type}</span><span>{listing.category} · {listing.condition}</span></div><h2>{listing.title}</h2><div className="seller-line"><span className="mini-avatar">{listing.seller.slice(0, 2).toUpperCase() || "MH"}</span> {listing.seller || "MerchantHub seller"} <Star size={13} fill="currentColor" /> <strong>{listing.sellerRating}</strong></div><p className="detail-description">{listing.description}</p>{(listing.type === "Auction" || listing.type === "Both") && <div className={`auction-policy-banner compact ${listing.winnerCancellationAllowed === false ? "locked" : "cancellable"}`}><strong>{listing.winnerCancellationAllowed === false ? "No change-of-mind cancellation after winning" : "Winner may cancel before delivery starts"}</strong><span>{listing.winnerCancellationAllowed === false ? "Delivery details and consent are required before bidding; the winning amount is charged automatically if you win. Applicable consumer-protection rights are unaffected." : "Bidding will not charge you automatically; winning buyers complete checkout themselves."}</span></div>}{listing.auctionStartAt && Date.parse(listing.auctionStartAt) > Date.now() && <p className="field-help">Bidding opens {new Date(listing.auctionStartAt).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" })} PHT.</p>}<div className="detail-checkout-box"><div className="detail-checkout-head"><span>{listing.type === "Auction" || listing.type === "Both" ? "Starting bid" : "Buy now"}</span><strong>{money(price)}</strong></div><div className="checkout-line"><span>Available stock</span><b>{availableStock}</b></div>{!isOwner && <div className="quantity-picker"><div><span>Quantity</span><strong>{availableStock > 0 ? <>{quantity} <small>of {availableStock}</small></> : "Out of stock"}</strong></div><div className="quantity-buttons"><button disabled={quantity <= 1} onClick={() => setQuantity((value) => Math.max(1, value - 1))}>−</button><button disabled={availableStock === 0 || quantity >= availableStock} onClick={() => setQuantity((value) => Math.min(availableStock, value + 1))}>+</button></div></div>}<div className="modal-actions">{isOwner ? <button className="button primary" onClick={() => onAuction(listing.id)}><Gavel size={15} /> Open auction dashboard</button> : <>{isAuction && <button className="button primary" onClick={() => onAuction(listing.id)}><Gavel size={15} /> {isAuctionScheduled ? "View scheduled auction" : "Place bid"}</button>}{!isOwner && !isAuction && (listing.type === "Auction" || listing.type === "Both") && availableStock === 0 && <button className="button secondary" disabled><Gavel size={15} /> Out of stock</button>}{canBuyNow && <button className="button secondary" disabled={!canBuyNow} onClick={() => onCheckout(listing.id, quantity)}><ShoppingBag size={15} /> {canBuyNow ? "Buy now" : "Out of stock"}</button>}</>}</div></div><div className="item-trust-row"><span><ShieldCheck size={14} /> Verified seller</span><span><Package size={14} /> {listing.stock} available</span><span><Truck size={14} /> Checkout delivery details next</span></div><div className="modal-actions"><button className="button secondary" onClick={() => onVisitStore(listing.ownerId ?? 0)} disabled={!listing.ownerId}><Store size={15} /> Visit store</button><button className="button secondary" onClick={() => onCompare(listing.id)}><ArrowLeftRight size={15} /> Compare item</button>{!isOwner && <button className="button secondary" onClick={() => onMessageSeller(listing)}><MessageCircle size={15} /> Message seller</button>}</div></section></div><section className="panel item-description-panel"><div className="panel-header"><div><div className="eyebrow">Listing intelligence</div><h2>Compare similar items</h2></div><span>{similarCount} matching</span></div><div className="item-benefits"><div><strong>Category</strong><p>{listing.category}{listing.subcategory ? ` · ${listing.subcategory}` : ""}</p></div><div><strong>Listing type</strong><p>{listing.type}</p></div><div><strong>Seller</strong><p>{listing.seller || "MerchantHub seller"}</p></div></div><button className="text-button comparison-panel-action" onClick={() => onCompare(listing.id)}><ArrowLeftRight size={15} /> Choose a matching item to compare <ChevronRight size={15} /></button></section></div>;
}

function ComparisonView({ baseListingId, candidateListingId, listings: allListings, onChoose, onBackToPicker, onBack, onOpenItem }: { baseListingId: string; candidateListingId?: string; listings: Listing[]; onChoose: (listingId: string) => void; onBackToPicker: () => void; onBack: () => void; onOpenItem: (listingId: string) => void }) {
  const base = allListings.find((item) => item.id === baseListingId);
  const similarListings = base ? allListings.filter((item) => item.id !== base.id && (base.ownerId == null || item.ownerId !== base.ownerId) && (item.lifecycle ?? "official") === "official" && Number(item.stock) > 0 && item.category.trim().toLowerCase() === base.category.trim().toLowerCase() && item.type === base.type) : [];
  const referencePrices = similarListings.map((item) => item.currentBid ?? item.startingBid ?? item.price).filter((price) => Number.isFinite(price)).sort((a, b) => a - b);
  const medianPrice = referencePrices.length ? referencePrices[Math.floor(referencePrices.length / 2)] : null;
  const selected = candidateListingId ? similarListings.find((item) => item.id === candidateListingId) : undefined;
  if (!base) return <div className="section-stack"><button className="back-link" onClick={onBack}><ChevronRight size={15} className="rotate-180" /> Back to item</button><section className="panel empty-state"><Search size={22} /><strong>Item no longer available</strong><span>Return to the original item and try again.</span></section></div>;

  if (selected) {
    const columns = [base, selected];
    const rows: Array<[string, (item: Listing) => string]> = [
      ["Category", (item) => item.category],
      ["Item type", (item) => item.subcategory || item.type],
      ["Listing format", (item) => item.type],
      ["Condition", (item) => item.condition],
      ["Current / starting price", (item) => money(item.currentBid ?? item.startingBid ?? item.price)],
      ["Buy-now price", (item) => item.buyNow ? money(item.buyNow) : "Not available"],
      ["Seller", (item) => `${item.seller || "MerchantHub seller"} · ★ ${item.sellerRating}`],
      ["Available stock", (item) => String(item.stock)],
    ];
    return <div className="section-stack"><button className="back-link" onClick={onBackToPicker}><ChevronRight size={15} className="rotate-180" /> Choose another similar item</button><section className="panel comparison-result-panel"><div className="panel-header"><div><div className="eyebrow teal-text"><ArrowLeftRight size={13} /> Side-by-side comparison</div><h2>Compare these listings</h2><p>Matched by {base.category} category and {base.type} listing type.</p></div><button className="button secondary" onClick={onBackToPicker}>Choose another item</button></div><div className="comparison-horizontal-scroll"><div className="comparison-columns">{columns.map((item) => <article className="comparison-column" key={item.id}><img className="comparison-product-image" src={item.image || "/merchanthub-icon.png"} alt={item.title} /><div className="comparison-product-title"><span className="pill coral-pill">{item.type}</span><h3>{item.title}</h3><span>{item.category}{item.subcategory ? ` · ${item.subcategory}` : ""}</span></div><dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value(item)}</dd></div>)}</dl><button className="button secondary full" onClick={() => onOpenItem(item.id)}>View item details</button></article>)}</div></div></section></div>;
  }

  return <div className="section-stack"><button className="back-link" onClick={onBack}><ChevronRight size={15} className="rotate-180" /> Back to item details</button><section className="panel comparison-picker-panel"><div className="panel-header"><div><div className="eyebrow coral-text"><ArrowLeftRight size={13} /> Marketplace comparison</div><h2>Choose an item to compare</h2><p>Showing other stores’ {base.category} listings with the same {base.type} format as <strong>{base.title}</strong>.</p>{referencePrices.length > 0 && <p className="comparison-market-reference">Market reference: {money(referencePrices[0])}–{money(referencePrices[referencePrices.length - 1])} · median {money(medianPrice ?? 0)} across {referencePrices.length} comparable listings.</p>}</div><span className="count-pill">{similarListings.length} matches</span></div>{similarListings.length ? <div className="comparison-picker-grid">{similarListings.map((item) => <div className="comparison-picker-card" key={item.id}><ListingCard listing={item} favorite={false} onFavorite={() => undefined} onClick={() => onChoose(item.id)} /><button className="button primary full" onClick={() => onChoose(item.id)}><ArrowLeftRight size={15} /> Compare with this item</button></div>)}</div> : <div className="empty-state"><Search size={22} /><strong>No matching items yet</strong><span>There are no other {base.category} listings with the same {base.type} type. Check back when similar items are listed.</span></div>}</section></div>;
}

function SellerBiddingOverview({ listings: sourceListings, onOpenAuction }: { listings: Listing[]; onOpenAuction: (id: string) => void }) {
  const [filter, setFilter] = useState<"All" | "Scheduled" | "Ongoing" | "Ended" | "Sold" | "Sold out">("All");
  const [, setClock] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const auctions = sourceListings.filter((listing) => (listing.type === "Auction" || listing.type === "Both") && listing.lifecycle !== "deleted" && listing.lifecycle !== "draft");
  const ended = auctions.filter((listing) => listing.lifecycle === "auction-ended");
  const sold = auctions.filter((listing) => listing.lifecycle === "sold");
  const soldOut = auctions.filter((listing) => listing.lifecycle === "official" && Number(listing.stock) <= 0);
  const scheduled = auctions.filter((listing) => listing.lifecycle === "official" && Number(listing.stock) > 0 && Boolean(listing.auctionStartAt && Date.parse(listing.auctionStartAt) > Date.now()) && (!listing.auctionEndAt || Date.parse(listing.auctionEndAt) > Date.now()));
  const ongoing = auctions.filter((listing) => listing.lifecycle === "official" && Number(listing.stock) > 0 && isLiveAuctionListing(listing));
  const visible = filter === "Scheduled" ? scheduled : filter === "Ongoing" ? ongoing : filter === "Ended" ? ended : filter === "Sold" ? sold : filter === "Sold out" ? soldOut : auctions;
  return <div className="section-stack"><section className="panel"><div className="panel-header"><div><div className="eyebrow coral-text"><span className="live-dot" /> Seller bid overview</div><h2>{auctions.length} auction listings</h2><span className="field-help">Monitor live bids, countdowns, and auctions that have closed.</span></div></div><div className="filter-tabs seller-auction-filters">{(["All", "Scheduled", "Ongoing", "Ended", "Sold", "Sold out"] as const).map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}<span>{item === "All" ? auctions.length : item === "Scheduled" ? scheduled.length : item === "Ongoing" ? ongoing.length : item === "Ended" ? ended.length : item === "Sold" ? sold.length : soldOut.length}</span></button>)}</div>{visible.length ? <div className="bid-history-list">{visible.map((listing) => <SellerAuctionCard key={listing.id} listing={listing} onOpen={() => onOpenAuction(listing.id)} />)}</div> : <div className="empty-state"><Gavel size={22} /><strong>{filter === "All" ? "No auction listings yet" : `No ${filter.toLowerCase()} auctions`}</strong><span>Create and publish an auction from Inventory to track it here.</span></div>}</section></div>;
}

function SellerAuctionCard({ listing, onOpen }: { listing: Listing; onOpen: () => void }) {
  const [summary, setSummary] = useState<any>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const load = () => {
      fetch(`/api/bids/summary?listingId=${encodeURIComponent(listing.id)}`).then((response) => readJson(response)).then(setSummary).catch(() => undefined);
      fetch(`/api/bids/history?listingId=${encodeURIComponent(listing.id)}`).then((response) => readJson(response)).then((payload) => setRows(payload.history ?? [])).catch(() => undefined);
    };
    load();
    const stream = new EventSource(`/api/bids/stream?listingId=${encodeURIComponent(listing.id)}`);
    stream.onmessage = load;
    const timer = window.setInterval(load, 15000);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { stream.close(); window.clearInterval(timer); window.clearInterval(clock); };
  }, [listing.id]);
  const ranked = [...rows].sort((a, b) => (b.maxBidCents ?? 0) - (a.maxBidCents ?? 0));
  const leader = summary?.leadingBidder ?? (ranked.find((row) => row.status === "won" || row.status === "active" || row.status === "offered") ? { name: ranked.find((row) => row.status === "won" || row.status === "active" || row.status === "offered")?.bidder, maxBidCents: ranked.find((row) => row.status === "won" || row.status === "active" || row.status === "offered")?.maxBidCents, userId: ranked.find((row) => row.status === "won" || row.status === "active" || row.status === "offered")?.userId, status: ranked.find((row) => row.status === "won" || row.status === "active" || row.status === "offered")?.status } : null);
  const second = leader ? ranked.find((row) => row.userId !== leader.userId && ["outbid", "active", "offered"].includes(row.status)) : null;
  const endTime = listing.auctionEndAt ? new Date(listing.auctionEndAt).getTime() : null;
  const secondsLeft = endTime == null ? null : Math.max(0, Math.floor((endTime - now) / 1000));
  const startTime = listing.auctionStartAt ? new Date(listing.auctionStartAt).getTime() : null;
  const startsIn = startTime == null ? null : Math.max(0, Math.floor((startTime - now) / 1000));
  const isScheduled = startTime != null && startsIn! > 0 && listing.lifecycle === "official";
  const ongoing = isLiveAuctionListing(listing);
  const soldOut = listing.lifecycle === "official" && Number(listing.stock) <= 0;
  const outcome = listing.lifecycle === "sold" ? "Sold" : listing.lifecycle === "auction-ended" ? listing.secondChancePending ? "Second chance pending" : "Ended without a sale" : soldOut ? "Out of stock" : isScheduled ? "Scheduled" : ongoing ? "Auction ongoing" : "Auction ended";
  return <article className="bid-history-card seller-auction-card"><div><div className="eyebrow">{outcome}</div><h3>{listing.title}</h3><span>{rows.length} recorded bids · {summary?.currentBidCents ? money(summary.currentBidCents / 100) : money(listing.startingBid ?? listing.price)} current</span><div className={`seller-auction-countdown ${ongoing || isScheduled ? "ongoing" : "ended"}`}><Clock3 size={14} /><span>{isScheduled ? `Starts in ${formatCountdown(startsIn ?? 0)}` : ongoing ? secondsLeft == null ? "No end time set" : `Ends in ${formatCountdown(secondsLeft)}` : endTime == null ? "Auction closed" : `Ended ${new Date(endTime).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}`}</span></div><div className="bid-timeline compact-timeline">{rows.slice(0, 3).map((row) => <span key={row.id}><b>{row.bidder ?? "Bidder"}</b> {money((row.currentBidCents || row.maxBidCents) / 100)}</span>)}</div></div><div><strong>{leader?.name ?? (listing.lifecycle === "auction-ended" ? "No winner" : "No bids yet")}</strong><small>{leader ? leader.status === "won" ? "Winner" : leader.status === "offered" ? "Offer pending" : isScheduled ? "Not open yet" : ongoing ? "Leading" : "Winning" : listing.lifecycle === "auction-ended" ? "No sale · re-auction available" : "No bid"} · {leader?.maxBidCents ? money(leader.maxBidCents / 100) : "—"}</small><small>Second · {second?.bidder ? `${second.bidder} · ${money(second.maxBidCents / 100)}` : "—"}</small><button className="button primary" onClick={onOpen}><Gavel size={14} /> {isScheduled ? "Review schedule" : ongoing ? "Monitor auction" : "Review auction"}</button></div></article>;
}
function BiddingHistoryView({ history, onOpenAuction, onRequestCancellation, onCancelWon }: { history: any[]; onOpenAuction: (bid: any) => void; onRequestCancellation: (bidId: number) => void; onCancelWon: (bidId: number) => void }) {
  const [expandedListingId, setExpandedListingId] = useState<string | null>(null);
  const groups = new Map<string, any[]>();
  for (const bid of history) {
    const key = String(bid.listingId ?? bid.id);
    groups.set(key, [...(groups.get(key) ?? []), bid]);
  }
  const items = [...groups.entries()].map(([listingId, bids]) => ({ listingId, bids }));
  return <div className="section-stack"><section className="panel"><div className="panel-header"><div><div className="eyebrow teal-text"><span className="live-dot teal" /> Your bidding history</div><h2>{items.length ? `${items.length} auction items` : "No bids yet"}</h2><span className="field-help">{history.length} bid updates grouped by item. Expand an item to see only its bid history.</span></div><button className="button primary" onClick={() => window.location.assign("/auctions")}><Gavel size={15} /> Browse live auctions</button></div><div className="buyer-bid-groups">{items.length ? items.map(({ listingId, bids }) => {
    const latest = bids[0];
    const highestCap = Math.max(...bids.map((bid) => Number(bid.maxBidCents ?? 0)));
    const status = bids.find((bid) => ["Won", "Winning", "Second-chance offer"].includes(bid.bidderStatus))?.bidderStatus ?? latest?.bidderStatus ?? "Outbid";
    const expanded = expandedListingId === listingId;
    return <article className={`buyer-bid-group ${expanded ? "expanded" : ""}`} key={listingId}><div className="buyer-bid-group-head"><button className="buyer-bid-group-toggle" aria-expanded={expanded} onClick={() => setExpandedListingId(expanded ? null : listingId)}><span className="buyer-bid-group-title"><strong>{latest?.listingTitle ?? listingId}</strong><small>{bids.length} bid update{bids.length === 1 ? "" : "s"} · latest {new Date(latest.createdAt).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}</small></span><span className="buyer-bid-group-cap"><strong>{money(highestCap / 100)}</strong><small>highest max cap</small></span><span className={`status-badge ${String(status).toLowerCase().replaceAll(" ", "-")}`}>{status}</span><ChevronDown size={17} className={expanded ? "buyer-bid-chevron open" : "buyer-bid-chevron"} /></button><button className="button secondary tiny buyer-open-detail" onClick={() => onOpenAuction(latest)}>Item details</button></div>{expanded && <div className="buyer-bid-group-content"><div className="buyer-bid-history-heading"><strong>{bids.length} bid update{bids.length === 1 ? "" : "s"} on {latest?.listingTitle ?? listingId}</strong><span>Newest first</span></div>{bids.map((bid, index) => <div className="buyer-bid-event-row" key={bid.id}><div className="buyer-bid-event-main"><strong>Bid update {bids.length - index}</strong><span>{new Date(bid.createdAt).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}</span></div><div className="buyer-bid-event-cap"><strong>{money(Number(bid.maxBidCents ?? bid.currentBidCents ?? 0) / 100)}</strong><span>Max cap · increment {money(Number(bid.incrementCents ?? 0) / 100)}</span></div><span className="status-badge">{bid.bidderStatus}</span>{bid.bidderStatus === "Winning" && bid.auctionState === "Auction ongoing" && <button className="button secondary tiny" onClick={() => onRequestCancellation(bid.id)}>Request cancellation</button>}{bid.bidderStatus === "Won" && bid.winnerCancellationAllowed !== false && (!bid.orderId || bid.orderStatus === "Processing") && <button className="button secondary tiny" onClick={() => onCancelWon(bid.id)}>Cancel won item</button>}</div>)}</div>}</article>;
  }) : <div className="empty-state"><Gavel size={22} /><strong>No persisted bids yet</strong><span>Place a bid and it will appear here grouped under its item.</span></div>}</div></section></div>;
}

function BiddingDetailView({ listingId, history, authUser, walletCents, onBack, onCancelWon, onOpenOrder, onVisitStore, onMessageSeller }: { listingId: string; history: any[]; authUser: AuthUser; walletCents: number; onBack: () => void; onCancelWon: (bidId: number) => void; onOpenOrder: (orderId: string) => void; onVisitStore: (ownerId: number) => void; onMessageSeller: (listing: Listing) => void }) {
  const rows = history.filter((bid) => bid.listingId === listingId);
  const winningBid = rows.find((bid) => bid.bidderStatus === "Won");
  const primaryBid = winningBid ?? rows[0];
  const [listing, setListing] = useState<Listing | null>(null);
  const [listingError, setListingError] = useState("");
  useEffect(() => {
    let current = true;
    setListing(null); setListingError("");
    fetch(`/api/listings/${encodeURIComponent(listingId)}`).then((response) => readJson(response)).then((payload) => { if (current) setListing(payload.listing ?? null); }).catch((error) => { if (current) setListingError(error instanceof Error ? error.message : "Item details are not available."); });
    return () => { current = false; };
  }, [listingId]);
  const status = winningBid ? "You are the winner" : primaryBid?.bidderStatus === "Winning" ? "You are currently winning" : primaryBid?.auctionState ?? "Auction record";
  const paidAmountCents = winningBid ? (winningBid.currentBidCents || winningBid.maxBidCents) : primaryBid ? (primaryBid.currentBidCents || primaryBid.maxBidCents) : null;
  const photos = listing?.photos?.filter(Boolean).length ? listing.photos.filter(Boolean) : listing?.image ? [listing.image] : [];
  const cancellationAllowed = listing?.winnerCancellationAllowed !== false;
  return <div className="section-stack">
    <button className="back-link" onClick={onBack}><ChevronRight size={15} className="rotate-180" /> Back to bidding history</button>
    {listing ? <section className="panel bidder-auction-detail">
      <div className="eyebrow teal-text">Your auction detail</div>
      <div className="bidder-auction-layout">
        <div className="bidder-auction-gallery"><img className="bidder-auction-cover" src={photos[0] ?? "/placeholder-product.png"} alt={listing.title} /><div className="bidder-auction-thumbnails">{photos.slice(0, 5).map((photo, index) => <img src={photo} alt={`${listing.title} photo ${index + 1}`} key={`${photo}-${index}`} />)}</div></div>
        <div className="bidder-auction-copy">
          <span className={`status-badge ${winningBid ? "won" : ""}`}>{status}</span><h2>{listing.title}</h2>
          <p className="field-help">{listing.category}{listing.subcategory ? ` · ${listing.subcategory}` : ""} · {listing.condition}</p>
          <p className="detail-description">{listing.description || "No additional seller description was provided."}</p>
          <div className={`auction-policy-banner ${cancellationAllowed ? "cancellable" : "locked"}`}><strong>{cancellationAllowed ? "Winner may cancel before delivery starts" : "No change-of-mind cancellation after winning"}</strong><span>{cancellationAllowed ? "No wallet funds are taken just for bidding. If you win, confirm delivery and checkout manually; cancelling an e-wallet-paid order before delivery starts returns the demo-wallet payment." : "Visible before bidding: the buyer provides delivery details and explicitly agrees to automatic checkout. The winning amount is charged from the reserved demo-wallet balance and an order is created."}</span></div>
          <div className="bidder-auction-facts"><div><span>{winningBid ? "Winning amount" : "Your bid"}</span><strong>{paidAmountCents == null ? "—" : money(paidAmountCents / 100)}</strong></div><div><span>Seller</span><strong>{listing.seller}</strong></div><div><span>Listing status</span><strong>{listing.lifecycle === "sold" ? "Sold to winner" : listing.lifecycle === "auction-ended" ? listing.secondChancePending ? "Second-chance offer pending" : "Auction ended" : "Auction ongoing"}</strong></div></div>
          <div className="bidder-auction-actions"><button className="button secondary" disabled={!listing.ownerId} onClick={() => listing.ownerId && onVisitStore(listing.ownerId)}><Store size={15} /> Visit seller store</button><button className="button primary" disabled={!listing.ownerId} onClick={() => onMessageSeller(listing)}><MessageCircle size={15} /> Message seller</button>{winningBid && cancellationAllowed && (!winningBid.orderId || winningBid.orderStatus === "Processing") && <button className="button secondary" onClick={() => onCancelWon(winningBid.id)}>Cancel won item</button>}</div>
          {winningBid && winningBid.orderId && <div className="inline-feedback"><PackageCheck size={15} /><span>Your order receipt is ready.</span><button className="text-button" onClick={() => onOpenOrder(winningBid.orderId)}>Open receipt</button></div>}
          {winningBid && !winningBid.orderId && !cancellationAllowed && <div className="checkout-note">Automatic checkout was expected at auction close. If you cannot see an order receipt, contact the seller before retrying any payment.</div>}
          {winningBid && !winningBid.orderId && cancellationAllowed && listing.lifecycle === "sold" && <AuctionWinnerCheckout bidId={winningBid.id} amountCents={paidAmountCents ?? 0} authUser={authUser} walletCents={walletCents} onOrder={onOpenOrder} />}
        </div>
      </div>
    </section> : <section className="panel empty-state"><Gavel size={22} /><strong>{listingError || "Loading auction item…"}</strong><span>{rows.length ? "Fetching the item details, photos, seller, and bid result." : "This account has no bid history for this auction."}</span></section>}
    <section className="panel"><div className="eyebrow teal-text">Your bid record</div><h2>{primaryBid?.listingTitle ?? listing?.title ?? listingId}</h2><p className="field-help">Your private bids and outcome for this item.</p><div className="bid-history-list">{rows.map((bid) => <div className="bid-history-card" key={bid.id}><div><strong>{new Date(bid.createdAt).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}</strong><span>{bid.auctionState}</span></div><div><strong>{money((bid.currentBidCents || bid.maxBidCents) / 100)}</strong><small>Maximum {money(bid.maxBidCents / 100)}</small></div><span className="status-badge">{bid.bidderStatus}</span></div>)}</div></section>
  </div>;
}
function AuctionDetail({ listing, sellerView = false, auctionSummary, auctionSeconds, auctionStartSeconds, walletCents, currentBid, viewerBidStatus = "You have not bid", viewerBidCurrentCents = 0, viewerMaxBidCents = 0, bidAmount, maxBid, bidIncrement, automaticBidding, authUser, setAutomaticBidding, setBidAmount, setMaxBid, setBidIncrement, bidFeed, placeBid }: { listing?: Listing; sellerView?: boolean; auctionSummary?: any; auctionSeconds: number; auctionStartSeconds: number; walletCents: number; currentBid: number; viewerBidStatus?: string; viewerBidCurrentCents?: number; viewerMaxBidCents?: number; bidAmount: string; maxBid: string; bidIncrement: string; automaticBidding: boolean; authUser: AuthUser; setAutomaticBidding: (value: boolean) => void; setBidAmount: (value: string) => void; setMaxBid: (value: string) => void; setBidIncrement: (value: string) => void; bidFeed: BidFeedItem[]; placeBid: (delivery?: AuctionDeliveryDetails) => void }) {
  const [deliveryPhone, setDeliveryPhone] = useState("");
  const [deliveryProvince, setDeliveryProvince] = useState(authUser.province ?? "South Cotabato");
  const [deliveryMunicipality, setDeliveryMunicipality] = useState(authUser.municipality ?? "");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryPosition, setDeliveryPosition] = useState<[number, number] | null>(null);
  const [autoCheckoutConsent, setAutoCheckoutConsent] = useState(false);
  useEffect(() => { setDeliveryPhone(""); setDeliveryAddress(""); setDeliveryPosition(null); setAutoCheckoutConsent(false); setDeliveryProvince(authUser.province ?? "South Cotabato"); setDeliveryMunicipality(authUser.municipality ?? ""); if (!listing?.id) return; let current = true; fetch(`/api/bids/proxy?listingId=${encodeURIComponent(listing.id)}`).then((response) => readJson(response)).then((payload) => { const saved = payload.proxy; if (!current || !saved?.shippingPhone || !saved?.shippingProvince || !saved?.shippingMunicipality || !saved?.shippingAddressDetails || !saved?.shippingLatitude || !saved?.shippingLongitude) return; setDeliveryPhone(saved.shippingPhone); setDeliveryProvince(saved.shippingProvince); setDeliveryMunicipality(saved.shippingMunicipality); setDeliveryAddress(saved.shippingAddressDetails); setDeliveryPosition([Number(saved.shippingLatitude), Number(saved.shippingLongitude)]); setAutoCheckoutConsent(true); }).catch(() => undefined); return () => { current = false; }; }, [listing?.id, authUser.id]);
  const requiresAutoCheckout = listing?.winnerCancellationAllowed === false;
  const preBidReady = Boolean(deliveryPhone.trim() && deliveryProvince && deliveryMunicipality && deliveryAddress.trim() && deliveryPosition && autoCheckoutConsent);
  const locateDeliveryPin = () => { if (!navigator.geolocation) { toast.error("This browser does not support location"); return; } navigator.geolocation.getCurrentPosition((position) => { setDeliveryPosition([position.coords.latitude, position.coords.longitude]); toast.success("Delivery pin saved"); }, () => toast.error("Allow location access to pin the delivery address"), { enableHighAccuracy: true }); };
  const submitAuctionBid = () => { if (requiresAutoCheckout) { if (!deliveryPhone.trim() || !deliveryProvince || !deliveryMunicipality || !deliveryAddress.trim() || !deliveryPosition || !autoCheckoutConsent) { toast.error("Complete delivery details and consent first", { description: "A no-cancellation auction requires a phone, address, map pin, and auto-checkout consent before bidding." }); return; } placeBid({ phone: deliveryPhone.trim(), province: deliveryProvince, municipality: deliveryMunicipality, addressDetails: deliveryAddress.trim(), latitude: deliveryPosition[0], longitude: deliveryPosition[1], autoCheckoutConsent: true }); return; } placeBid(); };
  if (!listing) return <div className="section-stack"><section className="panel empty-state"><Gavel size={22} /><strong>No live auctions</strong><span>Official user listings will appear here when an auction is published.</span></section></div>;
  const visibleCurrentBid = currentBid || listing.startingBid || listing.price;
  const reserveMet = listing.reserveThreshold == null || visibleCurrentBid >= listing.reserveThreshold;
  const watcherCount = new Set(bidFeed.map((bid) => bid.bidder)).size;
  const isScheduled = Boolean(listing.auctionStartAt && Date.parse(listing.auctionStartAt) > Date.now() && auctionStartSeconds > 0);
  const scheduledStartText = listing.auctionStartAt ? new Date(listing.auctionStartAt).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }) : "";
  const scheduledEndText = listing.auctionEndAt ? new Date(listing.auctionEndAt).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }) : "";
  return <div className="section-stack"><button className="back-link"><ChevronRight size={15} className="rotate-180" /> Back to live auctions</button><div className="auction-detail-grid"><section className="panel auction-visual-panel"><div className="detail-image"><img src={listing.image} alt={listing.title} /><div className="image-overlay"><span className="pill dark-pill">{listing.lifecycle === "sold" ? <>Sold to winner</> : listing.lifecycle === "auction-ended" ? <>Ended without a sale</> : listing.stock <= 0 ? <>Out of stock</> : isScheduled ? <><Clock3 size={12} /> Scheduled</> : auctionSeconds > 0 ? <><Radio size={12} /> Live now</> : <><Clock3 size={12} /> Auction ended</>}</span><span className="watchers"><Eye size={13} /> {watcherCount} bidder{watcherCount === 1 ? "" : "s"}</span></div></div><div className="thumbnail-row">{(listing.photos?.filter(Boolean).length ? listing.photos.filter(Boolean) : [listing.image]).slice(0, 4).map((photo, index) => <div className={`thumbnail ${index === 0 ? "active" : ""}`} key={photo}><img src={photo} alt={`${listing.title} angle ${index + 1}`} /></div>)}<span className="photo-count">{listing.photos?.filter(Boolean).length ?? 1} photo{(listing.photos?.filter(Boolean).length ?? 1) === 1 ? "" : "s"}</span></div></section><section className="auction-detail-copy"><div className="detail-kicker"><span className="pill coral-pill">Auction</span><span>{listing.category} · {listing.condition}</span></div><h2>{listing.title}</h2><div className="seller-line"><span className="mini-avatar">{listing.seller.slice(0, 2).toUpperCase()}</span> {listing.seller} <Star size={13} fill="currentColor" /> <strong>{listing.sellerRating}</strong><span className="seller-verified"><ShieldCheck size={13} /> Verified seller</span></div><p className="detail-description">{listing.description || "Review the seller-provided condition, included items, and delivery details before placing a bid."}</p><div className="detail-metrics"><div><span>{currentBid ? "Current highest bid" : "Starting bid"}</span><strong>{money(visibleCurrentBid)}</strong><small>{bidFeed.length} recorded bids</small></div><div><span>Reserve price</span><strong className={reserveMet ? "teal-text" : "coral-text"}>{reserveMet ? "Met" : "Not met"}</strong><small>{reserveMet ? "Eligible to win" : "Reserve still protected"}</small></div><div><span>{isScheduled ? "Starts in" : "Ends in"}</span><strong>{formatCountdown(isScheduled ? auctionStartSeconds : auctionSeconds)}</strong><small>{isScheduled ? `Opens ${scheduledStartText} PHT` : auctionSeconds === 0 ? "Auction ended" : "Live countdown · anti-snipe on"}</small></div></div><div className={`auction-policy-banner ${requiresAutoCheckout ? "locked" : "cancellable"}`}><strong>{requiresAutoCheckout ? "No change-of-mind cancellation after winning" : "Winner may cancel before delivery starts"}</strong><span>{requiresAutoCheckout ? "Before bidding, the buyer must provide delivery details and agree to automatic demo-wallet checkout. Applicable consumer-protection rights are unaffected." : "Bidding does not charge your wallet. If you win, complete delivery details and checkout manually."}</span></div>{sellerView ? <div className="panel seller-auction-dashboard"><div className="eyebrow teal-text">Seller auction dashboard</div><h3>{auctionSummary?.leadingBidder ? `${auctionSummary.leadingBidder.status === "won" ? "Winner" : auctionSummary.leadingBidder.status === "offered" ? "Second chance" : "Leading"}: ${auctionSummary.leadingBidder.name}` : auctionSummary?.bidCount ? "No eligible winner" : "No bids yet"}</h3><div className="detail-metrics"><div><span>Current winning bid</span><strong>{money((auctionSummary?.currentBidCents ?? (currentBid * 100 || listing.price * 100)) / 100)}</strong></div><div><span>Total bids</span><strong>{auctionSummary?.bidCount ?? bidFeed.length}</strong></div><div><span>Status</span><strong>{listing.lifecycle === "sold" ? "Sold · winner recorded" : listing.lifecycle === "auction-ended" ? listing.secondChancePending ? "Second-chance offer pending" : "Ended without a sale" : listing.stock <= 0 ? "Sold out" : isScheduled ? "Scheduled" : auctionSeconds > 0 ? "Ongoing" : "Ended"}</strong></div></div>{isScheduled && <small className="bid-helper">Opens {scheduledStartText} PHT and closes {scheduledEndText} PHT.</small>}<small className="bid-helper">Only you can see bidder names and maximum bid details for this auction.</small></div> : isScheduled ? <section className="panel scheduled-auction-notice"><div className="eyebrow coral-text">Bidding is scheduled</div><h3>Starts in {formatCountdown(auctionStartSeconds)}</h3><p>Bidding opens {scheduledStartText} PHT and closes {scheduledEndText} PHT. You can place a bid once the countdown reaches zero.</p></section> : <div className="bid-box"><div className="bid-box-head"><div><span className="eyebrow coral-text"><span className="live-dot" /> Live bidding</span><strong>Choose your next bid from the timeline</strong><small className="wallet-balance">E-wallet available: {money(walletCents / 100)}</small></div><Zap size={20} /></div><div className={`bidder-live-status ${viewerBidStatus === "Winning" || viewerBidStatus === "Winner" ? "winning" : viewerBidStatus === "Outbid" || viewerBidStatus === "Auction ended" ? "outbid" : ""}`}><div><span>Your status</span><strong>{viewerBidStatus}</strong></div><div><span>Current winning bid</span><strong>{money(currentBid || visibleCurrentBid)}</strong></div><div><span>Your bid / max cap</span><strong>{viewerMaxBidCents ? `${viewerBidCurrentCents ? money(viewerBidCurrentCents / 100) : viewerBidStatus === "Outbid" ? "Outbid" : "—"} / ${money(viewerMaxBidCents / 100)}` : "—"}</strong></div></div><div className="bid-fields"><label>Place bid<input value={bidAmount} onChange={(event) => setBidAmount(event.target.value)} inputMode="numeric" /></label>{automaticBidding && <><label>Maximum bid cap<input value={maxBid} onChange={(event) => setMaxBid(event.target.value)} inputMode="numeric" /></label><label>Automatic increment<input value={bidIncrement} onChange={(event) => setBidIncrement(event.target.value)} inputMode="numeric" min="1" /></label></>}</div>{requiresAutoCheckout && <div className="auction-prebid-checkout"><div><strong>Delivery details required before bidding</strong><small className="field-help">If you win, the winning price will be charged automatically from your reserved demo-wallet funds and an order receipt will be created.</small></div><div className="field-two"><label className="field-label">Phone number *<input value={deliveryPhone} onChange={(event) => setDeliveryPhone(event.target.value)} autoComplete="tel" required /></label><label className="field-label">Province *<select value={deliveryProvince} onChange={(event) => { setDeliveryProvince(event.target.value); setDeliveryMunicipality(""); }} required>{philippineProvinces.map((province) => <option key={province}>{province}</option>)}</select></label></div><label className="field-label">Municipality / City *<select value={deliveryMunicipality} onChange={(event) => setDeliveryMunicipality(event.target.value)} required><option value="">Select municipality</option>{municipalitiesFor(deliveryProvince).map((municipality) => <option key={municipality}>{municipality}</option>)}</select></label><label className="field-label">Full delivery address *<textarea value={deliveryAddress} onChange={(event) => setDeliveryAddress(event.target.value)} rows={2} required placeholder="House/building, street, barangay, and delivery notes" /></label><div className="auction-pin-head"><span className="field-help">Pin your delivery point (required)</span><button type="button" className="button secondary tiny" onClick={locateDeliveryPin}><MapPinned size={13} /> Use my location</button></div><CheckoutLocationMap position={deliveryPosition} onChange={setDeliveryPosition} /><label className="proxy-toggle auction-consent"><input type="checkbox" checked={autoCheckoutConsent} onChange={(event) => setAutoCheckoutConsent(event.target.checked)} /><span><strong>I agree to automatic checkout and no change-of-mind cancellation</strong><small>MerchantHub will reserve my maximum bid now. If I win, the winning amount will be charged automatically and an order will be created.</small></span></label>{!preBidReady && <small className="field-help">Complete the required delivery fields, pin the map, and check the consent box to enable bidding.</small>}</div>}<label className="proxy-toggle"><input type="checkbox" checked={automaticBidding} onChange={(event) => setAutomaticBidding(event.target.checked)} /><span><strong>Use automatic bidding</strong><small>Set your max cap and increment. After you confirm, the proxy stays active until outbid above your cap or the auction ends.</small></span></label><button className="button primary full" onClick={submitAuctionBid} disabled={isScheduled || auctionSeconds === 0 || listing.stock <= 0 || (requiresAutoCheckout && !preBidReady)}><Gavel size={16} /> {listing.stock <= 0 ? "Out of stock" : isScheduled ? "Scheduled to start" : auctionSeconds === 0 ? "Auction ended" : automaticBidding ? `Start automatic bidding · ${money(Number(bidAmount) || 0)}` : `Place bid · ${money(Number(bidAmount) || 0)}`}</button><small className="bid-helper">Need more balance? Open E-wallet from the sidebar to add demo funds.</small>{automaticBidding && <small className="bid-helper">Automatic responses use this increment and stop at your max cap. Your first bid still follows the seller’s minimum increment.</small>}</div>}</section></div><div className="auction-lower-grid"><section className="panel"><div className="panel-header"><div><div className="eyebrow">Transparent by design</div><h2>Bid history</h2></div><span className="live-feed-label"><span className="live-dot teal" /> Live feed</span></div><div className="bid-timeline">{bidFeed.map((bid) => <div className={`bid-event ${bid.status === "Winning" || bid.status === "Winner" ? "leading" : ""}`} key={bid.id}><div className="timeline-line" /><span className={`mini-avatar ${bid.status === "Winning" || bid.status === "Winner" ? "coral-avatar" : ""}`}>{bid.initials}</span><div><strong>{bid.amount > 0 ? money(bid.amount) : bid.status}</strong><span>{bid.bidder} · {bid.time}</span>{sellerView && bid.cancellationReason && <small className="bid-cancellation-reason">Buyer cancellation reason: {bid.cancellationReason}</small>}</div><em className={bid.status === "Winning" || bid.status === "Winner" ? "winning" : "outbid"}>{bid.status}</em></div>)}</div></section><section className="panel auction-notes"><div className="panel-header"><div><div className="eyebrow">Seller protection</div><h2>Good to know</h2></div><ShieldCheck size={19} className="teal-text" /></div><div className="note-row"><span className="note-icon teal"><Check size={15} /></span><div><strong>{reserveMet ? "Reserve price met" : "Reserve not met"}</strong><span>{reserveMet ? "This item is eligible to win at auction close." : "The current bid must reach the seller’s reserve."}</span></div></div><div className="note-row"><span className="note-icon coral"><Clock3 size={15} /></span><div><strong>Anti-snipe extension on</strong><span>A final-second bid adds 2 minutes for fair play.</span></div></div><div className="note-row"><span className="note-icon lavender"><MessageCircle size={15} /></span><div><strong>Ask the seller</strong><span>Start a private chat about condition or shipping.</span></div></div><div className="note-row"><span className="note-icon mustard"><Sparkles size={15} /></span><div><strong>Second chance offers</strong><span>If reserve is not met, the next eligible bidder can receive an offer.</span></div></div><div className="note-row"><span className="note-icon teal"><RefreshCcw size={15} /></span><div><strong>Relist ready</strong><span>Unsold inventory can be relisted in one click after close.</span></div></div><button className="button secondary full" onClick={() => toast.success("Open Messages from the sidebar to start a seller chat.")}><MessageCircle size={15} /> Open live chat</button></section></div></div>;
}

function CheckoutLocationMap({ position, onChange }: { position: [number, number] | null; onChange: (position: [number, number]) => void }) {
  const element = useRef<HTMLDivElement | null>(null); const map = useRef<L.Map | null>(null); const pin = useRef<L.Marker | null>(null); const fallback: [number, number] = [6.228, 125.068];
  useEffect(() => { if (!element.current || map.current) return; const initial = position ?? fallback; const userIcon = L.divIcon({ className: "checkout-user-marker-wrap", html: '<div class="checkout-user-marker"><span class="checkout-user-arrow">➤</span><span class="checkout-user-label">You are here</span></div>', iconSize: [112, 48], iconAnchor: [20, 38] }); map.current = L.map(element.current).setView(initial, 14); L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap contributors" }).addTo(map.current); pin.current = L.marker(initial, { draggable: true, icon: userIcon }).addTo(map.current).bindPopup("You are here. Drag the arrow to your exact delivery point."); pin.current.on("dragend", () => { const point = pin.current?.getLatLng(); if (point) onChange([point.lat, point.lng]); }); return () => { map.current?.remove(); map.current = null; }; }, []);
  useEffect(() => { if (!map.current || !position || !pin.current) return; pin.current.setLatLng(position); map.current.panTo(position); }, [position]);
  return <div><div className="checkout-location-editor"><strong>Delivery pin</strong><span className="field-help">Drag the pin to the exact place where the rider should meet you.</span></div><div className="leaflet-rider-map checkout-map" ref={element} /></div>;
}

function AuctionWinnerCheckout({ bidId, amountCents, authUser, walletCents, onOrder }: { bidId: number; amountCents: number; authUser: AuthUser; walletCents: number; onOrder: (orderId: string) => void }) {
  const [province, setProvince] = useState(authUser.province ?? "South Cotabato");
  const [municipality, setMunicipality] = useState(authUser.municipality ?? "");
  const [phone, setPhone] = useState("");
  const [addressDetails, setAddressDetails] = useState("");
  const [position, setPosition] = useState<[number, number] | null>(null);
  const [payment, setPayment] = useState<"E-wallet" | "COD">("E-wallet");
  const [busy, setBusy] = useState(false);
  const locate = () => { if (!navigator.geolocation) { toast.error("This browser does not support location"); return; } navigator.geolocation.getCurrentPosition((current) => { setPosition([current.coords.latitude, current.coords.longitude]); toast.success("Delivery pin saved"); }, () => toast.error("Allow location access to pin delivery"), { enableHighAccuracy: true }); };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!phone.trim() || !province || !municipality || !addressDetails.trim()) { toast.error("Complete your delivery details before checkout"); return; }
    setBusy(true);
    try {
      const response = await fetch(`/api/bids/${bidId}/checkout`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, province, municipality, addressDetails, payment, latitude: position?.[0], longitude: position?.[1] }) });
      const payload = await readJson(response);
      if (!response.ok) { toast.error(payload.error ?? "Auction checkout could not be completed"); return; }
      toast.success(payload.existing ? "Order receipt opened" : "Auction order placed", { description: payment === "E-wallet" ? "Your demo-wallet payment was recorded." : "Your order is confirmed for Cash on Delivery." });
      onOrder(payload.orderId);
    } catch {
      toast.error("Auction checkout failed. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };
  return <form className="auction-winner-checkout" onSubmit={submit}>
    <div className="eyebrow teal-text">Complete winner checkout</div><h3>Confirm delivery and payment</h3>
    <p className="field-help">Nothing was charged just for bidding. The winning amount is {money(amountCents / 100)}; you may cancel before delivery starts under this seller’s policy.</p>
    <div className="field-two"><label className="field-label">Phone number *<input value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" required /></label><label className="field-label">Province *<select value={province} onChange={(event) => { setProvince(event.target.value); setMunicipality(""); }} required>{philippineProvinces.map((item) => <option key={item}>{item}</option>)}</select></label></div>
    <label className="field-label">Municipality / City *<select value={municipality} onChange={(event) => setMunicipality(event.target.value)} required><option value="">Select municipality</option>{municipalitiesFor(province).map((item) => <option key={item}>{item}</option>)}</select></label>
    <label className="field-label">Delivery address *<textarea value={addressDetails} onChange={(event) => setAddressDetails(event.target.value)} rows={2} required placeholder="House/building, street, barangay, and delivery instructions" /></label>
    <div className="auction-pin-head"><span className="field-help">Delivery pin (optional for cancellable auctions)</span><button type="button" className="button secondary tiny" onClick={locate}><MapPinned size={13} /> Use my location</button></div><CheckoutLocationMap position={position} onChange={setPosition} />
    <label className="field-label">Payment method<select value={payment} onChange={(event) => setPayment(event.target.value as "E-wallet" | "COD")}><option value="E-wallet">MerchantHub demo E-wallet · {money(walletCents / 100)} available</option><option value="COD">Cash on Delivery</option></select></label>
    {payment === "E-wallet" && walletCents < amountCents && <small className="field-help coral-text">Your available balance is lower than the winning amount. Add demo funds or choose Cash on Delivery.</small>}
    <button className="button primary" disabled={busy || (payment === "E-wallet" && walletCents < amountCents)}>{busy ? "Placing order…" : payment === "E-wallet" ? `Pay ${money(amountCents / 100)} and place order` : "Place Cash on Delivery order"}</button>
  </form>;
}

function CheckoutPage({ listingId, customListings, authUser, onBack, onOrder }: { listingId: string; customListings: Listing[]; authUser: AuthUser; onBack: () => void; onOrder: (orderId: string) => void }) {
  const listing = customListings.find((item) => item.id === listingId) ?? { id: listingId, title: "Listing unavailable", description: "This listing has ended or was removed.", category: "", type: "Buy now" as const, price: 0, image: "", seller: "", sellerRating: 0, condition: "New" as const, stock: 1, accent: "teal" as const }; const availableStock = Math.max(0, Math.floor(Number(listing.stock) || 0)); const params = new URLSearchParams(window.location.search); const [quantity, setQuantity] = useState(availableStock > 0 ? Math.min(availableStock, Math.max(1, Number(params.get("quantity")) || 1)) : 0); const [province, setProvince] = useState(authUser.province ?? "South Cotabato"); const [municipality, setMunicipality] = useState(authUser.municipality ?? ""); const [address, setAddress] = useState(""); const [instructions, setInstructions] = useState(""); const [contact, setContact] = useState(""); const [payment, setPayment] = useState<"Online" | "COD">("Online"); const [position, setPosition] = useState<[number, number] | null>(null); const [busy, setBusy] = useState(false); useEffect(() => { setQuantity((current) => availableStock > 0 ? Math.min(Math.max(1, current), availableStock) : 0); }, [listingId, availableStock]); const total = (listing.buyNow ?? listing.price) * quantity;
  const locate = () => { if (!navigator.geolocation) return toast.error("This browser does not support location"); navigator.geolocation.getCurrentPosition((current) => { setPosition([current.coords.latitude, current.coords.longitude]); toast.success("Delivery pin saved"); }, () => toast.error("Allow location access to pin delivery"), { enableHighAccuracy: true }); };
  const submit = async (event: FormEvent) => { event.preventDefault(); if (quantity < 1 || availableStock < 1) { toast.error("This item is out of stock"); return; } if (!municipality || !address.trim() || !contact.trim()) { toast.error("Complete your delivery address and contact number"); return; } setBusy(true); const response = await fetch("/api/orders/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listingId: listing.id, quantity, amountCents: Math.round(total * 100), payment, province, municipality, addressDetails: `${address.trim()}${instructions.trim() ? ` · Instructions: ${instructions.trim()}` : ""} · Contact: ${contact.trim()}`, destinationLatitude: position?.[0], destinationLongitude: position?.[1] }) }); const payload = await readJson(response); setBusy(false); if (!response.ok) { toast.error(payload.error ?? "Checkout could not be created"); return; } toast.success("Order placed"); onOrder(payload.orderId); };
  return <div className="section-stack"><button className="back-link" onClick={onBack}><ChevronRight size={15} className="rotate-180" /> Back to listing</button><form className="panel checkout-page" onSubmit={submit}><div className="panel-header"><div><div className="eyebrow teal-text">Secure Philippine checkout</div><h2>Delivery and order details</h2><p>Give the rider the exact place and instructions for delivery.</p></div><span className="checkout-total">{money(total)}</span></div><div className="checkout-item-summary"><img src={listing.image} alt={listing.title} /><div><strong>{listing.title}</strong><span>{quantity} × {money(listing.buyNow ?? listing.price)}</span><span>{listing.seller}</span></div><div className="quantity-buttons"><input type="number" min="1" max={listing.stock} value={quantity} onChange={(event) => setQuantity(Math.max(1, Math.min(availableStock, Number(event.target.value) || 1)))} /><button type="button" onClick={() => setQuantity((value) => Math.max(1, value - 1))}>−</button><button type="button" onClick={() => setQuantity((value) => Math.min(availableStock, value + 1))}>+</button></div></div><div className="eyebrow">Delivery address</div><div className="field-two"><label className="field-label">Province<select value={province} onChange={(event) => { setProvince(event.target.value); setMunicipality(""); }} required>{philippineProvinces.map((item) => <option key={item}>{item}</option>)}</select></label><label className="field-label">Municipality / City<select value={municipality} onChange={(event) => setMunicipality(event.target.value)} required><option value="">Select municipality</option>{municipalitiesFor(province).map((item) => <option key={item}>{item}</option>)}</select></label></div><label className="field-label">House number, street, barangay, and landmark<textarea value={address} onChange={(event) => setAddress(event.target.value)} rows={3} placeholder="Example: 12 Mabini St., Brgy. Poblacion, near the public market" required /></label><div className="field-two"><label className="field-label">Contact number<input value={contact} onChange={(event) => setContact(event.target.value)} placeholder="09XX XXX XXXX" required /></label><label className="field-label">Rider instructions<input value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Gate code, preferred time, etc. (optional)" /></label></div><button type="button" className="button secondary" onClick={locate}><MapPinned size={15} /> {position ? "Delivery pin saved" : "Use my current location"}</button><CheckoutLocationMap position={position} onChange={setPosition} /><div className="eyebrow">Payment</div><div className="payment-methods"><button type="button" className={`payment-method-option ${payment === "Online" ? "active" : ""}`} onClick={() => setPayment("Online")}><WalletCards size={14} /><span><strong>E-wallet</strong><small>Protected online payment</small></span></button><button type="button" className={`payment-method-option ${payment === "COD" ? "active" : ""}`} onClick={() => setPayment("COD")}><Truck size={14} /><span><strong>Cash on Delivery</strong><small>Pay the rider in pesos</small></span></button></div><div className="checkout-summary"><span>Items × {quantity}</span><strong>{money(total)}</strong></div><button className="button primary full" disabled={busy}>{busy ? "Placing order…" : `Confirm order · ${money(total)}`}</button></form></div>;
}

function OrderReceipt({ orderId, accountOrders, onBack }: { orderId: string; accountOrders: any[]; onBack: () => void }) {
  const [loadedOrder, setLoadedOrder] = useState<any>(accountOrders.find((item) => item.orderId === orderId));
  const [riderLocation, setRiderLocation] = useState<any>(null);
  useEffect(() => { if (!loadedOrder || !["Rider assigned", "Picked up", "In transit"].includes(loadedOrder.status)) return; const loadLocation = () => fetch(`/api/orders/${orderId}/location`).then((response) => readJson(response)).then((payload) => { setRiderLocation(payload.location ?? null); if (payload.order) setLoadedOrder(payload.order); }).catch(() => undefined); loadLocation(); const timer = window.setInterval(loadLocation, 3000); return () => window.clearInterval(timer); }, [orderId, loadedOrder?.status]);
  useEffect(() => { if (loadedOrder) return; fetch(`/api/orders/${orderId}`).then((response) => readJson(response)).then((payload) => { if (payload.order) setLoadedOrder(payload.order); }).catch(() => undefined); }, [orderId, loadedOrder]);
  const order = loadedOrder; if (!order) return <div className="section-stack"><button className="back-link" onClick={onBack}><ChevronRight size={15} className="rotate-180" /> Back to orders</button><section className="panel empty-state"><PackageOpen size={22} /><strong>Loading receipt…</strong><span>Your order details will appear after the account refreshes.</span></section></div>;
  return <div className="section-stack"><button className="back-link" onClick={onBack}><ChevronRight size={15} className="rotate-180" /> Back to orders</button><section className="panel receipt-page"><div className="receipt-header"><div><div className="eyebrow teal-text">MerchantHub order receipt</div><h2>{order.orderId}</h2><span>{new Date(order.createdAt).toLocaleString("en-PH")}</span></div><StatusBadge status={order.status} /></div><div className="receipt-grid"><div><span>Listing</span><strong>{order.listingId}</strong></div><div><span>Quantity</span><strong>{Number(order.quantity ?? 0)} item{Number(order.quantity ?? 0) === 1 ? "" : "s"}</strong></div><div><span>Total</span><strong>{money((order.amountCents ?? 0) / 100)}</strong></div><div><span>Payment</span><strong>{order.payment === "COD" ? "Cash on Delivery" : order.payment === "Online" ? "Online payment" : "MerchantHub demo E-wallet"}</strong></div><div><span>Buyer</span><strong>{order.buyerName || "Buyer"}</strong></div><div><span>Seller / store</span><strong>{order.sellerName || "Seller"}</strong></div></div><div className="receipt-address"><MapPinned size={18} /><div><strong>Delivery destination</strong><span>{order.province} · {order.municipality}</span><span>{order.addressDetails || "No additional address details provided."}</span>{order.contactNumber && <span>Contact: {order.contactNumber}</span>}</div></div>{riderLocation && <div className="receipt-address"><MapPinned size={18} /><div><strong>Rider location · {riderLocation.moving ? "Moving now" : "Stationary"}</strong><span>Updated {riderLocation.updatedAt ? new Date(riderLocation.updatedAt).toLocaleTimeString("en-PH") : "just now"}</span><span>Coordinates: {Number(riderLocation.latitude).toFixed(5)}, {Number(riderLocation.longitude).toFixed(5)}</span></div></div>}<div className="receipt-timeline"><div className="active"><Check size={14} /><span>Order placed</span></div><div className={order.status !== "Processing" ? "active" : ""}><Package size={14} /><span>Rider assigned</span></div><div className={order.status === "Delivered" ? "active" : ""}><Truck size={14} /><span>Delivered</span></div></div><button className="button secondary" onClick={() => window.print()}><Printer size={15} /> Print receipt</button></section></div>;
}

function OrdersView({ orders: accountOrders, deliveryStatuses, changeOrderStatus, onOpenOrder }: { orders: any[]; deliveryStatuses: Record<string, OrderStatus>; changeOrderStatus: (id: string, status: OrderStatus) => void; onOpenOrder: (id: string) => void }) {
  const tabs = ["All orders", "Needs action", "In transit", "Delivered"];
  const [tab, setTab] = useState("All orders");
  const orders = accountOrders.map((order) => ({ id: order.orderId, customer: order.buyerName ?? order.buyerId, item: order.listingId, amount: (order.amountCents ?? 0) / 100, status: order.status, payment: order.payment, location: `${order.province} · ${order.municipality}`, eta: "Live update", tracking: order.orderId, rider: order.riderId ? `Rider ${order.riderId}` : undefined }));
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const filtered = orders.filter((order) => tab === "All orders" || (tab === "Needs action" ? ["Processing", "Rider assigned", "Disputed"].includes(order.status) : tab === "In transit" ? ["Rider assigned", "Picked up", "In transit"].includes(order.status) : order.status === "Delivered")); const gross = orders.reduce((sum, order) => sum + order.amount, 0); const inTransit = orders.filter((order) => ["Processing", "Rider assigned", "Picked up", "In transit"].includes(order.status)).length; const attention = orders.filter((order) => ["Processing", "Rider assigned", "Disputed"].includes(order.status)).length;
  return <div className="section-stack"><div className="toolbar-row"><div className="filter-tabs">{tabs.map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}{item === "Needs action" && <span className="tab-count">{attention}</span>}</button>)}</div><button className="button secondary" onClick={() => setTab(tab === "All orders" ? "Needs action" : "All orders")}><Filter size={15} /> {tab === "All orders" ? "Show needs action" : "Show all orders"}</button></div><div className="order-kpis"><MetricCard label="Orders total" value={money(gross)} delta="Live data" detail={`${orders.length} connected orders`} tone="teal" icon={WalletCards} /><MetricCard label="In transit" value={String(inTransit)} delta="Live data" detail="current handoffs" tone="coral" icon={Clock3} /><MetricCard label="Needs action" value={String(attention)} delta="Live data" detail="orders needing attention" tone="lavender" icon={ShieldCheck} /></div><section className="panel table-panel"><div className="panel-header"><div><div className="eyebrow">Order queue</div><h2>{filtered.length} orders in view</h2></div></div><div className="responsive-table"><table><thead><tr><th>Order</th><th>Customer / item</th><th>Amount</th><th>Status</th><th>Tracking</th><th>Delivery / rider</th><th /></tr></thead><tbody>{filtered.map((order) => { const status = deliveryStatuses[order.id] ?? order.status; const rider = assignments[order.id] ?? order.rider ?? "Unassigned"; return <tr key={order.id}><td><button className="text-button mono" onClick={() => onOpenOrder(order.id)}><FileSearch size={14} /> {order.id}</button><span className="table-sub">{order.payment} payment · click for receipt</span></td><td><strong>{order.customer}</strong><span className="table-sub">{order.item}</span></td><td><strong>{money(order.amount)}</strong><span className="table-sub">Payment protected</span></td><td><StatusBadge status={status} /></td><td><strong className="mono">{order.tracking}</strong><span className="table-sub">Live tracking</span></td><td><div className="delivery-cell"><span>{order.location}</span><small>{order.eta}</small><select className="assignment-select" value={rider} onChange={(event) => { setAssignments((current) => ({ ...current, [order.id]: event.target.value })); toast.success(`${order.id} rider updated`, { description: event.target.value }); }}><option>Unassigned</option><option>Paolo R.</option><option>Nina C.</option><option>Marc D.</option></select></div></td><td><button className="icon-button" onClick={() => onOpenOrder(order.id)} aria-label={`Open logistics for ${order.id}`}><MoreHorizontal size={17} /></button></td></tr>; })}</tbody></table></div></section><div className="order-note"><div className="note-icon teal"><ShieldCheck size={15} /></div><div><strong>Payments are protected until delivery is confirmed.</strong><span>Funds release when the buyer confirms delivery or the protection window closes.</span></div><button className="text-button" onClick={() => toast.success("Escrow protection", { description: "Funds remain protected until delivery is confirmed or the protection window closes." })}>Learn about escrow <ChevronRight size={14} /></button></div></div>;
}

function RiderDesk({ online, setOnline, deliveryStatuses, changeOrderStatus, authUser, riderOrders, filter: externalFilter, onFilterChange }: { online: boolean; setOnline: (value: boolean) => void; deliveryStatuses: Record<string, OrderStatus>; changeOrderStatus: (id: string, status: OrderStatus) => void; authUser: AuthUser | null | undefined; riderOrders: any[]; filter?: RiderQueueFilter; onFilterChange?: (filter: RiderQueueFilter) => void }) {
  const [localFilter, setLocalFilter] = useState<RiderQueueFilter>("Available");
  const activeFilter = externalFilter ?? localFilter;
  const updateFilter = onFilterChange ?? setLocalFilter;
  const [acceptedOrder, setAcceptedOrder] = useState<any>(() => riderOrders.find((order) => ["Rider assigned", "Picked up", "In transit"].includes(order.status)) ?? null);
  const [acceptedOrderIds, setAcceptedOrderIds] = useState<string[]>(() => { try { return JSON.parse(window.localStorage.getItem("merchantHub:rider:activeOrders") ?? "[]"); } catch { return []; } });
  const [availableOrders, setAvailableOrders] = useState(riderOrders);
  const [position, setPosition] = useState<[number, number] | null>(null);
  const [moving, setMoving] = useState(false);
  const [heading, setHeading] = useState(0);
  const [headingMode, setHeadingMode] = useState<"gps" | "compass" | null>(null);
  const [locationState, setLocationState] = useState<"idle" | "tracking" | "error">("idle");
  const [locationError, setLocationError] = useState("");
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [compassEnabled, setCompassEnabled] = useState(false);
  const destination: [number, number] | null = acceptedOrder?.destinationLatitude != null && acceptedOrder?.destinationLongitude != null ? [Number(acceptedOrder.destinationLatitude), Number(acceptedOrder.destinationLongitude)] : null;

  useEffect(() => {
    setAvailableOrders(riderOrders);
    const savedIds = (() => { try { return JSON.parse(window.localStorage.getItem("merchantHub:rider:activeOrders") ?? "[]") as string[]; } catch { return []; } })();
    const activeStatuses = ["Rider assigned", "Picked up", "In transit"];
    const assigned = riderOrders.find((order) => order.riderId === authUser?.id && activeStatuses.includes(order.status)) ?? riderOrders.find((order) => activeStatuses.includes(order.status));
    const activeIds = savedIds.filter((id) => riderOrders.some((order) => order.orderId === id && activeStatuses.includes(order.status)));
    setAcceptedOrderIds(activeIds); window.localStorage.setItem("merchantHub:rider:activeOrders", JSON.stringify(activeIds));
    setAcceptedOrder((current: any) => { const refreshed = current ? riderOrders.find((order) => order.orderId === current.orderId) : undefined; if (refreshed && activeStatuses.includes(refreshed.status)) return refreshed; return current && activeStatuses.includes(current.status) ? current : assigned ?? null; });
  }, [riderOrders, authUser?.id]);

  useEffect(() => {
    if (!acceptedOrder || !online || !["Rider assigned", "Picked up", "In transit"].includes(acceptedOrder.status)) {
      setLocationState("idle");
      setPosition(null);
      setMoving(false);
      return;
    }
    if (!navigator.geolocation) {
      setLocationState("error");
      setLocationError("This browser does not support GPS location.");
      return;
    }
    let previous: [number, number] | null = null;
    let lastSent: [number, number] | null = null;
    let lastSentAt = 0;
    const distanceMeters = (a: [number, number], b: [number, number]) => {
      const radians = Math.PI / 180;
      const dLat = (b[0] - a[0]) * radians;
      const dLon = (b[1] - a[1]) * radians;
      const x = dLon * Math.cos((a[0] + b[0]) * radians / 2);
      return Math.sqrt(dLat * dLat + x * x) * 6371000;
    };
    setLocationError("");
    setLocationState("tracking");
    const watcher = navigator.geolocation.watchPosition((current) => {
      const next: [number, number] = [current.coords.latitude, current.coords.longitude];
      const movedMeters = previous ? distanceMeters(previous, next) : 0;
      const gpsHeading = current.coords.heading;
      if (gpsHeading != null && Number.isFinite(gpsHeading)) {
        setHeading((gpsHeading + 360) % 360);
        setHeadingMode("gps");
      } else if (previous && movedMeters >= 3) {
        const radians = Math.PI / 180;
        const lat1 = previous[0] * radians;
        const lat2 = next[0] * radians;
        const dLon = (next[1] - previous[1]) * radians;
        const bearing = Math.atan2(Math.sin(dLon) * Math.cos(lat2), Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon));
        setHeading((bearing * 180 / Math.PI + 360) % 360);
        setHeadingMode("gps");
      }
      previous = next;
      setPosition(next);
      setAccuracy(Number.isFinite(current.coords.accuracy) ? current.coords.accuracy : null);
      setMoving(current.coords.speed != null ? current.coords.speed > 0.5 || movedMeters >= 3 : movedMeters >= 3);
      setLocationState("tracking");
      setLocationError("");
      const now = Date.now();
      if (!lastSent || now - lastSentAt >= 5000 || distanceMeters(lastSent, next) >= 15) {
        lastSent = next;
        lastSentAt = now;
        fetch("/api/rider/location", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: acceptedOrder.orderId, latitude: next[0], longitude: next[1], accuracy: current.coords.accuracy, moving: current.coords.speed != null ? current.coords.speed > 0.5 || movedMeters >= 3 : movedMeters >= 3 }) }).catch(() => undefined);
      }
    }, (error) => {
      const message = error.code === error.PERMISSION_DENIED ? "Location access is blocked. Allow location for this site in your browser settings." : error.code === error.TIMEOUT ? "Waiting for a GPS fix timed out. Move outdoors or try again." : "Could not read this device's location.";
      setLocationState("error");
      setLocationError(message);
      setPosition(null);
      setMoving(false);
    }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
    return () => navigator.geolocation.clearWatch(watcher);
  }, [online, acceptedOrder?.orderId, acceptedOrder?.status]);

  useEffect(() => {
    if (!acceptedOrder || !online) return;
    const orientationApi = (window as any).DeviceOrientationEvent;
    if (!orientationApi?.requestPermission) setCompassEnabled(true);
  }, [acceptedOrder?.orderId, online]);

  useEffect(() => {
    if (!compassEnabled || !acceptedOrder || !online) return;
    const updateHeading = (rawEvent: Event) => {
      const event = rawEvent as DeviceOrientationEvent & { webkitCompassHeading?: number };
      const compassHeading = Number.isFinite(event.webkitCompassHeading) ? event.webkitCompassHeading! : event.alpha == null ? null : event.absolute ? (360 - event.alpha + 360) % 360 : null;
      if (compassHeading != null) {
        setHeading((compassHeading + 360) % 360);
        setHeadingMode("compass");
      }
    };
    window.addEventListener("deviceorientationabsolute", updateHeading);
    window.addEventListener("deviceorientation", updateHeading);
    return () => {
      window.removeEventListener("deviceorientationabsolute", updateHeading);
      window.removeEventListener("deviceorientation", updateHeading);
    };
  }, [compassEnabled, acceptedOrder?.orderId, online]);

  const enableCompass = async () => {
    const orientationApi = (window as any).DeviceOrientationEvent;
    if (typeof orientationApi?.requestPermission === "function") {
      try {
        const permission = await orientationApi.requestPermission();
        if (permission !== "granted") { toast.error("Compass permission was not granted"); return; }
      } catch { toast.error("This browser could not enable the compass"); return; }
    }
    setCompassEnabled(true);
    toast.success("Compass enabled", { description: "The rider arrow can now follow your device direction." });
  };

  const accept = async (orderId: string) => {
    const order = availableOrders.find((row: any) => (row.orderId ?? row.id) === orderId);
    if (!window.confirm(`Accept delivery ${orderId}${order?.item ? ` for ${order.item}` : ""}? This assigns the delivery to you and starts live location tracking.`)) return;
    const response = await fetch(`/api/orders/${orderId}/accept`, { method: "POST" });
    const payload = await readJson(response);
    if (!response.ok) { toast.error(payload.error ?? "Unable to accept delivery"); return; }
    setAcceptedOrder(payload.order);
    setAcceptedOrderIds((current) => { const next = Array.from(new Set([...current, payload.order.orderId])); window.localStorage.setItem("merchantHub:rider:activeOrders", JSON.stringify(next)); return next; });
    setAvailableOrders((rows) => rows.map((row) => (row.orderId === orderId ? payload.order : row)));
    toast.success("Delivery accepted", { description: "The buyer was notified. Live GPS tracking is starting." });
  };

  const cancelPickup = async (orderId: string) => {
    if (!window.confirm(`Cancel pickup for ${orderId}? The buyer and seller will be told and the order will return to the available queue.`)) return;
    const response = await fetch(`/api/orders/${orderId}/cancel-pickup`, { method: "POST" });
    const payload = await readJson(response);
    if (!response.ok) { toast.error(payload.error ?? "Pickup could not be cancelled"); return; }
    setAvailableOrders((rows) => rows.map((row) => row.orderId === orderId ? { ...row, status: "Processing", riderId: null } : row));
    setAcceptedOrder((current: any) => current?.orderId === orderId ? null : current);
    setAcceptedOrderIds((current) => { const next = current.filter((id) => id !== orderId); window.localStorage.setItem("merchantHub:rider:activeOrders", JSON.stringify(next)); return next; });
    toast.success("Pickup cancelled", { description: "The order is back in the queue for another rider." });
  };
  const advanceStatus = async (orderId: string, status: OrderStatus) => {
    const response = await fetch(`/api/orders/${orderId}/status`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    const payload = await readJson(response);
    if (!response.ok) { toast.error(payload.error ?? "Unable to update delivery status"); return; }
    setAvailableOrders((rows) => rows.map((row) => row.orderId === orderId ? { ...row, status } : row));
    setAcceptedOrder((current: any) => current?.orderId === orderId ? ["Delivered", "Cancelled"].includes(status) ? null : { ...current, status } : current);
    if (["Delivered", "Cancelled"].includes(status)) setAcceptedOrderIds((current) => { const next = current.filter((id) => id !== orderId); window.localStorage.setItem("merchantHub:rider:activeOrders", JSON.stringify(next)); return next; });
    toast.success(`Delivery ${status.toLowerCase()}`, { description: `${orderId} is now marked ${status}.` });
  };
  const visibleOrders = filterRiderOrders(availableOrders, activeFilter);
  const tracking = locationState === "tracking" && position != null;
  return <div className="section-stack"><div className="rider-hero"><div><div className="eyebrow teal-text"><span className="live-dot teal" /> Rider network · {online ? "Live" : "Paused"}</div><h2>Live delivery control.</h2><p>Accept a delivery and allow GPS access. Keep this page open while delivering so your location and direction update live.</p></div><div className="availability-control"><div className="profile-avatar rider-avatar">MR</div><div><strong>{authUser?.name ?? "MerchantHub Rider"}</strong><span>{authUser?.municipality ?? "South Cotabato"}{authUser?.province ? ` · ${authUser.province}` : ""}</span></div><button className={`switch ${online ? "on" : ""}`} onClick={() => setOnline(!online)} aria-label="Toggle rider availability"><span /></button></div></div><div className="rider-grid"><section className="panel map-panel"><div className="panel-header"><div><div className="eyebrow">Live GPS + compass</div><h2>{acceptedOrder ? "Tracking accepted order" : "Waiting for accepted delivery"}</h2></div><span className={`location-chip ${tracking ? "is-tracking" : ""}`}><span className={`live-dot ${tracking && moving ? "teal" : ""}`} /> {tracking ? moving ? "Moving now" : "Live GPS" : locationState === "error" ? "GPS unavailable" : online ? "GPS starts on acceptance" : "Tracking paused"}</span></div><RiderLeafletMap position={position} destination={destination} heading={heading} /><div className="map-footer"><span><span className="legend-dot teal" /> {tracking ? `Rider GPS · ±${Math.round(accuracy ?? 0)} m${headingMode ? ` · ${headingMode}` : ""}` : "Rider position appears after a live GPS fix"}</span><span>{locationError || (acceptedOrder ? `${acceptedOrder.province ?? "South Cotabato"} · ${acceptedOrder.municipality ?? "Polomolok"}` : "Accept an order to begin")}</span></div>{acceptedOrder && online && !compassEnabled && <button className="button secondary compass-enable" onClick={enableCompass}><MapPinned size={14} /> Enable device compass</button>}</section><section className="panel delivery-queue"><div className="panel-header"><div><div className="eyebrow">Rider delivery queue</div><h2>{activeFilter} · {visibleOrders.length} orders</h2></div><span className="queue-count">{acceptedOrderIds.length} active · Rider only</span></div><div className="filter-tabs rider-filter-tabs">{riderQueueFilters.map((item) => <button key={item} className={activeFilter === item ? "active" : ""} onClick={() => updateFilter(item)}>{item}<span>{filterRiderOrders(availableOrders, item).length}</span></button>)}</div>{visibleOrders.map((order: any, index: number) => <div className="delivery-card" key={order.orderId ?? order.id}><div className="stop-index">0{index + 1}</div><div className="delivery-card-main"><div className="delivery-title"><strong>{order.item}</strong><StatusBadge status={order.status === "Processing" ? "Processing" : order.status} /></div><span>{order.customer ?? "Buyer"} · {order.province ?? "South Cotabato"} · {order.municipality ?? "Polomolok"}</span><small><MapPinned size={13} /> Buyer location is visible after checkout</small></div>{order.status === "Processing" && <button className="queue-action" disabled={!online} onClick={() => accept(order.orderId ?? order.id)}>Accept</button>}{order.status === "Rider assigned" && <><button className="queue-action" onClick={() => { setAcceptedOrder(order); setAcceptedOrderIds((current) => { const next = Array.from(new Set([...current, order.orderId])); window.localStorage.setItem("merchantHub:rider:activeOrders", JSON.stringify(next)); return next; }); }}>Go here first</button><button className="queue-action" onClick={() => advanceStatus(order.orderId, "Picked up")}>Picked up</button><button className="queue-action cancel-pickup-action" onClick={() => cancelPickup(order.orderId)}>Cancel pickup</button></>}{order.status === "Picked up" && <button className="queue-action" onClick={() => advanceStatus(order.orderId, "In transit")}>In transit</button>}{order.status === "In transit" && <button className="queue-action" onClick={() => advanceStatus(order.orderId, "Delivered")}>Delivered</button>}</div>)}</section></div></div>;
}
function RiderOnlyShell({ authUser, riderOrders, onLogout }: { authUser: AuthUser; riderOrders: any[]; onLogout: () => void }) {
  const [online, setOnline] = useState(true); const [signedOut, setSignedOut] = useState(false); const [filter, setFilter] = useState<RiderQueueFilter>("Available");
  if (signedOut) return <SignedOutScreen onReturn={() => setSignedOut(false)} />;
  const counts = Object.fromEntries(riderQueueFilters.map((item) => [item, filterRiderOrders(riderOrders, item).length])) as Record<RiderQueueFilter, number>;
  const icons = { Available: PackageOpen, Assigned: Truck, "Picked up": PackageCheck, "In transit": MapPinned, Delivered: Check, Cancelled: X };
  return <div className="app-shell rider-only-shell"><aside className="sidebar rider-sidebar"><div className="brand-lockup"><div className="brand-mark" aria-hidden="true"><span /><i /><b /></div><div><strong>Merchant<span>Hub</span></strong><small>rider network</small></div></div><div className="workspace-switcher"><div className="workspace-avatar">MR</div><div><strong>{authUser.name}</strong><span>{authUser.municipality || "Rider workspace"}</span></div></div><nav className="sidebar-nav" aria-label="Rider delivery filters"><div className="nav-group"><div className="nav-label">Delivery queue</div>{riderQueueFilters.map((item) => { const Icon = icons[item]; return <button key={item} className={`nav-item ${filter === item ? "active" : ""}`} onClick={() => setFilter(item)}><Icon size={17} /><span>{item}</span><em>{counts[item]}</em></button>; })}</div></nav><div className="profile-row"><div className="profile-avatar">{authUser.name.slice(0, 2).toUpperCase()}</div><div><strong>{authUser.name}</strong><span>Rider account</span></div></div></aside><main className="main-area"><header className="topbar"><div className="breadcrumb"><strong>MerchantHub Rider Desk</strong></div><div className="topbar-actions"><span className="status-dot-label"><span className="live-dot teal" /> Rider account</span><button className="button secondary" onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); window.localStorage.removeItem("merchantHub:rider:activeOrder"); onLogout(); setSignedOut(true); }}>Log out</button></div></header><div className="page-content"><div className="page-heading"><div><div className="eyebrow teal-text">Delivery operations</div><h1>Welcome, {authUser.name}</h1><p>Filter jobs by availability, pickup, delivery, and completion status.</p></div></div><RiderDesk online={online} setOnline={setOnline} deliveryStatuses={{}} changeOrderStatus={() => undefined} authUser={authUser} riderOrders={riderOrders} filter={filter} onFilterChange={setFilter} /></div></main></div>;
}

function RiderLeafletMap({ position, destination, heading }: { position: [number, number] | null; destination: [number, number] | null; heading: number }) {
  const element = useRef<HTMLDivElement | null>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const destinationMarker = useRef<L.Marker | null>(null);
  const route = useRef<L.Polyline | null>(null);
  const centeredOnFix = useRef(false);
  const iconForHeading = (degrees: number) => L.divIcon({ className: "rider-arrow-marker", html: `<span style="display:block;transform:rotate(${degrees}deg)">▲</span>`, iconSize: [32, 32], iconAnchor: [16, 16] });
  useEffect(() => {
    if (!element.current || map.current) return;
    map.current = L.map(element.current).setView(destination ?? [12.8797, 121.774], destination ? 13 : 6);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap contributors" }).addTo(map.current);
    return () => { map.current?.remove(); map.current = null; };
  }, []);
  useEffect(() => {
    if (!map.current) return;
    if (position) {
      if (!marker.current) marker.current = L.marker(position, { icon: iconForHeading(heading) }).addTo(map.current).bindPopup("Your live rider location");
      marker.current.setLatLng(position);
      marker.current.setIcon(iconForHeading(heading));
      if (!centeredOnFix.current) { map.current.setView(position, 16); centeredOnFix.current = true; }
    } else {
      marker.current?.remove();
      marker.current = null;
      centeredOnFix.current = false;
      if (destination) map.current.setView(destination, 14);
    }
    if (destination) {
      if (!destinationMarker.current) destinationMarker.current = L.marker(destination, { icon: L.divIcon({ className: "buyer-pin-marker", html: "◆", iconSize: [24, 24], iconAnchor: [12, 12] }) }).addTo(map.current).bindPopup("Buyer delivery point");
      else destinationMarker.current.setLatLng(destination);
    } else {
      destinationMarker.current?.remove();
      destinationMarker.current = null;
    }
    if (position && destination) {
      if (!route.current) route.current = L.polyline([position, destination], { color: "#227fbe", weight: 6, opacity: 0.85 }).addTo(map.current);
      else route.current.setLatLngs([position, destination]);
    } else {
      route.current?.remove();
      route.current = null;
    }
  }, [position, destination, heading]);
  const centerOnRider = () => { if (position && map.current) map.current.setView(position, Math.max(map.current.getZoom(), 16)); };
  return <div className="rider-map-wrap"><div className="leaflet-rider-map" ref={element} />{position && <button className="rider-map-center" onClick={centerOnRider}><MapPinned size={14} /> Center on rider</button>}</div>;
}
function MyStore({ ownerId, authUser, listings: ownedListings, isFollowing, onToggleFollow, onOpenListing }: { ownerId: number; authUser: AuthUser; listings: Listing[]; isFollowing: boolean; onToggleFollow: (ownerId: number, following: boolean) => Promise<number | null>; onOpenListing: (id: string) => void }) {
  const [profile, setProfile] = useState<any>(null);
  useEffect(() => { let active = true; fetch(`/api/stores/${ownerId}`).then((response) => readJson(response)).then((payload) => { if (active && payload.store) setProfile(payload.store); }).catch(() => undefined); return () => { active = false; }; }, [ownerId]);
  const isOwnStore = ownerId === authUser.id;
  const official = ownedListings.filter((item) => (item.lifecycle ?? "official") === "official" && Number(item.stock) > 0);
  const storeName = profile?.name || (isOwnStore ? authUser.storeName || authUser.name : ownedListings[0]?.seller) || "MerchantHub store";
  const location = [profile?.municipality ?? ownedListings[0]?.sellerMunicipality ?? (isOwnStore ? authUser.municipality : ""), profile?.province ?? ownedListings[0]?.sellerProvince ?? (isOwnStore ? authUser.province : "")].filter(Boolean).join(", ");
  const handleFollow = async () => { const count = await onToggleFollow(ownerId, isFollowing); if (count != null) setProfile((current: any) => ({ ...(current ?? {}), followerCount: count })); };
  return <div className="section-stack"><div className="storefront-banner"><div className="storefront-avatar">{profile?.image ? <img src={profile.image} alt="" /> : <Store size={22} />}</div><div className="storefront-identity"><div className="eyebrow">{isOwnStore ? "Your public storefront" : "Seller storefront"}</div><h2>{storeName}</h2><span>{location || "Seller location not provided"} · {Number(profile?.followerCount ?? 0)} followers</span><p>Official in-stock listings only. Follow this store to receive an alert when it publishes a scheduled auction.</p></div>{!isOwnStore && <button className={`button ${isFollowing ? "secondary" : "primary"}`} onClick={handleFollow}>{isFollowing ? "Following" : "Follow store"}</button>}</div><section className="panel inventory-cards-panel"><div className="panel-header"><div><div className="eyebrow">Public storefront</div><h2>{official.length} official listings</h2></div></div>{official.length ? <div className="listing-grid">{official.map((listing) => <ListingCard key={listing.id} listing={listing} favorite={false} onFavorite={() => undefined} onClick={() => onOpenListing(listing.id)} />)}</div> : <div className="empty-state"><Store size={22} /><strong>This store has no official listings</strong><span>Only published listings with stock are shown here.</span></div>}</section></div>;
}

function AuctionQtyModal({ listing, lifecycle = "official", onClose, onComplete }: { listing: Listing; lifecycle?: "draft" | "official"; onClose: () => void; onComplete: () => void }) {
  const [quantity, setQuantity] = useState("1");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [startingBid, setStartingBid] = useState(String(listing.startingBid ?? listing.price));
  const [reserve, setReserve] = useState(String(listing.reserveThreshold ?? listing.price));
  const [increment, setIncrement] = useState(String(listing.minimumIncrement ?? 10));
  const [winnerCancellationAllowed, setWinnerCancellationAllowed] = useState(listing.winnerCancellationAllowed !== false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const auctionStartAt = start ? philippineDateTimeToUtcIso(start) : null;
    const auctionEndAt = philippineDateTimeToUtcIso(end);
    const startingBidCents = Math.round(Number(startingBid) * 100);
    const reserveThresholdCents = Math.round(Number(reserve) * 100);
    const minimumIncrementCents = Math.round(Number(increment) * 100);
    const quantityValue = Math.round(Number(quantity));
    if (quantityValue < 1 || quantityValue >= listing.stock) { toast.error(`Auction quantity must be between 1 and ${Math.max(1, listing.stock - 1)}.`); return; }
    if (!auctionEndAt || Date.parse(auctionEndAt) <= Date.now()) { toast.error("Choose a future closing time in Philippine time (UTC+8)."); return; }
    if (start && (!auctionStartAt || Date.parse(auctionStartAt) <= Date.now() || Date.parse(auctionStartAt) >= Date.parse(auctionEndAt))) { toast.error("Choose a future start time that is earlier than the closing time."); return; }
    if (!Number.isFinite(startingBidCents) || startingBidCents <= 0 || !Number.isFinite(reserveThresholdCents) || reserveThresholdCents < 0 || !Number.isFinite(minimumIncrementCents) || minimumIncrementCents < 100) { toast.error("Enter a valid starting bid, reserve, and minimum increment of at least ₱1."); return; }
    setBusy(true);
    try {
      const response = await fetch(`/api/listings/${listing.id}/split-auction`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quantity: quantityValue, auctionStartAt, auctionEndAt, startingBidCents, reserveThresholdCents, minimumIncrementCents, lifecycle, winnerCancellationAllowed }) });
      const payload = await readJson(response);
      if (!response.ok) { toast.error(payload.error ?? "Auction listing could not be created"); return; }
      toast.success(lifecycle === "draft" ? "Auction draft created" : "Auction listing created", { description: `${quantityValue} unit${quantityValue === 1 ? "" : "s"} moved from “${listing.title}” into ${lifecycle === "draft" ? "Draft inventory" : "auction inventory"}.` });
      onComplete();
    } catch {
      toast.error("The auction could not be created. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return <div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}><form className="create-listing-modal" onSubmit={submit}><div className="modal-header"><div><div className="eyebrow coral-text">Inventory split</div><h2>{lifecycle === "draft" ? "Create auction draft" : "Create auction quantity"}</h2><p>{lifecycle === "draft" ? "Set the terms now; the auction stays in Draft inventory until you publish it." : "Move part of the current stock into a scheduled or immediate auction listing."}</p></div><button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="Close auction form"><X size={18} /></button></div><div className="field-two"><label className="field-label">Auction quantity *<input type="number" min="1" max={listing.stock - 1} value={quantity} onChange={(event) => setQuantity(event.target.value)} required /><small className="field-help">Source listing stock remaining: {Math.max(0, listing.stock - Number(quantity || 0))}</small></label><label className="field-label">Starting bid (₱) *<input type="number" min="0.01" step="0.01" value={startingBid} onChange={(event) => setStartingBid(event.target.value)} required /></label></div><div className="field-two"><label className="field-label">Auction starts (optional)<input type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} /><small className="field-help">Leave blank to start immediately · Philippine Standard Time (UTC+8).</small></label><label className="field-label">Auction ends *<input type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} required /><small className="field-help">Must be later than the scheduled start.</small></label></div><div className="field-two"><label className="field-label">Reserve price (₱)<input type="number" min="0" step="0.01" value={reserve} onChange={(event) => setReserve(event.target.value)} required /></label><label className="field-label">Minimum increment (₱)<input type="number" min="1" step="0.01" value={increment} onChange={(event) => setIncrement(event.target.value)} required /></label></div><div className="auction-policy-choice"><strong>Winner cancellation policy</strong><label><input type="radio" name="splitWinnerCancellationAllowed" checked={winnerCancellationAllowed} onChange={() => setWinnerCancellationAllowed(true)} /> Winner may cancel before delivery starts</label><label><input type="radio" name="splitWinnerCancellationAllowed" checked={!winnerCancellationAllowed} onChange={() => setWinnerCancellationAllowed(false)} /> No change-of-mind cancellation after winning</label><small className="field-help">Buyers must provide delivery details and consent before bidding; their maximum bid is reserved while the auction is active, and the winning order is created automatically. This does not waive applicable consumer-protection rights.</small></div><div className="modal-actions"><button type="button" className="button secondary" onClick={onClose} disabled={busy}>Cancel</button><button className="button primary" disabled={busy}>{busy ? "Saving…" : lifecycle === "draft" ? "Save auction draft" : "Create auction listing"}</button></div></form></div>;
}

function InventoryView({ listings: ownedListings, initialTab, onTabChange, onOpenListing, onCompareListing, onCreateListing, onRefresh }: { listings: Listing[]; initialTab: InventoryTab; onTabChange: (tab: InventoryTab) => void; onOpenListing: (id: string) => void; onCompareListing: (id: string) => void; onCreateListing: () => void; onRefresh: () => void }) {
  const [analytics, setAnalytics] = useState<any>(null); const [tab, setTab] = useState<InventoryTab>(initialTab); const [deltaInputs, setDeltaInputs] = useState<Record<string, string>>({}); const [priceInputs, setPriceInputs] = useState<Record<string, string>>({}); const [endTimeInputs, setEndTimeInputs] = useState<Record<string, string>>({}); const [auctionListing, setAuctionListing] = useState<Listing | null>(null); const [auctionLifecycle, setAuctionLifecycle] = useState<"draft" | "official">("official"); const [auctionSourcePickerOpen, setAuctionSourcePickerOpen] = useState(false);
  useEffect(() => { setTab(initialTab); }, [initialTab]);
  useEffect(() => { fetch("/api/metrics/overview").then((response) => readJson(response)).then((payload) => setAnalytics(payload.metrics ?? null)).catch(() => undefined); }, [ownedListings.length, initialTab]);
  const chooseTab = (next: InventoryTab) => { setTab(next); onTabChange(next); };
  const visible = ownedListings.filter((item) => (item.lifecycle ?? "official") === tab);
  const draftSources = ownedListings.filter((item) => (item.lifecycle ?? "official") === "official" && item.stock > 1 && (item.type === "Buy now" || item.type === "Both"));
  const updateStock = async (listing: Listing, delta: number) => { if (!Number.isFinite(delta) || delta === 0) return; const next = Math.max(0, listing.stock + Math.round(delta)); const response = await fetch(`/api/listings/${listing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stock: next }) }); const payload = await readJson(response); if (!response.ok) { toast.error(payload.error ?? "Quantity could not be updated"); return; } setDeltaInputs((current) => ({ ...current, [listing.id]: "" })); toast.success(`Quantity is now ${next}`); onRefresh(); };
  const saveListingPrice = async (listing: Listing) => { const value = Number(priceInputs[listing.id] ?? (listing.type === "Both" ? listing.buyNow ?? listing.price : listing.price)); if (!Number.isFinite(value) || value <= 0) { toast.error("Enter a price greater than zero"); return; } const field = listing.type === "Both" ? "buyNowPriceCents" : "priceCents"; const response = await fetch(`/api/listings/${listing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [field]: Math.round(value * 100) }) }); const payload = await readJson(response); if (!response.ok) { toast.error(payload.error ?? "Price could not be updated"); return; } setPriceInputs((current) => { const next = { ...current }; delete next[listing.id]; return next; }); toast.success("Listing price updated", { description: "Customers who saved this item can see the price change in their wishlist." }); onRefresh(); };
  const saveAuctionEndTime = async (listing: Listing) => { const localValue = endTimeInputs[listing.id] ?? utcIsoToPhilippineDateTime(listing.auctionEndAt); const auctionEndAt = philippineDateTimeToUtcIso(localValue); if (!auctionEndAt || Date.parse(auctionEndAt) <= Date.now()) { toast.error("Choose a future closing time in Philippine time (UTC+8)"); return; } const response = await fetch(`/api/listings/${listing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ auctionEndAt }) }); const payload = await readJson(response); if (!response.ok) { toast.error(payload.error ?? "Auction end time could not be updated"); return; } setEndTimeInputs((current) => { const next = { ...current }; delete next[listing.id]; return next; }); toast.success("Auction deadline updated", { description: "The countdown now uses Philippine Standard Time (UTC+8)." }); onRefresh(); };
  const updateLifecycle = async (listing: Listing, lifecycle: "draft" | "official" | "canceled" | "deleted") => { if (lifecycle === "deleted" && !window.confirm(`Delete “${listing.title}”? It will move to the Recycle bin.`)) return; const response = await fetch(`/api/listings/${listing.id}`, { method: lifecycle === "deleted" ? "DELETE" : "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lifecycle }) }); const payload = await readJson(response); if (!response.ok) { toast.error(payload.error ?? "Unable to update listing"); return; } onRefresh(); };
  const tabs: { id: InventoryTab; label: string }[] = [{ id: "official", label: "Official" }, { id: "draft", label: "Draft" }, { id: "auction-ended", label: "Auction ended" }, { id: "sold", label: "Sold" }, { id: "canceled", label: "Canceled" }, { id: "deleted", label: "Recycle bin" }];
  return <div className="section-stack">{analytics && <section className="panel"><div className="panel-header"><div><div className="eyebrow teal-text">Inventory analytics</div><h2>Demand forecast</h2></div><span className="trend-badge">Live data</span></div><div className="metric-grid"><MetricCard label="Gross sales" value={money((analytics.grossSalesCents ?? 0) / 100)} delta="Live" detail="connected orders" tone="coral" icon={CircleDollarSign} /><MetricCard label="Projected 30-day demand" value={money((analytics.projectedDemandCents ?? 0) / 100)} delta="Forecast" detail="based on recent sales" tone="teal" icon={BarChart3} /><MetricCard label="Stock coverage" value={analytics.stockCoverageDays == null ? "—" : `${analytics.stockCoverageDays} days`} delta="Forecast" detail="available inventory" tone="mustard" icon={Boxes} /></div></section>}<div className="inventory-banner"><div className="inventory-banner-icon"><Sparkles size={20} /></div><div><strong>Your seller inventory.</strong><span>Ended auctions leave the marketplace. No-sale items can be re-auctioned or deleted.</span></div><button className="button dark" onClick={() => setAuctionSourcePickerOpen(true)}><Gavel size={15} /> Create auction draft</button></div><section className="panel inventory-cards-panel"><div className="panel-header"><div><div className="eyebrow">Seller-owned listings</div><h2>{visible.length} {tabs.find((item) => item.id === tab)?.label.toLowerCase()} listings</h2></div><div className="filter-tabs inventory-tabs">{tabs.map((item) => <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => chooseTab(item.id)}>{item.label}<span>{ownedListings.filter((listing) => (listing.lifecycle ?? "official") === item.id).length}</span></button>)}</div></div>{visible.length ? <div className="inventory-card-grid">{visible.map((listing) => { const auction = listing.type === "Auction" || listing.type === "Both"; const canManageStock = ["official", "draft", "auction-ended", "canceled"].includes(tab); return <article className="inventory-card" key={listing.id}><div className="inventory-card-image"><img src={listing.image} alt={listing.title} /><span className={`status-badge ${tab}`}>{tab === "auction-ended" ? "Ended · no winner" : tab === "canceled" ? "Canceled" : tab === "deleted" ? "Recycle bin" : tab === "sold" ? "Sold" : tab}</span></div><div className="inventory-card-body"><div className="inventory-card-top"><span>{listing.category}</span><span>{listing.type}</span></div><h3>{listing.title}</h3><p className="field-help">Available stock: <strong>{listing.stock}</strong>{listing.settledAt && <span> · Closed {new Date(listing.settledAt).toLocaleString("en-PH", { dateStyle: "short", timeStyle: "short" })}</span>}</p>{(tab === "official" || tab === "draft") && (listing.type === "Buy now" || listing.type === "Both") && <div className="inventory-price-editor"><label className="field-label">{listing.type === "Both" ? "Buy-now price (₱)" : "Price (₱)"}<input type="number" min="0.01" step="0.01" value={priceInputs[listing.id] ?? String(listing.type === "Both" ? listing.buyNow ?? listing.price : listing.price)} onChange={(event) => setPriceInputs((current) => ({ ...current, [listing.id]: event.target.value }))} /></label><button className="button secondary" onClick={() => saveListingPrice(listing)}>Save price</button></div>}{tab === "official" && auction && <div className="inventory-auction-deadline"><label className="field-label">Auction ends (Philippine time)<input type="datetime-local" value={endTimeInputs[listing.id] ?? utcIsoToPhilippineDateTime(listing.auctionEndAt)} onChange={(event) => setEndTimeInputs((current) => ({ ...current, [listing.id]: event.target.value }))} /></label><button className="button secondary" onClick={() => saveAuctionEndTime(listing)}>Save end time</button></div>}{listing.secondChancePending && <div className="inline-feedback"><Clock3 size={14} /><span>Waiting for the second-highest bidder to accept or decline.</span></div>}<div className="inventory-manage-actions"><button className="button secondary" onClick={() => onCompareListing(listing.id)}><ArrowLeftRight size={14} /> Compare market prices</button>{canManageStock && <><label className="field-label">Add / remove quantity<input type="number" value={deltaInputs[listing.id] ?? ""} onChange={(event) => setDeltaInputs((current) => ({ ...current, [listing.id]: event.target.value }))} placeholder="e.g. 5 or -2" /></label><div className="inventory-quantity-buttons"><button className="button primary" onClick={() => updateStock(listing, Math.abs(Number(deltaInputs[listing.id]) || 1))}>Add</button><button className="button secondary" onClick={() => updateStock(listing, -Math.abs(Number(deltaInputs[listing.id]) || 1))} disabled={listing.stock <= 0}>Remove</button></div></>}{(tab === "auction-ended" || tab === "canceled") && auction && <button className="button primary" disabled={listing.stock <= 0 || listing.secondChancePending} onClick={async () => { const response = await fetch(`/api/listings/${listing.id}/re-auction`, { method: "POST" }); const payload = await readJson(response); if (!response.ok) { toast.error(payload.error ?? "Re-auction failed"); return; } toast.success("Auction relisted", { description: "The item is back in the live marketplace for 24 hours." }); onRefresh(); }}>{listing.secondChancePending ? "Offer pending" : listing.stock <= 0 ? "Add stock to re-auction" : "Re-auction"}</button>}{tab === "sold" && auction && <button className="button secondary" onClick={() => onOpenListing(listing.id)}><FileSearch size={14} /> Review winning bid</button>}{tab === "draft" && <button className="button primary" disabled={listing.stock <= 0} onClick={() => updateLifecycle(listing, "official")}>{listing.stock <= 0 ? "Add stock to publish" : "Make official"}</button>}{tab === "official" && <button className="button secondary" onClick={() => updateLifecycle(listing, "draft")}>Move to draft</button>}{tab !== "deleted" && tab !== "canceled" && <button className="button secondary" disabled={listing.secondChancePending} onClick={() => updateLifecycle(listing, "deleted")}>{listing.secondChancePending ? "Offer pending" : "Delete listing"}</button>}{tab === "deleted" && <button className="button secondary" onClick={() => updateLifecycle(listing, "draft")}>Restore draft</button>}{tab === "canceled" && <><button className="button secondary" onClick={() => updateLifecycle(listing, "draft")}>Return to draft</button><button className="button secondary" onClick={() => updateLifecycle(listing, "deleted")}>Delete</button></>}{listing.stock > 1 && tab === "official" && <button className="button secondary" onClick={() => { setAuctionLifecycle("official"); setAuctionListing(listing); }}><Gavel size={14} /> Auction qty</button>}</div></div></article>; })}</div> : <div className="empty-state"><Boxes size={22} /><strong>No {tabs.find((item) => item.id === tab)?.label.toLowerCase()} listings</strong><span>{tab === "auction-ended" ? "Only auctions with no winner appear here." : tab === "canceled" ? "Canceled wins and expired second-chance offers appear here." : tab === "sold" ? "Auctions with a confirmed buyer appear here." : "Create a listing to manage it here."}</span></div>}</section>{auctionSourcePickerOpen && <div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) setAuctionSourcePickerOpen(false); }}><section className="create-listing-modal"><div className="modal-header"><div><div className="eyebrow coral-text">Inventory split</div><h2>Choose buy-now inventory</h2><p>Select an official Buy now or Both listing with more than one unit. Nothing moves until you save the auction draft.</p></div><button type="button" className="icon-button" onClick={() => setAuctionSourcePickerOpen(false)} aria-label="Close auction source picker"><X size={18} /></button></div>{draftSources.length ? <div className="saved-search-list">{draftSources.map((item) => <button type="button" className="search-result-item" key={item.id} onClick={() => { setAuctionLifecycle("draft"); setAuctionListing(item); setAuctionSourcePickerOpen(false); }}><img src={item.image || "/merchanthub-icon.png"} alt="" /><span><strong>{item.title}</strong><small>{item.type} · {item.stock} available</small></span><Gavel size={15} /></button>)}</div> : <div className="empty-state"><Boxes size={22} /><strong>No eligible Buy-now inventory</strong><span>Publish a Buy now or Both listing with at least two units, then you can split a quantity into an auction draft.</span><button type="button" className="button primary" onClick={() => { setAuctionSourcePickerOpen(false); onCreateListing(); }}>Create a listing</button></div>}<div className="modal-actions"><button type="button" className="button secondary" onClick={() => setAuctionSourcePickerOpen(false)}>Cancel</button></div></section></div>}{auctionListing && <AuctionQtyModal listing={auctionListing} lifecycle={auctionLifecycle} onClose={() => setAuctionListing(null)} onComplete={() => { setAuctionListing(null); onRefresh(); if (auctionLifecycle === "draft") chooseTab("draft"); }} />}</div>;
}

function MessagesView({ authUser }: { authUser: AuthUser }) {
  type ChatMessage = { id: number; otherUserId: number; otherUser: string; listingId?: string | null; listingTitle: string; body: string; senderId: number; recipientId: number; readAt?: string | null; createdAt: string };
  const [messages, setMessages] = useState<ChatMessage[]>([]); const [activeKey, setActiveKey] = useState(""); const [draft, setDraft] = useState(""); const [messageSearch, setMessageSearch] = useState("");
  const params = new URLSearchParams(window.location.search); const requestedRecipient = Number(params.get("recipient")); const requestedListing = params.get("listing") || undefined;
  const load = () => fetch("/api/messages").then((response) => readJson(response)).then((payload) => setMessages(payload.messages ?? [])).catch(() => undefined);
  useEffect(() => { load(); const timer = window.setInterval(load, 3000); return () => window.clearInterval(timer); }, []);
  const keys = Array.from(new Set(messages.filter((item) => !messageSearch.trim() || `${item.otherUser} ${item.listingTitle} ${item.body}`.toLowerCase().includes(messageSearch.toLowerCase())).map((item) => `${item.otherUserId}:${item.listingId ?? ""}`)));
  const requestedKey = requestedRecipient ? `${requestedRecipient}:${requestedListing ?? ""}` : "";
  const selectedKey = activeKey || requestedKey || keys[0] || "";
  const selectedMessages = messages.filter((item) => `${item.otherUserId}:${item.listingId ?? ""}` === selectedKey);
  const selected = selectedMessages[0] ?? (requestedRecipient ? { id: 0, otherUserId: requestedRecipient, otherUser: "Seller", listingId: requestedListing, listingTitle: "Listing conversation", body: "", senderId: authUser.id, createdAt: new Date().toISOString() } : undefined);
  useEffect(() => { const unread = selectedMessages.filter((item) => item.recipientId === authUser.id && !item.readAt); if (!unread.length) return; Promise.all(unread.map((item) => fetch(`/api/messages/${item.id}/read`, { method: "POST" }))).then(() => load()).catch(() => undefined); }, [selectedKey, messages.length]);
  const send = async () => { if (!draft.trim() || !selected) return; const response = await fetch("/api/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipientId: selected.otherUserId, listingId: selected.listingId, body: draft.trim() }) }); if (!response.ok) { const payload = await readJson(response); toast.error(payload.error ?? "Message could not be sent"); return; } setDraft(""); load(); };
  return <div className="message-layout"><section className="panel conversation-list"><div className="panel-header"><div><div className="eyebrow">Inbox</div><h2>{keys.length} conversations</h2></div></div><label className="inbox-search"><Search size={15} /><input placeholder="Search messages" value={messageSearch} onChange={(event) => setMessageSearch(event.target.value)} /></label>{keys.map((key) => { const item = messages.find((message) => `${message.otherUserId}:${message.listingId ?? ""}` === key)!; return <button className={`conversation-item ${selectedKey === key ? "active" : ""}`} onClick={() => setActiveKey(key)} key={key}><span className="mini-avatar">{item.otherUser.slice(0, 2).toUpperCase()}</span><span><strong>{item.otherUser}</strong><small>{item.listingTitle}</small><em>{item.body}</em></span><time>{new Date(item.createdAt).toLocaleDateString("en-PH")}</time></button>; })}{!keys.length && <div className="empty-state"><Inbox size={22} /><strong>No conversations yet</strong><span>Message a seller from a listing to start one.</span></div>}</section><section className="panel chat-panel">{selected ? <><div className="chat-header"><div className="profile-avatar">{selected.otherUser.slice(0, 2).toUpperCase()}</div><div><strong>{selected.otherUser}</strong><span>About {selected.listingTitle} · listing-linked chat</span></div></div><div className="chat-body">{selectedMessages.map((message) => <div className={`chat-bubble ${message.senderId === authUser.id ? "sent" : "received"}`} key={message.id}>{message.body}<time>{new Date(message.createdAt).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" })}</time></div>)}</div><div className="chat-compose"><input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") send(); }} placeholder={`Write to ${selected.otherUser}...`} /><button className="send-button" onClick={send} aria-label="Send message"><Send size={16} /></button></div></> : <div className="empty-state"><MessageCircle size={22} /><strong>Select a conversation</strong><span>Messages are isolated per account and listing.</span></div>}</section></div>;
}

function SavedView({ listings: sourceListings, favoriteIds, toggleFavorite, savedSearches, priceChanges, onDeleteSavedSearch, onOpenListing }: { listings: Listing[]; favoriteIds: string[]; toggleFavorite: (id: string) => void; savedSearches: any[]; priceChanges: Record<string, any[]>; onDeleteSavedSearch: (id: number) => void; onOpenListing: (id: string) => void }) {
  const saved = sourceListings.filter((item) => favoriteIds.includes(item.id));
  const searchResults = (search: any) => {
    const terms = String(search.query ?? "").toLocaleLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 1);
    return sourceListings.filter((item) => {
      const text = `${item.title} ${item.description ?? ""} ${item.category} ${item.type}`.toLocaleLowerCase();
      const matchesTerms = terms.every((term) => text.includes(term));
      const matchesType = !search.filter || search.filter === "All items" || item.type.toLocaleLowerCase() === String(search.filter).toLocaleLowerCase() || item.category.toLocaleLowerCase() === String(search.filter).toLocaleLowerCase();
      const matchesProvince = !search.province || item.sellerProvince?.toLocaleLowerCase() === String(search.province).toLocaleLowerCase();
      const matchesMunicipality = !search.municipality || item.sellerMunicipality?.toLocaleLowerCase() === String(search.municipality).toLocaleLowerCase();
      return matchesTerms && matchesType && matchesProvince && matchesMunicipality;
    });
  };
  const movement = (change: any) => {
    const buyNowChanged = change.previousBuyNowPriceCents !== change.newBuyNowPriceCents && change.newBuyNowPriceCents != null;
    const before = Number(buyNowChanged ? (change.previousBuyNowPriceCents ?? change.previousPriceCents) : change.previousPriceCents);
    const after = Number(buyNowChanged ? change.newBuyNowPriceCents : change.newPriceCents);
    const direction = after > before ? "increased" : after < before ? "dropped" : "changed";
    return { before, after, direction, label: buyNowChanged ? "Buy-now price" : "Listing price" };
  };
  return <div className="section-stack">
    <section className="panel"><div className="panel-header"><div><div className="eyebrow">Wishlist</div><h2>Saved items</h2></div><span>{saved.length} saved</span></div>{saved.length ? <div className="listing-grid">{saved.map((item) => <article className="saved-item-with-history" key={item.id}><ListingCard listing={item} favorite onFavorite={() => toggleFavorite(item.id)} onClick={() => onOpenListing(item.id)} />{priceChanges[item.id]?.length ? <div className="wishlist-price-history">{priceChanges[item.id].slice(0, 3).map((change: any) => { const detail = movement(change); const Icon = detail.direction === "dropped" ? ArrowDownRight : ArrowUpRight; return <div className={`wishlist-price-change ${detail.direction}`} key={change.id}><Icon size={14} /><span><strong>{detail.label} {detail.direction}</strong><small>{money(detail.before / 100)} → {money(detail.after / 100)} · {new Date(change.createdAt).toLocaleDateString("en-PH", { dateStyle: "medium" })}</small></span></div>; })}</div> : <small className="wishlist-no-price-change">No seller price changes since you saved this item.</small>}</article>)}</div> : <div className="empty-state"><Heart size={22} /><strong>Your wishlist is empty</strong><span>Save a listing to keep it here for quick checkout.</span></div>}</section>
    <section className="panel"><div className="panel-header"><div><div className="eyebrow lavender-text">Saved search alerts</div><h2>Matching listings</h2></div><span>{savedSearches.length} searches</span></div>{savedSearches.length ? <div className="saved-search-results">{savedSearches.map((search) => { const matches = searchResults(search); return <section className="saved-search-result-group" key={search.id}><div className="saved-search-result-header"><div><strong>{search.name}</strong><span>{matches.length} current match{matches.length === 1 ? "" : "es"} · Alerts on{search.municipality || search.province ? ` · ${[search.municipality, search.province].filter(Boolean).join(", ")}` : ""}</span></div><button className="icon-button" onClick={() => onDeleteSavedSearch(search.id)} aria-label={`Delete saved search ${search.name}`}><X size={14} /></button></div>{matches.length ? <div className="listing-grid">{matches.slice(0, 6).map((item) => <ListingCard key={`${search.id}-${item.id}`} listing={item} favorite={favoriteIds.includes(item.id)} onFavorite={() => toggleFavorite(item.id)} onClick={() => onOpenListing(item.id)} />)}</div> : <div className="saved-search-empty">No matching listings right now. New matching items will appear here automatically when published.</div>}</section>; })}</div> : <div className="empty-state"><Bookmark size={22} /><strong>No saved searches yet</strong><span>Search for something like “hoodie” in Marketplace, then choose Save search. Matching published listings and alerts will appear here.</span></div>}</section>
  </div>;
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
      const data = await readJson(response) as { ok?: boolean; payments?: PaymentRecord[] };
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
      const data = await readJson(response) as { ok?: boolean; checkoutUrl?: string; error?: string };
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
      const data = await readJson(response) as GeneratedLabel & { ok?: boolean; error?: string };
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
      <section className="panel checkout-panel"><div className="panel-header"><div><div className="eyebrow">Gateway checkout</div><h2>Take a secure payment</h2></div><span className="sandbox-badge"><CircleCheckBig size={13} /> Test mode</span></div><div className="checkout-product"><img src={listings[0].image} alt="" /><div><strong>{selectedOrder.item}</strong><span>{selectedOrder.id} · Payment protected</span></div><b>{formatGatewayAmount(amount, currency)}</b></div><label className="field-label">Order to collect<select value={selectedOrderId} onChange={(event) => setSelectedOrderId(event.target.value)}>{orders.filter((order) => order.status !== "Delivered").map((order) => <option value={order.id} key={order.id}>{order.id} · {order.item}</option>)}</select></label><div className="currency-heading"><span className="field-label">Settlement currency</span><span className="currency-rate">1 PHP ≈ {currencyDetails.rate.toFixed(4)} {currency}</span></div><div className="currency-grid">{(Object.keys(paymentCurrencies) as PaymentCurrency[]).map((item) => <button key={item} className={`currency-option ${currency === item ? "active" : ""}`} onClick={() => setCurrency(item)}><strong>{paymentCurrencies[item].symbol}</strong><span>{item}</span></button>)}</div><div className="checkout-summary"><span>Order subtotal <b>{formatGatewayAmount(amount, currency)}</b></span><span>Gateway <b>Stripe Checkout</b></span><span>Promotion codes <b className="teal-text">Enabled</b></span><strong>Total <b>{formatGatewayAmount(amount, currency)}</b></strong></div><button className="button primary full" onClick={startCheckout} disabled={checkoutState === "loading"}><CreditCard size={16} />{checkoutState === "loading" ? "Creating secure checkout…" : `Pay ${formatGatewayAmount(amount, currency)}`} <ExternalLink size={14} /></button>{checkoutMessage && <div className={`inline-feedback ${checkoutState === "error" ? "error" : "success"}`}>{checkoutState === "error" ? <AlertCircle size={14} /> : <CircleCheckBig size={14} />}<span>{checkoutMessage}</span></div>}<p className="checkout-note">Test card: <strong>4242 4242 4242 4242</strong> · any future date · any CVC</p></section>
      <section className="panel label-generator-panel"><div className="panel-header"><div><div className="eyebrow">Automated fulfillment</div><h2>Generate a shipping label</h2></div><Printer size={19} className="teal-text" /></div><label className="field-label">Paid order<select value={selectedOrderId} onChange={(event) => setSelectedOrderId(event.target.value)}>{orders.map((order) => <option value={order.id} key={order.id}>{order.id} · {order.customer}</option>)}</select></label><div className="field-two"><label className="field-label">Carrier<select value={carrier} onChange={(event) => setCarrier(event.target.value)}><option>Ninja Van</option><option>J&amp;T Express</option><option>LBC Express</option><option>GrabExpress</option></select></label><label className="field-label">Service<select value={service} onChange={(event) => setService(event.target.value)}><option>Next day</option><option>Standard</option><option>Same day</option></select></label></div><div className="field-two"><label className="field-label">Package<select value={packageType} onChange={(event) => setPackageType(event.target.value)}><option>Small parcel</option><option>Box</option><option>Document pouch</option><option>Large parcel</option></select></label><label className="field-label">Weight (kg)<input value={weightKg} onChange={(event) => setWeightKg(event.target.value)} inputMode="decimal" /></label></div><label className="field-label">Destination<input value={destination} onChange={(event) => setDestination(event.target.value)} placeholder="City or delivery hub" /></label><button className="button dark full" onClick={generateLabel} disabled={labelState === "loading"}><Package size={16} />{labelState === "loading" ? "Generating label…" : "Generate label"}<Printer size={14} /></button>{labelMessage && <div className={`inline-feedback ${labelState === "error" ? "error" : "success"}`}>{labelState === "error" ? <AlertCircle size={14} /> : <CircleCheckBig size={14} />}<span>{labelMessage}</span></div>}{lastLabel && <div className="label-result"><div className="label-result-icon"><Package size={17} /></div><div><strong>{lastLabel.tracking}</strong><span>{lastLabel.carrier} · {lastLabel.service} · {lastLabel.weightKg} kg</span></div><a className="button secondary tiny" href={lastLabel.labelUrl} target="_blank" rel="noreferrer"><Download size={13} /> Print</a></div>}</section>
    </div>
    <div className="payments-lower-grid"><section className="panel"><div className="panel-header"><div><div className="eyebrow">Payment history</div><h2>Recent gateway activity</h2></div></div><div className="payment-history">{paymentHistory.length ? paymentHistory.map((payment) => { const paymentCurrency = (payment.currency in paymentCurrencies ? payment.currency : "PHP") as PaymentCurrency; return <div className="payment-history-row" key={payment.sessionId}><span className="payment-method-icon"><CreditCard size={15} /></span><div><strong>{payment.item}</strong><span>{payment.id} · {new Date(payment.createdAt).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}</span></div><b>{formatGatewayAmount(payment.amountMinor / 100 / paymentCurrencies[paymentCurrency].rate, paymentCurrency)}<small>{payment.currency}</small></b><span className={`status-badge ${payment.status}`}><span />{payment.status}</span></div>; }) : <div className="empty-labels"><CreditCard size={21} /><strong>No gateway records yet</strong><span>Create a test checkout to populate durable payment history.</span></div>}</div></section><section className="panel"><div className="panel-header"><div><div className="eyebrow">Generated labels</div><h2>{generatedLabels.length || 12} labels this week</h2></div><span className="trend-badge"><ArrowUpRight size={13} /> 18.4%</span></div>{generatedLabels.length ? <div className="generated-label-list">{generatedLabels.map((label) => <div className="generated-label-row" key={label.labelId}><span className="payment-method-icon"><Printer size={15} /></span><div><strong>{label.tracking}</strong><span>{label.orderId} · {label.destination}</span></div><a href={label.labelUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /></a></div>)}</div> : <div className="empty-labels"><Printer size={21} /><strong>Labels appear here after generation</strong><span>Every label includes a tracking number and printable SVG.</span></div>}</section></div>
  </div>;
}

function SellerApplicationsView() {
  const [applications, setApplications] = useState<any[]>([]);
  const load = () => fetch("/api/admin/seller-applications").then((response) => readJson(response)).then((payload) => setApplications(payload.applications ?? [])).catch(() => undefined);
  useEffect(() => { load(); }, []);
  const decide = async (id: number, status: "approved" | "denied") => { const response = await fetch(`/api/admin/seller-applications/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) }); const payload = await readJson(response); if (!response.ok) { toast.error(payload.error ?? "Application update failed"); return; } toast.success(status === "approved" ? "Seller approved" : "Seller application denied"); load(); };
  return <div className="section-stack"><section className="panel"><div className="panel-header"><div><div className="eyebrow mustard-text">Admin control</div><h2>Seller applications</h2></div><span>{applications.length} pending</span></div>{applications.length ? applications.map((row) => <div className="user-status-row" key={row.id}><span className="mini-avatar">{String(row.name ?? "SU").slice(0, 2).toUpperCase()}</span><div><strong>{row.storeName || row.name}</strong><span>{row.name} · {row.email} · {row.municipality || "Location not provided"}</span></div><button className="button primary tiny" onClick={() => decide(row.id, "approved")}>Approve</button><button className="button secondary tiny" onClick={() => decide(row.id, "denied")}>Deny</button></div>) : <div className="empty-state"><ClipboardCheck size={22} /><strong>No pending seller applications</strong><span>New seller applications will appear here for admin review.</span></div>}</section></div>;
}
function ManageUsersView() {
  const [users, setUsers] = useState<any[]>([]);
  const load = () => fetch("/api/admin/users").then((response) => readJson(response)).then((payload) => setUsers(payload.users ?? [])).catch(() => undefined);
  useEffect(() => { load(); }, []);
  const deactivate = async (id: number, name: string) => { if (!window.confirm(`Deactivate ${name}? They will no longer be able to sign in.`)) return; const response = await fetch(`/api/admin/users/${id}/deactivate`, { method: "PATCH" }); const payload = await readJson(response); if (!response.ok) { toast.error(payload.error ?? "User could not be deactivated"); return; } toast.success("User deactivated"); load(); };
  return <div className="section-stack"><section className="panel"><div className="panel-header"><div><div className="eyebrow coral-text">Account control</div><h2>Manage users</h2></div><span>{users.length} accounts</span></div><div className="user-status-grid">{users.map((row) => <div className="user-status-row" key={row.id}><span className="mini-avatar">{String(row.name ?? "US").slice(0, 2).toUpperCase()}</span><div><strong>{row.name}</strong><span>{row.email} · {row.role}{row.storeName ? ` · ${row.storeName}` : ""}</span></div><span className={`status-badge ${row.deactivatedAt ? "canceled" : "active"}`}>{row.deactivatedAt ? "Deactivated" : "Active"}</span>{row.role !== "admin" && !row.deactivatedAt && <button className="button secondary tiny" onClick={() => deactivate(row.id, row.name)}>Deactivate</button>}</div>)}</div></section></div>;
}

function AdminView() {
  const [reviewed, setReviewed] = useState<string[]>([]);
  const userRows = [{ name: "Mika Santos", role: "Buyer", status: "Active" }, { name: "North Star Cameras", role: "Seller", status: "Verified" }, { name: "Theo Cruz", role: "Buyer", status: "Pending" }, { name: "Paolo Rivera", role: "Rider", status: "Active" }];
  const review = (title: string) => { setReviewed((current) => [...current, title]); toast.success("Queue item reviewed", { description: title }); };
  return <div className="section-stack"><div className="admin-alert"><div className="note-icon mustard"><ShieldCheck size={15} /></div><div><strong>3 items need your review.</strong><span>Keep the marketplace trusted by clearing the moderation queue today.</span></div><button className="button dark" onClick={() => toast.success("Moderation queue opened")}>Review queue <ChevronRight size={15} /></button><button className="button secondary" onClick={async () => { if (!window.confirm("Reset the live demo? This permanently deletes current marketplace users, listings, bids, orders, and notifications.")) return; const response = await fetch("/api/admin/reset-demo", { method: "POST" }); const payload = await readJson(response).catch(() => ({})); if (!response.ok) { toast.error(payload.error ?? "Demo reset failed"); return; } toast.success("Demo marketplace reset", { description: "Demo seller login: demo@merchanthub.ph / demo123" }); }}>Reset demo data</button></div><div className="admin-grid"><MetricCard label="Active members" value="4,892" delta="+8.4%" detail="this month" tone="teal" icon={Users} /><MetricCard label="Pending reviews" value="18" delta="3 urgent" detail="moderation queue" tone="mustard" icon={ClipboardCheck} /><MetricCard label="Cancellation requests" value="6" delta="-2 today" detail="awaiting admin" tone="coral" icon={RefreshCcw} /><MetricCard label="Trust score" value="98.2%" delta="+1.2%" detail="system average" tone="lavender" icon={ShieldCheck} /></div><div className="admin-lower"><section className="panel table-panel"><div className="panel-header"><div><div className="eyebrow">Needs attention</div><h2>Moderation queue</h2></div><button className="text-button" onClick={() => toast.success("All moderation items loaded")}>View all <ChevronRight size={15} /></button></div><div className="moderation-list"><ModerationRow title="Bid cancellation request" detail="Bidder MS · Sony WH-1000XM5 · #BC-103" time="8m ago" tone="coral" reviewed={reviewed.includes("Bid cancellation request")} onReview={() => review("Bid cancellation request")} /><ModerationRow title="Listing image review" detail="Fujifilm X100V Silver · seller North Star Cameras" time="32m ago" tone="mustard" reviewed={reviewed.includes("Listing image review")} onReview={() => review("Listing image review")} /><ModerationRow title="Second chance offer expired" detail="Vintage Walnut Record Player · offer #SC-018" time="1h ago" tone="lavender" reviewed={reviewed.includes("Second chance offer expired")} onReview={() => review("Second chance offer expired")} /></div></section><section className="panel system-panel"><div className="panel-header"><div><div className="eyebrow">System health</div><h2>Services</h2></div><span className="status-dot-label"><span className="live-dot teal" /> All good</span></div>{["Payments & escrow", "Notifications", "Live bid feed", "Rider geolocation"].map((label) => <div className="system-row" key={label}><span>{label}</span><strong><span className="tiny-check"><Check size={11} /></span> Operational</strong></div>)}<button className="button secondary full" onClick={() => toast.success("System analytics opened")}>Open system analytics <ChevronRight size={15} /></button></section></div><section className="panel user-status-panel"><div className="panel-header"><div><div className="eyebrow">Account control</div><h2>User status</h2></div><button className="text-button" onClick={() => toast.success("User directory opened")}>Manage users <ChevronRight size={15} /></button></div><div className="user-status-grid">{userRows.map((user) => <div className="user-status-row" key={user.name}><span className="mini-avatar">{user.name.slice(0, 2).toUpperCase()}</span><div><strong>{user.name}</strong><span>{user.role}</span></div><select value={user.status} onChange={(event) => toast.success(`${user.name} marked ${event.target.value}`)}><option>Active</option><option>Verified</option><option>Pending</option><option>Suspended</option></select></div>)}</div></section></div>;
}

function MetricCard({ label, value, delta, detail, tone, icon: Icon }: { label: string; value: string; delta: string; detail: string; tone: Tone; icon: typeof Activity }) {
  return <div className={`metric-card ${tone}`}><div className="metric-top"><span>{label}</span><span className="metric-icon"><Icon size={16} /></span></div><strong>{value}</strong><div className="metric-bottom"><span className={delta.startsWith("-") ? "delta negative" : "delta"}><ArrowUpRight size={13} /> {delta}</span><small>{detail}</small></div></div>;
}

function ListingCard({ listing, favorite, onFavorite, onClick, onAddToCart, onBuyNow, onCompare, compareSelected }: { listing: Listing; favorite: boolean; onFavorite: () => void; onClick?: () => void; onAddToCart?: () => void; onBuyNow?: () => void; onCompare?: () => void; compareSelected?: boolean }) {
  const [photoIndex, setPhotoIndex] = useState(0);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const photos = listing.photos?.filter(Boolean).length ? listing.photos.filter(Boolean) : listing.image ? [listing.image] : [];
  const photo = photos[photoIndex] || "/merchanthub-icon.png";
  const scheduledStart = listing.auctionStartAt && Date.parse(listing.auctionStartAt) > Date.now() ? new Date(listing.auctionStartAt).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }) : null;
  const finishSwipe = (endX: number) => { if (touchStartX == null || photos.length < 2) return; const delta = endX - touchStartX; if (Math.abs(delta) > 35) setPhotoIndex((current) => (current + (delta < 0 ? 1 : -1) + photos.length) % photos.length); setTouchStartX(null); };
  return <article className={`listing-card ${onClick ? "is-tappable" : ""}`} onClick={onClick}><div className="listing-image gallery-touch-area" onTouchStart={(event) => setTouchStartX(event.touches[0]?.clientX ?? null)} onTouchEnd={(event) => finishSwipe(event.changedTouches[0]?.clientX ?? 0)}><button type="button" className="listing-image-button" onClick={(event) => { event.stopPropagation(); onClick?.(); }}><img src={photo} alt={`${listing.title} angle ${photoIndex + 1}`} /><span className={`listing-type ${listing.type === "Auction" || listing.type === "Both" ? "auction-type" : "buy-type"}`}>{listing.type === "Auction" || listing.type === "Both" ? <Gavel size={12} /> : <ShoppingBag size={12} />}{listing.type}</span><span className="listing-condition">{listing.condition}</span></button>{photos.length > 1 && <><button type="button" className="gallery-arrow gallery-prev" aria-label="Previous product image" onClick={(event) => { event.stopPropagation(); setPhotoIndex((photoIndex - 1 + photos.length) % photos.length); }}><ChevronLeft size={15} /></button><button type="button" className="gallery-arrow gallery-next" aria-label="Next product image" onClick={(event) => { event.stopPropagation(); setPhotoIndex((photoIndex + 1) % photos.length); }}><ChevronRight size={15} /></button><span className="gallery-count">{photoIndex + 1}/{photos.length}</span></>}</div><div className="listing-card-body"><div className="listing-card-meta"><span>{listing.category}</span><button className={`favorite-button ${favorite ? "is-favorite" : ""}`} onClick={(event) => { event.stopPropagation(); onFavorite(); }} aria-label={favorite ? "Remove from saved" : "Save item"}><Heart size={17} fill={favorite ? "currentColor" : "none"} /></button></div><h3>{listing.title}</h3>{scheduledStart && <small className="field-help">Bidding starts {scheduledStart} PHT</small>}{(listing.type === "Auction" || listing.type === "Both") && <span className={`auction-card-policy ${listing.winnerCancellationAllowed === false ? "locked" : "cancellable"}`}>{listing.winnerCancellationAllowed === false ? "No change-of-mind cancellation · auto-checkout" : "Winner may cancel before delivery starts"}</span>}<div className="listing-seller"><span className="mini-avatar">{listing.seller.slice(0, 2).toUpperCase()}</span>{listing.seller}<Star size={12} fill="currentColor" /><strong>{listing.sellerRating}</strong></div>{(listing.sellerMunicipality || listing.sellerProvince) && <small className="listing-location"><MapPinned size={11} /> {[listing.sellerMunicipality, listing.sellerProvince].filter(Boolean).join(", ")}</small>}<div className="listing-price-row"><div><span>{listing.currentBid ? "Current bid" : listing.type === "Auction" || listing.type === "Both" ? "Starting bid" : "Price"}</span><strong>{money(listing.currentBid ?? listing.startingBid ?? listing.price)}</strong></div>{listing.currentBid ? <div className="listing-countdown"><Clock3 size={13} /><span>{listing.timeLeft}</span></div> : <span className="stock-label">{listing.stock} in stock</span>}</div>{onCompare && <button className={`mini-action compare-action ${compareSelected ? "active" : ""}`} onClick={(event) => { event.stopPropagation(); onCompare(); }}><Check size={13} /> {compareSelected ? "Comparing" : "Compare"}</button>}{onAddToCart && <button className="mini-action" onClick={(event) => { event.stopPropagation(); onAddToCart(); }}><Heart size={13} /> {favorite ? "Saved item" : "Save item"}</button>}{onBuyNow && <button className="mini-action buy-now-action" onClick={(event) => { event.stopPropagation(); onBuyNow(); }}><ShoppingBag size={13} /> Buy now · {money(listing.buyNow ?? listing.price)}</button>}</div></article>;
}
function ActivityRow({ item, read, onOpen }: { item: ActivityItem; read: boolean; onOpen: () => void }) {
  return <button className={`activity-row ${read ? "read" : ""}`} onClick={onOpen}><span className={`mini-avatar ${item.tone}-avatar`}>{item.initials}</span><div><strong>{item.title}</strong><span>{item.meta}</span></div><time>{item.time}</time>{!read && <i />}</button>;
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
