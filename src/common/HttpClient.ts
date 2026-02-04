import axios, {
    AxiosInstance,
    AxiosRequestConfig,
    AxiosResponse,
    RawAxiosRequestHeaders
} from 'axios';
import FormData from 'form-data';
import _ from 'lodash';
import { DateTime } from 'luxon';
import OAuth from 'oauth-1.0a';
import qs from 'qs';
import { UrlClass } from '../garmin/UrlClass';
import {
    IOauth1,
    IOauth1Consumer,
    IOauth1Token,
    IOauth2Token,
    MFASessionData,
    MFAResult,
    LoginResult
} from '../garmin/types';
const crypto = require('crypto');

// MFA encryption constants
const MFA_ALGORITHM = 'aes-256-gcm';
const MFA_IV_LENGTH = 16;
const MFA_AUTH_TAG_LENGTH = 16;
const MFA_SESSION_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

const CSRF_RE = new RegExp('name="_csrf"\\s+value="(.+?)"');
const TICKET_RE = new RegExp('ticket=([^"]+)"');
const ACCOUNT_LOCKED_RE = new RegExp('var statuss*=s*"([^"]*)"');
const PAGE_TITLE_RE = new RegExp('<title>([^<]*)</title>');

const USER_AGENT_CONNECTMOBILE = 'com.garmin.android.apps.connectmobile';
const USER_AGENT_BROWSER =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36';

const OAUTH_CONSUMER_URL =
    'https://thegarth.s3.amazonaws.com/oauth_consumer.json';
//  refresh token
let isRefreshing = false;
let refreshSubscribers: ((token: string) => void)[] = [];

export class HttpClient {
    client: AxiosInstance;
    url: UrlClass;
    oauth1Token: IOauth1Token | undefined;
    oauth2Token: IOauth2Token | undefined;
    OAUTH_CONSUMER: IOauth1Consumer | undefined;
    private cookieJar: Record<string, string> = {};

    constructor(url: UrlClass) {
        this.url = url;
        this.client = axios.create();

        // Cookie management: send cookies with requests
        this.client.interceptors.request.use((config) => {
            const cookieStr = this.getCookieString();
            if (cookieStr) {
                config.headers['Cookie'] = cookieStr;
            }
            return config;
        });

        // Cookie management: capture Set-Cookie from responses
        this.client.interceptors.response.use(
            (response) => {
                this.captureCookies(response);
                return response;
            },
            async (error) => {
                // Capture cookies from error responses too
                if (error?.response) {
                    this.captureCookies(error.response);
                }
                const originalRequest = error.config;
                // Auto Refresh token
                if (
                    error?.response?.status === 401 &&
                    !originalRequest?._retry
                ) {
                    if (!this.oauth2Token) {
                        throw error;
                    }
                    if (isRefreshing) {
                        try {
                            const token = await new Promise<string>(
                                (resolve) => {
                                    refreshSubscribers.push((token) => {
                                        resolve(token);
                                    });
                                }
                            );
                            originalRequest.headers.Authorization = `Bearer ${token}`;
                            return this.client(originalRequest);
                        } catch (err) {
                            console.log('err:', err);
                            return Promise.reject(err);
                        }
                    }

                    originalRequest._retry = true;
                    isRefreshing = true;
                    console.log('interceptors: refreshOauth2Token start');
                    await this.refreshOauth2Token();
                    console.log('interceptors: refreshOauth2Token end');
                    isRefreshing = false;
                    refreshSubscribers.forEach((subscriber) =>
                        subscriber(this.oauth2Token!.access_token)
                    );
                    refreshSubscribers = [];
                    originalRequest.headers.Authorization = `Bearer ${
                        this.oauth2Token!.access_token
                    }`;
                    return this.client(originalRequest);
                }
                if (axios.isAxiosError(error)) {
                    if (error?.response) this.handleError(error?.response);
                }
                throw error;
            }
        );
        this.client.interceptors.request.use(async (config) => {
            if (this.oauth2Token) {
                config.headers.Authorization =
                    'Bearer ' + this.oauth2Token.access_token;
            }
            return config;
        });
    }

