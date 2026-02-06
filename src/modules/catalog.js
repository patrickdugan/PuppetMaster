import { createReadOnlySiteModule } from '../missions/moduleFactory.js';

export const moduleCatalog = {
  'social.linkedin': createReadOnlySiteModule({
    id: 'social.linkedin',
    domainHints: ['linkedin.com'],
    defaultUrl: 'https://www.linkedin.com/feed/',
    checks: [
      { id: 'global_nav', selectors: ['header[role="banner"]', '.global-nav'], pass: 'Global navigation detected.', warn: 'Global navigation not detected.' },
      { id: 'composer_or_feed', selectors: ['[data-test-id="share-box"]', '.scaffold-finite-scroll__content', 'main[role="main"]'], pass: 'Feed/composer region detected.', warn: 'Feed/composer region not detected.' },
    ],
  }),
  'social.x': createReadOnlySiteModule({
    id: 'social.x',
    domainHints: ['x.com', 'twitter.com'],
    defaultUrl: 'https://x.com/home',
    checks: [
      { id: 'primary_column', selectors: ['[data-testid="primaryColumn"]', 'main[role="main"]'], pass: 'Primary timeline column detected.', warn: 'Primary timeline column not detected.' },
      { id: 'composer_or_tweet', selectors: ['[data-testid="tweetTextarea_0"]', '[data-testid="tweet"]'], pass: 'Tweet composer/content detected.', warn: 'Tweet composer/content not detected.' },
    ],
  }),
  'social.youtube': createReadOnlySiteModule({
    id: 'social.youtube',
    domainHints: ['youtube.com'],
    defaultUrl: 'https://www.youtube.com/',
    checks: [
      { id: 'masthead', selectors: ['#masthead', 'ytd-masthead'], pass: 'YouTube masthead detected.', warn: 'YouTube masthead not detected.' },
      { id: 'content_grid_or_player', selectors: ['ytd-rich-grid-renderer', '#contents', '#movie_player'], pass: 'Content region detected.', warn: 'Content region not detected.' },
    ],
  }),
  'social.tiktok': createReadOnlySiteModule({
    id: 'social.tiktok',
    domainHints: ['tiktok.com'],
    defaultUrl: 'https://www.tiktok.com/',
    checks: [
      { id: 'main_layout', selectors: ['main', '[data-e2e="recommend-list-item-container"]'], pass: 'Main TikTok layout detected.', warn: 'Main TikTok layout not detected.' },
      { id: 'video_surface', selectors: ['video', '[data-e2e="feed-video"]'], pass: 'Video surface detected.', warn: 'Video surface not detected.' },
    ],
  }),
  'email.gmail': createReadOnlySiteModule({
    id: 'email.gmail',
    domainHints: ['mail.google.com'],
    defaultUrl: 'https://mail.google.com/mail/u/0/#inbox',
    checks: [
      { id: 'gmail_shell', selectors: ['div[role="main"]', '.aeF'], pass: 'Gmail shell detected.', warn: 'Gmail shell not detected.' },
      { id: 'inbox_list_or_auth', selectors: ['tr.zA', 'input[type="email"]'], pass: 'Inbox rows or auth entry detected.', warn: 'Neither inbox rows nor auth entry detected.' },
    ],
  }),
  'email.outlook': createReadOnlySiteModule({
    id: 'email.outlook',
    domainHints: ['outlook.office.com', 'outlook.live.com'],
    defaultUrl: 'https://outlook.office.com/mail/',
    checks: [
      { id: 'outlook_shell', selectors: ['[role="navigation"]', '[aria-label*="Folder"]', 'div[role="main"]'], pass: 'Outlook shell detected.', warn: 'Outlook shell not detected.' },
      { id: 'message_list_or_auth', selectors: ['[role="row"]', 'input[type="email"]'], pass: 'Message list or auth entry detected.', warn: 'Neither message list nor auth entry detected.' },
    ],
  }),
  'email.marketing.mailchimp': createReadOnlySiteModule({
    id: 'email.marketing.mailchimp',
    domainHints: ['mailchimp.com'],
    defaultUrl: 'https://mailchimp.com/',
    checks: [
      { id: 'marketing_nav', selectors: ['header', 'nav'], pass: 'Mailchimp nav detected.', warn: 'Mailchimp nav not detected.' },
      { id: 'campaign_surface', selectors: ['main', '[data-testid*="campaign"]'], pass: 'Campaign surface/main region detected.', warn: 'Campaign surface/main region not detected.' },
    ],
  }),
  'email.marketing.klaviyo': createReadOnlySiteModule({
    id: 'email.marketing.klaviyo',
    domainHints: ['klaviyo.com'],
    defaultUrl: 'https://www.klaviyo.com/',
    checks: [
      { id: 'site_shell', selectors: ['header', 'main'], pass: 'Klaviyo shell detected.', warn: 'Klaviyo shell not detected.' },
      { id: 'cta_surface', selectors: ['a[href*="login"]', 'a[href*="sign-up"]', 'button'], pass: 'CTA surface detected.', warn: 'CTA surface not detected.' },
    ],
  }),
};
