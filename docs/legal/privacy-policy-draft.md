> **DRAFT — requires lawyer review before publication** (PIPEDA/CASL for Canada, US state laws, GDPR/UK GDPR for EU/UK visitors). Not legal advice. Do not publish at www.stiko.design/privacy until reviewed. The only placeholder left to fill in is `[contact email]`. See "Drafting notes" at the very end; delete that section before publishing.

# Privacy policy

**Last updated:** 15 November 2026 (draft)

This policy explains what personal information stiko collects, why, who else handles it, and what choices you have. It covers the stiko app at **app.stiko.design** and the marketing site at **www.stiko.design**. We have tried to write it in plain language. If something is unclear, write to us at `[contact email]`.

## 1. Who we are

stiko ("we", "us") is a service where design and engineering teams share drawings, 3D models, images, PDFs and video with clients and collaborators and collect comments and approvals in one place. We run app.stiko.design and www.stiko.design.

For the information described in this policy, we decide why and how it is used. You can reach us at **`[contact email]`**. That address is the right place for any privacy question or request, including the ones in section 8.

## 2. What we collect

**Account information.** Your name, your email address, and your password. Your password is never stored in readable form: sign-in is handled by our authentication provider (WorkOS), which keeps it as a one-way hash. If you signed up before we moved sign-in to WorkOS, our own database also still holds the one-way hash from that earlier system.

**Your business profile.** Everyone who creates an account, including people who join only to review something they were invited to, is asked five short questions the first time they sign in (for accounts that existed before 15 November 2026, on their next visit): what best describes your work, what kind of business you run (including a short free-text answer if you choose "Other"), whether you design or build for clients, your own products or both, how many people work at your company, and your role. We use your answers to understand who uses stiko, to make it better for them, and to tailor stiko and our emails to your kind of work. From your email address we work out one extra fact, whether it belongs to a free consumer mail service or to a company domain, and we store only that yes/no answer alongside the profile. From your IP address at that moment we record your country and region (for example "CA" and "BC"). We do not keep the IP address itself for this purpose.

**Files, comments and activity inside stiko.** The files you upload (drawings, models, images, PDFs, video), the names of your projects, packages and submissions, the comments, markups, mentions and attachments you add, your approvals and change requests, and a record of who has opened which submission. People you invite to a package can see the parts of it you give them access to, including your name, your email address and the comments you write there. Likewise, if someone invites you, they and the other people on that package can see your name, email address and comments.

**Billing information.** If you buy a paid plan, payment is handled by Stripe. We never see or store your card number. We keep your plan, your Stripe customer reference and the status of your subscription.

**Usage analytics.** When analytics is on (see section 5), we record which pages you open and what you do in stiko, such as creating a project, uploading a file, sending something for review, signing up or paying. Each event carries internal ID numbers and codes, file types, sizes and counts. We deliberately do not send file names, project or package names, comment text, email addresses or people's names to our analytics provider. Your browser also sends technical details with every event, such as the page address, browser and device type, and your IP address. In the app, before a page address is sent, our code reduces it to the page path plus a short list of campaign and view labels, so email addresses, invitation links, password-reset links and any other details in the address are removed. **On the marketing site (www.stiko.design) we also use PostHog's automatic capture,** which records the pages you view, what you click and the visible text of the element you click (for example a button label such as "Sign up"). We do not record sessions on the marketing site, and in the app automatic capture is switched off: there we record only the specific actions listed above. On the onboarding page (the five questions above) only, we also record a **session replay**: a recording of how the page is used, such as clicks, scrolling and mouse movement. All text and everything typed into the page is masked in that recording. We never record sessions on the dashboard or on a package, because those pages show your confidential work.

**Marketing attribution.** When you arrive from an advertisement or a campaign link, the link can carry labels (UTM parameters such as source, medium and campaign) and ad-click identifiers (such as gclid, fbclid and ttclid). We save the first and the most recent of these, together with the page you landed on and the page you came from, in a cookie. When you create an account we copy them to your account record so we can tell which of our marketing works. If your browser already holds the cookie values `_fbc`, `_fbp` or `_ga` that advertising and analytics tools set, we copy those as well. If you arrive through a review invitation from another person, we record the account as coming from that invitation, not from advertising.

**Technical and security data.** Like any online service, our systems and providers see your IP address and browser details when you connect. We pass your IP address and browser details to WorkOS on sign-in so it can detect and limit abuse.

