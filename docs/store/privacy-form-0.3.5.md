# Chrome Web Store fields — version 0.3.5

Use these answers for the 0.3.5 package only. It supports ChatGPT, Claude and Gemini, without Grok permissions. The listing description is plain text: paste `description-0.3.5.txt`; do not include Markdown heading markers or asterisks.

## Single purpose description

Display the usage limits and remaining quotas reported by the user's signed-in ChatGPT, Claude and Gemini web accounts through a toolbar badge, popup and optional page widget.

## storage justification

Stores display preferences, normalized quota readings, update/backoff state, account fingerprints and public Gemini request descriptors locally. This keeps the badge, popup and widget consistent across tabs and service-worker restarts, separates account caches, and preserves last-known readings during temporary failures. Raw session cookies, access tokens and chat messages are not saved.

## alarms justification

Schedules quota refreshes while supported tabs are open and rotates the toolbar badge between the provider's main usage windows. Chrome alarms allow this to work when the Manifest V3 service worker is suspended. Polling respects retry delays and rate-limit backoff.

## scripting justification

Runs packaged scripts in supported tabs to verify the active account, make same-origin authenticated quota requests, extract quota events, discover Gemini request metadata, and display the optional widget. Scripts are limited to the supported provider sites. No downloaded script is executed.

## cookies justification

Reads Claude's sessionKey cookie, including when it is HttpOnly, to create a one-way session fingerprint and prevent one user's quota cache being shown after a different user signs in. Cookie change notifications invalidate affected tab bindings after logout or a session change. The extension does not create, edit, export or persist raw cookies. ChatGPT and Gemini requests also use the browser's existing authenticated sessions.

## Host permission justification

Access is limited to chatgpt.com, claude.ai and gemini.google.com. It is required to retrieve the signed-in account's usage metadata, verify account/workspace context, inspect relevant quota responses and display the optional widget. ChatGPT quota requests run from the extension; Claude and Gemini requests use supported tabs where needed. The extension does not request access to unrelated browsing sites.

## Are you using remote code?

No, I am not using Remote code.

## Remote code justification, if the field is available

All executable JavaScript is included in the extension package. The extension fetches provider JSON/HTML and may read public Gemini JavaScript assets as plain text to extract a request identifier with packaged parsing logic. Downloaded JavaScript is never evaluated, imported, injected as a script or run by an interpreter. Page-owned code executes only as part of the provider's own website.

## Data usage

Do not select "no user data". These recommendations disclose local access and processing, even though there is no developer-operated collection server. They deliberately cover data present in session responses and quota-bearing streams, including transient access.

| Category | Select | What the extension handles |
| --- | --- | --- |
| Personally identifiable information | Yes | Provider account/workspace IDs and Gemini email used to verify identity; normalized one-way fingerprints are retained. Session responses can also contain profile details, which are discarded. |
| Health information | No | No health-specific data requested or extracted. |
| Financial and payment information | Yes | Optional provider-reported usage credit balances may be read and displayed. No cards, transactions or payment history are requested. |
| Authentication information | Yes | Existing session cookies/access tokens used only with their original provider; raw credentials are not saved or included in diagnostics. |
| Personal communications | Yes | Copies of relevant Claude chat-response streams may be inspected for quota events. Message content is not retained, exported or sent to the developer. |
| Location | No | No location API or location tracking. Reset times use the browser's local timezone. |
| Web history | Yes | Current supported-provider tab URLs/context are accessed for badge routing and account checks; no chronological browsing-history database is built and unrelated sites are not recorded. |
| User activity | Yes | Relevant provider network responses and response-completion state are observed to update quotas; no advertising analytics, keystroke or mouse/scroll logging. |
| Website content | Yes | Quota JSON, account bootstrap metadata and, as a Gemini fallback, the native Usage page. Only normalized quota data is cached. |

Check all three certifications: no sale or transfer outside approved uses; no unrelated-purpose use/transfer; no creditworthiness or lending use.

## Privacy policy URL

https://github.com/Kulver-stukas/models-usage-limits/blob/main/docs/privacy-0.3.5.md

## Homepage URL

https://github.com/Kulver-stukas/models-usage-limits

## Support URL

https://github.com/Kulver-stukas/models-usage-limits/issues

## Other listing fields

- Category: Workflow & Planning.
- Language: English.
- Official URL: leave unset unless you have a separately verified website. A homepage URL is sufficient.
- Mature content: No.
- Remote code: No (text parsing is not execution).
- Screenshots: at least one 1280 × 800 or 640 × 400 JPEG or RGB PNG; use 0.3.5 UI and exclude Grok.
- Visibility: Public for a normal public launch, or Unlisted for a link-only pilot.
- Distribution: do not claim countries, audience eligibility, trader status, or legal certifications on someone else's behalf without checking the actual publisher account.

## Reviewer notes / testing instructions

Install the extension, sign in to one of the supported provider websites using your own account, and open the toolbar popup. Enable Floating widget in Settings if desired. Supported accounts should show their provider-reported quota windows. Navigate to an unrelated site to verify that the percentage badge disappears. The popup displays time until reset, while the widget displays the reset date/time. On Claude Free, REST may return null; send a normal chat message yourself to obtain a native quota event. The extension never sends a chat prompt automatically. ChatGPT Free Work/Codex values do not represent all ChatGPT chat limits. Gemini's public client assets are read only as text for descriptor discovery, never executed by the extension. No paid account or developer-provided credentials are required for basic testing. Account-tier-specific availability varies.
