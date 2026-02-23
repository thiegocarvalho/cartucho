# Cartucho // IPFS

![Cartucho IPFS Banner](https://placehold.co/1200x400/0a0a14/4f46e5?text=Cartucho+//+IPFS&font=orbitron)

**Cartucho IPFS** is a fully decentralized, browser-based retro game emulator and library manager. It leverages the power of the InterPlanetary File System (IPFS) to distribute, store, and play classic video games without relying on any centralized servers.

## 🚀 Play Now

Experience the decentralized arcade directly in your browser:  
👉 **[Play Cartucho IPFS on GitHub Pages](https://your-username.github.io/CartuchoIPFS/)**  
*(Replace with your actual GitHub Pages URL once deployed)*

## 🧠 How It Works: The Decentralized Arcade

Traditional cloud gaming or emulator sites rely on central web servers to host ROMs and emulator cores. If those servers go down, the games are inaccessible. Cartucho IPFS flips this model:

1. **No Centralized Servers:** The entire application (HTML, JS, CSS) and the emulator cores are static files. They can be hosted anywhere, including GitHub Pages or IPFS itself.
2. **IPFS for Game Storage:** Games (Cartuchos) are entirely stored on the IPFS network. When you import a game, you are simply adding a unique content identifier (CID) to your local library.
3. **100% Client-Side Execution:** The EmulatorJS engine compiles retro console cores using WebAssembly (Wasm). Everything runs locally right inside your browser's memory. No backend processing is required.
4. **Peer-to-Peer Distribution:** When you share a game link, you are sharing the IPFS hash. As long as at least one node on the global IPFS network pins that file, the game remains playable forever.

## ✨ Features

- **Multi-System Support:** Play classics from NES, SNES, Sega Genesis/Mega Drive, Game Boy Advance, Arcade (MAME), and many more through the robust [EmulatorJS](https://emulatorjs.org/) engine.
- **Decentralized Library:** Import games using IPFS CIDs. Your library structure is saved locally in your browser's `localStorage`.
- **Shareable Cartuchos:** Generate a custom URL (e.g., `?cartucho=CID`) to send a specific game to a friend. When they open the link, the game boots instantly.
- **QR Code Scanning:** Easily import new games or share your currently playing game by scanning or generating QR codes directly within the app.
- **Full Gamepad Support:** 
  - Connect your favorite USB or Bluetooth controller.
  - Navigate the entire UI, library, and settings menus using the D-Pad and buttons—no mouse required.
  - Auto-hides UI focus when the game is running, delegating control directly to the emulator.
  - **Quick Eject:** Hold `Start + Up` for 3 seconds on your controller to instantly stop the emulator and return to your library.
  - *Note on First Setup:* EmulatorJS intentionally requires you to manually assign your gamepad to "Player 1" via its in-game settings menu (the gear icon) the very first time you play. Once mapped and saved, it will auto-connect in future sessions.
- **Custom Gateway Configuration:** By default, it uses `ipfs.io`, but you can configure any public or private IPFS gateway in the settings to optimize your loading speeds.
- **Responsive & Retro Design:** A sleek, modern "glassmorphism" UI combined with CRT scanline effects for authentic nostalgia on both desktop and mobile.

## 🤝 Contributing

This project is open-source. Feel free to submit Pull Requests to add new features, improve the UI, or expand compatibility.

## 📜 License

This project is distributed under the MIT License. 

*Note: Cartucho IPFS is an engine and library manager. It is the user's responsibility to ensure they have the legal right to possess and play the ROMs they access via IPFS.*