**Email we send you.** We send account and service emails (verification, password reset, invitations, notifications about packages you are on). We send product news and tips only if you tick the box on the onboarding page.

## 3. Why we use it, and our legal basis

- **To provide stiko to you** (account, projects, sharing, comments, billing, support, AI summaries). This is necessary to perform our contract with you.
- **To keep stiko secure, prevent abuse and fix problems.** This is our legitimate interest.
- **To tailor stiko and our emails to your kind of work,** using your answers to the onboarding questions (section 2). This is our legitimate interest.
- **To understand how stiko is used and improve it, and to measure which of our marketing works.** This is our legitimate interest, and for visitors in the European Union, European Economic Area, United Kingdom and Switzerland it also depends on your consent to analytics cookies (see section 5).
- **To send you product news and tips.** Only with your consent, which you give by ticking an unticked box. You can withdraw it at any time (section 8).
- **To meet legal obligations,** for example keeping billing records.

## 4. How we generate summaries with AI

stiko can write a short summary of the comments on a submission, of a project, and a draft changelog. To do this, the text of the relevant comments, the names of the files they are attached to and the names of the project and its packages are sent to our AI provider, Atlas Cloud (section 6). Before sending, we replace the names of commenters with neutral labels such as "Reviewer A" and "Reviewer B". Comment text itself is sent as written, so please do not put information in comments that you do not want processed this way.

## 5. Cookies and similar technologies

We use cookies and browser storage for sign-in, to remember small things, and (with your consent where the law requires it) for analytics and attribution.

| Name | Set by | What it is | How long |
|---|---|---|---|
| `wos-session` | stiko (via WorkOS) | Keeps you signed in. Strictly necessary. | While you are signed in |
| `stiko-pending-auth` | stiko | Holds your place while you create an account or verify your email. Strictly necessary. | 10 minutes |
| `stiko_profile` | stiko | A signed marker that you have completed the onboarding questions, so we do not ask again on every page. | 1 year |
| `stiko_consent` | stiko | Remembers your cookie choice. Set only in the regions where we ask (see below). | 12 months |
| `stiko_ft`, `stiko_lt` | stiko | First-touch and last-touch campaign labels (section 2, "Marketing attribution"). Shared between www.stiko.design and app.stiko.design. Written only when the link you used carries campaign labels. | 90 days |
| `ph_…_posthog` | PostHog (our analytics provider) | Anonymous visitor ID, so one visit to the marketing site and the app is recognised as the same person. Also stored in your browser's local storage. | Up to 1 year |
| `stiko_geo` (session storage) | stiko | Remembers for this browser tab whether we needed to ask for your cookie choice. Contains no personal information. | Until you close the tab |
| Interface preferences (local storage) | stiko | Small settings such as whether a side panel is open. | Until you clear them |

The marketing site is hosted by Webflow, which may set its own cookies; see Webflow's privacy policy.

**Who is asked first.** If you visit from the European Union, the European Economic Area (Iceland, Liechtenstein, Norway), the United Kingdom or Switzerland, or if we cannot tell where you are, a banner asks you to **Accept** or **Decline** analytics cookies. Until you accept, analytics does not start: no PostHog cookie is set, nothing is sent to PostHog, and no campaign cookies are written. The Accept and Decline buttons are equally easy to choose.

**Everywhere else,** there is no banner. Analytics and attribution run by default, and this policy is the notice that tells you so.

**Changing your mind.** In the regions where we ask, delete the cookies for stiko.design in your browser and the banner appears again. Anywhere, you can block or delete cookies in your browser settings, or use a browser extension that blocks analytics scripts. If you are signed in and have declined, we stop sending analytics events about your account from our servers too.

## 6. Who else handles your information

We use the following service providers ("processors") to run stiko. They may use your information only to provide their service to us.

| Provider | What it does for us | What it receives |
|---|---|---|
| **WorkOS** | Sign-in and account security | Name, email, password (as a hash), sign-in IP address and browser details |
| **Stripe** | Payments and subscriptions | Your name and email address, our internal account ID, the payment details you enter on Stripe, your plan |
| **PostHog** (United States) | Product and website analytics, and the onboarding session replay | Event data, IP address and browser details, internal IDs; on the marketing site also your clicks and the text of what you click; no names, emails, file names or comment text |
| **Resend** | Sending email | Recipient email address, message text |
| **Cloudflare (R2)** | Storing uploaded files and attachments | The files you upload |
| **Neon** | Our database | Everything stored about your account and your projects |
| **Vercel** | Hosting the app, running our servers and serving the DWG/DXF-to-PDF converter | Everything that passes through the app, including the files while they are processed and server logs |
| **Atlas Cloud** | AI-written summaries (section 4) | Comment text, file names, project and package names; commenter names replaced by labels |
| **Modal** | Converting SolidWorks `.sldprt` parts into a viewable 3D model | The part file you upload |
| **Webflow** | Hosting the marketing site | Visitors' IP address and browser details |

