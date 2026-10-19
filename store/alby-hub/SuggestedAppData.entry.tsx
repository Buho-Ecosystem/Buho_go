// BuhoGO's entry for Alby Hub's app store.
// Goes into getAlby/hub: frontend/src/components/connections/SuggestedAppData.tsx
// Logo: copy buhogo.png (200 × 200) to frontend/src/assets/suggested-apps/buhogo.png

// 1. With the other logo imports, in alphabetical order:
import buhogo from "src/assets/suggested-apps/buhogo.png";

// 2. In appStoreApps, in alphabetical order by id:
    {
      id: "buhogo",
      title: "BuhoGO",
      description: "Bitcoin wallet for every day, on your phone",
      webLink: "https://go.mybuho.de",
      playLink: "https://play.google.com/store/apps/details?id=mybuho.buhogo",
      zapStoreLink: "https://zapstore.dev/apps/mybuho.buhogo",
      logo: buhogo,
      extendedDescription:
        "Pay and get paid from your Hub on your phone, next to your other wallets",
      categories: ["wallet-interfaces"],
      installGuide: (
        <>
          <p className="text-muted-foreground">
            Install{" "}
            <ExternalLink
              to="https://play.google.com/store/apps/details?id=mybuho.buhogo"
              className="font-medium text-foreground underline"
            >
              BuhoGO
            </ExternalLink>{" "}
            on your Android phone, or open{" "}
            <ExternalLink
              to="https://go.mybuho.de"
              className="font-medium text-foreground underline"
            >
              go.mybuho.de
            </ExternalLink>{" "}
            in your browser
          </p>
          <p className="text-muted-foreground">
            Or start in BuhoGO: under{" "}
            <span className="font-medium text-foreground">
              Connect a wallet
            </span>
            , tap <span className="font-medium text-foreground">Alby Hub</span>{" "}
            and approve BuhoGO here, without a code
          </p>
        </>
      ),
      finalizeGuide: (
        <>
          <div>
            <h3 className="font-medium">In BuhoGO</h3>
            <ul className="list-inside list-decimal text-muted-foreground">
              <li>
                Open{" "}
                <span className="font-medium text-foreground">Settings</span>{" "}
                {">"}{" "}
                <span className="font-medium text-foreground">
                  Manage Wallets
                </span>{" "}
                {">"}{" "}
                <span className="font-medium text-foreground">Add Wallet</span>{" "}
                {">"}{" "}
                <span className="font-medium text-foreground">
                  Connect a wallet
                </span>
                . New to BuhoGO? Tap{" "}
                <span className="font-medium text-foreground">
                  More ways to start
                </span>{" "}
                {">"}{" "}
                <span className="font-medium text-foreground">
                  Connect a wallet you already use
                </span>
              </li>
              <li>
                Tap <span className="font-medium text-foreground">Alby Hub</span>
                , then{" "}
                <span className="font-medium text-foreground">
                  Scan a code from your Hub
                </span>
                , and scan the QR code below. On the same phone, tap{" "}
                <span className="font-medium text-foreground">
                  Copy Connection Secret
                </span>{" "}
                here and{" "}
                <span className="font-medium text-foreground">Paste</span> it
                in BuhoGO
              </li>
              <li>
                BuhoGO checks the connection. Tap{" "}
                <span className="font-medium text-foreground">Add wallet</span>
              </li>
            </ul>
          </div>
        </>
      ),
      addedDate: "YYYY-MM-DD",
    },
