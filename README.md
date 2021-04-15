# gophercon.dev
Datastore for Gophercon.dev

## Purpose
This repo holds the conference data for [https://gophercon.dev]. To add or update a conference, create a PR with your change to `conferences.json`.

## conferences.json
The data is stored as a JSON object. It contains a single `"Conferences"` key with a list of conferences.
```json
{
    "Conferences": [...]
}
```
Each conference consists of a name, a start and end time for the conference itself, locations for the conference, phases of the conferences (like "Call for Papers" or "Registration"), and a list of links.
```json
{
    "Name": "Example Conference",
    "Start": "2021-12-24T00:00:00.000Z",
    "End": "2021-12-25T00:00:00.000Z",
    "Locations": [
        {
            "Label": "Berlin",
            "URL": "https://link-to-map"
        }
    ],
    "Phases": [
        {
            "Label": "Call for Papers",
            "URL": "",
            "Start": "2021-11-01T00:00:00.000Z",
            "End": "2021-11-30T23:59:59.000Z"
        },
        {
            "Label": "Registration",
            "URL": "",
            "Start": "2021-12-01T00:00:00.000Z",
            "End": "2021-12-24T00:00:00.000Z"
        }
    ],
    "Links": [
        {
            "Label": "Website",
            "URL": "https://example-gophercon.com"
        }
    ],
    "Cancelled": false,
    "Hidden": false,
    "Creator": "your name, handle, or email address"
}
```
### Name
This is the name of the conference. It often makes sense to include a year to distinguish the different iterations at first glance.

### Start and End
These timestamps define the duration of the conference itself. The conferences are sorted by the start date.

### Locations
One or more locations for this conference. It's possible to include multiple locations (for example for a combined online and offline version). It makes sense to include links to maps for physical locations and links to your conference platform for online conferences.

### Phases
Different time periods for the conference, this could include "Call for Papers", "Registration". You can include links to the CfP or ticket registration site. You need to define a start and end timestamp for the phase.

### Links
A list of links to your website, Twitter account, Instagram, and Google Plus page.

### Cancelled
Set this to true in case the conference was cancelled. The list entry will appear with a red background. You should also add a phase "Cancelled" with a link to the cancellation announcement.

### Hidden
This is usually set to false. THe conference will be hidden from the list. The template conference in the file it set to hidden so it doesn't show up in the list.

### Creator
Your name, handle, or email address. This is not displayed on the page but is visible in the repo. Used to identify the author of a conference entry.
