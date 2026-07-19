import { NextRequest, NextResponse } from 'next/server';
import { Users } from '@/lib/zite-integrations-backend-sdk';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import fs from 'fs';
import path from 'path';

// Initialize Firebase Admin if Service Account exists in local file or environment variables
const apps = getApps();
if (apps.length === 0) {
  const serviceAccountPath = path.resolve(process.cwd(), 'service-account.json');
  if (fs.existsSync(serviceAccountPath)) {
    try {
      const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
      initializeApp({
        credential: cert(serviceAccount),
        projectId: serviceAccount.project_id
      });
    } catch (e) {
      console.error('[Firebase Admin Route] Failed to initialize using local file:', e);
    }
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      initializeApp({
        credential: cert(serviceAccount),
        projectId: serviceAccount.project_id
      });
    } catch (e) {
      console.error('[Firebase Admin Route] Failed to initialize using environment variable:', e);
    }
  } else {
    try {
      const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;
      if (projectId) {
        initializeApp({ projectId });
      } else {
        initializeApp();
      }
    } catch (e) {
      console.error('[Firebase Admin Route] Failed default initializeApp:', e);
    }
  }
}

async function verifyToken(token: string): Promise<{ email: string | null; uid: string }> {
  // Support Mock auth token for local offline development
  if (token.startsWith('mock_token_for_')) {
    const email = token.replace('mock_token_for_', '');
    return { email, uid: email };
  }

  // If Firebase Admin is initialized, verify the ID Token
  const activeApps = getApps();
  if (activeApps.length > 0) {
    const decoded = await getAuth().verifyIdToken(token);
    return { email: decoded.email || null, uid: decoded.uid };
  }

  // Fallback JWT payload decoder for local testing without Admin credentials
  if (process.env.NODE_ENV === 'development') {
    const parts = token.split('.');
    if (parts.length === 3) {
      try {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
        return { email: payload.email || null, uid: payload.sub || payload.user_id };
      } catch {}
    }
  }

  throw new Error('Authentication verification not configured. Check process.env.FIREBASE_SERVICE_ACCOUNT.');
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ endpoint: string }> }
) {
  const { endpoint } = await params;

  try {
    // 1. Dynamic import of the requested endpoint file
    let endpointConfig;
    try {
      endpointConfig = (await import(`@/api/${endpoint}`)).default;
    } catch (e: any) {
      console.error(`[API Router] Endpoint not found: ${endpoint}`, e);
      return NextResponse.json(
        { message: `Endpoint ${endpoint} not found or failed to load.` },
        { status: 404 }
      );
    }

    // 2. Parse request body
    let body = {};
    if (req.headers.get('content-type')?.includes('application/json')) {
      body = await req.json().catch(() => ({}));
    }

    // 3. Setup context
    let context: any = { user: null };

    if (endpointConfig.authenticated) {
      const authHeader = req.headers.get('Authorization') || '';
      const token = authHeader.replace(/^Bearer\s+/i, '').trim();

      if (!token) {
        return NextResponse.json({ message: 'Authentication required' }, { status: 401 });
      }

      try {
        const decodedUser = await verifyToken(token);
        
        let dbUser = null;
        if (decodedUser.email) {
          // Look up user record in DB by email
          dbUser = await Users.findOne({ filters: { email: decodedUser.email } });
          console.log(`[API Router Auth] Token Email: ${decodedUser.email} | dbUser:`, dbUser ? JSON.stringify(dbUser) : "null");
        }

        if (dbUser) {
          context.user = {
            id: dbUser.id,
            email: dbUser.email,
            role: dbUser.role || 'User',
          };
        } else {
          // Bootstrap override: if Users table is empty, make first authenticated user Super Guide
          let userRole = 'User';
          try {
            const { records } = await Users.findAll({ limit: 1 });
            if (records.length === 0) {
              userRole = 'Super Guide';
              console.log(`[API Router] Bootstrap: Granting 'Super Guide' role to first user: ${decodedUser.email}`);
            }
          } catch (e) {
            // Ignore if Firestore is not loaded/accessible yet
          }

          context.user = {
            id: decodedUser.uid,
            email: decodedUser.email,
            role: userRole,
          };
        }
      } catch (authError: any) {
        console.error('[API Router] Authentication failed:', authError);
        return NextResponse.json(
          { message: authError.message || 'Unauthorized' },
          { status: 401 }
        );
      }
    }

    // 4. Input validation using Zod schema defined in endpoint
    let validatedInput = body;
    if (endpointConfig.inputSchema) {
      const parseResult = endpointConfig.inputSchema.safeParse(body);
      if (!parseResult.success) {
        return NextResponse.json(
          { message: 'Validation failed', errors: parseResult.error.errors },
          { status: 400 }
        );
      }
      validatedInput = parseResult.data;
    }

    // 5. Execute endpoint handler
    const output = await endpointConfig.execute({ input: validatedInput, context });

    // 6. Return response
    return NextResponse.json(output);

  } catch (error: any) {
    console.error(`[API Router] Error running ${endpoint}:`, error);
    
    // Check if it is a ZiteError or contains code property
    const status = error.code === 'FORBIDDEN' ? 403 : error.code === 'NOT_FOUND' ? 404 : 500;
    return NextResponse.json(
      { message: error.message || 'Internal Server Error', code: error.code || 'INTERNAL_ERROR' },
      { status }
    );
  }
}
