---
title: Backups
summary: Take, attach and restore images while keeping the target clear.
keywords: [backup, restore, retention, schedule, image, attach, offsite]
---

# Backups
Choose a server to inspect its images, take a backup, manage automatic backups, attach an image or restore its disk. Inside Server Details the same view is pinned to that server.

## Choose the right operation
Take Backup creates an image; Restore overwrites the server's current disk. Attach exposes an image as a read-only secondary drive for file recovery. Check the image date and target before either operation.

Purchased daily, weekly and monthly counts and offsite options are in Change Plan. The hour and days the scheduled backups run are shown and changed on this page, under [Backup schedule](help:backups#backup-schedule). BinaryLane describes automated backups in its [automated backups article](https://support.binarylane.com.au/support/solutions/articles/11000033794-automated-backups). Keeping BLDesk open is not required for the schedule.

## Take Backup
Take Backup asks which slot to use and for an optional name. A backup taken into a full slot replaces an existing one, which will no longer be available. BLDesk asks first and names that backup where it can. A backup into a free slot goes straight through. Both are recorded in [History](help:history).

For the daily, weekly and monthly slots, the number a slot keeps is the retention set in [Change Plan](help:server-change-plan). Suppose a server keeps two daily backups and already holds two, and you choose the daily slot. The dialog title is “Take Backup”, its button is red but asks for no typed name, and it says:

“No daily slot is free, so this backup replaces the oldest daily backup that is not locked or attached. The replaced backup will no longer be available.”

The row “Replaced backup” gives the name, ID, slot and date of the backup that goes, and the row shows it changing to “New daily backup”. History records the entry as destructive. When BinaryLane picks the oldest backup, it skips locked and attached ones.

BinaryLane's API reference does not say how many temporary backups a server can hold, so BLDesk cannot tell whether the temporary slot is full. If the server already has a temporary backup that is not locked or attached, the dialog is worded as a possibility, with the row “Replaced if no slot is free”:

“If this server has no free temporary slot, this backup replaces its oldest temporary backup that is not locked or attached. The replaced backup will no longer be available.”

Choosing a backup under “Replace Existing Image” replaces exactly that backup, and the dialog says:

“This backup replaces the backup you chose. The replaced backup will no longer be available.”

If the backup you chose is locked or attached, BLDesk does not claim it will be replaced: it shows no dialog, sends the request and shows BinaryLane's answer. Use Download on any image you need to keep before you take a backup that could replace it.

While BLDesk checks the server's backups and sends the request, the form's Cancel and close button are off, as in every form while its request runs, and cancelling the confirmation turns them back on. The take goes to the server you started it for, even if the page shows another server by then.

BLDesk reads the server's backups again when you submit, and gives up on that read after 20 seconds. If that read fails, it cannot tell whether a slot is full, or whether the backup you chose can still be replaced, so it asks anyway. For a slot, it names no backup, because it cannot tell which one would go, and the dialog says:

“Couldn't read this server's backups, so BLDesk can't say which one would be replaced if no slot is free. A backup that is replaced will no longer be available.”

For a backup you chose under “Replace Existing Image”, it says:

“Couldn't read this server's backups, so BLDesk can't check whether the backup you chose can still be replaced. If it can, this backup replaces it and the replaced backup will no longer be available.”

The row “Backup you chose” gives its name, ID, slot and date as the list on this page showed them. The button is red and History records the entry as destructive. Cancel sends nothing; confirming sends the request. When the list on this page cannot be read, it says “Couldn't read this server's backups.” with a Retry button, instead of “No Backups Found”.

## Worked example
Suppose you want to restore example image before-upgrade, ID 123, to the selected server. Take another backup first if you may need its current state. Choose Restore on the intended image.

The dialog title is “Restore from backup”, with:

“Overwrites the server's current disk with image "before-upgrade" (#123). Everything written since that image was taken is lost.”

The note says:

“Take a backup first if the current state might be needed again.”

Verify the server name and image in the change table. Type the target name, then choose “Restore”. Follow the action in History and check the guest once complete. Your dialog substitutes the actual image name and ID.

## Backup schedule
The Backup Schedule card, under the banner, says when the server's scheduled backups run, from the schedule BinaryLane reports for the server. It shows only what applies to what the server keeps. For a server with daily, weekly and monthly backups it reads:

“Backups run at about 2 am, Australia/Sydney time.”

“Weekly backups run on Sunday.”

“Monthly backups run on the 1st.”

The hour is approximate, and it and the days are in Australia/Sydney time for every region, whichever region the server is in. The weekday line appears only while the server keeps weekly backups, and the day-of-the-month line only while it keeps monthly ones. A server that keeps no daily, weekly or monthly backups has no schedule, so the card is not shown; a server with only temporary backups is one of those. If BinaryLane does not report what a server keeps, the card shows only the hour line, which applies to every kind of backup. When BinaryLane does not report the schedule, the card says “BinaryLane did not report when this server's backups run.” and has no button.

Change Schedule opens a form with a selector for each line that applies: “Hour of the day” (“Australia/Sydney time, approximate”), “Day of the week” (“for weekly backups”) and “Day of the month” (“for monthly backups”). Sunday is the first weekday and the days of the month run from the 1st to the 28th. The button in the form is off until something differs from the current schedule. The form shows the schedule BinaryLane reports now: a value you have not changed follows it if the schedule is changed elsewhere while the form is open, and only the values you changed are sent.

Submitting asks for confirmation. Suppose a server keeps daily and weekly backups, and you move the hour from 2 am to 3 am. The dialog title is “Change backup schedule”, its button is blue and asks for no typed name, and it says:

“Changes when BinaryLane runs this server's scheduled backups. The hour is approximate, and the days are Australia/Sydney calendar days.”

The table lists only the values that change, here “Hour of the day” going from “2 am” to “3 am”, and only those values are sent: BinaryLane keeps every value it is not sent. The request is recorded in [History](help:history). If BinaryLane accepts it without giving an action to follow, the entry stays “Submitted”, because BLDesk then has nothing to follow. BLDesk then reads the server list again, and the card shows the schedule that list reports. If BinaryLane applies the change a moment after accepting it, the card can show the old schedule until BLDesk next reads the list, which it does regularly. The reference does not say how a change interacts with a backup that is already due, so BLDesk makes no claim about that.

## Disabling automatic backups
The banner at the top of the page reads Enabled when the server has daily backups in its options. Backups taken by hand do not count: a server with only temporary backups reads Disabled. A server with weekly or monthly backups and no daily ones reads No daily and has no button, because enabling daily backups is for a server that has none; set its daily backups in Change Plan.

This page cannot turn weekly or monthly backups on. Change Plan, one of the server's own pages in the sidebar, sets how many daily, weekly and monthly backups a server keeps, in its Backups section, and the banner says so in each state. A server with daily backups reads:

“BinaryLane takes automated daily backups. The Backup Schedule below shows when they run. Weekly and monthly backups are set in the Backups section of the server's Change Plan.”

A server with weekly or monthly backups and no daily ones reads:

“This server keeps weekly or monthly backups and no daily ones. Daily, weekly and monthly backups are set in the Backups section of the server's Change Plan.”

A server with no backups in its options reads the text below, and its one button enables daily backups and keeps two of them:

“Automated backups are currently turned off for this server. The button enables daily backups and keeps two of them; weekly and monthly backups are set in the Backups section of the server's Change Plan.”

“Remove Daily Backups” is not a pause, and it is the banner's button only while the server has daily backups. BinaryLane's API reference calls the action destructive and says it asks for no further confirmation, so the dialog is your only check. The dialog title is “Remove daily backups”. Its button is red but asks for no typed name, so read the summary before you confirm. The request is recorded in History.

The summary says:

“Changes the server's options to remove its daily backups. This is not a pause: BinaryLane removes them, including any you took with Take Backup into a daily slot, and does not ask again.”

The notes say:

“BinaryLane does this only when the server has the two daily backups that enabling automated backups creates.”

“Temporary backups you took with Take Backup are not removed.”

The reference says previous backups will no longer be available. When this page was last checked against BinaryLane, the daily backups were removed and a temporary backup was kept, so the dialog says only that.

Before you disable, use Download on any image you need to keep.