    /**
     * Parse Set-Cookie headers from response and store them
     */
    private captureCookies(response: AxiosResponse): void {
        const setCookieHeaders = response.headers['set-cookie'];
        if (setCookieHeaders) {
            for (const cookieStr of setCookieHeaders) {
                // Extract cookie name=value (before ;)
                const nameValue = cookieStr.split(';')[0];
                const eqIndex = nameValue.indexOf('=');
                if (eqIndex > 0) {
                    const name = nameValue.substring(0, eqIndex).trim();
                    const value = nameValue.substring(eqIndex + 1).trim();
                    this.cookieJar[name] = value;
                }
            }
        }
    }

    /**
     * Get all stored cookies as a Cookie header string
     */
    private getCookieString(): string {
        return Object.entries(this.cookieJar)
            .map(([name, value]) => `${name}=${value}`)
            .join('; ');
    }

    async fetchOauthConsumer() {
        const response = await axios.get(OAUTH_CONSUMER_URL);
        this.OAUTH_CONSUMER = {
            key: response.data.consumer_key,
            secret: response.data.consumer_secret
        };
    }

    async checkTokenVaild() {
        if (this.oauth2Token) {
            if (this.oauth2Token.expires_at < DateTime.now().toSeconds()) {
                console.error('Token expired!');
                await this.refreshOauth2Token();
            }
        }
    }

    async get<T>(url: string, config?: AxiosRequestConfig<any>): Promise<T> {
        const response = await this.client.get<T>(url, config);
        return response?.data;
    }

    async post<T>(
        url: string,
        data: any,
        config?: AxiosRequestConfig<any>
    ): Promise<T> {
        const response = await this.client.post<T>(url, data, config);
        return response?.data;
    }

    async put<T>(
        url: string,
        data: any,
        config?: AxiosRequestConfig<any>
    ): Promise<T> {
        const response = await this.client.put<T>(url, data, config);
        return response?.data;
    }

    async delete<T>(url: string, config?: AxiosRequestConfig<any>): Promise<T> {
        const response = await this.client.post<T>(url, null, {
            ...config,
            headers: {
                ...config?.headers,
                'X-Http-Method-Override': 'DELETE'
            }
        });
        return response?.data;
    }

    setCommonHeader(headers: RawAxiosRequestHeaders): void {
        _.each(headers, (headerValue, key) => {
            this.client.defaults.headers.common[key] = headerValue;
        });
    }

    handleError(response: AxiosResponse): void {
        this.handleHttpError(response);
    }

    handleHttpError(response: AxiosResponse): void {
        const { status, statusText, data } = response;
        const msg = `ERROR: (${status}), ${statusText}, ${JSON.stringify(
            data
        )}`;
        console.error(msg);
        throw new Error(msg);
    }

    /**
     * Login to Garmin Connect
     * @param username
     * @param password
     * @returns {Promise<HttpClient | MFAResult>} Returns HttpClient on success, or MFAResult if MFA is required
     */
    async login(
        username: string,
        password: string
    ): Promise<HttpClient | MFAResult> {
        await this.fetchOauthConsumer();
        // Step1-3: Get ticket from page (or MFA result if MFA is required)
        const ticketOrMFA = await this.getLoginTicket(username, password);

        // Check if MFA is required
        if (typeof ticketOrMFA === 'object' && ticketOrMFA.needsMFA) {
            return ticketOrMFA;
        }

        const ticket = ticketOrMFA as string;
        // Step4: Oauth1
        const oauth1 = await this.getOauth1Token(ticket);

        // Step 5: Oauth2
        await this.exchange(oauth1);
        return this;
    }

