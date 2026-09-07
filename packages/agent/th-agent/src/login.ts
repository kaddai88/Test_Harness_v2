/**
 * Login Guard — evidence-based login state tracking.
 *
 * Core principle: "The URL is not a login URL" does NOT mean "logged in".
 * Login status must be inferred from explicit evidence, never from
 * the absence of a login form alone.
 *
 * State machine:
 *
 *   not_required ────────────────────────────────► (target site needs no login)
 *       │
 *       ▼ (login evidence detected: login form / URL contains login / profile hints)
 *   required
 *       │
 *       ▼ (login form observed on page)
 *   login_page_detected
 *       │
 *       ▼ (credentials submitted via fill_form/type)
 *   login_in_progress
 *       │
 *       ├──► authenticated  (confirmation evidence: user menu, logout link,
 *       │                    avatar, dashboard content on non-login URL)
 *       └──► failed         (still on login page after submit, or error shown)
 *
 * Key behaviors:
 *   - Navigation alone NEVER advances the state.
 *   - Only `authenticated` blocks re-login navigation.
 *   - `not_required` sites never trigger any login logic.
 */

export type LoginStatus =
  | 'not_required'      // Target site needs no login (no evidence of auth requirement)
  | 'required'          // Login is required but not yet started
  | 'login_page_detected' // Currently on a login page (form visible)
  | 'login_in_progress' // Credentials submitted, awaiting confirmation
  | 'authenticated'     // Confirmed logged in via evidence
  | 'failed';           // Login attempt failed

/**
 * Evidence that the target site requires login.
 * Detected from: initial page snapshot, URL patterns, site profile hints.
 */
export interface LoginRequirementEvidence {
  /** URL contains login/signin/auth keywords */
  urlSuggestsLogin: boolean;
  /** Page content shows a login form (password field, login button) */
  loginFormVisible: boolean;
  /** Site profile hints say authentication is needed */
  profileSaysAuth: boolean;
}

/**
 * Evidence that login succeeded.
 * At least one positive indicator must be present to confirm authentication.
 */
export interface LoginSuccessEvidence {
  /** Page shows user-specific content: user menu, avatar, username display */
  userIndicatorVisible: boolean;
  /** Page shows logout/sign-out link (only visible when authenticated) */
  logoutLinkVisible: boolean;
  /** URL changed away from login page AND substantial non-login content present */
  navigatedAwayWithContent: boolean;
  /** Page shows dashboard-like content (仪表盘, 工作台, admin panels) */
  dashboardVisible: boolean;
}

export interface LoginGuardState {
  status: LoginStatus;
  /** Evidence recorded when login requirement was detected */
  requirementEvidence?: LoginRequirementEvidence;
  /** Evidence recorded when authentication was confirmed */
  successEvidence?: LoginSuccessEvidence;
  /** Number of login attempts made */
  attempts: number;
  /** Turn when status last changed */
  lastChangedTurn: number;
  /** URLs blocked from navigation (login pages after authentication) */
  blockedUrls: string[];
}

/** Patterns in URL that suggest a login page */
const LOGIN_URL_PATTERNS = ['login', 'signin', 'sign-in', 'sign_in', 'auth', '登录'];

/** Patterns in page content (aria snapshot, lowercased) that indicate a login form */
const LOGIN_FORM_PATTERNS = ['password', '密码', 'passwd', 'confirm password'];

/** Patterns indicating authenticated-only UI elements */
const USER_INDICATOR_PATTERNS = [
  'logout', 'sign out', '退出', '注销', '退出登录', 'signout',
  '我的账户', '个人中心', 'user menu', 'my account',
];

/** Patterns indicating dashboard-like authenticated content */
const DASHBOARD_PATTERNS = [
  'dashboard', '仪表盘', '工作台', '控制台', 'admin',
];

/**
 * Create an initial login guard state.
 * Starts as 'not_required' — upgrade to 'required' only when evidence appears.
 */
export function createLoginGuardState(): LoginGuardState {
  return {
    status: 'not_required',
    attempts: 0,
    lastChangedTurn: 0,
    blockedUrls: [],
  };
}

/**
 * Detect whether the target site requires login.
 * Called with the initial page observation (URL + snapshot content).
 *
 * Returns updated state — only advances from 'not_required'.
 */
