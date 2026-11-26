# TVVC QA two-phone rehearsal

Start at [RallyFund QA sign-in](https://rallyfund-tvvc-qa.netlify.app/admin). Select **Fictional TVVC two-phone rehearsal**. The campaign starts as a draft with one fictional player, **Sample Riley**. Use only the supplied QA credentials, fictional details, and a Stripe test card. Share the links privately with your rehearsal partner.

| Role       | QA email                  | Responsibility                                                                          |
| ---------- | ------------------------- | --------------------------------------------------------------------------------------- |
| Coach      | `coach@tvvc.example`      | Issue the private setup link, approve the profile, and open and stop test donations.    |
| Dues admin | `dues-admin@tvvc.example` | Verify the test gift and record its net dues credit with a fictional posting reference. |

## Approval and sharing

1. On **Phone A**, sign in as the coach. Open **Athletes**, expand **Sample Riley**, and tap **Issue private setup link**. Copy the private URL and open it in a separate tab as the fictional player. Keep this setup URL with the people playing the coach and player roles.
2. Enter **Sample Riley Q** as the public display name and **Fictional two-phone rehearsal** as the message. Leave the photo blank. Check the fictional guardian authorization box and tap **Done**. The player should see **Waiting for coach approval**, with the share controls hidden.
3. Return to the coach tab. Refresh **Athletes** and enter **Fictional guardian approval, QA-001** in the authorization record. Tap **Approve public content**, then go to **Dashboard → Open test donations**.
4. Return to the player tab and tap **Check approval status**. Tap **Copy link** and send the public link to your rehearsal partner in an existing one-to-one conversation. Try **Share…** if the phone offers it. On **Phone B**, open the link in iPhone Safari. The page should show **Sample Riley Q**, select that player for fundraising credit, and offer **Card · Stripe sandbox**.
5. On Phone A, tap **Show QR code**. On Phone B, open the iPhone Camera in Photo mode, point it at the code, and tap the detected link. Open the address in Safari if the iPhone uses another default browser. Check that the scanned and pasted URLs match, including the player path, and show the same player. If you have two iPhones, repeat with their roles swapped. [Apple guide to scanning a QR code](https://support.apple.com/guide/iphone/scan-a-qr-code-iphe8bda8762/ios)

## Test gift, dues credit, and stop

1. On Phone B, submit one **$10.00** gift as **Fictional QA Donor**, using `phone-qa@example.com`. Confirm Stripe Checkout is in test mode and offers card payment. Use `4242 4242 4242 4242`, expiry `12/30`, CVC `123`, and ZIP `97006` if prompted. Pay once and return to the player page. [Stripe test cards](https://docs.stripe.com/testing#cards)
2. In a separate tab or browser session, sign in as the dues admin and open **Dues**. Select Sample Riley. Wait for the confirmed contribution and Stripe fee if they are still loading. Choose **Record reconciled credit posting**, select the $10 gift, and enter the eligible net amount shown. Use **QA-PHONE-001** as the external reference and **Matched fictional Stripe test gift** as the audit note. Save and check for one applied credit. The net amount is $10.00 less the actual test fee shown by RallyFund.
3. On Phone B, start another test checkout and leave it open at Stripe. On Phone A, use the coach's **Dashboard → Stop test donations**. Reload the public page and verify it says the campaign has stopped accepting test donations. Return to the unpaid Stripe tab and check that the session has expired. Confirm the existing dues credit is still present.

Record each phone model and browser, whether the pasted link and QR opened the same player, the posted credit, and whether stopping passed. Use the same campaign for all steps. The stop is final for that campaign.
