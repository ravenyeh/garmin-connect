# MFA Support Design for garmin-connect

## Overview

Add MFA (Multi-Factor Authentication) support to `@gooin/garmin-connect` package, enabling two-stage login flow for Garmin accounts with email OTP verification enabled.

Reference implementation: [matin/garth](https://github.com/matin/garth) (Python)

## Problem

-   Garmin accounts with MFA enabled send OTP codes via email after password login
-   Current `garmin-connect` library detects MFA but cannot complete verification
-   Serverless environments (Vercel) need stateless solution for two-stage auth flow

## Solution

Two-stage API with encrypted session token:

```typescript
// Stage 1: Login triggers MFA
const result = await GCClient.login(email, password);
if (result.needsMFA) {
    // Return encrypted session to frontend
    const mfaSession = result.mfaSession;
}

// Stage 2: Complete with OTP
await GCClient.verifyMFA(mfaSession, otpCode);
```

## Technical Details

### MFA Detection

From garth's `sso.py`: Check HTML page `<title>` for "MFA" string after login POST.

### MFA Verification Endpoint

```
POST https://sso.garmin.com/sso/verifyMFA/loginEnterMfaCode
```

Parameters:

-   `mfa-code`: User's OTP code
-   `embed`: "true"
-   `_csrf`: CSRF token from MFA page
-   `fromPage`: "setupEnterMfaCode"
-   Plus original signin params

### Session State (Encrypted)

```typescript
interface MFASessionData {
    cookies: string[];
    csrfToken: string;
    signinParams: Record<string, string>;
    timestamp: number;
}
```

-   Encrypted with AES-256-GCM
-   Secret key from `MFA_SECRET_KEY` env var
-   5-minute expiration

## Files to Modify

| File                          | Changes                                                          |
| ----------------------------- | ---------------------------------------------------------------- |
| `src/garmin/types/index.ts`   | Add `MFASessionData`, `MFAResult`, `LoginResult` types           |
| `src/common/HttpClient.ts`    | Modify `login()`, add `verifyMFA()`, add encrypt/decrypt methods |
| `src/garmin/UrlClass.ts`      | Add MFA verification URL                                         |
| `src/garmin/GarminConnect.ts` | Expose `verifyMFA()` method                                      |

## API Changes

### `login()` - Modified Return Type

```typescript
async login(username?: string, password?: string): Promise<GarminConnect | MFAResult>

interface MFAResult {
  needsMFA: true;
  mfaSession: string;
}
```

### `verifyMFA()` - New Method

```typescript
async verifyMFA(mfaSession: string, mfaCode: string): Promise<GarminConnect>
```

## Environment Variables

```
MFA_SECRET_KEY=<32+ character secret for AES encryption>
```

## Backward Compatibility

-   Accounts without MFA: `login()` returns `GarminConnect` instance (unchanged behavior)
-   Accounts with MFA: `login()` returns `MFAResult` object with `needsMFA: true`

## Testing

1. Build: `npm run build:windows`
2. Test non-MFA account: Should work as before
3. Test MFA account: Should return `needsMFA: true`, then complete with `verifyMFA()`