    private async getLoginTicket(
        username: string,
        password: string
    ): Promise<string | MFAResult> {
        // Step1: Set cookie
        const step1Params = {
            clientId: 'GarminConnect',
            locale: 'en',
            service: this.url.GC_MODERN
        };
        const step1Url = `${this.url.GARMIN_SSO_EMBED}?${qs.stringify(
            step1Params
        )}`;
        // console.log('login - step1Url:', step1Url);
        await this.client.get(step1Url);

        // Step2 Get _csrf
        const step2Params = {
            id: 'gauth-widget',
            embedWidget: true,
            locale: 'en',
            gauthHost: this.url.GARMIN_SSO_EMBED
        };
        const step2Url = `${this.url.SIGNIN_URL}?${qs.stringify(step2Params)}`;
        // console.log('login - step2Url:', step2Url);
        const step2Result = await this.get<string>(step2Url);
        // console.log('login - step2Result:', step2Result)
        const csrfRegResult = CSRF_RE.exec(step2Result);
        if (!csrfRegResult) {
            throw new Error('login - csrf not found');
        }
        const csrf_token = csrfRegResult[1];
        // console.log('login - csrf:', csrf_token);

        // Step3 Get ticket
        const signinParams: Record<string, string> = {
            id: 'gauth-widget',
            embedWidget: 'true',
            clientId: 'GarminConnect',
            locale: 'en',
            gauthHost: this.url.GARMIN_SSO_EMBED,
            service: this.url.GARMIN_SSO_EMBED,
            source: this.url.GARMIN_SSO_EMBED,
            redirectAfterAccountLoginUrl: this.url.GARMIN_SSO_EMBED,
            redirectAfterAccountCreationUrl: this.url.GARMIN_SSO_EMBED
        };
        const step3Url = `${this.url.SIGNIN_URL}?${qs.stringify(signinParams)}`;
        const step3Result =
            (await this.post<string>(
                step3Url,
                qs.stringify({
                    username,
                    password,
                    embed: 'true',
                    _csrf: csrf_token
                }),
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        Dnt: 1,
                        Origin: this.url.GARMIN_SSO_ORIGIN,
                        Referer: this.url.SIGNIN_URL,
                        'User-Agent': USER_AGENT_BROWSER
                    }
                }
            )) || '';
        // console.log('step3Result:', step3Result)
        this.handleAccountLocked(step3Result);
        this.handlePageTitle(step3Result);

        // Check if MFA is required
        if (this.detectMFA(step3Result)) {
            // Get CSRF token from MFA page
            const mfaCsrfResult = CSRF_RE.exec(step3Result);
            const mfaCsrfToken = mfaCsrfResult ? mfaCsrfResult[1] : csrf_token;

            // Get cookies from axios client
            const cookies = this.serializeCookieJar();

            // Create and encrypt MFA session
            const mfaSessionData: MFASessionData = {
                cookies,
                csrfToken: mfaCsrfToken,
                signinParams,
                timestamp: Date.now()
            };

            return {
                needsMFA: true,
                mfaSession: this.encryptMFASession(mfaSessionData)
            };
        }

        const ticketRegResult = TICKET_RE.exec(step3Result);
        if (!ticketRegResult) {
            throw new Error(
                'login failed (Ticket not found), please check username and password'
            );
        }
        const ticket = ticketRegResult[1];
        return ticket;
    }

    /**
     * Detect if MFA is required by checking page title and content
     */
    private detectMFA(htmlStr: string): boolean {
        if (!htmlStr) return false;

        const titleMatch = PAGE_TITLE_RE.exec(htmlStr);
        if (titleMatch) {
            const title = titleMatch[1];
            // Check title for MFA indicators
            if (title.includes('MFA') || title.includes('Verification')) {
                return true;
            }
        }

        // Also check for MFA form elements in the HTML
        // Garmin's MFA page contains these specific elements
        if (
            htmlStr.includes('mfa-code') ||
            htmlStr.includes('verifyMFA') ||
            htmlStr.includes('loginEnterMfaCode') ||
            htmlStr.includes('verification-code') ||
            htmlStr.includes('setupEnterMfaCode')
        ) {
            return true;
        }

        return false;
    }

    /**
     * Verify MFA code and complete login
     * @param mfaSession Encrypted MFA session from login()
     * @param mfaCode OTP code from user's email
     */
    async verifyMFA(mfaSession: string, mfaCode: string): Promise<HttpClient> {
        // Decrypt session data
        const sessionData = this.decryptMFASession(mfaSession);

        // Check expiration
        if (Date.now() - sessionData.timestamp > MFA_SESSION_EXPIRY_MS) {
            throw new Error('MFA session expired. Please login again.');
        }

        // Restore cookies
        this.restoreCookieJar(sessionData.cookies);

        // Ensure OAuth consumer is loaded
        if (!this.OAUTH_CONSUMER) {
            await this.fetchOauthConsumer();
        }

        // Submit MFA code
        const mfaUrl = `${this.url.MFA_VERIFY}?${qs.stringify(
            sessionData.signinParams
        )}`;

        const mfaResult =
            (await this.post<string>(
                mfaUrl,
                qs.stringify({
                    'mfa-code': mfaCode,
                    embed: 'true',
                    _csrf: sessionData.csrfToken,
                    fromPage: 'setupEnterMfaCode',
                    rememberMyBrowserChecked: 'true'
                }),
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        Dnt: 1,
                        Origin: this.url.GARMIN_SSO_ORIGIN,
                        Referer: this.url.SIGNIN_URL,
                        'User-Agent': USER_AGENT_BROWSER
                    }
                }
            )) || '';

        // Check if MFA verification succeeded
        const titleMatch = PAGE_TITLE_RE.exec(mfaResult);
        const title = titleMatch ? titleMatch[1] : 'Unknown';
        if (title !== 'Success') {
            throw new Error(`MFA verification failed. Page title: ${title}`);
        }

        // Extract ticket and complete OAuth flow
        const ticketRegResult = TICKET_RE.exec(mfaResult);
        if (!ticketRegResult) {
            throw new Error('MFA verification failed: ticket not found');
        }
        const ticket = ticketRegResult[1];

        // Complete OAuth flow
        const oauth1 = await this.getOauth1Token(ticket);
        await this.exchange(oauth1);

        return this;
    }

    /**
     * Serialize cookie jar to JSON string for MFA session storage
     */
    private serializeCookieJar(): string {
        return JSON.stringify(this.cookieJar);
    }

    /**
     * Restore cookie jar from serialized JSON string
     */
    private restoreCookieJar(serialized: string): void {
        try {
            this.cookieJar = JSON.parse(serialized);
        } catch {
            this.cookieJar = {};
        }
    }

    /**
     * Get MFA secret key from environment variable
     */
    private getMFASecretKey(): Buffer {
        const key = process.env.MFA_SECRET_KEY;
        if (!key || key.length < 32) {
            throw new Error(
                'MFA_SECRET_KEY environment variable must be at least 32 characters'
            );
        }
        return Buffer.from(key.slice(0, 32), 'utf-8');
    }

    /**
     * Encrypt MFA session data
     */
    private encryptMFASession(data: MFASessionData): string {
        const iv = crypto.randomBytes(MFA_IV_LENGTH);
        const cipher = crypto.createCipheriv(
            MFA_ALGORITHM,
            this.getMFASecretKey(),
            iv
        );

        const json = JSON.stringify(data);
        const encrypted = Buffer.concat([
            cipher.update(json, 'utf8'),
            cipher.final()
        ]);
        const authTag = cipher.getAuthTag();

        // Format: iv + authTag + encrypted (Base64)
        return Buffer.concat([iv, authTag, encrypted]).toString('base64');
    }

    /**
     * Decrypt MFA session data
     */
    private decryptMFASession(encrypted: string): MFASessionData {
        try {
            const buffer = Buffer.from(encrypted, 'base64');

            const iv = buffer.subarray(0, MFA_IV_LENGTH);
            const authTag = buffer.subarray(
                MFA_IV_LENGTH,
                MFA_IV_LENGTH + MFA_AUTH_TAG_LENGTH
            );
            const data = buffer.subarray(MFA_IV_LENGTH + MFA_AUTH_TAG_LENGTH);

            const decipher = crypto.createDecipheriv(
                MFA_ALGORITHM,
                this.getMFASecretKey(),
                iv
            );
            decipher.setAuthTag(authTag);

            const decrypted = Buffer.concat([
                decipher.update(data),
                decipher.final()
            ]).toString('utf8');

            return JSON.parse(decrypted);
        } catch (error) {
            throw new Error('Invalid or corrupted MFA session');
        }
    }

    // TODO: Handle Phone number
    handlePageTitle(htmlStr: string): void {
        if (!htmlStr) return;
        const pageTitileRegResult = PAGE_TITLE_RE.exec(htmlStr);
        if (pageTitileRegResult) {
            const title = pageTitileRegResult[1];
            console.log('login page title:', title);
            if (_.includes(title, 'Update Phone Number')) {
                // current I don't know where to update it
                // See:  https://github.com/matin/garth/issues/19
                throw new Error(
                    "login failed (Update Phone number), please update your phone number, currently I don't know where to update it"
                );
            }
        }
    }

    handleAccountLocked(htmlStr: string): void {
        if (!htmlStr) return;
        const accountLockedRegResult = ACCOUNT_LOCKED_RE.exec(htmlStr);
        if (accountLockedRegResult) {
            const msg = accountLockedRegResult[1];
            console.error(msg);
            throw new Error(
                'login failed (AccountLocked), please open connect web page to unlock your account'
            );
        }
    }

    async refreshOauth2Token() {
        if (!this.OAUTH_CONSUMER) {
            await this.fetchOauthConsumer();
        }
        if (!this.oauth2Token || !this.oauth1Token) {
            throw new Error('No Oauth2Token or Oauth1Token');
        }
        const oauth1 = {
            oauth: this.getOauthClient(this.OAUTH_CONSUMER!),
            token: this.oauth1Token
        };
        await this.exchange(oauth1);
        console.log('Oauth2 token refreshed!');
    }

    async getOauth1Token(ticket: string): Promise<IOauth1> {
        if (!this.OAUTH_CONSUMER) {
            throw new Error('No OAUTH_CONSUMER');
        }
        const params = {
            ticket,
            'login-url': this.url.GARMIN_SSO_EMBED,
            'accepts-mfa-tokens': true
        };
        const url = `${this.url.OAUTH_URL}/preauthorized?${qs.stringify(
            params
        )}`;

        const oauth = this.getOauthClient(this.OAUTH_CONSUMER);

        const step4RequestData = {
            url: url,
            method: 'GET'
        };
        const headers = oauth.toHeader(oauth.authorize(step4RequestData));
        // console.log('getOauth1Token - headers:', headers);

        const response = await this.get<string>(url, {
            headers: {
                ...headers,
                'User-Agent': USER_AGENT_CONNECTMOBILE
            }
        });
        // console.log('getOauth1Token - response:', response);
        const token = qs.parse(response) as unknown as IOauth1Token;
        // console.log('getOauth1Token - token:', token);
        this.oauth1Token = token;
        return { token, oauth };
    }

    getOauthClient(consumer: IOauth1Consumer): OAuth {
        const oauth = new OAuth({
            consumer: consumer,
            signature_method: 'HMAC-SHA1',
            hash_function(base_string: string, key: string) {
                return crypto
                    .createHmac('sha1', key)
                    .update(base_string)
                    .digest('base64');
            }
        });
        return oauth;
    }
    //
    async exchange(oauth1: IOauth1) {
        const token = {
            key: oauth1.token.oauth_token,
            secret: oauth1.token.oauth_token_secret
        };
        // console.log('exchange - token:', token);

        const baseUrl = `${this.url.OAUTH_URL}/exchange/user/2.0`;
        const requestData = {
            url: baseUrl,
            method: 'POST',
            data: null
        };

        const step5AuthData = oauth1.oauth.authorize(requestData, token);
        // console.log('login - step5AuthData:', step5AuthData);
        const url = `${baseUrl}?${qs.stringify(step5AuthData)}`;
        // console.log('exchange - url:', url);
        this.oauth2Token = undefined;
        const response = await this.post<IOauth2Token>(url, null, {
            headers: {
                'User-Agent': USER_AGENT_CONNECTMOBILE,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });
        // console.log('exchange - response:', response);
        this.oauth2Token = this.setOauth2TokenExpiresAt(response);
        // console.log('exchange - oauth2Token:', this.oauth2Token);
    }

    setOauth2TokenExpiresAt(token: IOauth2Token): IOauth2Token {
        // human readable date
        token['last_update_date'] = DateTime.now().toLocal().toString();
        token['expires_date'] = DateTime.fromSeconds(
            DateTime.now().toSeconds() + token['expires_in']
        )
            .toLocal()
            .toString();
        // timestamp for check expired
        token['expires_at'] = DateTime.now().toSeconds() + token['expires_in'];
        token['refresh_token_expires_at'] =
            DateTime.now().toSeconds() + token['refresh_token_expires_in'];
        return token;
    }
}
