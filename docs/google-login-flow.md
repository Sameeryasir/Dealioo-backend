# Google Login Flow (Sign in with Google)

This document explains what happens when a user clicks **Continue with Google** on Dealioo login/signup.

> **Not the same as Google Ads connect.**  
> Login uses `GOOGLE_CALLBACK_URL` (backend).  
> Ads connect uses `GOOGLE_REDIRECT_URI` (frontend) — see end of this file.

---

## Quick summary

1. User clicks **Continue with Google**
2. Browser goes to Dealioo backend → Google
3. User picks Gmail and allows access
4. Google returns to Dealioo backend with a one-time `code`
5. Backend exchanges the code, finds/creates the user, issues Dealioo tokens
6. Browser lands on frontend `/auth/google/complete` and the session is saved

---

## Env variables used (login)

| Variable | Purpose | Local example |
|----------|---------|----------------|
| `GOOGLE_CLIENT_ID` | OAuth client ID | (from Google Cloud Console) |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret | (from Google Cloud Console) |
| `GOOGLE_CALLBACK_URL` | Where Google must return after Allow | `http://localhost:4001/api/auth/google/callback` |
| `GOOGLE_AUTH_URI` | Google authorize page (optional; has default) | `https://accounts.google.com/o/oauth2/auth` |
| `GOOGLE_TOKEN_URI` | Google token exchange (optional; has default) | `https://oauth2.googleapis.com/token` |
| `FRONTEND_URL` | Allowed frontend origin(s) for return | e.g. `http://localhost:3002` |
| `JWT_SECRET` | Used to sign OAuth `state` | (app secret) |

Frontend also may have `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (display / client-side).  
**Real OAuth for login is driven by the backend** `GOOGLE_CLIENT_ID` / secret / callback.

---

## APIs / URLs in the flow

### Dealioo APIs

| Step | Method + path | Who calls it |
|------|----------------|--------------|
| Start login | `GET /api/auth/google?mode=login\|signup&returnOrigin=…` | Browser (from frontend) |
| OAuth callback | `GET /api/auth/google/callback?code=…&state=…` | Browser (redirect from Google) |
| Finish page | Frontend `/auth/google/complete#…` | Browser (redirect from backend) |

### External Google APIs (called by backend)

| Step | URL | Purpose |
|------|-----|---------|
| Authorize | `GOOGLE_AUTH_URI` (default `https://accounts.google.com/o/oauth2/auth`) | User signs in / consents |
| Token exchange | `GOOGLE_TOKEN_URI` (default `https://oauth2.googleapis.com/token`) | Trade `code` for Google access token |
| User profile | `https://www.googleapis.com/oauth2/v3/userinfo` | Get email, name, Google user id |

---

## Step-by-step flow

### 1. User clicks Continue with Google

**Frontend**

- Button: `GoogleAuthButton` on login/signup
- Starts flow via `startGoogleAuth(mode)` in  
  `retention-frontend/app/services/auth/start-google-auth.ts`

Browser navigates to:

```text
{API_BASE}/auth/google?mode=login&returnOrigin={window.location.origin}
```

Example (local):

```text
http://localhost:4001/api/auth/google?mode=login&returnOrigin=http://localhost:3002
```

---

### 2. Backend starts OAuth (`GET /api/auth/google`)

**File:** `retention-backend/src/modules/auth/auth.controller.ts`  
**Handler:** `googleAuth`

What it does:

1. Reads `mode` (`login` or `signup`)
2. Calls `GoogleOAuthService.buildAuthorizationUrl(mode, returnOrigin)`
3. Returns **HTTP 302** redirect to Google

**It does not log the user in yet.** It only sends the browser to Google.

---

### 3. Backend builds Google authorize URL

**File:** `retention-backend/src/modules/auth/google-oauth.service.ts`  
**Method:** `buildAuthorizationUrl`

Builds a `state` payload (mode, frontend origin, timestamp, nonce) and signs it.

Then builds query params:

