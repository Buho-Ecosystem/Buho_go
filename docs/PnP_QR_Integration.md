# PnP QR Code Integration - TLDR

## What is this?

South African retailers (Pick n Pay, Checkers, Shoprite, Woolworths, etc.) display QR codes at checkout. MoneyBadger (cryptoqr.net) bridges these retail QR codes to Lightning, so Bitcoin wallets can pay at the till. The merchant always receives ZAR (fiat) - they never touch sats.

```
Your wallet (sats) --> MoneyBadger (converts) --> Merchant (receives ZAR)
```

---

## Path 1: PnP Path (implemented)

**How it works:** Convert the retail QR code into a Lightning address via cryptoqr.net.

```
Scan QR --> encode as {payload}@cryptoqr.net --> resolve LNURL --> pay Lightning invoice
```

| | |
|---|---|
| API key needed? | No |
| Partnership needed? | No |
| Works today? | Yes |
| Retailers supported | PnP, Checkers, Shoprite, Woolworths (EMVCo QR codes) |
| Tipping | No |
| Variable amounts | No |
| Merchant name display | No (just lightning address) |

**Pros:** Zero dependencies, works immediately, no registration.
**Cons:** Limited to EMVCo QR retailers, no merchant metadata, no tipping.

---

## Path 2: MoneyBadger Scanner API (future)

**How it works:** Send the QR data to MoneyBadger's API, get back merchant info + Lightning invoice.

```
Scan QR --> GET /scan (metadata) --> show merchant UI --> POST /scan --> pay Lightning invoice
```

| | |
|---|---|
| API key needed? | Yes (provided by MoneyBadger) |
| Partnership needed? | Yes |
| Works today? | No - need to contact MoneyBadger |
| Retailers supported | ALL (PnP, Checkers, Zapper, SnapScan, ScanToPay, etc.) |
| Tipping | Yes |
| Variable amounts | Yes |
| Merchant name display | Yes (name, location, category) |

**Pros:** Full retailer coverage, rich UX (tips, merchant info, order refs).
**Cons:** Requires MoneyBadger partnership and API key.

---

## Decision

Ship Path 1 now. If users demand tipping, SnapScan/Zapper support, or merchant info, then pursue MoneyBadger partnership for Path 2.

---

## India - Is this possible?

### Short answer: Not the same way. No MoneyBadger equivalent exists for India (yet).

### The landscape

India uses **UPI (Unified Payments Interface)** for QR payments. UPI QR codes are everywhere - from street vendors to major chains. There are **678 million+ merchant QR codes** in India.

However, there is **no production-ready bridge** that lets a Lightning wallet scan a UPI QR and pay a merchant in INR the way MoneyBadger does for ZAR in South Africa.

### What exists today

| Service | What it does | Limitation |
|---|---|---|
| [Pursa.co](https://pursa.co) | Converts Bitcoin <-> INR via Lightning UPI. P2P exchange, no KYC. | Not merchant QR scanning. It's a manual exchange - you sell BTC and receive INR to a UPI ID. Not real-time POS. |
| [Lightspark](https://www.lightspark.com/knowledge/real-time-payments-india) | Writes about Lightning as cross-border bridge for UPI | Theoretical/infrastructure level, not a consumer product. |

### What would be needed

For India to work like South Africa, someone would need to build:
1. **Merchant agreements** with Indian retailers to accept crypto at POS
2. **A bridge service** (like MoneyBadger) that receives sats and settles INR to merchants
3. **UPI QR parsing** to detect and convert merchant QR codes
4. **RBI compliance** - India's central bank has strict crypto regulations

### Opportunity

India has the infrastructure (UPI is massive) and the QR culture. The missing piece is the MoneyBadger-equivalent company with merchant agreements and fiat settlement. If your friend is interested, this is essentially what MoneyBadger built for South Africa - but for the Indian market. It's a business opportunity, not a technical blocker.

### Realistic near-term option

A simpler approach for India: Lightning-to-UPI P2P payments using services like Pursa. User sends sats, recipient gets INR in their UPI wallet. This works today but is P2P (person-to-person), not POS (point-of-sale).