export function detectLoginRequirement(
  state: LoginGuardState,
  url: string,
  pageContent: string,
  turn: number
): LoginGuardState {
  // Only detect from not_required state
  if (state.status !== 'not_required') return state;

  const urlLower = url.toLowerCase();
  const contentLower = pageContent.toLowerCase();

  const evidence: LoginRequirementEvidence = {
    urlSuggestsLogin: LOGIN_URL_PATTERNS.some(p => urlLower.includes(p)),
    loginFormVisible: LOGIN_FORM_PATTERNS.some(p => contentLower.includes(p)),
    profileSaysAuth: false, // Set externally via site hints if available
  };

  const requiresLogin = evidence.urlSuggestsLogin || evidence.loginFormVisible || evidence.profileSaysAuth;

  if (!requiresLogin) return state; // Stay not_required

  return {
    ...state,
    status: evidence.loginFormVisible ? 'login_page_detected' : 'required',
    requirementEvidence: evidence,
    lastChangedTurn: turn,
  };
}

/**
 * Record that credentials were submitted.
 * Called when browser_fill_form / browser_type targets login fields.
 */
export function recordCredentialsSubmitted(
  state: LoginGuardState,
  turn: number
): LoginGuardState {
  // Only meaningful from login_page_detected or required
  if (state.status !== 'login_page_detected' && state.status !== 'required') {
    return state;
  }
  return {
    ...state,
    status: 'login_in_progress',
    attempts: state.attempts + 1,
    lastChangedTurn: turn,
  };
}

/**
 * Check page content for authentication confirmation evidence.
 * Called after every snapshot while in login_in_progress state.
 *
 * Authentication is confirmed when ANY positive indicator is present.
 */
export function checkLoginConfirmation(
  state: LoginGuardState,
  url: string,
  pageContent: string,
  turn: number
): LoginGuardState {
  if (state.status !== 'login_in_progress') return state;

  const contentLower = pageContent.toLowerCase();
  const urlLower = url.toLowerCase();

  const evidence: LoginSuccessEvidence = {
    userIndicatorVisible: USER_INDICATOR_PATTERNS.some(p => contentLower.includes(p)),
    logoutLinkVisible: contentLower.includes('logout') || contentLower.includes('退出'),
    navigatedAwayWithContent:
      !LOGIN_URL_PATTERNS.some(p => urlLower.includes(p)) &&
      contentLower.length > 100 &&
      !LOGIN_FORM_PATTERNS.some(p => contentLower.includes(p)),
    dashboardVisible: DASHBOARD_PATTERNS.some(p => contentLower.includes(p)),
  };

  const authenticated =
    evidence.userIndicatorVisible ||
    evidence.logoutLinkVisible ||
    evidence.navigatedAwayWithContent ||
    evidence.dashboardVisible;

  if (authenticated) {
    return {
      ...state,
      status: 'authenticated',
      successEvidence: evidence,
      lastChangedTurn: turn,
    };
  }

  // Still on login page after submit → failed (agent can retry or report)
  const stillOnLoginPage =
    LOGIN_FORM_PATTERNS.some(p => contentLower.includes(p)) ||
    LOGIN_URL_PATTERNS.some(p => urlLower.includes(p));

  // Only mark failed if we've waited (content checked) and still see login form
  if (stillOnLoginPage && evidence.navigatedAwayWithContent === false && contentLower.length > 50) {
    return {
      ...state,
      status: 'failed',
      lastChangedTurn: turn,
    };
  }

  return state; // Stay in login_in_progress
}

/**
 * Check if navigation to a URL should be blocked.
 * Only blocks login page navigation when already authenticated.
 */
export function shouldBlockNavigation(
  state: LoginGuardState,
  url: string
): { blocked: boolean; reason?: string } {
  if (state.status !== 'authenticated') return { blocked: false };

  const urlLower = url.toLowerCase();
  const isLoginUrl = LOGIN_URL_PATTERNS.some(p => urlLower.includes(p));

  if (isLoginUrl) {
    return {
      blocked: true,
      reason: `Already authenticated. Do NOT navigate back to login pages. URL: "${url}"`,
    };
  }

  return { blocked: false };
}

/**
 * Get a human-readable status summary for logging.
 */
export function describeLoginState(state: LoginGuardState): string {
  switch (state.status) {
    case 'not_required':
      return 'not_required (no login evidence detected)';
    case 'required':
      return 'required (login needed but not started)';
    case 'login_page_detected':
      return `login_page_detected (form visible, ${state.attempts} attempts)`;
    case 'login_in_progress':
      return `login_in_progress (attempt ${state.attempts}, awaiting confirmation)`;
    case 'authenticated':
      return `authenticated (confirmed at turn ${state.lastChangedTurn})`;
    case 'failed':
      return `failed (attempt ${state.attempts} did not leave login page)`;
  }
}
