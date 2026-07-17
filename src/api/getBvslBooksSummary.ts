import { z } from 'zod';
import { createEndpoint } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  authenticated: true,
  description: 'Fetch book distribution data from Supabase for a BVSL',
  inputSchema: z.object({
    email: z.string(),
    startDate: z.string(),
    endDate: z.string(),
  }),
  outputSchema: z.object({
    books: z.array(z.object({
      date: z.string(),
      bookName: z.string(),
      quantity: z.number(),
    })),
    totalBooks: z.number(),
  }),
  async execute({ input }) {
    const supabaseUrl = process.env.ZITE_SUPABASE_URL;
    const supabaseKey = process.env.ZITE_SUPABASE_ANON_KEY;

    // Step 1: Look up volunteer by email
    const volRes = await fetch(
      `${supabaseUrl}/rest/v1/volunteers?email=eq.${encodeURIComponent(input.email)}&select=id`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
    );
    const volunteers = await volRes.json();
    if (!Array.isArray(volunteers) || volunteers.length === 0) {
      return { books: [], totalBooks: 0 };
    }

    const volunteerId = volunteers[0].id;

    // Step 2: Query book distribution log
    const booksRes = await fetch(
      `${supabaseUrl}/rest/v1/book_distribution_log?volunteer_id=eq.${volunteerId}&distribution_date=gte.${input.startDate}&distribution_date=lte.${input.endDate}&select=distribution_date,book_name,quantity`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
    );
    const booksData = await booksRes.json();

    if (!Array.isArray(booksData)) {
      return { books: [], totalBooks: 0 };
    }

    const books = booksData.map((b: any) => ({
      date: b.distribution_date || '',
      bookName: b.book_name || '',
      quantity: Number(b.quantity) || 0,
    }));

    const totalBooks = books.reduce((s, b) => s + b.quantity, 0);

    return { books, totalBooks };
  },
});
