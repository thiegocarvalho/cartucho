# Cartucho // IPFS

![Cartucho IPFS Banner](https://placehold.co/1200x400/0a0a14/4f46e5?text=Cartucho+//+IPFS&font=orbitron)

**Cartucho IPFS** is a fully decentralized, browser-based retro game emulator and library manager. It leverages the power of the InterPlanetary File System (IPFS) to distribute, store, and play classic video games without relying on any centralized servers.

## 🚀 Play Now

Experience the decentralized arcade directly in your browser:  
👉 **[Play Cartucho IPFS on GitHub Pages](https://thiegocarvalho.github.io/cartucho/)**  

## 🧠 How It Works: The Decentralized Arcade

Traditional cloud gaming or emulator sites rely on central web servers to host ROMs and emulator cores. If those servers go down, the games are inaccessible. Cartucho IPFS flips this model:

1. **No Centralized Servers:** The entire application (HTML, JS, CSS) and the emulator cores are static files. They can be hosted anywhere, including GitHub Pages or IPFS itself.
2. **IPFS for Game Storage:** Games (Cartuchos) are entirely stored on the IPFS network. When you import a game, you are simply adding a unique content identifier (CID) to your local library.
3. **100% Client-Side Execution:** The EmulatorJS engine compiles retro console cores using WebAssembly (Wasm). Everything runs locally right inside your browser's memory. No backend processing is required.
4. **Peer-to-Peer Distribution:** When you share a game link, you are sharing the IPFS hash. As long as at least one node on the global IPFS network pins that file, the game remains playable forever.

## ✨ Features

- **Multi-System Support:** Play classics from NES, SNES, Sega Genesis/Mega Drive, Game Boy Advance, Arcade (MAME), and many more through the robust [EmulatorJS](https://emulatorjs.org/) engine.
- **Decentralized Library:** Import games using IPFS CIDs. Your library structure is saved locally in your browser's `localStorage`.
- **Offline After First Play:** ROMs are cached locally by CID (content-addressed, so the cache can never go stale). The second time you open a game it boots instantly, with no network at all — and you can free the space from the settings screen.
- **Shareable Cartuchos:** Generate a custom URL (e.g., `?cartucho=CID`) to send a specific game to a friend. When they open the link, the game boots instantly.
- **QR Code Scanning:** Easily import new games or share your currently playing game by scanning or generating QR codes directly within the app.
- **Full Gamepad Support:** 
  - Connect your favorite USB or Bluetooth controller.
  - Navigate the entire UI, library, and settings menus using the D-Pad and buttons—no mouse required.
  - Auto-hides UI focus when the game is running, delegating control directly to the emulator.
  - **Quick Eject:** Hold `Start + Up` for 3 seconds on your controller to instantly stop the emulator and return to your library.
  - *Note on First Setup:* EmulatorJS intentionally requires you to manually assign your gamepad to "Player 1" via its in-game settings menu (the gear icon) the very first time you play. Once mapped and saved, it will auto-connect in future sessions.
- **Custom Gateway Configuration:** By default it uses the public Pinata gateway, and you can point it at any public or private IPFS gateway in the settings. On every load the app races all known gateways and uses the fastest one that actually answers.
- **Responsive & Retro Design:** A sleek, modern "glassmorphism" UI combined with CRT scanline effects for authentic nostalgia on both desktop and mobile.

## 🗂️ Project Structure

No build step, no bundler — the browser loads the ES modules directly.

```
index.html               markup + script loading order
tailwind.config.js       theme, used only by the CSS build
assets/css/tailwind.css  GENERATED — do not edit by hand
assets/css/main.css      glassmorphism, CRT scanlines, gamepad focus
assets/img/og-cover.png  link preview image
assets/js/
  config.js              cores, gateways, timeouts, storage keys
  icons.js               SVGs injected from JS
  vendor.js              on-demand loading of qrcodejs / html5-qrcode
  ipfs.js                CID parsing, gateway selection, manifest fetching
  library.js             localStorage, manifest validation, import/export
  rom-cache.js           ROM caching (Cache API) with download progress
  emulator.js            EmulatorJS globals, boot and player navigation
  gamepad.js             controller loop and UI focus
  app.js                 Alpine component wiring it all together
```

Serving it needs nothing but a static server (ES modules do not load over `file://`):

```bash
npm run serve      # http://localhost:8000
```

Open it through `localhost`, not `0.0.0.0` or a LAN IP: outside a secure context the browser
disables the Cache API, the clipboard and the camera, so ROM caching, link copying and the QR
scanner silently stop working. To test on a phone, use an HTTPS tunnel.

The only build step is the CSS, and its output is committed — clone and serve works with no
tooling. If you change Tailwind classes in the markup, regenerate it:

```bash
npm install
npm run build      # compiles the CSS and stamps a content hash on asset URLs
```

The hash matters: GitHub Pages serves assets with a 10-minute cache, so without it a deploy
can pair the new `index.html` with a stale `app.js` and break the page.

## 🌐 A Note on Gateways

Most well-known public gateways (`ipfs.io`, `dweb.link`, `w3s.link`, `nftstorage.link`,
`cloudflare-ipfs.com`) currently answer browser requests with `403`/redirects **without CORS
headers**, or have dead DNS — so `fetch` fails even when the content is there. The gateway list is
curated by testing real cross-origin requests. If you add one, test it the same way.

Content only reachable through a private/dedicated gateway will **not** load for other people: pin it
somewhere publicly reachable before sharing a Cartucho link.

## 🎨 Design

Visual and interaction decisions live in [`DESIGN.md`](DESIGN.md) — type scale, color roles,
touch targets, breakpoints and the responsive rules. The values there are the only ones
allowed; a published visual version with rendered samples accompanies it.

## 🤝 Contributing

This project is open-source. Feel free to submit Pull Requests to add new features, improve the UI, or expand compatibility.

## 📜 License

This project is distributed under the MIT License. 

*Note: Cartucho IPFS is an engine and library manager. It is the user's responsibility to ensure they have the legal right to possess and play the ROMs they access via IPFS.*
