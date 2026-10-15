import { after } from 'next/server';

/** Run best-effort work once the response has been sent, so the caller's
 * button is not held while it completes. Outside a request scope (scripts,
 * tests) the work simply runs detached. */
export function runAfterResponse(label: string, work: () => Promise<unknown>): void {
  const run = () => work().catch(error => console.warn(`[After response] ${label} failed`, error));
  try {
    after(run);
  } catch {
    void run();
  }
}
