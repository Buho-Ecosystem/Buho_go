# BuhoGO User Guide

This guide walks you through everything you need to know to use BuhoGO for your Bitcoin Lightning payments.

Back to [README](README.md) | For developers: [Developer Guide](Developer.md)

<br>

## Table of Contents

1. [Choosing Your Wallet Type](#choosing-your-wallet-type)
2. [Setting Up a Spark Wallet](#setting-up-a-spark-wallet)
3. [Connecting an NWC Wallet](#connecting-an-nwc-wallet)
4. [Connecting an LNBits Wallet](#connecting-an-lnbits-wallet)
5. [Receiving Bitcoin](#receiving-bitcoin)
6. [Sending Bitcoin](#sending-bitcoin)
7. [On-Chain Bitcoin (L1)](#on-chain-bitcoin-l1)
8. [Transaction History](#transaction-history)
9. [Managing Contacts](#managing-contacts)
10. [Switching Wallets](#switching-wallets)
11. [Settings and Preferences](#settings-and-preferences)
12. [Troubleshooting](#troubleshooting)

<br>

## Choosing Your Wallet Type

BuhoGO supports three types of wallets. Choose the one that fits your needs. See the [feature comparison table](README.md#payment-capabilities) for a quick overview.

### Spark Wallet

Best for users who want full control over their Bitcoin.

**Advantages**
- Self-custodial: You hold the keys
- Zero-fee transfers to other Spark users
- Works offline for viewing balance
- Single seed phrase backs up everything
- On-chain Bitcoin (L1) receive and send support

**Considerations**
- Requires secure backup of seed phrase
- PIN required each session
- Limited to one Spark wallet per app

### NWC Wallet

Best for users who already have a Lightning wallet they want to use.

**Advantages**
- Connect your existing wallet (Alby, Primal, etc.)
- No seed phrase to manage
- Multiple wallets supported
- Quick setup with QR code

**Considerations**
- Depends on external wallet availability
- Features limited by connected wallet capabilities
- Cannot send to Spark addresses

### LNBits Wallet

Best for users who run their own LNBits instance or want direct API access.

**Advantages**
- Connect to any LNBits server
- Full control via Admin API key
- Self-hosted option for maximum privacy
- Multiple wallets supported
- Works with any LNBits-compatible backend

**Considerations**
- Requires LNBits server URL and Admin API key
- Cannot send to Spark addresses
- No fee estimation (fees handled by LNBits backend)

<br>

## Setting Up a Spark Wallet

### Step 1: Start Wallet Creation

Open BuhoGO and tap "Create Wallet" on the welcome screen.

<img src="public/Spark_images/AddNew_Wallet.png" alt="Add New Wallet" width="280">

### Step 2: Save Your Seed Phrase

You will see 12 words displayed on screen. These words are your **only way** to recover your wallet.

<img src="public/Spark_images/CreateSeed_1.png" alt="Create Seed Phrase" width="280">

**Important**:
- Write these words down on paper in the exact order shown
- Store them in a secure, offline location
- Never store them digitally, take screenshots, or share them with anyone
- Anyone with these words can access your Bitcoin

**We cannot recover your phrase if you lose it.** Your funds are entirely in your hands.

### Step 3: Verify Your Backup

The app will show all 12 words shuffled in random order. You must tap each word in the correct sequence (1-12) to prove you've properly recorded your backup.

<img src="public/Spark_images/CreateSeed_2.png" alt="Verify Seed Phrase" width="280">

**How it works:**
- Tap the first word of your seed phrase
- A green badge with "1" appears on that word
- Continue tapping words in order (2, 3, 4... up to 12)
- If you tap the wrong word, you'll see a red badge and an error message
- Use "Show me again" if you need to go back and check your written backup

Once all 12 words are selected correctly, you'll see a success message reminding you to store your phrase safely.

### Step 4: Create Your PIN

Enter a 6-digit PIN, then confirm it. This PIN protects your wallet and is required to:

- Unlock the wallet on app launch
- View your seed phrase in settings
- Sign transactions

Choose a PIN you can remember but others cannot guess.

### Step 5: Done

Your wallet is now ready. You will be taken to the main wallet screen where you can start receiving and sending Bitcoin.

<img src="public/Spark_images/CreateSeed_3.png" alt="Wallet Ready" width="280">

<img src="public/Spark_images/Home_Black.png" alt="Home Dark" width="280"> <img src="public/Spark_images/Home_Light.png" alt="Home Light" width="280">

<br>

## Connecting an NWC Wallet

### What is NWC?

Nostr Wallet Connect (NWC) is a protocol that lets apps communicate with Lightning wallets. Many popular wallets support NWC including Alby, Mutiny, and others.

### Getting Your NWC Connection String

1. Open your existing Lightning wallet
2. Look for "Nostr Wallet Connect" or "NWC" in settings
3. Create a new connection for BuhoGO
4. Copy the connection string (starts with `nostr+walletconnect://`)

### Connecting in BuhoGO

1. Open BuhoGO and tap "Connect Wallet"
2. Either paste your NWC string or tap the QR icon to scan
3. Give your wallet a name for easy identification
4. Tap "Connect"

Your wallet balance and info will appear once connected.

### Adding More NWC Wallets

You can connect multiple NWC wallets:

1. Go to Settings
2. Tap "Add Wallet"
3. Follow the same connection steps

<br>

## Connecting an LNBits Wallet

### What is LNBits?

LNBits is an open-source Lightning accounts system that can run on top of various Lightning backends. It provides a simple API for wallet operations and can be self-hosted or used via public instances.

### Getting Your LNBits Credentials

1. Log in to your LNBits instance (e.g., `https://demo.lnbits.com` or your self-hosted server)
2. Open your wallet
3. Click on "API Info" in the wallet menu
4. Copy the following:
   - **Server URL**: The base URL of your LNBits instance
   - **Admin Key**: Your wallet's Admin API key (required for full access)

**Important**: The Admin Key gives full access to your wallet. Never share it publicly.

### Connecting in BuhoGO

1. Open BuhoGO and tap "Connect Wallet"
2. Select "LNBits" from the wallet options
3. Enter a name for your wallet
4. Enter your LNBits server URL (e.g., `https://demo.lnbits.com`)
5. Enter your Admin API key
6. Tap "Connect"

Your wallet balance will appear once connected successfully.

### Supported LNBits Features

- **Check Balance**: View your current wallet balance
- **Send Payments**: Pay Lightning invoices and Lightning addresses
- **Receive Payments**: Generate Lightning invoices
- **Transaction History**: View past payments and receipts

### Adding More LNBits Wallets

You can connect multiple LNBits wallets (from same or different servers):

1. Go to Settings
2. Tap "Add Wallet"
3. Select "LNBits"
4. Follow the same connection steps

<br>

## Receiving Bitcoin

### Using Lightning Invoice (All Wallets)

Lightning invoices are the standard way to receive Bitcoin on the Lightning Network.

1. Tap the "Receive" button on the wallet screen
2. Enter the amount you want to receive (in sats)
3. Optionally add a description
4. Tap "Create Invoice"
5. Share the QR code or copy the invoice string

The invoice expires after a set time (usually 1 hour). If not paid before expiry, create a new one.

### Using Spark Address (Spark Wallet Only)

Spark addresses allow you to receive instant, zero-fee payments from other Spark users.

1. Tap the "Receive" button
2. Toggle to "Spark Address" view
3. Share the QR code or copy the address

Your Spark address never changes and does not expire. Anyone with a Spark wallet can send to it without fees.

**Tip**: Your Spark address starts with `sp1` (mainnet) or `tsp1` (testnet).

<br>

## Sending Bitcoin

### Using the QR Scanner

The fastest way to pay:

1. Tap the "Send" button
2. Point your camera at the payment QR code
3. Confirm the amount and details
4. Tap "Send"

### Manual Entry

1. Tap the "Send" button
2. Tap the paste icon or type the payment destination
3. The app detects the payment type automatically:
   - Lightning invoice (`lnbc...`)
   - Lightning address (`name@domain.com`)
   - Spark address (`sp1...`) - Spark wallet only
   - LNURL (`lnurl...`)

### Using Contacts

1. Tap the "Send" button
2. Scroll down to see your saved contacts
3. Tap a contact to start a payment

**Note**: Contacts with Spark addresses show a badge and require a Spark wallet to pay.

### Payment Confirmation

Before sending, you will see:
- Recipient address or invoice
- Amount in sats and your local currency
- Network fee (if applicable)

Review these details carefully before confirming.

<br>

## On-Chain Bitcoin (L1)

Spark wallets support receiving and sending on-chain Bitcoin (Layer 1). This allows you to interact directly with the Bitcoin blockchain.

### Receiving On-Chain Bitcoin

Use this when someone wants to send you Bitcoin from an exchange, hardware wallet, or any on-chain source.

<img src="public/L1_images/L1_Claim_recive.png" alt="L1 Receive Address" width="280">

1. Tap the "Receive" button on the wallet screen
2. Switch to the "Bitcoin" tab
3. Share your Bitcoin address (starts with `bc1p...`)
4. The sender can scan the QR code or copy the address

**Important Notes:**
- Your Bitcoin address is reusable — you can receive multiple deposits to the same address
- Deposits require 3 confirmations before they can be claimed (typically 30 minutes)
- There is a small network fee when claiming deposits

### Tracking Incoming Deposits

When Bitcoin is sent to your address, you'll see it appear as a pending deposit.

<img src="public/L1_images/L1_Incoming_Detected.png" alt="L1 Incoming Detected" width="280"> <img src="public/L1_images/L1_Claim_Pending.png" alt="L1 Claim Pending" width="280">

The deposit shows:
- Amount received
- Confirmation progress (0/3, 1/3, 2/3, 3/3)
- Status indicator

You can also see pending deposits in your transaction list.

<img src="public/L1_images/L1_incoming_Pending_txKList.png" alt="L1 Pending in Transaction List" width="280">

### Claiming Deposits

Once a deposit has 3 confirmations, you can claim it to add the funds to your Spark balance.

<img src="public/L1_images/L1_Claim_it_final.png" alt="L1 Claim Deposit" width="280">

1. Tap "Claim" on the confirmed deposit
2. Review the fee breakdown:
   - **Deposit amount**: Total Bitcoin received
   - **Network fee**: Fee to claim the deposit
   - **Net amount**: What you'll receive in your wallet
3. Tap "Add to Wallet" to confirm

The claimed Bitcoin is instantly available in your Spark wallet for Lightning payments or Spark transfers.

**High Fee Warning**: If the network fee is more than 50% of your deposit, you'll see a warning. Consider waiting for lower fees or returning the deposit to the sender.

### Returning a Deposit

If the claim fee is too high relative to your deposit amount, you can return the Bitcoin to the sender instead.

<img src="public/L1_images/L1_Return_Not_Accept_L1.png" alt="L1 Return to Sender" width="280">

### Sending On-Chain Bitcoin (Withdrawals)

You can send Bitcoin from your Spark wallet to any on-chain Bitcoin address.

1. Tap the "Send" button
2. Enter or scan a Bitcoin address (starts with `bc1...`, `3...`, or `1...`)
3. Enter the amount
4. Choose your fee speed:
   - **Slow**: Lower fee, may take longer to confirm
   - **Medium**: Balanced fee and speed
   - **Fast**: Higher fee, faster confirmation
5. Review the total (amount + network fee)
6. Confirm the withdrawal

**Note**: On-chain withdrawals take time to confirm on the Bitcoin network. You can track the status in your transaction history.

<br>

## Transaction History

Your transaction history shows all payments sent and received. Access it by tapping "Transactions" on the main wallet screen.

### Grouped Transactions

When you send or receive multiple payments to/from the same destination within a short period, BuhoGO automatically groups them together to keep your transaction list clean and organized.

<img src="public/Spark_images/TX_List_1.png" alt="Transactions Expanded" width="280"> <img src="public/Spark_images/TX_List_closed.png" alt="Transactions Grouped" width="280">

Tap on a grouped transaction to expand and see individual payments within the group.

<br>

## Managing Contacts

### Adding a Contact

1. Go to Settings > Address Book
2. Tap the "+" button
3. Enter the contact name
4. Choose address type (Lightning or Spark)
5. Enter the address
6. Tap "Save"

### Editing a Contact

1. Go to Settings > Address Book
2. Tap on the contact
3. Make your changes
4. Tap "Save"

### Deleting a Contact

1. Go to Settings > Address Book
2. Tap on the contact
3. Tap "Delete"
4. Confirm deletion

### Contact Types

**Lightning Address**: Format like `name@domain.com`. Works with all wallet types.

**Spark Address**: Format starting with `sp1...`. Only payable from Spark wallets. These payments are instant and free.

<br>

## Switching Wallets

If you have multiple wallets:

1. Tap the wallet name at the top of the main screen
2. Select the wallet you want to use
3. The app switches to that wallet immediately

The active wallet indicator shows which wallet is currently selected.

### Setting a Default Wallet

Your most recently used wallet becomes the default. When you open the app, it will load this wallet automatically.

<br>

## Settings and Preferences

### Theme

Toggle between dark and light modes in Settings > Appearance.

### Language

Change the app language in Settings > Language.

### Currency

Set your preferred fiat currency for price display in Settings.

### Spark Wallet Settings

For Spark wallets, additional options are available:

**View Seed Phrase**: Requires PIN entry. Use this to verify your backup.

<img src="public/Settings_images/Settings_Show_Seed.png" alt="Show Seed Phrase" width="280">

**Change PIN**: Update your wallet PIN.

<img src="public/Settings_images/Settings_Change_Pin.png" alt="Change PIN" width="280">

**Delete Wallet**: Permanently removes the Spark wallet. Make sure you have your seed phrase backed up before deleting.

<img src="public/Spark_images/DeleteWallet.png" alt="Delete Wallet" width="280">

### NWC Wallet Settings

**Rename**: Change the display name for the wallet.

**Disconnect**: Removes the NWC connection. You can reconnect later with the same or different connection string.

<br>

## Troubleshooting

For technical issues and developer debugging, see [Common Issues](Developer.md#common-issues) in the Developer Guide.

### Spark Wallet Issues

**Forgot PIN**
There is no PIN recovery. If you have your seed phrase, delete and restore the wallet:
1. Uninstall and reinstall the app
2. Select "Restore Wallet"
3. Enter your 12-word seed phrase
4. Set a new PIN

<img src="public/Spark_images/RestoreSeed.png" alt="Restore Wallet" width="280">

**Payment Failed**
- Check your balance is sufficient
- Verify the recipient address is correct
- For Lightning payments, the recipient must have inbound capacity
- Try a smaller amount

### NWC Wallet Issues

**Connection Failed**
- Verify your NWC string is complete and correct
- Check that your wallet provider is online
- Try generating a new NWC connection string

**Balance Not Showing**
- Pull down to refresh
- Check your wallet provider app is running
- Verify the NWC connection has balance read permissions

**Cannot Send Payment**
- Some NWC connections have spending limits
- Check your wallet provider for any restrictions
- Verify the payment destination is valid

### LNBits Wallet Issues

**Connection Failed**
- Verify your server URL is correct and accessible
- Ensure you're using HTTPS (required except for localhost)
- Check that your Admin API key is valid
- Try accessing your LNBits server directly in a browser

**Invalid API Key**
- Make sure you copied the complete Admin Key (not Invoice Key)
- Admin Key is required for full wallet access
- Generate a new key in LNBits if needed

**Balance Not Updating**
- Pull down to refresh the wallet
- Check your LNBits server is online
- Verify the wallet hasn't been deleted on the server

**Payment Failed**
- Check your LNBits wallet has sufficient balance
- Verify the recipient's invoice is valid and not expired
- Check the LNBits server logs for detailed error messages

### On-Chain Bitcoin (L1) Issues

**Deposit Not Showing**
- Deposits may take a few minutes to appear after being broadcast
- Tap "Check for deposits" to manually refresh
- Ensure the sender used the correct address

**Cannot Claim Deposit**
- Wait for 3 confirmations (check the confirmation counter)
- If the fee is too high, wait for lower network fees or return to sender

**Withdrawal Pending for a Long Time**
- On-chain transactions can take time during high network activity
- Check the transaction status in your history
- If you selected "Slow" speed, it may take longer to confirm

### General Issues

**App Crashes on Launch**
- Force close and reopen the app
- Clear app cache in your device settings
- Reinstall if problems persist (backup first!)

**QR Scanner Not Working**
- Ensure camera permissions are granted
- Check for adequate lighting
- Try moving closer to or further from the QR code

<br>

## Payment Format Reference

| Format | Example | Description |
|--------|---------|-------------|
| Lightning Invoice | `lnbc10u1p...` | One-time payment request with encoded amount |
| Lightning Address | `satoshi@wallet.com` | Reusable address, similar to email |
| Spark Address | `sp1qw3e...` | Spark network address for zero-fee transfers |
| LNURL | `lnurl1dp68...` | Encoded URL for various Lightning operations |
| Bitcoin Address (L1) | `bc1p...`, `bc1q...` | On-chain Bitcoin address (Spark only) |

<br>

## Tips for New Users

1. **Start Small**: Make your first few transactions with small amounts until you are comfortable.

2. **Verify Addresses**: Always double-check recipient addresses before sending. Bitcoin transactions cannot be reversed.

3. **Backup Immediately**: For Spark wallets, back up your seed phrase before receiving any funds.

4. **Test Receive First**: Generate a small test invoice to verify your setup works correctly.

5. **Keep PIN Private**: Never share your PIN with anyone. BuhoGO support will never ask for it.

<br>

## Getting Help

If you encounter issues not covered in this guide:

- Check the [GitHub Issues](https://github.com/Buho-Ecosystem/Buho_go/issues) for known problems
- Open a new issue with details about your problem
- Include your wallet type (Spark or NWC) and steps to reproduce

<br>

## Related Documentation

- [README](README.md) - Project overview and quick start
- [Use Cases](USE_CASES.md) - Real-world scenarios and examples
- [Developer Guide](Developer.md) - Technical documentation for contributors

<br>

*This guide is updated regularly. Check back for new features and improvements.*