**Services your browser contacts directly.** Two public delivery services supply small technical files that the stiko app needs, and your browser fetches them straight from those services, not through us. They do not receive your files, comments or account details. But, like any web server, each one sees your IP address and browser details, and that the request came from stiko, when your browser loads the file.

| Service | What it supplies | When your browser contacts it |
|---|---|---|
| **unpkg.com** (a public code-delivery network) | The helper script that displays PDFs | When you open a PDF |
| **raw.githack.com** (a public file host that serves files from GitHub) | A standard lighting image used to light 3D models | When you open a 3D model |

We do not sell your personal information. We do not share it with advertisers. We may disclose information if the law requires it, or in connection with a sale or reorganisation of our business, in which case we will tell you.

## 7. Where your information is processed, and how long we keep it

**International transfers.** Our providers are located in, or operate from, the United States and other countries. If you are in the European Economic Area, the United Kingdom or Switzerland, your information is therefore transferred outside your region. Where the law requires it, we rely on recognised safeguards for those transfers, such as adequacy decisions, the EU-US Data Privacy Framework or standard contractual clauses.

**How long we keep it.** We keep your account information, business profile, files and comments for as long as your account is active. You control your content: deleting a file or a submission removes it straight away. When you delete a project or a package it goes to the trash, where you can restore it for 28 days; after that it is permanently deleted and its stored files are removed. If you ask us to delete your account (section 8), we delete or anonymise your personal information, except records we must keep by law, such as billing records. Our providers may keep backup copies for a limited time after deletion. Analytics data is kept for as long as it remains useful for the purposes in section 3; you can ask us to delete the analytics data held about you.

## 8. Your rights and choices

Depending on where you live, you may have the right to:

- ask for a copy of the personal information we hold about you (**access**);
- have it corrected if it is wrong (**correction**);
- have it deleted (**deletion**);
- object to or restrict how we use it, including analytics based on our legitimate interest (**objection**);
- receive it in a portable format (**portability**);
- withdraw a consent you gave us, at any time, without affecting what we did before you withdrew it; and
- complain to your data protection authority (in Canada, the Office of the Privacy Commissioner or your provincial equivalent; in the UK, the ICO; in the EU, your national authority).

To use any of these, write to **`[contact email]`**. We may need to confirm it is really you. We will answer within the time the law that applies to you requires. There is currently no self-service button to delete your account in the app, so please ask us by email.

**Product news and tips.** We send them only if you ticked the box, and every such message will explain how to unsubscribe. You can also withdraw at any time by writing to `[contact email]`. Withdrawing does not stop the account emails stiko needs to send you, such as verification, password reset and notifications about packages you are on.

## 9. Children

stiko is a business tool and is not directed to children. We do not knowingly collect personal information from anyone under 16. If you think a child has given us information, write to `[contact email]` and we will delete it.

## 10. Changes to this policy

When we change this policy we will update the date at the top. If a change is significant, for example a new kind of use or a new category of provider, we will tell you in the app or by email before it takes effect.

## 11. Contact

Questions, requests or complaints: **`[contact email]`**.

---

## Drafting notes for the reviewing lawyer (DELETE THIS SECTION BEFORE PUBLISHING)

Written against the code on the `feature/kyc-posthog` branch (2026-11-15). Items to confirm or correct:

