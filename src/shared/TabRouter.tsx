import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Menu, ChevronDown } from 'lucide-react';

export interface TabConfig {
  value: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  badge?: number;
}

interface TabRouterProps {
  tabs: TabConfig[];
  defaultTab?: string;
  children: (activeTab: string, changeTab: (tab: string) => void) => React.ReactNode;
  desktopCols?: number;
  /** When true, ignores URL hash — always starts at defaultTab and doesn't write hash */
  ignoreUrlHash?: boolean;
}

/** Number of tabs shown inline on desktop before collapsing the rest into "More" */
const VISIBLE_COUNT = 7;

export default function TabRouter({ tabs, defaultTab, children, desktopCols, ignoreUrlHash }: TabRouterProps) {
  const [activeTab, setActiveTab] = useState(() => {
    if (ignoreUrlHash) return defaultTab || tabs[0]?.value || '';
    return window.location.hash.slice(1) || defaultTab || tabs[0]?.value || '';
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showRightFade, setShowRightFade] = useState(false);
  const [showLeftFade, setShowLeftFade] = useState(false);

  // Detect scroll position to show/hide fade indicators
  const checkFades = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setShowLeftFade(el.scrollLeft > 4);
    setShowRightFade(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    checkFades();
    el.addEventListener('scroll', checkFades, { passive: true });
    const ro = new ResizeObserver(checkFades);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', checkFades);
      ro.disconnect();
    };
  }, [checkFades, tabs]);

  // Scroll active tab into view when it changes
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const active = el.querySelector('[data-state="active"]') as HTMLElement | null;
    if (active) {
      active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }, [activeTab]);

  useEffect(() => {
    if (ignoreUrlHash) return;
    const onPop = () => {
      const hash = window.location.hash.slice(1);
      const validTab = tabs.find(t => t.value === hash);
      if (validTab) setActiveTab(validTab.value);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [tabs, ignoreUrlHash]);

  const handleChange = useCallback((value: string) => {
    setActiveTab(value);
    setMobileOpen(false);
    if (!ignoreUrlHash) {
      window.history.pushState(null, '', `#${value}`);
    }
  }, [ignoreUrlHash]);

  // Use grid layout only when desktopCols is explicitly set AND tab count is small
  const useGrid = desktopCols != null && tabs.length <= 6;
  const activeLabel = tabs.find(t => t.value === activeTab)?.label || 'Menu';
  const ActiveIcon = tabs.find(t => t.value === activeTab)?.icon;

  // Split tabs into visible + overflow for desktop when many tabs
  const hasOverflow = tabs.length > VISIBLE_COUNT;
  const visibleTabs = hasOverflow ? tabs.slice(0, VISIBLE_COUNT) : tabs;
  const overflowTabs = hasOverflow ? tabs.slice(VISIBLE_COUNT) : [];
  // If active tab is in overflow, we need to show it in visible area
  const activeInOverflow = hasOverflow && overflowTabs.some(t => t.value === activeTab);
  const displayVisibleTabs = activeInOverflow
    ? [...visibleTabs.slice(0, VISIBLE_COUNT - 1), tabs.find(t => t.value === activeTab)!]
    : visibleTabs;
  const displayOverflowTabs = activeInOverflow
    ? [visibleTabs[VISIBLE_COUNT - 1], ...overflowTabs.filter(t => t.value !== activeTab)]
    : overflowTabs;

  return (
    <Tabs value={activeTab} onValueChange={handleChange} className="w-full">
      {/* Desktop Navigation */}
      <div className="hidden md:block relative mb-6 no-print">
        {/* Left fade */}
        {showLeftFade && (
          <div className="absolute left-0 top-0 bottom-0 w-8 z-10 pointer-events-none rounded-l-md"
            style={{ background: 'linear-gradient(to right, hsl(var(--background)) 0%, transparent 100%)' }}
          />
        )}
        {/* Right fade */}
        {!hasOverflow && showRightFade && (
          <div className="absolute right-0 top-0 bottom-0 w-8 z-10 pointer-events-none rounded-r-md"
            style={{ background: 'linear-gradient(to left, hsl(var(--background)) 0%, transparent 100%)' }}
          />
        )}

        <div
          ref={scrollRef}
          className="overflow-x-auto scrollbar-hide"
        >
          <TabsList
            className={useGrid ? 'grid w-full' : 'flex w-max min-w-full'}
            style={useGrid ? { gridTemplateColumns: `repeat(${desktopCols}, minmax(0, 1fr))` } : undefined}
          >
            {displayVisibleTabs.map(tab => {
              const Icon = tab.icon;
              return (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className="flex items-center gap-1.5 shrink-0 whitespace-nowrap px-4"
                >
                  {Icon && <Icon className="w-4 h-4 shrink-0" />}
                  <span>{tab.label}</span>
                  {tab.badge != null && tab.badge > 0 && (
                    <span className="ml-0.5 bg-destructive text-destructive-foreground text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                      {tab.badge}
                    </span>
                  )}
                </TabsTrigger>
              );
            })}

            {/* "More" dropdown for overflow tabs */}
            {hasOverflow && displayOverflowTabs.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="flex items-center gap-1 shrink-0 whitespace-nowrap px-4 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors rounded-md cursor-pointer"
                    type="button"
                  >
                    More
                    <ChevronDown className="w-3.5 h-3.5" />
                    {/* Show badge dot if any overflow tab has a badge */}
                    {displayOverflowTabs.some(t => t.badge && t.badge > 0) && (
                      <span className="w-2 h-2 bg-destructive rounded-full" />
                    )}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[180px]">
                  {displayOverflowTabs.map(tab => {
                    const Icon = tab.icon;
                    return (
                      <DropdownMenuItem
                        key={tab.value}
                        onClick={() => handleChange(tab.value)}
                        className="cursor-pointer"
                      >
                        {Icon && <Icon className="w-4 h-4 mr-2 shrink-0" />}
                        <span className="flex-1">{tab.label}</span>
                        {tab.badge != null && tab.badge > 0 && (
                          <span className="ml-2 bg-destructive text-destructive-foreground text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                            {tab.badge}
                          </span>
                        )}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </TabsList>
        </div>
      </div>

      {/* Mobile Navigation — categorized drawer */}
      <div className="md:hidden mb-6 no-print">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" className="w-full justify-between">
              <span className="flex items-center gap-2">
                {ActiveIcon && <ActiveIcon className="w-4 h-4" />}
                {activeLabel}
              </span>
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="max-h-[70vh] overflow-y-auto rounded-t-xl">
            <div className="pt-2 pb-4">
              <p className="text-sm font-medium text-muted-foreground mb-3 px-1">Navigate to</p>
              <div className="grid grid-cols-2 gap-2">
                {tabs.map(tab => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.value;
                  return (
                    <Button
                      key={tab.value}
                      variant={isActive ? 'default' : 'outline'}
                      size="sm"
                      className="justify-start h-10 text-xs"
                      onClick={() => handleChange(tab.value)}
                    >
                      {Icon && <Icon className="w-4 h-4 mr-1.5 shrink-0" />}
                      <span className="truncate">{tab.label}</span>
                      {tab.badge != null && tab.badge > 0 && (
                        <span className="ml-auto bg-destructive text-destructive-foreground text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                          {tab.badge}
                        </span>
                      )}
                    </Button>
                  );
                })}
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {children(activeTab, handleChange)}
    </Tabs>
  );
}
