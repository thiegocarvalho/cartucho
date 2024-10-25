# Cartucho

A retro game emulator that allows you to play classic games directly in your browser, with ROMs and ISOs stored on IPFS (InterPlanetary File System).

## Demo

You can try out the emulator at [cartucho.vercel.app](https://cartucho.vercel.app/).

| CID (IPFS HASH)                                   | Platform           | Name                      |
|---------------------------------------------------|--------------------|---------------------------|
| QmZfuWPvHRJ349sh83ugigyt28bjhsb1QkTxFUjjgvjVk8    | Sega Mega Drive     | Ultimate Mortal Kombat 3  |
| QmVGuDy3gS9byoXQ6WfsTtZqrP2n9kbbQuqtdBSAe9Ru2n    | Sega Mega Drive     | Sonic 2                   |
| QmXR4bG2NZrsJ2xiQbJj9pUr5W8apCVC4cVuLBD6SnreBk    | SNES                | Super Mario Bros          |
| QmPJD8k2Lawf6hEo79AjUGFU8xoZ6bNMjC12GM9AAPrA7v    | Game Boy Advanced   | Pokemon Red               |
| QmcCiPqSk3mECFjrb1jdW21r3DSULCND5CymZFKT82DCQw    | Nintendo 64        | Super Smash Bros           |


## Features

- **Support for ROMs and ISOs:** Load games directly from IPFS.
- **Cross-Platform:** Play on any device with a modern browser.
- **Open Source:** Contribute and help improve the emulator.

## How It Works

The emulator uses IPFS technology to store and retrieve ROMs and ISOs, ensuring fast and decentralized access to games. This means you can share your ROMs with other users without relying on centralized servers.

## How to Add Games
To add games to the emulator:

Upload your ROM or ISO to IPFS.
Copy the CID generated by IPFS.
Enter the CID and select console to load the game.

## Installation

To run the emulator locally, follow these steps:

1. Clone the repository:
   ```bash
   git clone https://github.com/thiegocarvalho/cartucho.git
   cd cartucho
   # Install dependecies 
   npm install
   # run app
   npm run start
2. Access the Application
Once the application is running, open your browser and navigate to: [http://localhost:3000](http://localhost:3000).


## Contributing

If you want to contribute to this project, feel free to fork the repository and submit a pull request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
