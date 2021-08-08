"use strict";

let websocket;

const DestinationEnum = Object.freeze({
  HARDWARE_AND_SOFTWARE: 0,
  HARDWARE_ONLY: 1,
  SOFTWARE_ONLY: 2,
});

let timer = null;

function onKeyDown(context, settings, state) {
  timer = setTimeout(() => {
    const updatedSettings = {
      keyPressCounter: -1,
    };

    setSettings(context, updatedSettings);
    setTitle(context, 0);
  }, 1500);
}

function onKeyUp(context, settings, state) {
  clearTimeout(timer);

  let keyPressCounter = 0;
  if (
    settings != null &&
    Object.prototype.hasOwnProperty.call(settings, "keyPressCounter")
  ) {
    keyPressCounter = settings["keyPressCounter"];
  }

  keyPressCounter++;

  const updatedSettings = {
    keyPressCounter,
  };

  setSettings(context, updatedSettings);
  setTitle(context, keyPressCounter);
}

function onWillAppear(context, settings) {
  let keyPressCounter = 0;
  if (
    settings != null &&
    Object.prototype.hasOwnProperty.call(settings, "keyPressCounter")
  ) {
    keyPressCounter = settings["keyPressCounter"];
  }

  setTitle(context, keyPressCounter);
}

function onWillDisappear(context, settings) {
  // TODO if this is the last button connected to a specific
  // server, start a timer for disconnecting from that server.
}

function setTitle(context, keyPressCounter) {
  const json = {
    event: "setTitle",
    context: context,
    payload: {
      title: "" + keyPressCounter,
      target: DestinationEnum.HARDWARE_AND_SOFTWARE,
    },
  };
  websocket.send(JSON.stringify(json));
}
function setSettings(context, settings) {
  const json = {
    event: "setSettings",
    context: context,
    payload: settings,
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
        onKeyDown(context, settings, state);
      } else if (event === "keyUp") {
        const { payload } = jsonObj;
        const { settings, state } = payload;
        onKeyUp(context, settings, state);
      } else if (event === "willAppear") {
        const { payload } = jsonObj;
        const { settings } = payload;
        onWillAppear(context, settings);
      } else if (event === "willDisappear") {
        const { payload } = jsonObj;
        const { settings } = payload;
        onWillDisappear(context, settings);
      }
    };

    websocket.onclose = () => {
      // Websocket is closed
    };
  };
