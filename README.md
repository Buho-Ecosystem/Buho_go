<div align="center">

<img src="public/buho_logo.png" alt="BuhoGO" width="120">

# BuhoGO

**A clean, open-source Bitcoin & Lightning wallet. Self-custody or bring-your-own.**

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![Live App](https://img.shields.io/badge/Web-go.mybuho.de-15DE72)](https://go.mybuho.de)
[![Google Play](https://img.shields.io/badge/Android-Google%20Play-3DDC84?logo=googleplay&logoColor=white)](https://play.google.com/store/apps/details?id=mybuho.buhogo)
[![Docker](https://img.shields.io/badge/Docker-robinvonmises%2Fbuho__go-2496ED?logo=docker&logoColor=white)](https://hub.docker.com/r/robinvonmises/buho_go)

[**Live App**](https://go.mybuho.de) · [**Guide**](Guide.md) · [**Use Cases**](USE_CASES.md) · [**Developers**](Developer.md) · [**Contribute**](CONTRIBUTING.md)

<img src="https://github.com/user-attachments/assets/a4750386-cf4e-49d5-b1d9-8092b59219c9" alt="BuhoGO header" width="640">

</div>

## What it is

One app, three ways to hold sats:

| Wallet  | Custody         | Best for                                    |
| ------- | --------------- | ------------------------------------------- |
| **Spark**  | Self-custodial  | New users who want full ownership plus on-chain |
| **NWC**    | Connect (Alby, Primal, etc.) | Keep your existing Lightning wallet     |
| **LNBits** | Your server     | Power users running their own node          |

> [!TIP]
> Spark gives you on-chain Bitcoin (L1) deposits and withdrawals, plus zero-fee transfers between Spark users, without channel management.

## Capabilities

|                        | Spark | NWC | LNBits |
| ---------------------- | :---: | :-: | :----: |
| Pay Lightning invoice  |   Yes  |  Yes  |    Yes   |
| Pay Lightning address  |   Yes  |  Yes  |    Yes   |
| LNURL pay / withdraw   |   Yes  |  Yes  |    Yes   |
| Receive Lightning      |   Yes  |  Yes  |    Yes   |
| Spark to Spark (zero-fee) |  Yes  |  No  |    No   |
| On-chain Bitcoin (L1)  |   Yes  |  No  |    No   |

## Beyond send and receive

- **Kiosk Mode**: turn any device into a PIN-locked POS terminal with tips, round-up, and fiat display
- **Batch Send**: pay many contacts in one flow
- **Auto-Transfer**: threshold-based payouts (e.g. sweep your POS to cold storage)
- **Internal Transfer**: move funds between your own wallets
- **Address Book**: contacts with Lightning, Spark, or BTC addresses
- **Deep links**: handles `lightning:`, `bitcoin:`, `lnurlp://`, `lnurlw://`
- **Biometric unlock**, dark/light themes, EN / DE / ES

## Screenshots

<table>
<tr>
<td align="center"><img src="public/Spark_images/Home_Black.png" width="220"><br><sub>Dark mode</sub></td>
<td align="center"><img src="public/Spark_images/Home_Light.png" width="220"><br><sub>Light mode</sub></td>
<td align="center"><img src="public/Settings_images/BuhoGO_Start_Choose_Wallet.png" width="220"><br><sub>Welcome</sub></td>
</tr>
<tr>
<td align="center"><img src="public/create_send.png" width="220"><br><sub>Send / receive</sub></td>
<td align="center"><img src="public/Spark_images/TX_List_1.png" width="220"><br><sub>Transactions</sub></td>
<td align="center"><img src="public/Spark_images/CreateSeed_3.png" width="220"><br><sub>Wallet ready</sub></td>
</tr>
</table>

## Run it

```bash
git clone https://github.com/Buho-Ecosystem/Buho_go.git
cd Buho_go && npm install && npm run dev
```

Open `http://localhost:9000`.

<details>
<summary><b>Production / Android builds</b></summary>

```bash
# Web (output: dist/spa)
npm run build

# Android APK
quasar build -m capacitor -T android
# ...or open in Android Studio
quasar build -m capacitor -T android --ide
```
</details>

## Security in one paragraph

Spark seeds are encrypted with **AES-256-GCM** using a per-device key (PBKDF2, 100k iterations). Private keys never leave the device. NWC strings and LNBits API keys are stored locally only. No server holds your secrets, ever.

## Tech

`Vue 3` · `Quasar` · `Pinia` · `Vite` · `@buildonspark/spark-sdk` · `@getalby/sdk` · `LNBits REST` · `Capacitor`

## Documentation

| Doc | For |
| --- | --- |
| [**Guide.md**](Guide.md) | Users: setup, sending, receiving, kiosk |
| [**USE_CASES.md**](USE_CASES.md) | Anyone: "I want to do X" then how |
| [**Developer.md**](Developer.md) | Hackers: architecture, providers, builds |
| [**CONTRIBUTING.md**](CONTRIBUTING.md) | First-timers and pros: how to help |

## License

[AGPL-3.0](LICENSE). Built for Bitcoiners, by Bitcoiners.
