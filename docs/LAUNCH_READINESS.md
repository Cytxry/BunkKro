# BunkKro launch readiness audit (27 Nov 2026)

**Update, same day:** the owner's details are in (Charan, Bengaluru, charanb2128@gmail.com, 18+), so A4 is done.
Privacy Policy, Terms of Service, About and a new Help & contact page were rewritten as plain documents with no
placeholders. Day Order is removed from public pages because it is switched off in the app. Still open: A1
(custom SMTP; when you add it, change "Supabase ... sends account emails" in privacy.html §7 to your email
provider), A6 (Google app in production), Confirm email and Secure password change, and the age gate before
13 May 2027.

How this was made: the website code, the browser extension, the Supabase project itself (tables, row-level security,
foreign keys, storage, edge functions, auth settings, security advisor), the Vercel configuration, and the official
or authoritative sources linked below. This is not legal advice. Laws are summarised from the sources found; check
the gazette texts (or a lawyer) before relying on a legal point.

Status words: **Verified** = checked in code, in Supabase or in a browser. **Not tested** = changed or recommended,
not run end to end. **Owner** = only you can do it (your accounts, your details).

---

## 1. What BunkKro actually collects and where it goes

| Data | Where it comes from | Where it is stored | Shared with |
|---|---|---|---|
| Email, password (hashed by Supabase) | Sign-up form | Supabase Auth, Sydney region (ap-southeast-2) | Supabase |
| Name, email, profile photo URL | Google, if "Continue with Google" (scopes: email, profile) | Supabase Auth user metadata | Google (sign-in), Supabase |
| Display name you set in Settings | You | User metadata | Supabase |
| Settings: target, rounding, semester dates, Day Order calendar, "already counted" dates, Pro list date | You | User metadata (`bk_prefs`, `bk_counted_upto`, `bk_pro_waitlist`) | Supabase |
| Subjects, attendance numbers, daily marks, timetable, holidays, extra classes | You | Tables `subjects`, `daily_period_logs`, `tracker_logs`, `timetables`, `timetable_entries`, `timetable_exceptions` | Supabase |
| Timetable import records (counts, dates, engine version, file hash) | Timetable import | `timetable_imports` | Supabase |
| Timetable corrections, only with the sharing switch on | You | `timetable_feedback` | Supabase |
| Old copy of subjects (9 rows, 3 users) | An earlier manual backup | `Subjects_backup` | Supabase |
| The timetable photo or PDF itself | You | **Not uploaded.** The built-in scanner reads it in the browser; BunkKro AI currently runs only on your PC (`?ai=1`) | No one, today |
| Login token, cached data, preferences | The app | Browser localStorage; the extension's `chrome.storage` | No one |

What is **not** there (verified): no file storage buckets, no analytics, no ads, no tracking cookies, no payments, no
email sending of BunkKro's own (only Supabase Auth emails), and no database functions that bypass row-level security.

Third parties a browser talks to: Supabase (API), jsDelivr (supabase-js and the scanner library), Project Naptha's
tessdata host (scanner language files), Google (only for Google sign-in, and for profile photos from
`lh3.googleusercontent.com`). **Google Fonts is no longer used:** the font is now served from the site.

---

## A. Mandatory before launch