| Param | Meaning |
|-------|---------|
| `response_type=code` | Ask Google for an auth code |
| `client_id` | `GOOGLE_CLIENT_ID` |
| `redirect_uri` | `GOOGLE_CALLBACK_URL` (must match Google Console exactly) |
| `scope=email profile` | What we ask Google for |
| `state` | Signed Dealioo data (login/signup + frontend) |
| `prompt=select_account` | Always show account picker |

Final URL shape:

```text
{GOOGLE_AUTH_URI}?response_type=code&client_id=…&redirect_uri=…&scope=email+profile&state=…&prompt=select_account
```

---

### 4. User on Google

User picks Gmail and clicks **Allow**.

Google redirects the browser back to:

```text
GOOGLE_CALLBACK_URL
```

Local:

```text
http://localhost:4001/api/auth/google/callback?code=ONE_TIME_CODE&state=…
```

---

### 5. Backend callback (`GET /api/auth/google/callback`)

**File:** `retention-backend/src/modules/auth/auth.controller.ts`  
**Handler:** `googleAuthCallback`

What it does:

1. If Google sent `error` → redirect to frontend login/signup with error message  
2. Validate `state` (signature, age, mode, frontend)  
3. Require `code`  
4. Call `exchangeCodeForProfile(code)`  
5. Call `authService.handleGoogleLogin(profile, mode, frontend)`  
6. Redirect to frontend complete page with tokens  

---

### 6. Exchange code for Google profile

**File:** `google-oauth.service.ts`  
**Method:** `exchangeCodeForProfile`

1. **POST** to `GOOGLE_TOKEN_URI` with:
   - `code`
   - `client_id`
   - `client_secret`
   - `redirect_uri` (same as `GOOGLE_CALLBACK_URL`)
   - `grant_type=authorization_code`
2. Receive Google `access_token`
3. **GET** `https://www.googleapis.com/oauth2/v3/userinfo` with that token
4. Read email, name, Google id (`sub`), email verified
5. Fail if email missing or not verified

---

### 7. Create Dealioo session

**File:** `auth.service.ts`  
**Method:** `handleGoogleLogin`

1. Find or create Dealioo user from Google profile (`resolveGoogleUser`)
2. Build Dealioo access + refresh tokens (`buildAuthSession`)
3. Build redirect to frontend complete page

Redirect target:

```text
{FRONTEND}/auth/google/complete#accessToken=…&refreshToken=…&isNewUser=…&user=…
```

Tokens are in the **URL hash** (`#…`), not query string.

---

### 8. Frontend complete page

**File:** `retention-frontend/app/(routes)/auth/google/complete/page.tsx`

1. Reads tokens from the hash
2. Saves session
3. Sends user into the app (or next onboarding step)

---

## Key source files

| Area | File |
|------|------|
| Start button | `retention-frontend/app/components/auth/GoogleAuthButton.tsx` |
| Start navigation | `retention-frontend/app/services/auth/start-google-auth.ts` |
| Routes | `retention-backend/src/modules/auth/auth.controller.ts` |
| OAuth URL + token/profile | `retention-backend/src/modules/auth/google-oauth.service.ts` |
| User + session | `retention-backend/src/modules/auth/auth.service.ts` |
| Finish page | `retention-frontend/app/(routes)/auth/google/complete/page.tsx` |

---

## Google Cloud Console checklist (login)

Authorized **redirect URI** must include exactly:

```text
http://localhost:4001/api/auth/google/callback
```

Production example:

```text
https://dealioo.io/api/auth/google/callback
```

(or your real production API host — must match `GOOGLE_CALLBACK_URL`)

Mismatch → Google error **`redirect_uri_mismatch`**.

---

## Difference: Google Ads connect (not login)

| | Google **login** | Google **Ads connect** |
|--|------------------|-------------------------|
| Env | `GOOGLE_CALLBACK_URL` | `GOOGLE_REDIRECT_URI` |
| Google returns to | Backend `/api/auth/google/callback` | Frontend `/auth/google/callback` |
| Local URL | `http://localhost:4001/api/auth/google/callback` | `http://localhost:3002/auth/google/callback` |
| Frontend page | `/auth/google/complete` | `/auth/google/callback` (forwards to `/api/google-ads/callback/oauth`) |

Ads frontend forward page:  
`retention-frontend/app/(routes)/auth/google/callback/page.tsx`
