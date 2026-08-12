export const COOKIE_NAME = "app_session_id";
/** Separate opaque cookie for branded email/password customer sessions. */
export const CUSTOMER_SESSION_COOKIE = "roofplan_customer_session";
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
export const CUSTOMER_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
export const PASSWORD_RESET_TTL_MS = 1000 * 60 * 30;
export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = 'Please login (10001)';
export const NOT_ADMIN_ERR_MSG = 'You do not have required permission (10002)';
