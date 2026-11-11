import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Activity, LayoutDashboard, LogOut, Menu, PackageSearch, Settings2, Sparkles, X } from "lucide-react";
import { useState, type ReactNode } from "react";

import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/orders", label: "Orders", icon: PackageSearch },
  { to: "/activity", label: "Activity log", icon: Activity },
  { to: "/settings", label: "PayPal settings", icon: Settings2 },
] as const;

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2.5">
      <span className="flex size-9 items-center justify-center rounded-xl bg-primary-gradient shadow-elevated">
        <Sparkles className="size-4.5 text-primary-foreground" />
      </span>
      <span className="font-display text-lg font-bold tracking-tight text-sidebar-accent-foreground">
        OrderFlow <span className="text-sidebar-primary">AI</span>
      </span>
    </Link>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1">
      {NAV.map(({ to, label, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          onClick={onNavigate}
          activeOptions={{ exact: to === "/" }}
          className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          activeProps={{ className: "bg-sidebar-accent text-sidebar-accent-foreground" }}
        >
          <Icon className="size-4" />
          {label}
        </Link>
      ))}
    </nav>
  );
}

function SignOutButton({ onDone }: { onDone?: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  async function handleSignOut() {
    onDone?.();
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }
  return (
    <button
      type="button"
      onClick={handleSignOut}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
    >
      <LogOut className="size-4" />
      Sign out
    </button>
  );
}

function SidebarFooter() {
  return (
    <div className="flex flex-col gap-3">
      <SignOutButton />
      <SidebarNote />
    </div>
  );
}

function SidebarNote() {
  return (
    <div className="rounded-xl border border-sidebar-border bg-sidebar-accent/60 p-4 text-xs leading-relaxed text-sidebar-foreground">
      <p className="font-semibold text-sidebar-accent-foreground">Owner approval on</p>
      <p className="mt-1">Nothing is sent, paid, refunded or changed without your approval.</p>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col justify-between bg-sidebar p-5 lg:flex">
        <div className="flex flex-col gap-8">
          <Brand />
          <NavLinks />
        </div>
        <SidebarFooter />
      </aside>

      <header className="sticky top-0 z-30 flex items-center justify-between bg-sidebar px-4 py-3 lg:hidden">
        <Brand />
        <button
          type="button"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg p-2 text-sidebar-accent-foreground hover:bg-sidebar-accent"
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </header>
      <div
        className={cn(
          "fixed inset-x-0 top-[60px] z-20 bg-sidebar p-4 shadow-elevated transition-all lg:hidden",
          open ? "visible opacity-100" : "invisible -translate-y-2 opacity-0",
        )}
      >
        <NavLinks onNavigate={() => setOpen(false)} />
        <div className="mt-2 border-t border-sidebar-border pt-2">
          <SignOutButton onDone={() => setOpen(false)} />
        </div>
      </div>

      <main className="lg:pl-64">
        <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-10">{children}</div>
      </main>
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && (
          <p className="mb-1.5 text-xs font-semibold tracking-[0.14em] text-primary uppercase">{eyebrow}</p>
        )}
        <h1 className="text-2xl font-bold text-foreground sm:text-3xl">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
