/**
 * Lightweight Supabase REST client for backend endpoints.
 * Uses process.env.ZITE_SUPABASE_URL and process.env.ZITE_SUPABASE_ANON_KEY.
 * Backend-only — do NOT import from frontend code.
 */

class SupabaseQueryBuilder<T = any> {
  private _table: string;
  private _select = '*';
  private _filters: string[] = [];
  private _orderClauses: string[] = [];
  private _limitVal: number | null = null;
  private _rangeFrom: number | null = null;
  private _rangeTo: number | null = null;
  private _single = false;

  constructor(table: string) {
    this._table = table;
  }

  select(columns: string): this {
    this._select = columns;
    return this;
  }

  eq(col: string, val: string | number | boolean): this {
    this._filters.push(`${col}=eq.${val}`);
    return this;
  }

  neq(col: string, val: string | number | boolean): this {
    this._filters.push(`${col}=neq.${val}`);
    return this;
  }

  gte(col: string, val: string | number): this {
    this._filters.push(`${col}=gte.${val}`);
    return this;
  }

  lte(col: string, val: string | number): this {
    this._filters.push(`${col}=lte.${val}`);
    return this;
  }

  gt(col: string, val: string | number): this {
    this._filters.push(`${col}=gt.${val}`);
    return this;
  }

  lt(col: string, val: string | number): this {
    this._filters.push(`${col}=lt.${val}`);
    return this;
  }

  in(col: string, values: (string | number)[]): this {
    const escaped = values.map(v => typeof v === 'string' ? `"${v}"` : String(v)).join(',');
    this._filters.push(`${col}=in.(${escaped})`);
    return this;
  }

  is(col: string, val: null | boolean): this {
    this._filters.push(`${col}=is.${val}`);
    return this;
  }

  ilike(col: string, pattern: string): this {
    this._filters.push(`${col}=ilike.${pattern}`);
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }): this {
    const dir = opts?.ascending === false ? 'desc' : 'asc';
    this._orderClauses.push(`${col}.${dir}`);
    return this;
  }

  limit(n: number): this {
    this._limitVal = n;
    return this;
  }

  range(from: number, to: number): this {
    this._rangeFrom = from;
    this._rangeTo = to;
    return this;
  }

  single(): this {
    this._single = true;
    return this;
  }

  /** Build the full URL */
  private _buildUrl(): string {
    const base = process.env.ZITE_SUPABASE_URL;
    const params: string[] = [`select=${encodeURIComponent(this._select)}`];

    for (const f of this._filters) {
      params.push(f);
    }

    if (this._orderClauses.length > 0) {
      params.push(`order=${this._orderClauses.join(',')}`);
    }

    if (this._limitVal !== null) {
      params.push(`limit=${this._limitVal}`);
    }

    return `${base}/rest/v1/${this._table}?${params.join('&')}`;
  }

  /** Build request headers */
  private _buildHeaders(): Record<string, string> {
    const key = process.env.ZITE_SUPABASE_ANON_KEY;
    const headers: Record<string, string> = {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    };

    if (this._rangeFrom !== null && this._rangeTo !== null) {
      headers['Range'] = `${this._rangeFrom}-${this._rangeTo}`;
      headers['Range-Unit'] = 'items';
    }

    if (this._single) {
      headers['Accept'] = 'application/vnd.pgrst.object+json';
    }

    return headers;
  }

  /** Execute the query */
  async execute(): Promise<{ data: T; error: null } | { data: null; error: string }> {
    const url = this._buildUrl();
    const headers = this._buildHeaders();

    const resp = await fetch(url, { method: 'GET', headers });

    if (!resp.ok) {
      const body = await resp.text();
      return { data: null, error: `Supabase ${resp.status}: ${body}` };
    }

    const data = await resp.json();
    return { data: data as T, error: null };
  }

  /** Make the builder thenable so you can `await supabase.from('x').select('*')` */
  then<TResult1 = { data: T; error: null } | { data: null; error: string }, TResult2 = never>(
    onfulfilled?: ((value: { data: T; error: null } | { data: null; error: string }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

/** Entry point — usage: `supabase.from('table').select('*').eq('id', 1)` */
export const supabase = {
  from<T = any>(table: string): SupabaseQueryBuilder<T[]> {
    return new SupabaseQueryBuilder<T[]>(table);
  },
};

/**
 * Paginate through ALL rows for a query (Supabase caps at 1000 per request).
 *
 * Usage:
 * ```ts
 * const rows = await fetchAllRows<MyType>((from, to) =>
 *   supabase.from('my_table').select('*').eq('active', true).range(from, to)
 * );
 * ```
 */
export async function fetchAllRows<T>(
  buildQuery: (from: number, to: number) => SupabaseQueryBuilder<T[]>,
): Promise<T[]> {
  const PAGE_SIZE = 1000;
  const allRows: T[] = [];
  let offset = 0;

  while (true) {
    const from = offset;
    const to = offset + PAGE_SIZE - 1;
    const query = buildQuery(from, to);
    const { data, error } = await query;

    if (error) {
      throw new Error(error);
    }

    const rows = data as T[];
    allRows.push(...rows);

    if (rows.length < PAGE_SIZE) {
      break; // Last page
    }

    offset += PAGE_SIZE;
  }

  return allRows;
}
