# Authentication verification hardening

The API router no longer accepts `mock_token_for_*` or decodes JWT payloads as
proof of identity. Both the endpoint router and upload route use
`verifyFirebaseIdToken`, which delegates verification to Firebase Admin and
fails closed if Admin is unavailable.

Production rejects `FIREBASE_AUTH_EMULATOR_HOST` at verifier module load and
before each verification. This is necessary because the
[Admin SDK accepts unsigned tokens when configured for the Auth emulator](https://firebase.google.com/docs/emulator-suite/connect_auth#admin_sdks).
The browser emulator flag cannot enable emulator authentication in a production
build. Browser authentication no longer reads a mock identity from localStorage
or generates fake tokens; missing Firebase configuration leaves the user signed
out and causes sign-in to report a configuration error.

Local emulator testing must use Firebase Auth sign-in and SDK verification in a
non-production process. The legacy `tests/e2e/helpers.ts` mock-token fixtures
are no longer supported; that suite needs authenticated fixtures before it can
be used for acceptance. No bypass should be restored for those fixtures.

Focused checks:

```sh
npx tsx --test tests/auth-token-verification.test.ts tests/firebase-storage-upload.test.ts tests/logout-department-routing.test.ts
```

The security tests use a local RSA key and substitute only certificate retrieval;
the real Admin SDK validates signatures, expiry, issuer and audience. Route tests
trap profile operations and verify rejection before database access. They require
no live credentials, data changes or emulator service.

These are local source changes and checks. Deployment and authenticated live
Google sign-in have not been performed.
