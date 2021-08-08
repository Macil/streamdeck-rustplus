"use strict";

let websocket;

const DestinationEnum = Object.freeze({
  HARDWARE_AND_SOFTWARE: 0,
  HARDWARE_ONLY: 1,
  SOFTWARE_ONLY: 2,
});

let timer = null;

const counterAction = {
  onKeyDown(context, settings, coordinates, userDesiredState) {
    timer = setTimeout(function () {
      const updatedSettings = {
        keyPressCounter: -1
      };

      counterAction.SetSettings(context, updatedSettings);
      counterAction.SetTitle(context, 0);
    }, 1500);
  },

  onKeyUp(context, settings, coordinates, userDesiredState) {
    clearTimeout(timer);

    var keyPressCounter = 0;
    if (settings != null && settings.hasOwnProperty("keyPressCounter")) {
      keyPressCounter = settings["keyPressCounter"];
    }

    keyPressCounter++;

    const updatedSettings = {
      keyPressCounter
    };

    this.SetSettings(context, updatedSettings);

    this.SetTitle(context, keyPressCounter);
  },

  onWillAppear(context, settings, coordinates) {
    var keyPressCounter = 0;
    if (settings != null && settings.hasOwnProperty("keyPressCounter")) {
      keyPressCounter = settings["keyPressCounter"];
    }

    this.SetTitle(context, keyPressCounter);
  },

  SetTitle(context, keyPressCounter) {
    var json = {
      event: "setTitle",
      context: context,
      payload: {
        title: "" + keyPressCounter,
        target: DestinationEnum.HARDWARE_AND_SOFTWARE,
      },
    };

    websocket.send(JSON.stringify(json));
  },

  SetSettings(context, settings) {
    var json = {
      event: "setSettings",
      context: context,
      payload: settings,
    };

    websocket.send(JSON.stringify(json));
  },
};

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

      if (event == "keyDown") {
        const { payload } = jsonObj;
        const { settings, coordinates, userDesiredState } = payload;
        counterAction.onKeyDown(
          context,
          settings,
          coordinates,
          userDesiredState
        );
      } else if (event == "keyUp") {
        const { payload } = jsonObj;
        const { settings, coordinates, userDesiredState } = payload;
        counterAction.onKeyUp(context, settings, coordinates, userDesiredState);
      } else if (event == "willAppear") {
        const { payload } = jsonObj;
        const { settings, coordinates } = payload;
        counterAction.onWillAppear(context, settings, coordinates);
      }
    };

    websocket.onclose = () => {
      // Websocket is closed
    };
  };
