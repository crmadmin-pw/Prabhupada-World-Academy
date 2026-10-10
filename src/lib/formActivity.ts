/**
 * Tracks work that a reload would throw away: unsaved form controls, custom
 * widgets (checkbox, switch, quiz choices), and explicit leases from screens
 * that keep answers in memory.
 */

import { useEffect, useRef } from 'react';

const EDITABLE_SELECTOR = [
  'input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="hidden"]):not([type="image"])',
  'textarea',
  'select',
  '[contenteditable="true"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="slider"]',
  '[role="combobox"]',
  '[role="spinbutton"]',
  '[data-slot="checkbox"]',
  '[data-slot="switch"]',
  '[data-slot="input"]',
  '[data-slot="textarea"]',
  '[data-slot="select-trigger"]',
].join(',');

const CLICK_TOGGLE_SELECTOR = [
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[data-slot="checkbox"]',
  '[data-slot="switch"]',
].join(',');

const touched = new Set<HTMLElement>();
const listeners = new Set<() => void>();
let leases = 0;
let trackingInstalled = false;
let removeTracking: (() => void) | null = null;

function notify() {
  queueMicrotask(() => {
    for (const listener of listeners) listener();
  });
}

export function holdUnsavedWork(): () => void {
  leases += 1;
  notify();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    leases = Math.max(0, leases - 1);
    notify();
  };
}

/**
 * Keeps a reload waiting while `active` is true. The lease is taken during
 * render so a version check that is already awaiting cannot reload between
 * this screen appearing and a passive effect.
 */
export function useUnsavedWork(active: boolean) {
  const release = useRef<(() => void) | null>(null);
  if (active && !release.current) release.current = holdUnsavedWork();
  if (!active && release.current) {
    release.current();
    release.current = null;
  }
  useEffect(() => () => {
    release.current?.();
    release.current = null;
  }, []);
}

export function subscribeFormActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function editableControl(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const control = target.closest(EDITABLE_SELECTOR);
  return control instanceof HTMLElement ? control : null;
}

function nativeControlIsClean(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement) {
    const type = (el.type || 'text').toLowerCase();
    if (type === 'checkbox' || type === 'radio') return el.checked === el.defaultChecked;
    if (type === 'file') return (el.files?.length ?? 0) === 0;
    if (type === 'button' || type === 'submit' || type === 'reset' || type === 'hidden' || type === 'image') return true;
    return el.value === el.defaultValue;
  }
  if (el instanceof HTMLTextAreaElement) return el.value === el.defaultValue;
  if (el instanceof HTMLSelectElement) {
    return Array.from(el.options).every(option => option.selected === option.defaultSelected);
  }
  return false;
}

function remember(control: HTMLElement | null) {
  if (!control) return;
  touched.add(control);
  notify();
}

function onEdit(event: Event) {
  if (event.target instanceof Element) {
    const form = event.target.closest('form');
    if (form instanceof HTMLElement) remember(form);
  }
  remember(editableControl(event.target));
}

function onToggleClick(event: Event) {
  if (!(event.target instanceof Element)) return;
  const control = event.target.closest(CLICK_TOGGLE_SELECTOR);
  remember(control instanceof HTMLElement ? control : null);
}

function onClick(event: Event) {
  onEdit(event);
  onToggleClick(event);
}

function dirtyControlCount(): number {
  let dirty = 0;
  for (const el of touched) {
    if (!el.isConnected || nativeControlIsClean(el)) {
      touched.delete(el);
      continue;
    }
    dirty += 1;
  }
  return dirty;
}

export function isFormInProgress(): boolean {
  if (leases > 0) return true;
  if (typeof document === 'undefined') return false;
  if (document.querySelector('[data-unsaved-work="true"]')) return true;
  const active = document.activeElement;
  if (active instanceof HTMLElement && editableControl(active)) return true;
  return dirtyControlCount() > 0;
}

export function installFormActivityTracking(): () => void {
  if (typeof document === 'undefined') return () => {};
  if (trackingInstalled && removeTracking) return removeTracking;
  document.addEventListener('input', onEdit, true);
  document.addEventListener('change', onEdit, true);
  document.addEventListener('click', onClick, true);
  trackingInstalled = true;
  removeTracking = () => {
    document.removeEventListener('input', onEdit, true);
    document.removeEventListener('change', onEdit, true);
    document.removeEventListener('click', onClick, true);
    trackingInstalled = false;
    removeTracking = null;
  };
  return removeTracking;
}
