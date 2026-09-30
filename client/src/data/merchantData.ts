export type ListingType = "Auction" | "Buy now" | "Both";
export type OrderStatus =
  | "Paid"
  | "Processing"
  | "Rider assigned"
  | "Picked up"
  | "In transit"
  | "Delivered"
  | "Disputed";

export type Listing = {
  id: string;
  title: string;
  description?: string;
  category: string;
  type: ListingType;
  price: number;
  currentBid?: number;
  startingBid?: number;
  buyNow?: number;
  auctionEndAt?: string;
  reserveThreshold?: number;
  minimumIncrement?: number;
  lifecycle?: "draft" | "official" | "deleted";
  ownerId?: number;
  bidders?: number;
  timeLeft?: string;
  image: string;
  photos?: string[];
  seller: string;
  sellerRating: number;
  condition: "New" | "Like new" | "Good";
  stock: number;
  reserveMet?: boolean;
  featured?: boolean;
  accent: string;
};

export type Order = {
  id: string;
  customer: string;
  item: string;
  amount: number;
  status: OrderStatus;
  payment: "Online" | "COD";
  location: string;
  eta: string;
  tracking: string;
  rider?: string;
};

export type Activity = {
  id: string;
  initials: string;
  title: string;
  meta: string;
  time: string;
  tone: "coral" | "teal" | "mustard" | "lavender";
};

export type InventoryRow = {
  sku: string;
  item: string;
  category: string;
  stock: number;
  sold: number;
  views: number;
  trend: number;
  status: "Healthy" | "Low stock" | "Auctioning";
};

export const listings: Listing[] = [
  {
    id: "sony-xm5",
    title: "Sony WH-1000XM5 Headphones",
    category: "Audio",
    type: "Auction",
    price: 8200,
    currentBid: 8450,
    startingBid: 6500,
    auctionEndAt: "2026-10-01T12:00:00+08:00",
    bidders: 18,
    timeLeft: "01h 42m",
    image: "https://images.unsplash.com/photo-1618366712010-f4ae9c647dcb?auto=format&fit=crop&w=900&q=85",
    seller: "Audio Archive PH",
    sellerRating: 4.9,
    condition: "Like new",
    stock: 1,
    reserveMet: true,
    featured: true,
    accent: "coral",
  },
  {
    id: "fujifilm-x100",
    title: "Fujifilm X100V Silver",
    category: "Cameras",
    type: "Auction",
    price: 42800,
    currentBid: 43100,
    startingBid: 38000,
    bidders: 11,
    timeLeft: "04h 18m",
    image: "https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=900&q=85",
    seller: "North Star Cameras",
    sellerRating: 4.8,
    condition: "Good",
    stock: 1,
    reserveMet: false,
    accent: "teal",
  },
  {
    id: "leather-tote",
    title: "Handmade Leather Market Tote",
    category: "Fashion",
    type: "Buy now",
    price: 1850,
    buyNow: 1850,
    image: "https://images.unsplash.com/photo-1548036328-c9fa89d128fa?auto=format&fit=crop&w=900&q=85",
    seller: "Mara Atelier",
    sellerRating: 5,
    condition: "New",
    stock: 12,
    accent: "mustard",
  },
  {
    id: "running-shoes",
    title: "New Balance 990v5 Grey",
    category: "Footwear",
    type: "Both",
    price: 6900,
    currentBid: 6900,
    buyNow: 7600,
    startingBid: 5600,
    bidders: 7,
    timeLeft: "06h 05m",
    image: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=900&q=85",
    seller: "Stride Supply",
    sellerRating: 4.7,
    condition: "New",
    stock: 4,
    reserveMet: true,
    accent: "lavender",
  },
  {
    id: "ceramic-set",
    title: "Hand-thrown Ceramic Set",
    category: "Home",
    type: "Buy now",
    price: 2400,
    buyNow: 2400,
    image: "https://images.unsplash.com/photo-1610701596007-11502861dcfa?auto=format&fit=crop&w=900&q=85",
    seller: "Luna Clay",
    sellerRating: 4.9,
    condition: "New",
    stock: 8,
    accent: "teal",
  },
  {
    id: "record-player",
    title: "Vintage Walnut Record Player",
    category: "Audio",
    type: "Auction",
    price: 5100,
    currentBid: 5100,
    startingBid: 4200,
    bidders: 5,
    timeLeft: "09h 12m",
    image: "https://images.unsplash.com/photo-1461360228754-6e81c478b882?auto=format&fit=crop&w=900&q=85",
    seller: "Second Spin",
    sellerRating: 4.6,
    condition: "Good",
    stock: 1,
    reserveMet: true,
    accent: "coral",
  },
];

