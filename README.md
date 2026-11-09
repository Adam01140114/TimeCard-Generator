# TimeCard Generator

Fill in the days you worked and download a signed, print-ready time card PDF. Built for phones first, and it works just as well on a desktop.

**Live app:** https://adam01140114.github.io/TimeCard-Generator/

## Features

- **Starts empty every time.** Date, time-in and time-out fields are never pre-filled or saved. You enter them.
- **Automatic hours.** Each day's hours (minus lunch) are calculated as you type, with page and overall totals. Overnight shifts work too.
- **Multiple pages.** Add a page for each time card you need; a page with many days continues onto the next sheet.
- **Signed automatically.** Each page is signed with the employee's name in a handwritten script font and dated with its last day.
- **Preview, download or share.** On phones, Share opens the system share sheet so you can send the PDF by email or text.
- **Private.** Everything runs in your browser and nothing is uploaded. If you choose, your name, position and service are remembered on your device.
- **Works offline** after the first visit, and can be added to your home screen.

## Running it locally

It's a static site with no build step. Serve the folder with any static file server, for example:

```bash
npx serve .
```

PDFs are generated with [jsPDF](https://github.com/parallax/jsPDF) 4.2.1 (MIT), included in `vendor/`. The signature uses [Alex Brush](https://github.com/googlefonts/alex-brush) (SIL Open Font License 1.1), included in `vendor/fonts/` with its license.

## Notes

The PDF covers Latin characters, including accents like é, ñ and ü. Characters outside that set, such as Chinese or Arabic script, are left out of the PDF.
