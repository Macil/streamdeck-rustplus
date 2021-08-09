"use strict";

let websocket;

// keys are ip|port, and values are {websocket, keyCount, disconnectTimer}
const connections = {};

// keys are context strings, and values {settings, parsedConnectionConfig}
const byContext = {};

const DestinationEnum = Object.freeze({
  HARDWARE_AND_SOFTWARE: 0,
  HARDWARE_ONLY: 1,
  SOFTWARE_ONLY: 2,
});

function parseConnectionConfig(connectionConfigStr) {
  if (!connectionConfigStr) {
    return null;
  }
  try {
    const indirectEval = eval;
    return indirectEval('('+connectionConfigStr+')');
  } catch (e) {
    return null;
  }
}

function onKeyDown(context, state) {
  let keyPressCounter = byContext[context].settings.keyPressCounter ?? 0;

  keyPressCounter++;
  byContext[context].settings.keyPressCounter = keyPressCounter;

  saveSettings(context);
  setTitle(context, keyPressCounter);
}

function onKeyUp(context, state) {
}

function onWillAppear(context) {
  const keyPressCounter = byContext[context].settings.keyPressCounter ?? 0;
  setTitle(context, keyPressCounter);
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
  const json = {
    event: "setSettings",
    context: context,
    payload: byContext[context].settings,
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
        return;
      }

      if (event === "keyDown") {
        const { payload } = jsonObj;
        const { state } = payload;
        onKeyDown(context, state);
      } else if (event === "keyUp") {
        const { payload } = jsonObj;
        const { state } = payload;
        onKeyUp(context, state);
      } else if (event === "willAppear") {
        const { payload } = jsonObj;
        const { settings } = payload;
        byContext[context] = {
          settings: settings || {},
          parsedConnectionConfig: parseConnectionConfig(settings?.['connection-config'])
        };
        onWillAppear(context);
      } else if (event === "willDisappear") {
        // TODO if this is the last button connected to a specific
        // server, start a timer for disconnecting from that server.
        delete byContext[context];
      } else if (event === "sendToPlugin") {
        const { payload } = jsonObj;
        const sdpi_collection = payload?.sdpi_collection;
        if (sdpi_collection) {
          const { key, value } = sdpi_collection;
          byContext[context].settings[key] = value;
          if (key === 'connection-config') {
            byContext[context].parsedConnectionConfig = parseConnectionConfig(value);
          }
          saveSettings(context);
        }
      }
    };

    websocket.onclose = () => {
      // Websocket is closed
    };
  };
