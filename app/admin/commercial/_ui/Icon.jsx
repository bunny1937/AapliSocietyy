"use client";
import {
  LayoutDashboard, FileText, Users, CreditCard, BookOpen, Waves, Store,
  Megaphone, MessageSquareWarning, Settings, Building2, ClipboardList,
  Database, PackageOpen, ScrollText, Plus, RefreshCw, Tag, IndianRupee,
  Home, CheckCircle, AlertTriangle, Clock, Phone, ChevronRight, Search,
  Bell, Wrench, ShieldAlert, Sparkles, Calendar, ArrowRight, Sun, Moon, X,
} from "lucide-react";

const MAP = {
  x: X,
  "layout-dashboard": LayoutDashboard, "file-text": FileText, users: Users,
  "credit-card": CreditCard, "book-open": BookOpen, waves: Waves, store: Store,
  megaphone: Megaphone, "message-square-warning": MessageSquareWarning,
  settings: Settings, "building-2": Building2, "clipboard-list": ClipboardList,
  database: Database, "package-open": PackageOpen, "scroll-text": ScrollText,
  plus: Plus, "refresh-cw": RefreshCw, tag: Tag, "indian-rupee": IndianRupee,
  home: Home, "check-circle": CheckCircle, "alert-triangle": AlertTriangle,
  clock: Clock, phone: Phone, "chevron-right": ChevronRight, search: Search,
  bell: Bell, wrench: Wrench, "shield-alert": ShieldAlert, sparkles: Sparkles,
  calendar: Calendar, "arrow-right": ArrowRight, sun: Sun, moon: Moon,
};

export default function Icon({ name, size = 16, ...rest }) {
  const Cmp = MAP[name];
  if (!Cmp) return null;
  return <Cmp size={size} {...rest} />;
}
