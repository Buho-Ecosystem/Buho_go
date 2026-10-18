# Security Policy

BuhoGO is a self-custodial Bitcoin and Lightning wallet. Bugs here can cause **irreversible loss of
user funds**. We would rather hear about a suspected issue that turns out to be harmless than not
hear about it at all.

## Reporting a Vulnerability

**Do not open a public issue, PR, or discussion for security problems.** Public disclosure puts real
money at risk before users can update.

| Channel | Where |
| --- | --- |
| GitHub advisory (preferred) | [Report a vulnerability](https://github.com/Buho-Ecosystem/Buho_go/security/advisories/new) |
| Email | `contact@mybuho.de` |
| Nostr DM (NIP-17) | `drshift@lnbits.de`, `npub17c2szua46mc8ndp4grvy4z5465x0qxjge8tqx7vyu0vkqr24y2hssuuy6f` |

Email is not end-to-end encrypted. For exploit details, PoC code, or anything containing user data,
use the GitHub advisory form or an encrypted Nostr DM. You can also send a short email asking us to
move the conversation there.

**Include:** affected component, app version or commit, platform (web, Play Store, self-hosted, or
Docker), exact reproduction steps, a PoC, the concrete impact, and how you want to be credited.

Test only against your own wallets. Never use funds or accounts belonging to others.

## Supported Versions

Fixes go into the latest release. Please reproduce on the latest version from Google Play, Zapstore, [GitHub releases](https://github.com/Buho-Ecosystem/Buho_go/releases) or [go.mybuho.de](https://go.mybuho.de) before reporting.

## Response

| Stage | Target |
| --- | --- |
| Acknowledgement | 48 hours |
| Triage and severity rating | 5 business days |
| Status updates | Every 7 days until resolved |
| Fix, critical | 14 days, expedited release |
| Fix, high or medium | 30 to 90 days |

We follow coordinated disclosure with a **90-day** default embargo from acknowledgement. Please hold
off publishing until a fix ships or the embargo ends, whichever comes first. We may ask for an
extension when a fix depends on an upstream project, or shorten it if the issue is being exploited.
Advisories are published on GitHub and credit you unless you ask otherwise.

## Scope

**In scope:** this repository and its build pipeline, `go.mybuho.de`, the Android app
(`mybuho.buhogo`) from Google Play, Zapstore and GitHub releases, the official Docker image, recovery
phrase storage and encryption, cloud backup, biometric and PIN handling, the Spark emergency exit,
payment destination parsing and resolution (invoices, Lightning addresses, LNURL, on-chain, Spark,
Arkade, npub and NIP-05, phone numbers), NWC secret handling and permission scoping, LNbits
credential handling, Kiosk Mode isolation, Bolt Card and NFC payments, Batch Send, Auto-Transfer,
Internal Transfer, contact chat encryption (NIP-17), identity keys and remote signers (NIP-46), and
supply-chain issues in declared dependencies.

**Out of scope:** third-party services unless the flaw is in *our* use of them (Spark, LNBits
servers, NWC providers, Branta, Nostr relays, map and price data, Google Play, Netlify, Docker Hub),
operator misconfiguration of self-hosted instances, attacks requiring a rooted, compromised, or
physically unlocked device, attacks requiring the user to paste their seed or connection string
somewhere hostile, social engineering, and forks or domains we do not operate.

**Usually closed without impact evidence:** missing headers or cookie flags, self-XSS, clickjacking
on non-sensitive pages, missing rate limiting, volumetric DoS, outdated dependencies with no working
exploit, raw scanner output, and SPF, DKIM, or DMARC findings.

## Severity

CVSS v3.1 as a baseline, escalated for anything that can move or expose funds.

- **Critical:** seed or key extraction, silent redirection of a payment, RCE, or compromise of a
  published artifact (APK, Docker image, dependency)
- **High:** theft of NWC secrets or LNBits keys, bypass of PIN, biometrics, or Kiosk Mode, wrong
  recipient or amount in Batch Send or Auto-Transfer, XSS reaching wallet state
- **Medium:** leakage of balances, history, contacts, or location, weak crypto parameters or
  predictable randomness, CSRF on non-fund-moving actions
- **Low:** limited information disclosure, or issues needing an unlikely chain of preconditions

## Safe Harbor

Research conducted in good faith under this policy is authorised. That means: avoid privacy
violations, data destruction, and service degradation; test only what you own or are authorised to
test; do not access other users' data; no social engineering or physical attacks; give us reasonable
time before disclosing; and comply with applicable law. We will not pursue legal action against
researchers who stay within these lines, and will confirm your authorisation if a third party
questions it.

## Recognition

BuhoGO is community-driven and AGPL-3.0 with no funding behind it, so we cannot offer a cash or sats
bounty. We are honest about that up front rather than implying a payout that will not come.

What we can offer for valid findings:

- Credit in the published advisory, under whatever name, handle, or npub you prefer
- A Nostr shout-out, if you want one
- **Premium access to the tools we build across the Buho Ecosystem**, arranged case by case

If a finding is meaningful to us, reach out and we will work out something that is actually worth
your time.

## Notes for Self-Hosters

Serve over HTTPS with HSTS and a strict CSP. Pull every release, since we publish fixes but you
deploy them. Never expose LNBits admin keys or environment secrets to the browser bundle. Keep the
deployment isolated from any node holding significant funds.

## What BuhoGO Cannot Protect Against

A compromised device. A user who shares their recovery phrase or screen. A malicious LNbits server,
NWC provider, or relay the user chose to connect to. Builds from unofficial sources, so verify APK
signatures. A lost recovery phrase, for which there is no recovery path.

## Verifying a Download

APKs from GitHub releases and Zapstore are signed with this certificate (SHA-256):

```
26:C7:82:AE:11:B1:55:D6:27:9C:B6:72:90:8B:0D:F6:F8:5A:6F:B5:A9:2D:37:88:B1:5B:51:BF:28:D9:C7:EC
```

Check it with `apksigner verify --print-certs BuhoGO_vX.Y.Z.apk`. Google Play delivers its own signed build.

---

For ordinary bugs and feature requests, use [Issues](https://github.com/Buho-Ecosystem/Buho_go/issues)
and [CONTRIBUTING.md](CONTRIBUTING.md).

*Last updated: `2026_10_18`. The version in `main` is authoritative.*
