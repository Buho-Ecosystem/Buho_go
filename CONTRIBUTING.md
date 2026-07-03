<div align="center">

# 🦉 Help Build BuhoGO

**BuhoGO is built by people who care, not just people who code.**
*You do not need to be a Bitcoin dev. You do not need to know Vue. You just need to want to help.*

[← README](README.md) · [Developer Guide](Developer.md) · [Open Issues](https://github.com/Buho-Ecosystem/Buho_go/issues)

</div>

---

> [!NOTE]
> **Here to write code?** Welcome. Jump straight to the **[Developer Guide](Developer.md)** for setup, architecture, and the build. The rest of this page is for everyone, coders included.

---

## 🙌 You do not have to be a developer

Some of the most valuable things BuhoGO needs have nothing to do with code. If any of these sound like you, you are exactly who we are looking for.

| You could help with… | What that looks like |
| --- | --- |
| 📣 **Marketing** | Spread the word, post about BuhoGO, help people discover self-custody Bitcoin |
| ✍️ **Writing** | Blog posts, guides, "how I use BuhoGO" stories, clearer wording in the app |
| 🎬 **Video** | A short demo, a setup walkthrough, a "pay with Bitcoin" clip people can share |
| 🌍 **Travelling with BuhoGO** | Pay in the real world, photograph the moment, tell us where it worked (or did not) |
| 🗺️ **The Bitcoin map** | Add or correct places that take Bitcoin near you |
| 🛠️ **Community tools** | Build something useful around BuhoGO and share it with everyone |
| 🌐 **Translation** | Bring BuhoGO to your language |
| 🎨 **Design eyes** | Spot rough edges, suggest better icons, flag awkward copy |

> [!TIP]
> Not sure where you fit? [Open an issue](https://github.com/Buho-Ecosystem/Buho_go/issues/new) and say hello. We will help you find a spot.

---

## 🪜 The 5-minute to 5-week ladder

Pick the rung that fits your day. **Every rung counts.**

| ⏱️ Time | 🎯 Contribution | 🧰 Skills |
| --- | --- | --- |
| **5 min** | ⭐ Star the repo · 🐛 Open an issue with a bug or idea | None |
| **15 min** | ✍️ Fix a typo · improve wording · suggest a use case | Read English |
| **1 hour** | 🌍 Translate a screen · 📣 Post about BuhoGO · 🗺️ Add map places | Your language and time |
| **An evening** | 🎬 Record a short demo · ✍️ Write a guide or story | Storytelling |
| **A weekend** | 🚀 Build a feature · add a wallet integration | Vue + JS |
| **A month** | 🏛️ Architect something big (iOS, new wallet type, …) | Senior dev |

> [!TIP]
> **The smallest valid contribution is a typo fix.** Genuinely. We merge those. Start there if you have never opened a PR.

---

## 📣 Marketing, writing, and video

This is real work and we are grateful for it.

- **Made a video or wrote something?** Share the link in an [issue](https://github.com/Buho-Ecosystem/Buho_go/issues/new) so we can boost it.
- **Travelling and paying with BuhoGO?** Photos and short stories of Bitcoin in the wild are gold. Tell us the place, the country, and how it felt.
- **Have a marketing idea or a reach you can lend?** Open a Discussion. We love teaming up.
- **Built a community tool** on top of BuhoGO? Tell us about it and we will help point people to it.

No pull request needed for any of this. A link and a short note is plenty.

---

## 🌍 Translators wanted

BuhoGO ships in **English, German, and Spanish** today. Want your language next? You are 80% of the way there:

1. Copy `src/i18n/en-US/index.js` to `src/i18n/<your-locale>/index.js`
2. Translate the values (keep the keys)
3. Register the locale in `src/boot/i18n.js`
4. Open a pull request. Even a partial translation is useful

> [!CAUTION]
> In i18n strings, write a literal `@` as `{'@'}`, otherwise it breaks the Android build.

Not comfortable with the files? Translate the text in an issue and we will wire it in for you.

---

## 🐛 Reporting bugs that get fixed

A great bug report is half the fix. Include:

- **What you did** (3 lines max)
- **What happened** vs **what you expected**
- **Wallet type**: Spark, NWC, or LNBits
- **Platform**: web (which browser?), Android version, app version
- **A screenshot or screen recording** if it is visual

[→ Open a bug](https://github.com/Buho-Ecosystem/Buho_go/issues/new)

---

## 💡 Suggesting features

Before anyone builds a 2,000-line pull request, **open an issue first** describing:

1. **The problem**: who hurts, when, and why?
2. **A sketch** of the solution (rough, not final)
3. **Alternatives** you considered

We align on direction before code gets written. It saves everyone a wasted weekend.

---

## 🔨 For developers

Full setup and architecture live in the **[Developer Guide](Developer.md)**. The essentials:

> [!TIP]
> **Looking for high-impact work?** We are bringing a new **Arkade (Ark L2)** wallet to BuhoGO ([PR #177](https://github.com/Buho-Ecosystem/Buho_go/pull/177)). It is written and building, and it needs real-device testing, a couple of SDK decisions, and polish. Read **[ARK_ME.md](ARK_ME.md)** to jump in. You do not need to be a developer to help test it.

<details open>
<summary><b>📦 Quick start</b></summary>

```bash
git clone https://github.com/Buho-Ecosystem/Buho_go.git
cd Buho_go
npm install
npm run dev    # http://localhost:9000
```

</details>

<details>
<summary><b>🌱 First pull request</b></summary>

```
1. Fork           →  click Fork on GitHub
2. Clone          →  git clone https://github.com/<you>/Buho_go.git
3. Branch         →  git checkout -b fix/typo-on-welcome
4. Run            →  npm install && npm run dev
5. Change ONE thing
6. Commit         →  git commit -m "fix: typo on welcome screen"
7. Push & PR      →  open a pull request against the `dev` branch
```

Feature and fix pull requests target **`dev`**. The `main` branch tracks the released, clean state. One thing per pull request.

</details>

<details>
<summary><b>✅ Before you push</b></summary>

- [ ] Tested on **dark and light** themes
- [ ] Tested on **at least one** wallet type (Spark, NWC, or LNBits)
- [ ] If you touched a flow used in **kiosk mode**, retested kiosk
- [ ] No `console.log` of mnemonics, PINs, API keys, or NWC strings, ever
- [ ] Screenshot or short clip in the pull request if it is visual

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

> [!IMPORTANT]
> **Working on anything Nostr-related?** Use [nostr-core](https://nostr-core.netlify.app/) first, never `nostr-tools`. If a helper you need is missing, open a PR on nostr-core and mention it is for BuhoGO, and we will pull it in quickly.

### ✅ Gets your pull request merged faster

- **Small.** One thing per pull request. A 30-line change is reviewed in minutes.
- **Screenshots.** If it is visible, show it. Before and after is even better.
- **Both themes tested.** Half of design bugs hide in light mode.
- **No new dependencies** unless you explain why.
- **Match existing patterns.** Look at neighbouring code first.

### 🚫 Slows it down

- Reformatting unrelated files.
- Adding new tooling, linters, or abstractions without asking.
- Refactors bundled with features ("while I was here…").
- Unannounced breaking changes to wallet storage formats.

---

## 💬 Talking to humans

- **Bugs and features** → [GitHub Issues](https://github.com/Buho-Ecosystem/Buho_go/issues)
- **Questions about a pull request** → comment on it
- **Bigger ideas, marketing, or partnerships** → open a Discussion

We try to respond within a few days. Ping politely if it has been longer than a week.

---

## 📜 License and DCO

By contributing code you agree it ships under [**AGPL-3.0**](LICENSE), the same as the rest of BuhoGO. Do not paste proprietary code you do not have the rights to.

---

<div align="center">

### 🦉 Thank you for considering to help BuhoGO!

**Code, words, video, a place on the map, or just telling a friend. It all moves us forward.**

[Browse good first issues →](https://github.com/Buho-Ecosystem/Buho_go/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)

</div>
</content>
