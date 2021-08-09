"use strict";

let websocket;
let latestSettings;

const DestinationEnum = Object.freeze({
  HARDWARE_AND_SOFTWARE: 0,
  HARDWARE_ONLY: 1,
  SOFTWARE_ONLY: 2,
});

let resetTimer = null;

function onKeyDown(context, state) {
  resetTimer = setTimeout(() => {
    latestSettings.keyPressCounter = -1;

    saveSettings(context);
    setTitle(context, 0);
  }, 1500);
}

function onKeyUp(context, state) {
  clearTimeout(resetTimer);

  let keyPressCounter = latestSettings.keyPressCounter ?? 0;

  keyPressCounter++;
  latestSettings.keyPressCounter = keyPressCounter;

  saveSettings(context);
  setTitle(context, keyPressCounter);
}

function onWillAppear(context) {
  const keyPressCounter = latestSettings.keyPressCounter ?? 0;
  setTitle(context, keyPressCounter);
}

function onWillDisappear(context) {
  // TODO if this is the last button connected to a specific
  // server, start a timer for disconnecting from that server.
}

function setTitle(context, keyPressCounter) {
  const json = {
    event: "setTitle",
    context,
    payload: {
      title: "" + keyPressCounter,
      target: DestinationEnum.HARDWARE_AND_SOFTWARE,
    },
  };
  websocket.send(JSON.stringify(json));
}
function saveSettings(context) {
  if (!latestSettings) {
    throw new Error("Can't save settings before loading them");
  }
  const json = {
    event: "setSettings",
    context: context,
    payload: latestSettings,
  };
  websocket.send(JSON.stringify(json));
}

globalThis.connectElgatoStreamDeckSocket =
  function connectElgatoStreamDeckSocket(
    inPort,
    inPluginUUID,
    inRegisterEvent,
    inInfo
  ) {
    // Open the web socket
    websocket = new WebSocket("ws://127.0.0.1:" + inPort);

    websocket.onopen = () => {
      // WebSocket is connected, send message
      const json = {
        event: inRegisterEvent,
        uuid: inPluginUUID,
      };
      websocket.send(JSON.stringify(json));
    };

    websocket.onmessage = (evt) => {
      // Received message from Stream Deck
      const jsonObj = JSON.parse(evt.data);
      const { event, action, context } = jsonObj;

      if (action !== "tech.macil.rustplus.smartswitch") {
        console.warn(
          "expected action=tech.macil.rustplus.smartswitch",
          jsonObj
        );
        return;
      }

      if (event === "keyDown") {
        const { payload } = jsonObj;
        const { settings, state } = payload;
        latestSettings = settings;
        onKeyDown(context, state);
      } else if (event === "keyUp") {
        const { payload } = jsonObj;
        const { settings, state } = payload;
        latestSettings = settings;
        onKeyUp(context, state);
      } else if (event === "willAppear") {
        const { payload } = jsonObj;
        const { settings } = payload;
        latestSettings = settings;
        onWillAppear(context);
      } else if (event === "willDisappear") {
        const { payload } = jsonObj;
        const { settings } = payload;
        latestSettings = settings;
        onWillDisappear(context);
      } else if (event === "sendToPlugin") {
        const { payload } = jsonObj;
        const sdpi_collection = payload?.sdpi_collection;
        if (sdpi_collection) {
          const { key, value } = sdpi_collection;
          latestSettings[key] = value;
          saveSettings(context);
        }
      }
    };

    websocket.onclose = () => {
      // Websocket is closed
    };
  };
