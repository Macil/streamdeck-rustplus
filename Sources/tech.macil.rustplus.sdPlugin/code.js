"use strict";

let sdWebsocket;

// keys results from getConnectionKey(), and
// values are {websocket, websocketReadyDefer, userCount, reconnectTimer, disconnectTimer, seq}
const connections = Object.create(null);

// keys are context strings, and values {settings, parsedConnectionConfig}
const byContext = Object.create(null);

const DestinationEnum = Object.freeze({
  HARDWARE_AND_SOFTWARE: 0,
  HARDWARE_ONLY: 1,
  SOFTWARE_ONLY: 2,
});

let protobufRoot;
const protobufRootDefer = newPromiseDefer();

protobuf.load("rustplus.proto", (err, root) => {
  if (err) {
    protobufRootDefer.reject(err);
    unhandledError(err);
  } else {
    protobufRoot = root;
    protobufRootDefer.resolve(root);
  }
});

function unhandledError(err) {
  console.error("Unhandled error:", err);
}

function getConnectionKey(parsedConnectionConfig) {
  return JSON.stringify([
    parsedConnectionConfig.ip,
    parsedConnectionConfig.port,
  ]);
}

function handleConnect(context) {
  const { parsedConnectionConfig } = byContext[context];
  if (!parsedConnectionConfig) {
    return;
  }
  const connectionKey = getConnectionKey(parsedConnectionConfig);
  const connection = connections[connectionKey];
  if (connection) {
    if (connection.disconnectTimer != null) {
      clearTimeout(connection.disconnectTimer);
      connection.disconnectTimer = null;
    }
    connection.userCount++;
  } else {
    const connection = {
      websocket: null,
      websocketReadyDefer: newPromiseDefer(),
      seq: 1,
      userCount: 1,
      reconnectTimer: null,
      disconnectTimer: null,
    };
    connections[connectionKey] = connection;

    function setupWebsocket() {
      const websocket = (connection.websocket = new WebSocket(
        `ws://${parsedConnectionConfig.ip}:${parsedConnectionConfig.port}`
      ));
      websocket.binaryType = "arraybuffer";
      connection.websocketReadyDefer.resolve(
        new Promise((resolve, reject) => {
          websocket.addEventListener("open", () => {
            resolve(websocket);
          });
          websocket.addEventListener("error", (event) => {
            reject(event.error || event);
          });
          websocket.addEventListener("close", () => {
            reject(new Error("websocket closed before opening"));
          });
        })
      );

      // reconnect logic
      websocket.addEventListener("close", () => {
        if (connections[connectionKey] !== connection) {
          return;
        }
        connection.seq = 0;
        connection.websocket = null;
        connection.websocketReadyDefer = newPromiseDefer();
        connection.reconnectTimer = setTimeout(setupWebsocket, 30 * 1000);
      });

      const AppMessage = protobufRoot.lookupType("rustplus.AppMessage");

      websocket.onmessage = (event) => {
        try {
          const message = AppMessage.decode(new Uint8Array(event.data));
          console.log("got message", message);
        } catch (err) {
          unhandledError(err);
        }
      };
    }

    protobufRootDefer.promise
      .then(() => setupWebsocket())
      .catch(unhandledError);
  }
}

function handleDisconnect(context) {
  const { parsedConnectionConfig } = byContext[context];
  if (!parsedConnectionConfig) {
    return;
  }
  const connectionKey = getConnectionKey(parsedConnectionConfig);
  const connection = connections[connectionKey];
  connection.userCount--;
  if (connection.userCount === 0) {
    connection.disconnectTimer = setTimeout(() => {
      removeConnection(connectionKey);
    }, 30 * 1000);
  }
}

function removeConnection(connectionKey) {
  const connection = connections[connectionKey];
  delete connections[connectionKey];
  if (connection.disconnectTimer != null) {
    clearTimeout(connection.disconnectTimer);
  }
  if (connection.reconnectTimer != null) {
    clearTimeout(connection.reconnectTimer);
  }
  connection.websocket?.close();
}

function onKeyDown(context, state) {
  const { parsedConnectionConfig } = byContext[context];
  if (!parsedConnectionConfig) {
    // TODO show an error in this case
    return;
  }
  const connection = connections[getConnectionKey(parsedConnectionConfig)];
  (async () => {
    await connection.websocketReadyDefer.promise;

    const AppRequest = protobufRoot.lookupType("rustplus.AppRequest");

    const request = {
      entityId: parsedConnectionConfig.entityId,
      setEntityValue: {
        value: state == 1,
      },

      seq: connection.seq++,
      playerId: parsedConnectionConfig.playerId,
      playerToken: parsedConnectionConfig.playerToken,
    };

    const protoRequest = AppRequest.fromObject(request);
    connection.websocket.send(AppRequest.encode(protoRequest).finish());
  })().catch(unhandledError);
}

function saveSettings(context) {
  const json = {
    event: "setSettings",
    context: context,
    payload: byContext[context].settings,
  };
  sdWebsocket.send(JSON.stringify(json));
}

globalThis.connectElgatoStreamDeckSocket =
  function connectElgatoStreamDeckSocket(
    inPort,
    inPluginUUID,
    inRegisterEvent,
    inInfo
  ) {
    // Open the web socket
    sdWebsocket = new WebSocket("ws://127.0.0.1:" + inPort);

    sdWebsocket.onopen = () => {
      // WebSocket is connected, send message
      const json = {
        event: inRegisterEvent,
        uuid: inPluginUUID,
      };
      sdWebsocket.send(JSON.stringify(json));
    };

    sdWebsocket.onmessage = (evt) => {
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
      } else if (event === "willAppear") {
        const { payload } = jsonObj;
        const { settings } = payload;
        byContext[context] = {
          settings: settings || {},
          parsedConnectionConfig: parseConnectionConfig(
            settings?.["connection-config"]
          ),
        };
        handleConnect(context);
      } else if (event === "willDisappear") {
        handleDisconnect(context);
        delete byContext[context];
      } else if (event === "sendToPlugin") {
        const { payload } = jsonObj;
        const sdpi_collection = payload?.sdpi_collection;
        if (sdpi_collection) {
          const { key, value } = sdpi_collection;
          byContext[context].settings[key] = value;
          if (key === "connection-config") {
            handleDisconnect(context);
            byContext[context].parsedConnectionConfig =
              parseConnectionConfig(value);
            handleConnect(context);
          }
          saveSettings(context);
        }
      }
    };

    sdWebsocket.onclose = () => {
      // Websocket is closed
    };
  };
