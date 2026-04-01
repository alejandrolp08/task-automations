Sales Tracking operative workspace

This folder stores working files for the sales tracking project.

Current live workflow documented here:

- unread Viagogo sale emails are parsed from Gmail
- the sale is matched against SmartSuite inventory using `Full Event Info`
- the script ranks equivalent matches by:
  - closest sell price
  - oldest `first_created`
- successful matches update SmartSuite:
  - total payout
  - profit
  - ext order #
  - sold
  - client full name
  - client email
- unmatched or invalid emails are sent to review

Current production settings:

- `MAX_EMAILS_TO_PROCESS = 9999`
- `DEBUG_LOG_CANDIDATES = false`
- expected trigger frequency:
  - every 20 to 30 minutes

Important implementation notes:

- `Full Event Info` is the current production source of truth for matching
- buyer names are normalized before writing to SmartSuite
  - example:
    - `*Chase Breen*` becomes `Chase Breen`
- direct SmartSuite lookup columns were tested, but `Full Event Info` proved more reliable for live reconciliation

Suggested usage:

- historical reference emails or samples
- parsing notes
- output exports
- reconciliation summaries
- docs about vendor-specific email formats

This project is expected to help bridge the difference between:

- old Ticketvault email-based sale tracking
- new ReachPro / Viagogo sale notifications
