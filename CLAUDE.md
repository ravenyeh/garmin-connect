# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Fork of [@gooin/garmin-connect](https://github.com/Pythe1337N/garmin-connect) with MFA (Multi-Factor Authentication) support added. The library connects to Garmin Connect for health and workout data via OAuth1/OAuth2 authentication.

MFA implementation references [matin/garth](https://github.com/matin/garth) (Python Garmin SSO client).

## Build Commands

```bash
npm run build:windows    # Build TypeScript (Windows)
npm run build            # Build TypeScript (Mac/Linux)
npm run build:watch      # Build with watch mode
npm run prettier:all     # Format all files
```

No test framework is configured yet.

## Architecture

### Authentication Flow

1. **SSO Login** (`src/common/HttpClient.ts`) - Three-step process:
    - Step 1: GET to SSO embed URL to set cookies
    - Step 2: GET signin page to obtain CSRF token
    - Step 3: POST credentials with CSRF token
2. **MFA Detection** - Check HTML `<title>` and page content for MFA indicators
3. **MFA Verification** - POST to `/sso/verifyMFA/loginEnterMfaCode` with OTP code
4. **OAuth1 Token** - Exchange login ticket for OAuth1 token via `/oauth-service/oauth/preauthorized`
5. **OAuth2 Token** - Exchange OAuth1 for OAuth2 via `/oauth-service/oauth/exchange/user/2.0`
6. **Auto-refresh** - Axios interceptor automatically refreshes expired OAuth2 tokens

### MFA Two-Stage Flow (for Serverless)

Login returns `MFAResult` with encrypted session state when MFA is required. Session state (cookies, CSRF token, signin params) is AES-256-GCM encrypted for safe client-side storage. `verifyMFA()` decrypts and restores the session to complete authentication. Requires `MFA_SECRET_KEY` env var (32+ chars).

### Key Files

-   `src/common/HttpClient.ts` - Core HTTP client with OAuth, cookie management, MFA login/verify logic
-   `src/garmin/GarminConnect.ts` - Public API class wrapping HttpClient
-   `src/garmin/UrlClass.ts` - All Garmin API endpoint URLs, domain-configurable (garmin.com/garmin.cn)
-   `src/garmin/types/index.ts` - TypeScript interfaces for OAuth tokens, MFA types, API responses

### Cookie Management

Axios in Node.js does not handle cookies automatically. `HttpClient` implements manual cookie tracking via request/response interceptors and a `cookieJar` object. This is critical for the SSO flow which requires cookies across multiple requests.

### Domain Support

All URLs are constructed via `UrlClass` which accepts `garmin.com` or `garmin.cn` domain parameter, enabling both international and China region support.
