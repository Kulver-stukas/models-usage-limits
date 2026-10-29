# Usage Meter privacy policy — version 0.3.7

Effective date: 29 October 2026. Maintainer: Kulver-stukas, the publisher of the Usage Meter project.

Usage Meter displays quotas from your existing signed-in ChatGPT, Claude, Gemini and Grok web sessions. The extension has no developer-operated account service, analytics endpoint or advertising service. The maintainer does not automatically receive your usage readings, identifiers, credentials, conversations or browsing activity.

## Information accessed and its purpose

- **Account and workspace information:** provider account/organization IDs, plan information and Gemini's account email may be processed to identify the active context and keep readings from different accounts separate. Account/session fingerprints are derived locally using a one-way hash. Hashes are pseudonymous identifiers, not a claim of anonymity.
- **Authentication information:** existing browser sessions are used to request quotas from their respective providers. ChatGPT access tokens are processed transiently for authenticated requests. Claude's session cookie and Grok's sso (or sso-rw) cookie are read and fingerprinted to detect account changes. Raw cookies and access tokens are not saved in extension storage, copied into diagnostics or sent to the maintainer. The extension does not ask you to enter a password or modify your cookies.
- **Quota and subscription metadata:** used/remaining values, reset timestamps, model availability, feature counts, optional usage credit balances and update errors are processed and displayed. The extension does not request card details, transactions or payment history.
- **Supported website context and content:** current supported-provider tab URLs, account bootstrap metadata and relevant quota responses are accessed for routing, account verification and refresh. A Gemini fallback can inspect its Usage page. Public Gemini assets can be downloaded without account credentials and read as text to identify the native usage request; downloaded code is not executed.
- **Quota-bearing chat responses:** copies of relevant Claude response streams or timeline events may pass through local buffers so packaged code can extract quota metadata. Chat message content is not retained in the quota cache, included in diagnostics, sent to the maintainer or used for another purpose. The extension does not submit model prompts automatically.

The extension does not request health records, precise location, camera, microphone or contacts. It does not record unrelated website history, keystrokes, mouse movements or scrolling for analytics. The browser's timezone is used to format reset times.

## Local storage and retention

Chrome extension local storage contains preferences, normalized quota readings, account fingerprints, public request descriptors, local count references and retry state. Session storage also holds tab/context bindings used after service-worker restarts; these can include current provider organization identifiers. Old inactive contexts are pruned when the retained context limit is exceeded. Otherwise cached data can remain until you clear the extension's data or uninstall it. Local storage is browser-managed and is not claimed to be separately encrypted by this extension. Chat messages and raw authentication credentials are not intentionally persisted.

Optional reset markers also store the selected quota IDs and enablement per provider account and plan, the observed critical-window deadline and reading time, and pending reset/acknowledgement state. These records remain local. The feature can read a supported page's existing favicon to overlay a green dot and temporarily replace its icon; it does not modify or retain the page title. Loading an icon may request the icon URL already supplied by the page. No system notification permission is requested.

## Requests and sharing

Authenticated HTTPS requests go only to the corresponding supported provider to retrieve its own account and quota information. Public Gemini descriptor discovery may also request Google's public www.gstatic.com assets without account cookies. Providers and their infrastructure receive ordinary request metadata, such as IP address and browser headers, under their own policies. Usage Meter does not send quota readings or session data to a maintainer-operated server or an advertising/analytics provider. It does not sell data, use it for advertising, use it for creditworthiness or lending, or use it for a purpose unrelated to displaying and verifying quotas.

## Diagnostics and voluntary reports

Copy diagnostics is a user-initiated action. It includes extension/provider version, sanitized status information and quota readings, not raw session cookies, access tokens or chat text. Copying alone does not transmit the report to the maintainer. If you post it or a screenshot in an issue or another support channel, that channel receives what you choose to share; remove personal information first and never post credentials. Public GitHub issues are public.

## Your controls

You can hide the widget, restrict or revoke site access through Chrome, disable the extension, clear its data, or uninstall it. Removing site access can prevent quota retrieval. Uninstalling removes the extension's local and session data. Logging out of a provider changes its authentication context but is not a request to erase every previously cached quota snapshot.

Reset markers are disabled by default. You can enable or disable them and choose quota windows in Settings → Reset markers while the relevant account is active. Disabling the feature clears its observation and pending event state for that account and plan.

## Changes and contact

Data practices may change with future releases. Material changes will be disclosed in the release documentation and extension/store interface as appropriate. For questions, open an issue in the Kulver-stukas/models-usage-limits GitHub repository. Do not include credentials or private conversations in a public issue.
