"use client"

import * as React from 'react';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { Button } from './button';
import { Calendar as CalendarIcon, Clock, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DateTimePickerProps {
  value?: string;
  onChange: (value: string) => void;
  type?: 'datetime' | 'date';
  placeholder?: string;
  disabled?: boolean;
  min?: string;
  max?: string;
  className?: string;
  id?: string;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const DAYS_OF_WEEK = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export function DateTimePicker({
  value,
  onChange,
  type = 'datetime',
  placeholder = 'Select date & time',
  disabled = false,
  min,
  max,
  className,
  id,
}: DateTimePickerProps) {
  const [isOpen, setIsOpen] = React.useState(false);

  // Parsed date states
  const parsedDate = React.useMemo(() => {
    if (!value) return null;
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }, [value]);

  // Calendar navigation states (default to parsed date or today)
  const [navMonth, setNavMonth] = React.useState(() => {
    const today = new Date();
    return parsedDate ? parsedDate.getMonth() : today.getMonth();
  });
  const [navYear, setNavYear] = React.useState(() => {
    const today = new Date();
    return parsedDate ? parsedDate.getFullYear() : today.getFullYear();
  });

  // Sync calendar view if selected value changes externally
  React.useEffect(() => {
    if (parsedDate) {
      setNavMonth(parsedDate.getMonth());
      setNavYear(parsedDate.getFullYear());
    }
  }, [parsedDate]);

  // Time states (12-hour format)
  const [selectedHour, setSelectedHour] = React.useState('12');
  const [selectedMinute, setSelectedMinute] = React.useState('00');
  const [selectedPeriod, setSelectedPeriod] = React.useState<'AM' | 'PM'>('PM');

  // Sync time state if parsedDate is present
  React.useEffect(() => {
    if (parsedDate && type === 'datetime') {
      let hours = parsedDate.getHours();
      const mins = parsedDate.getMinutes().toString().padStart(2, '0');
      const period = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      hours = hours === 0 ? 12 : hours;
      setSelectedHour(hours.toString().padStart(2, '0'));
      setSelectedMinute(mins);
      setSelectedPeriod(period);
    }
  }, [parsedDate, type]);

  // Calendar helpers
  const daysInMonth = React.useMemo(() => {
    return new Date(navYear, navMonth + 1, 0).getDate();
  }, [navYear, navMonth]);

  const firstDayOfWeek = React.useMemo(() => {
    return new Date(navYear, navMonth, 1).getDay();
  }, [navYear, navMonth]);

  const prevMonthDays = React.useMemo(() => {
    return new Date(navYear, navMonth, 0).getDate();
  }, [navYear, navMonth]);

  const calendarCells = React.useMemo(() => {
    const cells: Array<{ day: number; isPadding: boolean; date: Date }> = [];
    
    // Padding from previous month
    for (let i = firstDayOfWeek - 1; i >= 0; i--) {
      const day = prevMonthDays - i;
      const prevMonth = navMonth === 0 ? 11 : navMonth - 1;
      const prevYear = navMonth === 0 ? navYear - 1 : navYear;
      cells.push({
        day,
        isPadding: true,
        date: new Date(prevYear, prevMonth, day),
      });
    }

    // Days in current month
    for (let i = 1; i <= daysInMonth; i++) {
      cells.push({
        day: i,
        isPadding: false,
        date: new Date(navYear, navMonth, i),
      });
    }

    // Keep the calendar compact: use five rows whenever the month fits, and
    // add a sixth only for months whose first week plus days require it.
    const totalCells = cells.length <= 35 ? 35 : 42;
    const nextMonthPadding = totalCells - cells.length;
    for (let i = 1; i <= nextMonthPadding; i++) {
      const nextMonth = navMonth === 11 ? 0 : navMonth + 1;
      const nextYear = navMonth === 11 ? navYear + 1 : navYear;
      cells.push({
        day: i,
        isPadding: true,
        date: new Date(nextYear, nextMonth, i),
      });
    }

    return cells;
  }, [navYear, navMonth, daysInMonth, firstDayOfWeek, prevMonthDays]);

  const handlePrevMonth = () => {
    if (navMonth === 0) {
      setNavMonth(11);
      setNavYear(prev => prev - 1);
    } else {
      setNavMonth(prev => prev - 1);
    }
  };

  const handleNextMonth = () => {
    if (navMonth === 11) {
      setNavMonth(0);
      setNavYear(prev => prev + 1);
    } else {
      setNavMonth(prev => prev + 1);
    }
  };

  const constructISOString = (dateObj: Date, hourStr: string, minStr: string, period: 'AM' | 'PM') => {
    let hour = parseInt(hourStr, 10);
    if (period === 'PM' && hour < 12) hour += 12;
    if (period === 'AM' && hour === 12) hour = 0;
    
    const year = dateObj.getFullYear();
    const month = (dateObj.getMonth() + 1).toString().padStart(2, '0');
    const day = dateObj.getDate().toString().padStart(2, '0');
    const hrs = hour.toString().padStart(2, '0');
    const mns = minStr.toString().padStart(2, '0');

    if (type === 'date') {
      return `${year}-${month}-${day}`;
    }
    return `${year}-${month}-${day}T${hrs}:${mns}`;
  };

  const slotTime = (dateObj: Date, hourStr: string, minuteStr: string, period: 'AM' | 'PM') => {
    let hour = parseInt(hourStr, 10);
    if (period === 'PM' && hour < 12) hour += 12;
    if (period === 'AM' && hour === 12) hour = 0;
    return new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate(), hour, parseInt(minuteStr, 10), 0, 0).getTime();
  };

  const earliestMs = React.useMemo(() => {
    if (!min || type !== 'datetime') return null;
    const earliest = new Date(min);
    return Number.isNaN(earliest.getTime()) ? null : earliest.getTime();
  }, [min, type]);

  const isSlotBeforeMin = (hour: string, minute: string, period: 'AM' | 'PM', dateObj?: Date) => {
    if (earliestMs == null) return false;
    return slotTime(dateObj || parsedDate || new Date(), hour, minute, period) < earliestMs;
  };

  const handleSelectDate = (cellDate: Date) => {
    let hour = selectedHour;
    let minute = selectedMinute;
    let period = selectedPeriod;
    if (isSlotBeforeMin(hour, minute, period, cellDate) && earliestMs != null) {
      const earliest = new Date(earliestMs);
      let hours = earliest.getHours();
      period = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12 || 12;
      hour = hours.toString().padStart(2, '0');
      minute = earliest.getMinutes().toString().padStart(2, '0');
      setSelectedHour(hour);
      setSelectedMinute(minute);
      setSelectedPeriod(period);
    }
    const iso = constructISOString(cellDate, hour, minute, period);
    onChange(iso);
    if (type === 'date') {
      setIsOpen(false);
    }
  };

  const handleTimeChange = (hour: string, minute: string, period: 'AM' | 'PM') => {
    if (isSlotBeforeMin(hour, minute, period)) return;
    setSelectedHour(hour);
    setSelectedMinute(minute);
    setSelectedPeriod(period);

    const baseDate = parsedDate || new Date();
    const iso = constructISOString(baseDate, hour, minute, period);
    onChange(iso);
  };

  const handleClear = () => {
    onChange('');
    setIsOpen(false);
  };

  const handleToday = () => {
    handleSelectDate(new Date());
  };

  // Human-readable trigger text
  const buttonText = React.useMemo(() => {
    if (!parsedDate) return placeholder;
    if (type === 'date') {
      return parsedDate.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    }
    
    const timeStr = parsedDate.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
    const dateStr = parsedDate.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    return `${dateStr} · ${timeStr}`;
  }, [parsedDate, type, placeholder]);

  const hourContainerRef = React.useRef<HTMLDivElement>(null);
  const minuteContainerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (isOpen && type === 'datetime') {
      setTimeout(() => {
        if (hourContainerRef.current) {
          const selected = hourContainerRef.current.querySelector('[data-selected="true"]');
          if (selected) {
            selected.scrollIntoView({ block: 'nearest', behavior: 'auto' });
          }
        }
        if (minuteContainerRef.current) {
          const selected = minuteContainerRef.current.querySelector('[data-selected="true"]');
          if (selected) {
            selected.scrollIntoView({ block: 'nearest', behavior: 'auto' });
          }
        }
      }, 50);
    }
  }, [isOpen, type, selectedHour, selectedMinute]);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger
        id={id}
        disabled={disabled}
        className={cn(
          "w-full flex items-center justify-start text-left font-normal h-10 px-3 py-2 bg-card border rounded-xl hover:bg-accent/40 focus:outline-hidden focus:ring-1 focus:ring-primary shadow-xs gap-2",
          !value && "text-muted-foreground",
          className
        )}
      >
        {type === 'date' ? (
          <CalendarIcon className="w-4 h-4 text-primary shrink-0" />
        ) : (
          <Clock className="w-4 h-4 text-primary shrink-0" />
        )}
        <span className="truncate text-xs">{buttonText}</span>
      </PopoverTrigger>
      
      <PopoverContent
        align="start"
        sideOffset={8}
        className="w-auto max-w-[calc(100vw-1rem)] p-3 bg-card border border-border/80 shadow-xl rounded-2xl flex flex-col sm:flex-row gap-3 max-h-[calc(100dvh-1rem)] overflow-y-auto backdrop-blur-md"
      >
        {/* Style block to hide scrollbars completely */}
        <style dangerouslySetInnerHTML={{__html: `
          .scrollbar-none::-webkit-scrollbar {
            display: none;
          }
          .scrollbar-none {
            -ms-overflow-style: none;
            scrollbar-width: none;
            scroll-behavior: smooth;
          }
        `}} />

        {/* Calendar Picker Panel */}
        <div className="w-[min(320px,calc(100vw-3rem))] sm:w-[248px] shrink-0 flex flex-col gap-2.5">
          {/* Header */}
          <div className="flex items-center justify-between pb-1">
            <span className="font-semibold text-sm tracking-tight text-foreground">
              {MONTH_NAMES[navMonth]} {navYear}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={handlePrevMonth}
                aria-label="Previous month"
                className="w-7 h-7 rounded-lg text-muted-foreground hover:bg-primary/10 hover:text-primary"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleNextMonth}
                aria-label="Next month"
                className="w-7 h-7 rounded-lg text-muted-foreground hover:bg-primary/10 hover:text-primary"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Weekday headers */}
          <div className="grid grid-cols-7 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
            {DAYS_OF_WEEK.map((d) => (
              <div key={d} className="py-1">{d}</div>
            ))}
          </div>

          {/* Days grid */}
          <div className="grid grid-cols-7 gap-0.5 text-center text-xs">
            {calendarCells.map((cell, idx) => {
              const isSelected = parsedDate && 
                parsedDate.getDate() === cell.date.getDate() &&
                parsedDate.getMonth() === cell.date.getMonth() &&
                parsedDate.getFullYear() === cell.date.getFullYear();
              
              const isToday = !cell.isPadding && (() => {
                const today = new Date();
                return today.getDate() === cell.date.getDate() &&
                  today.getMonth() === cell.date.getMonth() &&
                  today.getFullYear() === cell.date.getFullYear();
              })();

              const isDisabled = (() => {
                const cellDateOnly = new Date(cell.date.getFullYear(), cell.date.getMonth(), cell.date.getDate());
                if (min) {
                  const minD = new Date(min);
                  const minDateOnly = new Date(minD.getFullYear(), minD.getMonth(), minD.getDate());
                  if (cellDateOnly < minDateOnly) return true;
                }
                if (max) {
                  const maxD = new Date(max);
                  const maxDateOnly = new Date(maxD.getFullYear(), maxD.getMonth(), maxD.getDate());
                  if (cellDateOnly > maxDateOnly) return true;
                }
                return false;
              })();

              return (
                <button
                  key={idx}
                  type="button"
                  disabled={isDisabled}
                  aria-label={cell.date.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}
                  aria-pressed={!!isSelected}
                  onClick={() => !isDisabled && handleSelectDate(cell.date)}
                  className={cn(
                    "h-11 w-full sm:h-8 sm:w-8 rounded-full flex items-center justify-center font-medium transition-colors relative focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1",
                    isDisabled 
                      ? "text-muted-foreground/20 cursor-not-allowed hover:bg-transparent"
                        : cell.isPadding
                        ? "text-muted-foreground/30 hover:bg-muted/40 cursor-pointer"
                        : "text-foreground hover:bg-primary/10 hover:text-primary cursor-pointer",
                    isToday && !isSelected && !isDisabled && "border border-primary/60 text-primary font-bold",
                    isSelected && !isDisabled && "bg-primary text-primary-foreground font-semibold shadow-sm hover:bg-primary/90 hover:text-primary-foreground"
                  )}
                >
                  {cell.day}
                </button>
              );
            })}
          </div>

          {/* Bottom Actions */}
          <div className="flex justify-between items-center border-t border-border/60 pt-2 mt-0.5">
            <button
              type="button"
              onClick={handleClear}
              className="text-xs font-medium text-muted-foreground hover:text-destructive cursor-pointer focus:outline-none"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={handleToday}
              className="text-xs font-semibold text-primary hover:text-primary/80 cursor-pointer focus:outline-none"
            >
              Today
            </button>
          </div>
        </div>

        {/* Time Picker Panel */}
        {type === 'datetime' && (
          <div className="flex flex-col justify-between sm:pl-4 sm:border-l sm:border-border/80 pt-3 sm:pt-0 border-t sm:border-t-0 border-border/80 min-w-[170px]">
            {/* Digital Clock Banner */}
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-border/60">
              <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                <Clock className="w-3.5 h-3.5 text-primary" />
                <span>{selectedHour}:{selectedMinute} {selectedPeriod}</span>
              </div>
              {/* Segmented AM/PM Toggle */}
              <div className="flex bg-muted/60 p-0.5 rounded-lg border border-border/40">
                {(['AM', 'PM'] as const).map(p => {
                  const isSelected = selectedPeriod === p;
                  const isPast = isSlotBeforeMin('11', '59', p);
                  return (
                    <button
                      key={p}
                      type="button"
                      disabled={isPast}
                      onClick={() => handleTimeChange(selectedHour, selectedMinute, p)}
                      className={cn(
                        "px-2 py-0.5 text-[10px] font-bold rounded-md transition-all cursor-pointer focus:outline-none disabled:cursor-not-allowed disabled:opacity-40",
                        isSelected
                          ? "bg-primary text-primary-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {p}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Scrollable Column Selectors */}
            <div className="flex gap-2 justify-center">
              {/* Hours Column */}
              <div className="flex flex-col items-center flex-1">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Hour</span>
                <div 
                  ref={hourContainerRef} 
                  className="h-44 w-full bg-muted/20 border border-border/40 rounded-xl p-1 overflow-y-auto flex flex-col gap-1 scrollbar-none"
                >
                  {Array.from({ length: 12 }, (_, i) => (i + 1).toString().padStart(2, '0')).map(h => {
                    const isSelected = selectedHour === h;
                    const isPast = isSlotBeforeMin(h, '59', selectedPeriod);
                    return (
                      <button
                        key={h}
                        type="button"
                        disabled={isPast}
                        data-selected={isSelected}
                        onClick={() => handleTimeChange(h, selectedMinute, selectedPeriod)}
                        className={cn(
                          "h-7 w-full text-xs rounded-lg font-medium transition-all cursor-pointer shrink-0 focus:outline-none flex items-center justify-center disabled:cursor-not-allowed disabled:opacity-40",
                          isSelected 
                            ? "bg-primary text-primary-foreground font-bold shadow-xs scale-[0.98]" 
                            : "text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                        )}
                      >
                        {h}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Minutes Column */}
              <div className="flex flex-col items-center flex-1">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Min</span>
                <div 
                  ref={minuteContainerRef} 
                  className="h-44 w-full bg-muted/20 border border-border/40 rounded-xl p-1 overflow-y-auto flex flex-col gap-1 scrollbar-none"
                >
                  {Array.from({ length: 60 }, (_, i) => i.toString().padStart(2, '0')).map(m => {
                    const isSelected = selectedMinute === m;
                    const isPast = isSlotBeforeMin(selectedHour, m, selectedPeriod);
                    return (
                      <button
                        key={m}
                        type="button"
                        disabled={isPast}
                        data-selected={isSelected}
                        onClick={() => handleTimeChange(selectedHour, m, selectedPeriod)}
                        className={cn(
                          "h-7 w-full text-xs rounded-lg font-medium transition-all cursor-pointer shrink-0 focus:outline-none flex items-center justify-center disabled:cursor-not-allowed disabled:opacity-40",
                          isSelected 
                            ? "bg-primary text-primary-foreground font-bold shadow-xs scale-[0.98]" 
                            : "text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                        )}
                      >
                        {m}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Done Action */}
            <div className="pt-2.5 mt-1 border-t border-border/60">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="w-full h-8 text-xs font-semibold bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 shadow-xs flex items-center justify-center transition-all cursor-pointer focus:outline-none"
              >
                Set Time
              </button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
