# Refresh Token Authentication (Backend)

This document explains how refresh tokens work in the Retention Plus backend (`retention-backend`).

## Overview

The auth system uses **two tokens**:

| Token | Type | Purpose | Stored where |
|-------|------|---------|--------------|
| **Access token** | JWT | Sent on every protected API call (`Authorization: Bearer …`) | Client only |
| **Refresh token** | Opaque random string | Used to get a new access token when the old one expires | Client + hashed in database |

The access token is short-lived. The refresh token is long-lived and kept in the database so it can be revoked (logout, rotation, security).

---

## Flow diagram

```
Login (email + password)
        │
        ▼
   OTP sent to email
        │
        ▼
POST /auth/verify-otp
        │
        ├──► access token (JWT)
        └──► refresh token (plain string, saved hashed in DB)

Protected API call
        │
        ▼
   Access token valid? ──yes──► Request succeeds
        │
        no (401)
        │
        ▼
POST /auth/refresh  { refreshToken }
        │
        ├──► Old refresh token revoked in DB
        ├──► New access token (JWT)
        └──► New refresh token (rotation)

Logout
        │
        ▼
POST /auth/logout  { refreshToken }
        │
        └──► Refresh token revoked in DB
```

---

## API endpoints

### 1. Issue tokens — `POST /auth/verify-otp`

Called after the user enters a valid OTP.

**Request body:**

```json
{
  "email": "user@example.com",
  "otp": 123456
}
```

**Response:**

```json
{
  "message": "OTP verified successfully.",
  "token": "<access-jwt>",
  "refreshToken": "<opaque-refresh-token>",
  "user": { ... }
}
```

Both tokens are returned together. The client must store both.

---

### 2. Refresh tokens — `POST /auth/refresh`

Called when the access token has expired (typically after a `401 Unauthorized`).

**Rate limit:** 10 requests per minute.

**Request body:**

```json
{
  "refreshToken": "<opaque-refresh-token>"
}
```

**Success response:**

```json
{
  "token": "<new-access-jwt>",
  "refreshToken": "<new-refresh-token>"
}
```

**Error responses:**

| Status | Reason |
|--------|--------|
| `401` | Token invalid, expired, or already revoked |
| `403` | User account is inactive |

---

### 3. Logout — `POST /auth/logout`

Revokes the refresh token on the server. The access token may still work until it expires, but it cannot be renewed without a valid refresh token.

**Request body:**

```json
{
  "refreshToken": "<opaque-refresh-token>"
}
```

**Response:**

```json
{
  "message": "Logged out successfully."
}
```

If the token is already revoked or not found, the endpoint still returns success (idempotent logout).

---

## Access token (JWT)

- Signed with `JWT_SECRET`
- Expiry controlled by env (see below)
- Payload shape (`JwtAccessPayload`):

```typescript
{
  sub: number;    // user id
  email: string;
  role: string;
}
```

Protected routes use `JwtAuthGuard` and expect:

```
Authorization: Bearer <access-jwt>
```

---

## Refresh token (opaque)

Refresh tokens are **not JWTs**. They are:

1. Generated as 64-character hex strings (`randomBytes(32)`)
2. Hashed with **SHA-256** before storage
3. Only the **plain token** is sent to the client; the database stores the hash only

This means a database leak does not expose usable refresh tokens.

### Token rotation

Every successful call to `POST /auth/refresh`:

1. Validates the current refresh token
2. **Revokes** the old token (`revoked_at` set)
3. Issues a **new** access token and **new** refresh token

Each refresh token can only be used once. Reusing an old token after rotation fails with `401`.

---

## Database

**Table:** `refresh_tokens`  
**Entity:** `src/db/entities/refresh-token.entity.ts`  
**Migration:** `src/db/migrations/1778890000000-AddRefreshTokenTable.ts`

| Column | Type | Description |
|--------|------|-------------|
| `id` | serial | Primary key |
| `token_hash` | varchar | SHA-256 hash of the refresh token (unique index) |
| `expires_at` | timestamptz | When the token expires |
| `revoked_at` | timestamptz | Set on logout or rotation; `null` = active |
| `created_at` | timestamptz | When the token was created |
| `user_id` | integer | FK to `users.id` (cascade delete) |

Run the migration if the table does not exist yet:

```bash
npm run migration:run
```

---

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_SECRET` | Yes | — | Secret used to sign access JWTs |
| `JWT_ACCESS_EXPIRES_IN` | No | `JWT_EXPIRES_IN` or `15m` | Access token lifetime (e.g. `15m`, `1h`, `7d`) |
| `JWT_EXPIRES_IN` | No | `15m` | Fallback if `JWT_ACCESS_EXPIRES_IN` is not set |
| `JWT_REFRESH_EXPIRES_IN` | No | `10d` | Refresh token lifetime stored in DB |

**Refresh expiry format:** `<number><unit>` where unit is `d` (days), `h` (hours), `m` (minutes), or `s` (seconds).

**Example `.env` for production-style settings:**

```env
JWT_SECRET=your-secret-key
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=10d
```

---

## Source files

| File | Role |
|------|------|
| `src/modules/auth/auth.service.ts` | Token issue, refresh, revoke logic |
| `src/modules/auth/auth.controller.ts` | `/auth/verify-otp`, `/auth/refresh`, `/auth/logout` routes |
| `src/modules/auth/auth.module.ts` | Registers `RefreshToken` entity and JWT config |
| `src/modules/auth/authDto/refresh-token.dto.ts` | Request validation for refresh/logout |
| `src/db/entities/refresh-token.entity.ts` | TypeORM entity |
| `src/modules/auth/jwt/jwt.strategy.ts` | Validates access JWT on protected routes |

---

## Key service methods

All logic lives in `AuthService`:

| Method | Description |
|--------|-------------|
| `issueAuthTokens(user)` | Creates access JWT + new refresh token record |
| `refreshAccessToken(rawToken)` | Validates, rotates, returns new token pair |
| `revokeRefreshToken(rawToken)` | Marks refresh token as revoked (logout) |
| `hashRefreshToken(token)` | SHA-256 hash before DB lookup/storage |
| `createRefreshTokenForUser(userId)` | Generates and persists a new refresh token |

---

## Testing with curl

**1. Verify OTP and get tokens:**

```bash
curl -X POST http://localhost:4001/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","otp":123456}'
```

**2. Call a protected route:**

```bash
curl http://localhost:4001/restaurant/all \
  -H "Authorization: Bearer <access-token>"
```

**3. Refresh when access token expires:**

```bash
curl -X POST http://localhost:4001/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"<refresh-token>"}'
```

**4. Logout:**

```bash
curl -X POST http://localhost:4001/auth/logout \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"<refresh-token>"}'
```

---

## Security notes

- Refresh tokens are **hashed at rest**; plain values never touch the database.
- **Rotation** limits damage if a refresh token is stolen (old token becomes invalid after use).
- **Logout** revokes the refresh token server-side so it cannot be reused.
- Access tokens remain stateless JWTs; shortening `JWT_ACCESS_EXPIRES_IN` reduces exposure if an access token leaks.
- The `/auth/refresh` endpoint is rate-limited to reduce brute-force attempts.

---

## Related (frontend)

The frontend stores both tokens in `localStorage`, calls `/auth/refresh` on `401`, and `/auth/logout` on sign-out. See the frontend auth session helpers under `retention-frontend/app/lib/`.
