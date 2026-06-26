# 🧲 PropMail Pinpoint — Rightmove Full Address Finder

A Chrome/Edge browser extension that finds the **full address** of a property on
Rightmove. Rightmove usually only shows the street or area — Pinpoint recovers
the exact address by combining two public data sources:

1. **Pinpoint magnet** — reads the map pin (latitude/longitude) that Rightmove
   embeds in the listing page and reverse-geocodes it to the real nearby
   postcodes (via the free [postcodes.io](https://postcodes.io) API).
2. **EPC database** — searches those postcodes in the official **EPC
   (Energy Performance Certificate) register** for every certified address on
   the street, then ranks them by property type and floor area to surface the
   single most likely full address.

This is the same resolution pipeline used by the PropMail Pro web app
(`api/epc.js`), repackaged as a standalone, self-contained extension — no server
required.

---

## Install (Load unpacked)

The extension isn't on the Chrome Web Store, so you install it in developer mode:

1. Download / copy this `extension/` folder to your computer.
2. Open **Chrome** and go to `chrome://extensions` (in **Edge**: `edge://extensions`).
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select this `extension/` folder.
5. The 🧲 PropMail Pinpoint icon appears in your toolbar (pin it for easy access).

## One-time setup — add your free EPC API key

1. Click the extension icon → **Options & API key** (or right-click the icon →
   *Options*).
2. Register for a free key at
   [get-energy-performance-data.communities.gov.uk](https://get-energy-performance-data.communities.gov.uk)
   (run by the UK government — covers England & Wales).
3. Paste the key into Options and click **Save**.

Your key is stored locally (`chrome.storage.local`) and is only ever sent to the
official EPC register over HTTPS.

## Use it

1. Open any property page on `rightmove.co.uk`.
2. A small **🧲 Pinpoint** panel appears at the bottom-right.
3. Click **Find full address**.
4. You'll get the most likely full address (with a confidence indicator), a
   **Copy** button, and a list of other candidate addresses on the street.

You can also click the toolbar icon → **Find full address on this page**.

---

## How matching works

| Step | What happens |
|------|--------------|
| Read listing | Parses Rightmove's embedded `PAGE_MODEL` for the display address, postcode area, map pin, property type, bedrooms and floor area. |
| Reverse-geocode | The map pin is offset by Rightmove, so we fetch ~20 nearby postcodes and keep the ones in the listing's postcode area. |
| EPC search | Each candidate postcode is searched in the EPC register; we keep the postcode whose street matches the listing. |
| Rank | Candidates are filtered by flat-vs-house, then ranked by how closely each EPC floor area matches the listing's size. |

**Confidence levels:** *High* = floor area matched · *Good* = street confirmed
from the pin · *Postcode-area match* = best effort within the area.

## Notes & limits

- Only works on listings that **publish a map pin** and have an **EPC on record**
  (most homes sold/let since 2008 do).
- Results are candidates, not guarantees — always sanity-check against the
  listing photos and description.
- Use responsibly and in line with Rightmove's terms of use and applicable
  data-protection rules. The EPC register is public data; treat any resulting
  address with care.

## Files

```
extension/
├── manifest.json     # MV3 manifest
├── content.js        # reads the listing + injects the on-page panel
├── content.css       # panel styling
├── background.js      # reverse-geocode + EPC resolver (the "pinpoint magnet")
├── popup.html/js      # toolbar popup
├── options.html/js    # EPC API key settings
└── icons/             # toolbar icons
```

## Privacy

The extension talks to exactly two services, both over HTTPS:
`api.postcodes.io` (postcode lookup, no key) and the government EPC register
(`api.get-energy-performance-data.communities.gov.uk`, your key). No data is sent
anywhere else, and there is no analytics or tracking.
