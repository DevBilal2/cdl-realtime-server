# Privacy Policy: CDL Lead Notifier

Last updated: 10 September 2026

CDL Lead Notifier is an internal Chrome extension built for recruiters at CDL.
It shows a desktop notification when a lead is assigned to them in Zoho CRM.
This policy describes what the extension handles and what it does not.

## What the extension collects

**An access code.** During setup the user pastes in an access code issued by
their administrator. The extension stores it on the user's own machine using
`chrome.storage.local` and sends it to the CDL notification server to identify
which recruiter is connected. It is not shared with anyone else and is not used
for any other purpose.

**Nothing else.** The extension does not ask for, read, or transmit a name,
email address, password, location, browsing history, or the content of any web
page.

## What the extension stores on the user's machine

- The access code, so it does not have to be entered again.
- A Zoho CRM link for each notification, so that clicking a notification opens
  the correct lead. These are deleted when the notification is clicked, and any
  left over are removed automatically after 24 hours.

Both are kept in `chrome.storage.local` on that device. Neither is synced
between devices, and neither is sent anywhere other than as described above.

## What the extension receives

When a lead is assigned to the recruiter in Zoho CRM, the CDL notification
server sends the extension the lead's name, campus, and record ID so it can
display the notification. This information travels from CDL's own systems to
that recruiter's browser. The extension does not send it anywhere else and does
not retain it beyond the life of the notification.

## What the extension cannot do

- It has no access to Gmail, Drive, Calendar, or any other Google service.
- It cannot read browsing history or the user's open tabs.
- It contains no content scripts, so it never reads or alters any web page.
- It contacts exactly one server, `cdl-realtime-server-orbw.onrender.com`, and
  no other host on the internet.
- It contains no analytics, tracking, or advertising code of any kind.

## Sharing

No data is sold or transferred to third parties. No data is used for anything
unrelated to delivering lead notifications. No data is used to assess
creditworthiness or for lending.

The only party involved besides the user is CDL itself, which already holds
this lead information in its own CRM.

## Retention

The access code remains on the device until the user clears it or removes the
extension. Notification links are removed on click, and otherwise within 24
hours. Undelivered leads may be held briefly on the CDL notification server so
they can be shown when the recruiter's browser reconnects, and are held in
memory only, never written to disk.

## Removing your data

Uninstalling the extension removes everything it stored on the device.
Recruiters who want their access revoked should contact their CDL
administrator, who can remove them, after which the access code stops working.

## Contact

Questions about this policy should go to the CDL administrator who issued your
access code.
