const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function quizDraftKey(ownerId: string | null | undefined, kind: 'editor' | 'attempt', scope: string): string | null {
  return ownerId ? `quiz-work:v1:${encodeURIComponent(ownerId)}:${kind}:${encodeURIComponent(scope)}` : null;
}

export function readQuizWork<T>(key: string | null): T | null {
  if (!key || typeof localStorage === 'undefined') return null;
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    if (!saved || saved.version !== 1 || !Number.isFinite(saved.savedAt) || Date.now() - saved.savedAt > MAX_AGE_MS) return null;
    return saved.value as T;
  } catch { return null; }
}

export function saveQuizWork(key: string | null, value: unknown): boolean {
  if (!key || typeof localStorage === 'undefined') return false;
  try {
    localStorage.setItem(key, JSON.stringify({ version: 1, savedAt: Date.now(), value }));
    return true;
  } catch { return false; }
}

export function clearQuizWork(key: string | null): void {
  if (!key || typeof localStorage === 'undefined') return;
  try { localStorage.removeItem(key); } catch { /* Storage may be blocked. */ }
}

/** Answers are restored only for the same question text, types and options. */
export function quizAttemptVersion(questions: { id: string; text: string; type: string; options: string[] }[]): string {
  return JSON.stringify(questions.map(({ id, text, type, options }) => ({ id, text, type, options })));
}
