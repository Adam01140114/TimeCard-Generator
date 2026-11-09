# TimeCard Generator

Fill in the days you worked, sign, and download a clean, print-ready time card PDF. Built for phones first, and it works just as well on a desktop.

**Live app:** https://adam01140114.github.io/TimeCard-Generator/

## Features

- **Starts empty every time.** Date, time-in and time-out fields are never pre-filled or saved. You enter them.
- **Automatic hours.** Each day's hours (minus lunch) are calculated as you type, with card and overall totals. Overnight shifts work too.
- **Multiple cards.** Each card prints on its own page, and long cards continue onto a second page.
- **Sign your way.** Type your name, or draw your signature with a finger, stylus or mouse.
- **Optional extras.** A supervisor signature line, and a switch to hide the hours column.
- **Preview, download or share.** On phones, Share opens the system share sheet so you can send the PDF by email or text.
- **Private.** Everything runs in your browser and nothing is uploaded. If you choose, your name, position and company are remembered on your device.
- **Works offline** after the first visit, and can be added to your home screen.

## Running it locally

It's a static site with no build step. Serve the folder with any static file server, for example:

```bash
npx serve .
```

PDFs are generated with [jsPDF](https://github.com/parallax/jsPDF) 4.2.1 (MIT), which is included in `vendor/`.

## Notes

The PDF uses the standard PDF fonts, which cover Latin characters (including accents like é, ñ and ü). Characters outside that set, such as Chinese or Arabic script, are left out of the PDF.
