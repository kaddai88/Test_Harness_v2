/**
 * Regression tests for the LoginGuard state machine.
 *
 * Key principle: "URL is not a login URL" does NOT mean "logged in".
 * Authentication must be confirmed by explicit evidence.
 */
import { describe, it, expect } from 'vitest';
import {
  createLoginGuardState,
  detectLoginRequirement,
  recordCredentialsSubmitted,
  checkLoginConfirmation,
  shouldBlockNavigation,
  describeLoginState,
} from './login.js';

describe('LoginGuard — requirement detection', () => {
  it('stays not_required for a plain site (no login evidence)', () => {
    let state = createLoginGuardState();
    state = detectLoginRequirement(state, 'https://www.baidu.com', 'search box and news links', 1);
    expect(state.status).toBe('not_required');
  });

  it('detects login_page_detected when password field is visible', () => {
    let state = createLoginGuardState();
    state = detectLoginRequirement(
      state,
      'https://example.com/login',
      'textbox "username" textbox "password" button "login"',
      1
    );
    expect(state.status).toBe('login_page_detected');
    expect(state.requirementEvidence?.urlSuggestsLogin).toBe(true);
    expect(state.requirementEvidence?.loginFormVisible).toBe(true);
  });

  it('detects required via URL alone (no form visible yet)', () => {
    let state = createLoginGuardState();
    state = detectLoginRequirement(state, 'https://example.com/auth/signin', 'welcome to our site', 1);
    expect(state.status).toBe('required');
  });

  it('detects required via Chinese password field', () => {
    let state = createLoginGuardState();
    state = detectLoginRequirement(state, 'https://example.com/', '用户名 密码 登录', 1);
    expect(state.status).toBe('login_page_detected');
  });

  it('does not regress from later states', () => {
    let state = createLoginGuardState();
    state = detectLoginRequirement(state, 'https://example.com/login', 'password', 1);
    state = { ...state, status: 'authenticated' };
    // detectLoginRequirement should be a no-op now
    const before = state;
    state = detectLoginRequirement(state, 'https://example.com/other', 'content', 5);
    expect(state).toBe(before);
  });
});

describe('LoginGuard — credential submission', () => {
  it('advances login_page_detected → login_in_progress', () => {
    let state = createLoginGuardState();
    state = detectLoginRequirement(state, 'https://example.com/login', 'password field', 1);
    state = recordCredentialsSubmitted(state, 3);
    expect(state.status).toBe('login_in_progress');
    expect(state.attempts).toBe(1);
  });

  it('ignores submission when not in a login state', () => {
    let state = createLoginGuardState();
    state = recordCredentialsSubmitted(state, 3);
    expect(state.status).toBe('not_required');
    expect(state.attempts).toBe(0);
  });

  it('counts multiple attempts', () => {
    let state = createLoginGuardState();
    state = detectLoginRequirement(state, 'https://example.com/login', 'password', 1);
    state = recordCredentialsSubmitted(state, 2);
    // Simulate failed attempt → back to login_page_detected
    state = { ...state, status: 'login_page_detected' };
    state = recordCredentialsSubmitted(state, 5);
    expect(state.attempts).toBe(2);
  });
});