export const orders: Order[] = [
  { id: "MH-2841", customer: "Mika Santos", item: "Sony WH-1000XM5 Headphones", amount: 8450, status: "In transit", payment: "Online", location: "Davao City", eta: "Today · 3:40 PM", tracking: "MHX-DF9-2841", rider: "Paolo R." },
  { id: "MH-2840", customer: "Enzo Villanueva", item: "Handmade Leather Market Tote", amount: 1850, status: "Rider assigned", payment: "COD", location: "Koronadal", eta: "Today · 5:10 PM", tracking: "MHX-KR2-2840", rider: "Nina C." },
  { id: "MH-2837", customer: "Aya Lim", item: "Fujifilm X100V Silver", amount: 43100, status: "Processing", payment: "Online", location: "General Santos", eta: "Tomorrow", tracking: "Pending pickup", rider: "Unassigned" },
  { id: "MH-2835", customer: "Gio Navarro", item: "New Balance 990v5 Grey", amount: 6900, status: "Picked up", payment: "Online", location: "Tupi", eta: "Today · 6:20 PM", tracking: "MHX-TP1-2835", rider: "Marc D." },
  { id: "MH-2829", customer: "Kara Uy", item: "Hand-thrown Ceramic Set", amount: 2400, status: "Delivered", payment: "COD", location: "Polomolok", eta: "Yesterday", tracking: "MHX-PL7-2829", rider: "Nina C." },
  { id: "MH-2823", customer: "Theo Cruz", item: "Vintage Walnut Record Player", amount: 5100, status: "Disputed", payment: "Online", location: "Davao City", eta: "Review needed", tracking: "MHX-DF9-2823", rider: "Paolo R." },
];

export const inventory: InventoryRow[] = [
  { sku: "AUD-055", item: "Sony WH-1000XM5 Headphones", category: "Audio", stock: 6, sold: 29, views: 4820, trend: 18, status: "Healthy" },
  { sku: "CAM-104", item: "Fujifilm X100V Silver", category: "Cameras", stock: 1, sold: 8, views: 3060, trend: 42, status: "Auctioning" },
  { sku: "FAS-204", item: "Handmade Leather Market Tote", category: "Fashion", stock: 12, sold: 54, views: 2014, trend: 12, status: "Healthy" },
  { sku: "FOT-013", item: "New Balance 990v5 Grey", category: "Footwear", stock: 4, sold: 23, views: 1740, trend: 8, status: "Low stock" },
  { sku: "HOM-018", item: "Hand-thrown Ceramic Set", category: "Home", stock: 8, sold: 17, views: 1102, trend: -3, status: "Healthy" },
];

export const inventoryChanges = [
  { id: "log-1", action: "Sold", item: "Sony WH-1000XM5 Headphones", quantity: "-1", detail: "Order MH-2841", time: "18m ago", tone: "coral" },
  { id: "log-2", action: "Restocked", item: "Handmade Leather Market Tote", quantity: "+12", detail: "Mara Atelier", time: "2h ago", tone: "teal" },
  { id: "log-3", action: "Converted", item: "Fujifilm X100V Silver", quantity: "-1", detail: "Auction #AU-104", time: "Yesterday", tone: "lavender" },
  { id: "log-4", action: "Adjusted", item: "New Balance 990v5 Grey", quantity: "-2", detail: "Damaged packaging", time: "Yesterday", tone: "mustard" },
];

export const activities: Activity[] = [
  { id: "a1", initials: "MS", title: "Mika won the Sony WH-1000XM5 auction", meta: "₱8,450 · Reserve met", time: "2m ago", tone: "coral" },
  { id: "a2", initials: "PR", title: "Paolo accepted delivery MH-2841", meta: "Davao City → Tupi", time: "18m ago", tone: "teal" },
  { id: "a3", initials: "LC", title: "Low stock: New Balance 990v5 Grey", meta: "4 units remaining", time: "42m ago", tone: "mustard" },
  { id: "a4", initials: "JN", title: "Jessa saved your camera listing", meta: "Fujifilm X100V Silver", time: "1h ago", tone: "lavender" },
  { id: "a5", initials: "AD", title: "Bid cancellation request received", meta: "Review required · #BC-103", time: "2h ago", tone: "mustard" },
];

export const bidHistory = [
  { initials: "MS", amount: 8450, time: "2m ago", status: "Winning" },
  { initials: "JL", amount: 8200, time: "8m ago", status: "Outbid" },
  { initials: "KR", amount: 7900, time: "14m ago", status: "Outbid" },
  { initials: "MS", amount: 7600, time: "21m ago", status: "Outbid" },
];

export const riderStats = [
  { label: "Deliveries today", value: "14", detail: "+3 vs yesterday", tone: "teal" },
  { label: "Avg. delivery time", value: "38m", detail: "-8m this week", tone: "coral" },
  { label: "Rating average", value: "4.98", detail: "From 216 reviews", tone: "mustard" },
];

export const notifications = [
  { id: "n1", label: "You were outbid on Fujifilm X100V", time: "8m", tone: "coral", unread: true },
  { id: "n2", label: "Rider Paolo accepted MH-2841", time: "18m", tone: "teal", unread: true },
  { id: "n3", label: "Price drop: Leather Market Tote", time: "1h", tone: "lavender", unread: false },
];