1. **Legal entity and address.** The draft names no legal entity and no postal address, because only `[contact email]` was allowed as a placeholder. Add the entity and, for CASL-compliant promotional email, a mailing address.
2. **Processors differ from the original brief in two places.** (a) File storage is **Cloudflare R2**, not AWS S3 (`lib/s3.ts` reads `R2_*` settings; `ARCHITECTURE.md` still says S3, which is stale). (b) **CloudConvert is not listed**: nothing in the code creates a CloudConvert job any more (the upload-time STEP conversion trigger was removed in commit c225360; STEP is converted in the viewer). A webhook receiver and helper remain in the code for old jobs. If CloudConvert is ever re-enabled, or if STEP files uploaded before April 2026 were sent to it, add it. **Webflow** is listed because it hosts the marketing site, although no app code uses it. Check that each provider's own terms (data processing agreements, no-training and retention terms, especially Atlas Cloud, Modal and PostHog) match what this policy says about them.
3. **Retention.** Only two retention rules exist in code: the 28-day trash window for projects and packages (`lib/trash.ts`; permanent deletion of files and submissions is immediate), and the trash purge job. There is no scheduled deletion of inactive accounts. There is **no self-service account deletion** (the button shows "not wired up yet"), so the policy promises manual handling by email. Do not shorten that promise without building the feature.
4. **Marketing email.** No promotional email is sent today; the unticked checkbox only records consent (`users.marketing_consent`, with timestamp and method). There is no in-app control to withdraw it, so withdrawal is by email, and the unsubscribe-link promise applies once promotional email exists. Confirm the exact CASL wording of the checkbox ("Send me product news and tips from stiko. You can unsubscribe at any time.") and the record-keeping.
5. **IP address and PostHog.** The text says PostHog receives your IP address. If the founder turns on PostHog's "Discard client IP data" setting (recommended in the rollout runbook), this can be strengthened to say IP addresses are discarded rather than stored. Server-side events are sent from the hosting provider's address, not the visitor's. Browser events pass through our own proxy (app.stiko.design/ingest), which forwards the visitor's IP address to PostHog so it can work out the country, but forwards no cookies, sign-in data or referrer.
6. **Consent model.** Outside the EU/EEA/UK/CH list, analytics runs without asking (opt-out only by blocking cookies). Confirm that is acceptable for Canada (PIPEDA, Quebec Law 25), California and other US states, and whether any region needs a banner or a "Do Not Sell or Share" / Global Privacy Control commitment. The code does not read Do Not Track or GPC signals. Ad-click identifiers are stored but not yet sent to any advertising platform.
7. **Transfer mechanism, age limit (16), regulators named, and lawful bases** are generic; please tailor them. Confirm whether an EU/UK representative is needed.
8. **Backups.** The sentence about provider backups is a generic caution, not verified against Neon's or Cloudflare's actual retention.
9. **Cookie table.** Built from the code, not from a browser session. `wos-session` is WorkOS AuthKit's default name (it differs if `WORKOS_COOKIE_NAME` is set in production), and `ph_…_posthog` carries the PostHog project key in its name. Before publishing, open app.stiko.design signed in, browser developer tools, Application tab, Cookies, and confirm the list matches; also check what the Webflow site itself sets.
10. **Two browser-side third parties that were not in the original brief.** The PDF viewer loads its helper script (the pdf.js worker) from **unpkg.com** (`components/viewers/PDFKonvaViewer.tsx`), and the 3D viewer loads a lighting image from **raw.githack.com** (drei's `<Environment preset="studio">` in `components/viewers/SceneLighting.tsx` fetches it from there). Each receives the viewer's IP address and user agent. The draft discloses both in section 6. **Suggestion: self-host both** (the worker ships inside the `pdfjs-dist` package; the lighting image is a single downloadable .hdr file), which would remove the disclosure, the third-party IP exposure and a dependency on someone else's servers. Until then, please confirm the wording is adequate and whether these need to appear in the processor list or only as disclosed recipients.
11. **Ad and analytics cookies copied at signup regardless of consent.** At signup, `lib/analytics/signup.ts` copies the values of the `_fbc`, `_fbp` and `_ga` cookies into the user's record (`click_ids`) without checking the visitor's consent choice (the consent state is stored separately in `users.analytics_consent`). Those cookies exist only if a Meta pixel or Google Analytics tag is running on the visitor's browser (stiko sets none of them, and we are not aware of any such tag on the Webflow site; please confirm that), so in practice the copy is empty unless a pixel is added later. Please decide whether the copy should be gated on consent, or removed until advertising platforms are actually connected. Section 2 ("Marketing attribution") says plainly that they are copied.
12. **Marketing-site autocapture.** The Webflow site runs PostHog with autocapture on, which records clicks and the text of clicked elements (section 2 says so). Session replay is off there. Unlike the app, that site has no address scrubbing, so check that no page on it puts personal data in an address or in the text of a clickable element (for example a form that echoes a name).