describe('LoginGuard — authentication confirmation', () => {
  it('confirms via logout link evidence', () => {
    let state = createLoginGuardState();
    state = detectLoginRequirement(state, 'https://example.com/login', 'password', 1);
    state = recordCredentialsSubmitted(state, 2);
    state = checkLoginConfirmation(
      state,
      'https://example.com/dashboard',
      'welcome user dashboard 退出链接 个人中心 many content items here to pass length check',
      3
    );
    expect(state.status).toBe('authenticated');
    expect(state.successEvidence?.userIndicatorVisible).toBe(true);
  });

  it('confirms via navigation away from login URL with content', () => {
    let state = createLoginGuardState();
    state = detectLoginRequirement(state, 'https://example.com/login', 'password', 1);
    state = recordCredentialsSubmitted(state, 2);
    state = checkLoginConfirmation(
      state,
      'https://example.com/home',
      'a'.repeat(150), // substantial non-login content
      3
    );
    expect(state.status).toBe('authenticated');
    expect(state.successEvidence?.navigatedAwayWithContent).toBe(true);
  });

  it('confirms via dashboard content', () => {
    let state = createLoginGuardState();
    state = detectLoginRequirement(state, 'https://example.com/login', 'password', 1);
    state = recordCredentialsSubmitted(state, 2);
    state = checkLoginConfirmation(
      state,
      'https://example.com/',
      'dashboard overview with statistics and charts visible to the user here',
      3
    );
    expect(state.status).toBe('authenticated');
    expect(state.successEvidence?.dashboardVisible).toBe(true);
  });

  it('marks failed when still on login page after submit', () => {
    let state = createLoginGuardState();
    state = detectLoginRequirement(state, 'https://example.com/login', 'password', 1);
    state = recordCredentialsSubmitted(state, 2);
    state = checkLoginConfirmation(
      state,
      'https://example.com/login',
      'textbox "username" textbox "password" button "login" error wrong credentials please retry',
      3
    );
    expect(state.status).toBe('failed');
  });

  it('stays in login_in_progress when page is ambiguous (short content)', () => {
    let state = createLoginGuardState();
    state = detectLoginRequirement(state, 'https://example.com/login', 'password', 1);
    state = recordCredentialsSubmitted(state, 2);
    state = checkLoginConfirmation(state, 'https://example.com/login', 'loading', 3);
    expect(state.status).toBe('login_in_progress');
  });

  it('ignores confirmation check when not in login_in_progress', () => {
    let state = createLoginGuardState();
    const before = state;
    state = checkLoginConfirmation(state, 'https://example.com/', 'logout link visible', 3);
    expect(state).toBe(before);
  });
});

describe('LoginGuard — navigation blocking', () => {
  it('blocks login URL navigation only when authenticated', () => {
    let state = createLoginGuardState();
    // Not authenticated → no blocking
    expect(shouldBlockNavigation(state, 'https://example.com/login').blocked).toBe(false);

    state = detectLoginRequirement(state, 'https://example.com/login', 'password', 1);
    state = recordCredentialsSubmitted(state, 2);
    state = checkLoginConfirmation(state, 'https://example.com/home', 'a'.repeat(150), 3);
    expect(state.status).toBe('authenticated');

    // Now authenticated → block
    const result = shouldBlockNavigation(state, 'https://example.com/login');
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain('Already authenticated');
  });

  it('does not block non-login URLs when authenticated', () => {
    let state = createLoginGuardState();
    state = detectLoginRequirement(state, 'https://example.com/login', 'password', 1);
    state = recordCredentialsSubmitted(state, 2);
    state = checkLoginConfirmation(state, 'https://example.com/home', 'a'.repeat(150), 3);

    const result = shouldBlockNavigation(state, 'https://example.com/settings');
    expect(result.blocked).toBe(false);
  });
});

describe('LoginGuard — the original bug scenario', () => {
  it('navigating to a non-login URL does NOT set authenticated', () => {
    // This is the Baidu bug: navigate to baidu.com (no login) → old code set loginConfirmed=true
    let state = createLoginGuardState();
    // Simulate: navigate to non-login URL (no evidence checks involved)
    // detectLoginRequirement with non-login URL and non-login content → stays not_required
    state = detectLoginRequirement(state, 'https://www.baidu.com', 'search box news links', 1);
    expect(state.status).toBe('not_required');

    // Even navigating elsewhere doesn't change status (navigation alone never advances state)
    expect(shouldBlockNavigation(state, 'https://www.baidu.com/login').blocked).toBe(false);
    expect(state.status).not.toBe('authenticated');
  });

  it('baidu-style site: no login form → skip login entirely', () => {
    let state = createLoginGuardState();
    state = detectLoginRequirement(
      state,
      'https://www.baidu.com',
      'textbox "search" button "百度一下" link "新闻" link "地图"',
      1
    );
    expect(state.status).toBe('not_required');
    expect(describeLoginState(state)).toContain('not_required');
  });
});
