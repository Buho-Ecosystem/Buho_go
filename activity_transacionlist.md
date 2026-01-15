Every wallet includes a list of transactions that allow the users to see who they sent bitcoin to and who they received bitcoin from. This sounds straightforward, but there are many detailed design decisions to consider.

What is a transaction? #
On a technical level, a transaction is a transfer of a specific amount between two addresses at a specific time. However, as human beings, we often perceive transactions in practical terms, such as grocery store purchases, mortgage payments, or repaying a friend for lunch. It is important that we enable users to incorporate these additional layers of meaning so that they can more intuitively navigate and engage with their transaction history.

Smartphone screen showing a list of user transactions with minimal information
A minimal transaction list that avoids the display of technical details.

Smartphone screen showing a list of user transactions with rich information like descriptions, tags, and contacts
If users annotate transactions well, they see much richer history.

Smartphone screen showing a mix of user transactions with minimal and rich information
Unless a user is thorough about organization, they will see a mix of annotated activity and raw transaction information.

Smartphone screen showing a list of user transactions with minimal information and invoice IDs
If your users are likely to rely on addresses or lightning invoice IDs to identify payments, you may decide to show them. Always consider your users.

Design considerations #
Research by the team at Alby has indicated that most users rarely visit a transaction list. The most frequent reasons for doing so are to confirm payment status, manage budgeting, and to analyze payment behavior. The most significant challenges users face are navigating through long lists to find a specific transaction and the lack of available metadata, leaving users unsure as to who the payment was sent to and for what purpose.

The Activity screen is a utility page where a user can quickly browse a dataset to see what’s new, locate something specific, identify patterns, and so on. Every detail should be thoughtfully considered to avoid adding elements that only increase visual interest without providing meaningful information, unless there is a good reason for doing so.

Following are some of the design decisions in the screens above:

Received amounts are displayed in green, which typically carries a positive connotation. While it might seem logical to highlight sent amounts in red, this isn’t necessary as there is sufficient contrast already. Red can continue to be the color associated with errors.
Adding a plus or minus next to amounts is helpful for the color-blind, as well as general readability & usability.
Fallback icons have been designed to subtly and usefully indicate whether Bitcoin was sent or received, and the status of the transaction. If they are not displayed, for example when a contact image is shown instead, no information is lost. Displaying a Bitcoin symbol, on the other hand, could be visually distracting without providing any useful information.
The formatting guidelines in Units & Symbols are applied.
Not carefully weighing these decisions can easily result in a cluttered appearance.

Beyond transactions #
Smartphone screen of a transaction list mixing payments and other user activity
A list that includes non-payment activity.

Since we already offer users a chronological list of events, it is a small step to go beyond transactions and also include other relevant wallet activity.

User activity #
Events can include user activity related to unique wallet features. For example:

Blixt allows for manual control over lightning channels. The list can show when channels were opened and closed.
Breez includes a podcast player. New subscriptions and episodes could be listed.
Hexa allows users to have multiple wallets. The list can show when new wallets were created.
Authentication to third-party services via sign in with bitcoin.
Software notifications #
Wallets can also independently monitor user funds, data traffic, and other aspects, highlighting any activity that users should be immediately aware of, or may need to reference in the future. Particularly in terms of security and privacy, users depend on the software to be vigilant on their behalf.

Smart organization #
The lightning network makes micropayments economically and technically viable. For example, as a user listens to a podcast, they may stream 10 sats per minute to the host as a thank you. This can easily result in a cluttered activity list, which can be remedied via automatic grouping.

Smartphone screen showing a long list of highly similar micro payments
Micropayments can easily flood an activity screen and make it hard to use.

Smartphone screen showing many micro payments grouped together
Smart grouping can help keep the list easy to parse.

Smartphone screen showing a list of condensed micro payments
When expanded, the micropayment information can be kept to a minimum.

Search & export #
Search functionality within a digital wallet is incredibly useful for anyone frequently using it, especially as micropayments become more prevalent. Given that this function relies heavily on high-quality data, it’s important to make it easy for users to add relevant metadata to their transactions.

Another feature closely linked to the search function in digital wallets is data export, which can serve several purposes. For one, a user may wish to migrate to a new wallet and bring their transaction history along with them. Additionally, export functionality is beneficial for accounting and tax purposes, especially for merchants.

Smartphone screen showing search and export options for a list of payments
An example UI for search, filtering and export.

Smartphone screen showing a list of payments with a user prompt to organize them
Wallets can support users in organizing transactions more easily.

Smartphone screen showing a payment screen with rich invoice information
If an invoice includes a description or other useful data (e.g. BOLT 11), make sure to store it.

Smartphone screen showing a payment that is in the process of being sent
Make it easy to add metadata when a user sends or receives a transaction, as it is top-of-mind at that moment.

Different views #
Smartphone screen showing a balance chart and spending category breakdown
Example of a screen summarizing the users spending and receiving categories.

Alternative approaches to the basic list view can give users different perspectives on their finances and activity.

The example shown here uses traditional categories borrowed from personal household finance. As users tag transactions, the categories update.

It’s recommended to approach this type of view based on the unique use case and feature set of the application. For example, a wallet that is focused on interaction with lightning applications may instead group payments by the services they were made with.

Transaction details #
The activity list focuses on summarizing the top-level information, so users can quickly scan the screen to get an overview. If they identify a transaction they want to take a closer look at or interact with, the following screens become relevant.

A payment made on lightning #
As with the activity list, transaction details screens should also only highlight relevant information and options, and make secondary details easily accessible.

Smartphone screen showing a completed lightning payment
On-chain and lightning payments look structurally similar, but differ in subtle ways.

Smartphone screen showing a completed lightning payment with extended technical details
Expanded details of lightning payment.

A payment received on-chain #
While the details for lightning and on-chain payments look very similar, there are subtle differences. Most noticeable for the user is the difference in fees and processing time.

Smartphone screen showing a completed on-chain payment
A received on-chain transaction without annotations.

Smartphone screen showing an on-chain payment with expanded technical details
The same transaction with an assigned contact, tags, and description, as well as expanded details.

Smartphone screen showing an on-chain payment with extended details and an additional modal for further technical details
Tapping list items can quickly bring up further details and options.

Status display #
A list of payment statuses with different design treatments
Status indicators are important for on-chain transactions since they take longer to confirm, as well as when things go wrong. While a completed transaction generally doesn’t need a status indicator, it should be shown if the transaction completes while the user is watching. Error messages should be clear and provide access to details and options to remedy the problem.

The recipient field #
A list of sender and recipient fields with varying amount of detail
Most intuitive for users is likely when a transaction is directly linked to a person or business. As this requires the user to tag transactions accordingly, there need to be fallback approaches that try to communicate the available technical information in ways that users can relate to.

This can be in the form of text labels, or even uniquely generated icons like Jazzicons. When using visual fallbacks, be deliberate about their impact. If they draw visual attention, but don’t communicate any useful information, you may want to avoid them.

Wrapping up #
As mentioned earlier, there is significant nuance involved in displaying user activity. Although this permits a multitude of minor design decisions, users typically benefit when wallets adopt similar strategies. This is especially important in relation to the addition of metadata, which is not stored either on-chain or by lightning nodes. To ensure interoperability and data portability, it would be advantageous if wallets could agree on standardized data formats.