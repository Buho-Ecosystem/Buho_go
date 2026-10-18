# MoneyBadger / CryptoQR Integration Plan for BuhoGO

## Status

- ✅ **Phase 1 — "PnP Path" (EMVCo QR → Lightning Address via cryptoqr.net): shipped.** Lives in `src/utils/merchantQR.js`, wired into `SendModal.vue` and `Wallet.vue`. Merchant detection, regex matching, ZAR amount parsing all live.
- ⏳ **Phase 2 — Full MoneyBadger Scanner API:** pending. Requires API key from `info@moneybadger.co.za` and the partnership conversation.

---

## Overview

Integrate MoneyBadger's CryptoQR payment system into BuhoGO, enabling users to pay at South African retail stores (Pick n Pay, etc.) by scanning legacy POS QR codes. The system translates proprietary retail QR codes into Lightning Address payments via MoneyBadger's `cryptoqr.net` backend.

## How It Works

```
[BuhoGO - Client Side]                    [MoneyBadger - Service Side]

1. User scans retail POS QR code
2. Regex matches known merchant pattern
3. URL-encode QR content
4. Form Lightning Address:
   {encoded_qr}@cryptoqr.net        --->  5. Resolves Lightning Address (LNURL-pay)
                                           6. Generates BOLT11 invoice (ZAR → sats)
                                    <---   7. Returns invoice to wallet
8. Pay invoice via existing
   Lightning Address flow
```

**Important:** `cryptoqr.net` is MoneyBadger's proprietary backend. The client-side regex/encoding is open, but every payment resolves through their infrastructure. Partnership or API agreement may be required.

## Domains

| Environment | Domain |
|---|---|
| Mainnet | `cryptoqr.net` |
| Staging/Test | `staging.cryptoqr.net` |

## MoneyBadger API (E-Commerce)

Base URLs:
- Production: `https://api.cryptoqr.co.za/api/v2`
- Staging: `https://api.staging.cryptoqr.co.za/api/v2`

Authentication: `X-API-Key` header (obtained from MoneyBadger)

Key endpoints:
- `GET /invoices/{invoiceID}` — Retrieve invoice status
- `POST /invoices/{invoiceID}/confirm` — Confirm authorized payment

Full API docs are private, available after requesting API keys from `info@moneybadger.co.za`.

---

## Supported Merchant QR Patterns

Each merchant QR pattern maps to a known South African payment provider. When matched, BuhoGO can display the corresponding merchant logo in the payment flow and transaction history.

| Merchant / Provider | Regex Pattern | Logo Required |
|---|---|---|
| **Pick n Pay** | `.*za\.co\.electrum\.picknpay.*` | Yes |
| **Ecentric** | `.*za\.co\.ecentric.*` | Yes |
| **Zapper** | `.*zapper\.com.*`, `.*\.zap\.pe.*`, `SK-\d{1,}-\d{23}`, `\d{20}` | Yes |
| **Scan to Pay** | `.*scantopay\.io.*`, `.*payat\.io.*`, `.*\.oltio\.co\.za.*` | Yes |
| **SnapScan** | `.*snapscan.*` | Yes |
| **Yoyo** | `.*yoyogroup\.co.*` | Yes |
| **Wigroup** | `.*\.wigroup\..*` | Yes |
| **Netcash / SagePay** | `.*paynow\.netcash\|paynow\.sagepay\.co\.za.*` | Yes |
| **Transaction Junction** | `.*transactionjunction\.co\.za.*` | Yes |
| **Electrum (generic)** | `.*za\.co\.electrum(?!\.picknpay).*` | Yes |
| **EasyPay / UMPQR** | `.*easypay.*`, `.*UMPQR.*` | Yes |
| **CryptoQR (native)** | `.*cryptoqr\.net.*` | Yes (MoneyBadger logo) |

## Merchant Branding in BuhoGO

When a scanned QR matches a known merchant pattern, BuhoGO should:

1. **Payment screen:** Show the matched merchant logo + name alongside the payment amount
2. **Transaction history:** Tag the transaction with the merchant identity and logo
3. **Confirmation screen:** Display "Paying at Pick n Pay" (or matched merchant) for user confidence

### Proposed merchant config structure

```javascript
const merchantConfigs = [
  {
    id: 'picknpay',
    name: 'Pick n Pay',
    logo: 'merchants/picknpay.svg',
    identifierRegex: /.*za\.co\.electrum\.picknpay.*/,
    domain: {
      mainnet: 'cryptoqr.net',
      staging: 'staging.cryptoqr.net'
    }
  },
  // ... additional merchants
]
```

### Logo assets needed

- Pick n Pay
- Ecentric
- Zapper
- Scan to Pay
- SnapScan
- Yoyo
- Wigroup
- Netcash / SagePay
- Transaction Junction
- Electrum
- EasyPay
- MoneyBadger / CryptoQR

---

## ~~Implementation Touchpoints in BuhoGO~~ ✅ Phase 1 done

> Phase 1 conversion landed in `src/utils/merchantQR.js`, consumed by `SendModal.vue` (QR scan handler) and `Wallet.vue` (deep-link / paste path). Phase 2 will reuse the same touchpoints.

### ~~Files to modify~~

| File | ~~Change~~ |
|---|---|
| ~~`src/utils/`~~ | ~~New `merchantQR.js` — regex matching + Lightning Address conversion~~ |
| ~~`src/components/SendModal.vue`~~ | ~~Add merchant QR detection in QR scan handler~~ |
| ~~`src/utils/lightning.js`~~ | ~~Already handles Lightning Addresses — no changes expected~~ |
| ~~`src/components/PaymentModal.vue`~~ | ~~Show merchant logo/name on confirmation~~ |
| ~~`src/pages/TransactionHistory.vue`~~ | ~~Display merchant branding on matched transactions~~ |
| ~~`src/stores/transactionMetadata.js`~~ | ~~Store merchant identity with transaction~~ |
| ~~`src/assets/merchants/`~~ | ~~New directory for merchant logo SVGs~~ |

### ~~Core conversion function~~

```javascript
// Shipped — see src/utils/merchantQR.js for the actual implementation.
function convertMerchantQRToLightningAddress(qrContent, network = 'mainnet') {
  if (!qrContent) return null
  for (const merchant of merchantConfigs) {
    const match = qrContent.match(merchant.identifierRegex)
    if (match) {
      const domain = merchant.domain[network] || merchant.domain.mainnet
      return {
        lightningAddress: `${encodeURIComponent(qrContent)}@${domain}`,
        merchant: {
          id: merchant.id,
          name: merchant.name,
          logo: merchant.logo
        }
      }
    }
  }
  return null
}
```

---

## Reference Implementations

| Wallet | Source |
|---|---|
| Zeus | [PR #3436](https://github.com/ZeusLN/zeus/pull/3436) — `utils/handleAnything.ts` |
| Blink/Galoy | [PR #331](https://github.com/GaloyMoney/galoy-client/pull/331) — `src/parsing/merchants.ts` |
| MoneyBadger WooCommerce | [GitHub](https://github.com/MoneyBadgers/moneybadger-woocommerce) |


---

## Notes

- BuhoGO already handles Lightning Addresses and LNURL-pay, so the core payment flow requires no new protocol support
- The main work is QR detection, merchant branding, and UX
- Currency: MoneyBadger operates in ZAR; the invoice amount in sats is determined by their backend at current exchange rates
- Failed POS transactions: the terminal resets after 90 seconds; Lightning payments return within minutes
