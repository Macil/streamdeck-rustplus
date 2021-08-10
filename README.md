# streamdeck-rustplus

This is an **unofficial** [Stream Deck](https://www.elgato.com/en/stream-deck-mk2) plugin for interacting with Smart Switches in the PC game [Rust](https://store.steampowered.com/app/252490/Rust/). This plugin mimics some of the functionality of the official [Rust companion app](https://rust.facepunch.com/companion) directly on the Stream Deck.

## Install

Go to the [Releases](https://github.com/Macil/streamdeck-rustplus/releases) page, download the latest "tech.macil.rustplus.streamDeckPlugin" file, and then open it to load the plugin into Stream Deck.

## Configuring

You must have [Node.js](https://nodejs.org/) and Google Chrome installed to continue.

In Stream Deck, scroll down on the right until you see the "Rust+" section with the "Rust Smart Switch" action. Drag that action onto a free spot in Stream Deck. You are able to title it as you want and customize the on/off images.

Next, we need to fill out the Entity Config setting for the button.

In a terminal, run this command which will open a Steam login page:

```
npx @liamcottle/rustplus.js fcm-register
```

Log into Steam and the command should complete. Then run this command:

```
npx @liamcottle/rustplus.js fcm-listen
```

Leave that window open. Now in Rust, use the wire tool while holding the use key on a smart switch to activate the "Pair" menu option, just like you were pairing the smart switch with the Rust+ mobile app. When you do this, a block of text will appear in the terminal, starting with `{` and ending with `}`. Copy that text and paste it as the Entity Config on the Stream Deck button.

The button should work now to toggle the Smart Switch!

## Developing

If you want to contribute to this project and develop on its code, copy or symlink the "Sources/tech.macil.rustplus.sdPlugin" directory into the Stream Deck Plugins directory. You should also turn on Stream Deck's Javascript debugging functionality. See [Create your own plugin](https://developer.elgato.com/documentation/stream-deck/sdk/create-your-own-plugin/) for more information on these steps.

## About

This project would not have been possible without [rustplus.js](https://github.com/liamcottle/rustplus.js)!
