<div align="center">

# 🦉 Help Build BuhoGO

**Every wallet, button, and translation in BuhoGO was contributed by someone like you.**
*You don't need to be a Bitcoin dev. You don't need to know Vue. You just need to care.*

[← README](README.md) · [Developer Guide](Developer.md) · [Open Issues](https://github.com/Buho-Ecosystem/Buho_go/issues)

</div>

---

## 🪜 The 5-minute → 5-week ladder

Pick the rung that fits your day. **Every rung counts.**

| ⏱️ Time     | 🎯 Contribution                                         | 🧰 Skills          |
| ----------- | ------------------------------------------------------- | ------------------ |
| **5 min**   | ⭐ Star the repo · 🐛 Open an issue with a bug or idea  | None               |
| **15 min**  | ✍️ Fix a typo · improve wording · suggest a use case   | Read English       |
| **1 hour**  | 🌍 Translate a string into your language               | Bilingual          |
| **An evening** | 🎨 Tweak a color / icon · improve a small UX detail   | A bit of Vue / CSS |
| **A weekend**  | 🚀 Build a new feature · add a wallet integration     | Vue + JS           |
| **A month**    | 🏛️ Architect something big (iOS, new wallet type, …) | Senior dev         |

> [!TIP]
> **Smallest valid contribution: a typo fix.** Genuinely. We merge those. Start there if you've never opened a PR.

---

## 🟢 First-time contributors — start here

You picked the right project. Here's the path of least resistance:

```
1. Fork           →  click Fork on GitHub
2. Clone          →  git clone https://github.com/<you>/Buho_go.git
3. Branch         →  git checkout -b fix/typo-on-welcome
4. Run            →  npm install && npm run dev
5. Change ONE thing
6. Commit         →  git commit -m "fix: typo on welcome screen"
7. Push & PR      →  open a PR to main with a screenshot if it's visual
```

That's it. We'll review it. If something needs adjusting we'll **suggest** the change — not gatekeep.

> [!NOTE]
> Look for issues tagged [`good first issue`](https://github.com/Buho-Ecosystem/Buho_go/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) — they're scoped for newcomers.

---

## 🌍 Translators wanted

BuhoGO ships in **EN / DE / ES** today. Want your language next? You're 80% of the way there:

1. Copy `src/i18n/en-US/index.js` to `src/i18n/<your-locale>/index.js`
2. Translate the values (keep the keys)
3. Register the locale in `src/boot/i18n.js`
4. Open a PR — even partial translations are useful

> [!CAUTION]
> In i18n strings, write a literal `@` as `{'@'}` — otherwise it breaks the Android build.

---

## 🐛 Reporting bugs that get fixed

A great bug report = a fixed bug. Include:

- **What you did** (3 lines max)
- **What happened** vs **what you expected**
- **Wallet type** — Spark / NWC / LNBits
- **Platform** — Web (browser?), Android version, app version
- **Screenshot or screen recording** if visual

[→ Open a bug](https://github.com/Buho-Ecosystem/Buho_go/issues/new)

---

## 💡 Suggesting features

Before you build a 2,000-line PR, **open an issue first** describing:

1. **The problem** — who hurts, when, why?
2. **A sketch** of the solution (rough, not final)
3. **Alternatives** you considered

We'll align on direction before you write code. Saves everyone from wasted weekends.

---

## 🔨 Code contributions — the cheat sheet

<details open>
<summary><b>📦 Setup</b></summary>

```bash
git clone https://github.com/Buho-Ecosystem/Buho_go.git
cd Buho_go
npm install
npm run dev    # http://localhost:9000
```

For Android: `quasar build -m capacitor -T android --ide`.

</details>

<details>
<summary><b>🧭 Where things live</b></summary>

| Want to change…              | File / folder                       |
| ---------------------------- | ----------------------------------- |
| Send/receive UI              | `src/components/{Send,Receive}Modal.vue` |
| Kiosk POS                    | `src/pages/KioskDashboard.vue`      |
| Settings screen              | `src/pages/Settings.vue`            |
| Wallet logic (any type)      | `src/providers/*WalletProvider.js`  |
| App-wide state               | `src/stores/wallet.js`              |
| Colors / theme               | `src/css/app.css`                   |
| Strings / translations       | `src/i18n/<locale>/index.js`        |

Full architecture: [Developer.md](Developer.md).

</details>

<details>
<summary><b>✅ Before you push</b></summary>

- [ ] Tested on **dark and light** themes
- [ ] Tested on **at least one** wallet type (Spark / NWC / LNBits)
- [ ] If you touched a flow used in **kiosk mode**, retested kiosk
- [ ] No `console.log` of mnemonics / PINs / API keys / NWC strings — *ever*
- [ ] Screenshot or short clip in the PR if it's visual

</details>

<details>
<summary><b>📝 Commit messages</b></summary>

Short, present-tense, conventional-ish:

```
fix: prevent kiosk PIN dialog from closing on outside tap
feat(spark): show pending L1 deposits in receive sheet
i18n(es): translate batch-send wizard
chore: bump @buildonspark/spark-sdk to 0.x.y
```

</details>

---

## 🧠 Things that will get your PR merged faster

✅ **Small.** One thing per PR. A 30-line PR is reviewed in 5 minutes.
✅ **Screenshots.** If it's visible, show it. Before / after even better.
✅ **Tested both themes.** Half of design bugs hide in light mode.
✅ **No new dependencies** unless you explain why.
✅ **Match existing patterns.** Look at neighbouring code first.

## 🚫 Things that slow it down

❌ Reformatting unrelated files.
❌ Adding new tooling / linters / abstractions without asking.
❌ Refactors bundled with features ("while I was here…").
❌ Unannounced breaking changes to wallet storage formats.

---

## 🎨 Design contributions

Not a coder? **We need design eyes.**

- Spot misaligned components on small screens? Open an issue with a screenshot.
- Got a better icon? Drop it in an issue.
- See an em-dash, awkward copy, or AI-sounding text? Flag it — we cut those.

---

## 💬 Talking to humans

- **Bugs / features** → [GitHub Issues](https://github.com/Buho-Ecosystem/Buho_go/issues)
- **Questions about a PR** → comment on the PR
- **Bigger ideas** → open a Discussion before coding

We try to respond within a few days. Ping politely if it's been longer than a week.

---

## 📜 License & DCO

By contributing you agree your code ships under [**AGPL-3.0**](LICENSE) — same as the rest of BuhoGO. Don't paste proprietary code you don't have rights to.

---

<div align="center">

### 🦉 That's it. Pick a rung. Climb on.

**The best PR is the one you actually open.**

[Browse good-first-issues →](https://github.com/Buho-Ecosystem/Buho_go/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)

</div>