| # | Item | Why | Status |
|---|---|---|---|
| A1 | **Custom SMTP in Supabase** (Resend, Brevo, Postmark...) | Without it, Supabase Auth refuses to send emails to anyone outside your Supabase team: sign-up confirmations, password resets and the password-change code will fail for real students. The built-in sender is also limited to a few emails an hour and is "not for production". ([Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [changelog](https://supabase.com/changelog/29370-supabase-auth-changes-to-default-email-provider)) | **Owner.** Launch blocker |
| A2 | **Account deletion that works** | The DPDP Act gives a right to erasure (s.12), and Google's user data policy expects users to be able to delete. The site's "Delete my login" called an edge function that was never deployed. | **Done, partly verified:** `delete-account` deployed (version 2). It refuses no token, a fake token, a public key in place of a login, and a missing "DELETE". A real deletion was not run (it needs a throwaway account). |
| A3 | **Deletion and export cover all of a student's data** | `Subjects_backup` holds students' rows but was skipped by delete and export. | **Done:** added to the website's delete, the export, and the edge function. Verified: 0 rows left behind from earlier deleted accounts in every table. |
| A4 | **Your identity and contact in the policies** | The SPDI Rules 2011 (Rule 4 privacy policy, Rule 5(9) grievance officer, in force until the DPDP Act replaces s.43A) and DPDP Rules (contact for data questions; grievances answered within at most 90 days, Rule 14) expect a named contact. Consumer law needs it once you charge. | **Owner:** fill the [brackets] in `privacy.html`, `terms.html`, `about.html`; set `BK_SUPPORT_EMAIL` in `settings.js` |
| A5 | **A public home page** | Google requires the app home page to be public and not just a login page. Your `/` is only the login screen when logged out. ([Google brand verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification), [verification requirements](https://support.google.com/cloud/answer/13464321)) | **Done:** `about.html`, public, describes the app, links Privacy and Terms. Use it as the consent screen's home page. |
| A6 | **Google OAuth app set to "In production"** | In "Testing", only listed test users can sign in. | **Owner:** Google Cloud → Google Auth Platform → Audience. With only email/profile scopes no review is needed to publish. |
| A7 | **Privacy policy and terms public, linked from the login** | SPDI Rule 4; Google requires the privacy policy URL on the consent screen, on your domain. | **Done:** `privacy.html`, `terms.html` load without login (verified locally); linked from the login card, Settings and About. Still drafts until A4. |
| A8 | **Vercel plan** | Vercel Hobby is for non-commercial personal use only. A free BunkKro is fine; once Pro is sold, it needs Vercel Pro. ([Vercel fair use](https://vercel.com/docs/limits/fair-use-guidelines)) | **Owner,** before charging |

## B. Conditional

| Item | When it applies | What to do |
|---|---|---|
| Consumer Protection (E-Commerce) Rules, 2020 | When Pro is sold | Show your legal name, address, contact and grievance officer; prices including taxes; cancellation and refund terms before payment; a refund policy page. ([Rules](https://consumeraffairs.nic.in/sites/default/files/E%20commerce%20rules.pdf)) |
| Payment provider requirements (Razorpay, Cashfree...) | When Pro is sold | They ask for Terms, Privacy, Refund/Cancellation, Contact pages on the domain before activating. |
| GST registration | Turnover above the threshold, or by choice | Ask a CA when revenue starts. |
| Children's data (DPDP s.9, Rule 10: verifiable parental consent) | If under-18s use BunkKro; Rule 10 applies from **13 May 2027** | The terms and policy say 18+, or with a guardian's consent. Before May 2027, either add an age confirmation at sign-up and refuse under-18s, or build verifiable parental consent. Recommend 18+ only. |
| DPDP notice, consent and rights rules (Rules 3, 5-16) | Most apply from **13 May 2027**; the Act itself is in force. ([PIB summary](https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/nov/doc20251117695301.pdf)) | The drafts already follow them (itemised notice, withdrawal as easy as consent, erasure, grievance contact). Re-check the gazette text before May 2027. |
| Hosted AI server (Vast.ai) | When timetable files go to a server | Update the privacy policy (bracketed line already there): what is sent, where the server is, deletion time. Add its address to the CSP. Don't keep files. |
| Breach notification (DPDP s.8(6), Rule 7) | If a breach happens | Tell affected users and the Data Protection Board. Write a one-page plan (who checks what, who to email). |
| EU GDPR / UK GDPR | Only if you target people in the EU or UK | **Not applicable now:** BunkKro is for Indian colleges and doesn't market there. |
| US COPPA / CCPA | Under-13 audience; CCPA revenue/user thresholds | **Not applicable.** |
| IT (Intermediary) Rules 2021 | If users publish content to each other through BunkKro | **Not applicable now:** share packs are codes students copy themselves; nothing is hosted for others. |
| Cookie banner | Non-essential cookies or tracking | **Not needed:** only essential storage (login, preferences). Disclosed in the privacy policy. |

## C. Trust and privacy improvements

| Item | Status |
|---|---|
| Google Fonts removed (the font is served from the site; one less third party sees IPs) | **Done, verified** (font loads, no Google requests) |
| Estimate disclaimer on Home ("numbers are estimates... college records are what count") and in About/Terms | **Done, verified** |
| Privacy policy corrected to verified facts: Sydney storage region, Google data use, scanner downloads, Pro list, essential storage; removed my earlier invented "reply in 7 days / 30 days" promise and backup period (now placeholders) | **Done** |
| Turn on **Confirm email** (Supabase → Email). Today anyone can sign up with someone else's address; with Google linking that allows an account takeover trick | **Owner,** high priority (needs A1 first) |
| Turn on **Secure password change** (makes the emailed code mandatory) and the **Password changed** notification | **Owner** |
| Leaked password protection (Supabase advisor warning) | **Owner;** needs Supabase Pro |

## D. Technical

| Item | Status |
|---|---|
| Row-level security on every table, plus restrictive "own rows only" policies, plus cross-table ownership checks | **Verified** in Supabase |
| No service-role key or secret in the website (static check scans files and git history) | **Verified** |
| CSP without unsafe script sources; X-Frame-Options; nosniff; Referrer-Policy | **Verified**; added **Permissions-Policy** (no camera, microphone, location, payment) |
| `delete-account` runs without the gateway JWT check because your project signs logins with ES256 keys, which that check rejects; the function verifies the token itself with `auth.getUser` | **Done, verified** with refusals |
| 404 page, robots.txt, sitemap.xml, meta description, Open Graph tags | **Done** (404 works on Vercel automatically) |
| Remove `http://127.0.0.1:8765` / `localhost:8765` from the CSP when the hosted AI replaces the local one | Later |
| Backups: Supabase Free has no downloadable daily backups and pauses after a week idle. For real users, Supabase Pro (daily backups) or a scheduled `pg_dump` | **Owner,** recommended |
| Uptime check (UptimeRobot / Better Stack free) on the site and Supabase | Recommended |
| Error reporting (e.g. Sentry free tier) | Optional; would need a privacy-policy line and CSP entry |
| `Subjects_backup` table: personal data with no purpose now. Delete it after you export a copy, or keep it and leave it covered by deletion/export (done) | **Owner** decision |
| Custom domain (bunkkro.in or similar) | Recommended: needed to show your own name instead of `...supabase.co` on Google's screen (with Supabase custom domain, paid) and for brand verification |

## E. Settings (already built; what each part is for)

Account (name, login method, password change with current password and emailed code, log out everywhere) ·
Attendance (target, rounding, semester) · Appearance (theme) · Timetable AI (sharing fixes, consent) · Plan ·
Your data (download all, delete data then login) · Help & legal (tour, privacy, terms, contact when set).
Nothing else needs adding now: no cookie preferences (no optional cookies), no session list (Supabase doesn't expose
one to the client; "log out everywhere" covers it), no separate privacy-request form (export and delete are
self-service; anything else goes to the contact email).

## F. Public pages (no login needed)

`/about.html` (home page for Google), `/privacy.html`, `/terms.html`, `/404.html`. Linked from: the login card
("By continuing...", "What is BunkKro?"), Settings → Help & legal, and each other's footers.

## G. What I need from you

1. Who runs BunkKro: your name (or company), city/state in India.
2. A contact email for support and privacy/grievance requests, and the name of the person who answers them.
3. How many days you'll take to answer requests (the law allows at most 90).
4. Your email provider for Supabase SMTP (and a sending address on a domain you own).
5. Whether you'll get a custom domain, and which.
6. Your Supabase plan (to state backup retention correctly).
7. Age decision: 18+ only, or build parental consent.
8. For the hosted AI later: server location and how long files are kept (aim: deleted right after reading).
9. Courts' city for the terms; date of publishing.

## H. Scorecard

| Item | Status | Priority | Blocks launch |
|---|---|---|---|
| Custom SMTP (A1) | Owner | Launch blocker | Yes |
| Account deletion deployed (A2) | Done, refusals verified, full run not tested | Launch blocker | No longer |
| Delete/export cover all data (A3) | Done, verified | Launch blocker | No longer |
| Owner details in policies (A4) | Owner | Launch blocker | Yes |
| Public home page (A5) | Done | Launch blocker | No longer |
| Google app in production (A6) | Owner | Launch blocker | Yes, if still Testing |
| Policies public + linked (A7) | Done (drafts) | Launch blocker | Until A4 |
| Confirm email on | Owner | High | Strongly advised |
| Secure password change on | Owner | High | No |
| Age decision (before 13 May 2027) | Owner | High | No |
| Vercel Pro before charging (A8) | Owner | Conditional | Before Pro |
| E-commerce rules, refund page | Conditional | Before Pro | Before Pro |
| Backups / uptime | Owner | Recommended | No |
| Custom domain + Google branding | Owner | Recommended | No |
| Error reporting | — | Optional | No |
| GDPR/COPPA/CCPA/Intermediary rules | — | Not applicable | No |

## Google OAuth consent screen: what to enter

- App name: BunkKro · Support email: yours
- App home page: `https://bunkkro.vercel.app/about.html`
- Privacy policy: `https://bunkkro.vercel.app/privacy.html` · Terms: `https://bunkkro.vercel.app/terms.html`
- Authorized domain: `bunkkro.vercel.app` (your index.html already has a Google site-verification tag)
- Scopes: only `openid`, `email`, `profile` (nothing sensitive: no app review needed). Publishing status: In production.
- Logo: optional; adding one triggers brand verification, which also needs every authorized domain verified. While
  sign-in goes through `mvlyeygitnnuksuxmcsy.supabase.co`, Google's screen shows that address; a Supabase custom
  domain (paid) fixes it.
- Google API Services User Data Policy: the privacy policy now says exactly what's received from Google and that it
  is used only to log in and show the name and photo. Limited Use rules apply to sensitive/restricted scopes only.
  ([policy](https://developers.google.com/terms/api-services-user-data-policy), [OAuth policies](https://developers.google.com/identity/protocols/oauth2/policies), [branding](https://support.google.com/cloud/answer/15549049))

## What was verified after the changes

- Calculation regression 40/40 and XSS check 4/4 (browser), static checks, Day Order and AI batch checks: all pass.
- Public pages, 404, robots, sitemap, font: load locally without login; no console errors; about and 404 checked on
  desktop and phone width.
- Supabase: RLS on all tables; no storage buckets; no orphaned rows; `delete-account` refuses every bad request.
- **Not tested:** a real account deletion (needs a throwaway account), the live Vercel deployment of these pages
  (the preview is behind Vercel login for me), Google's consent screen settings (your account).
