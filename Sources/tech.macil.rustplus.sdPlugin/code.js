"use strict";

let sdWebsocket;

/*
keys results from getConnectionKey(), and values are
{
  websocket, websocketReadyDefer,
  seq,
  reconnectTimer, disconnectTimer,
  contexts,
  contextsByEntityId,
  seqCallbacks,
}
*/
const connections = Object.create(null);

// keys are context strings, and values {settings, parsedConnectionConfig}
const byContext = Object.create(null);

const DestinationEnum = Object.freeze({
  HARDWARE_AND_SOFTWARE: 0,
  HARDWARE_ONLY: 1,
  SOFTWARE_ONLY: 2,
});

let protobufRoot, AppRequest, AppMessage;
const protobufRootDefer = newPromiseDefer();

protobuf.load("rustplus.proto", (err, root) => {
  if (err) {
    protobufRootDefer.reject(err);
    unhandledError(err);
  } else {
    protobufRoot = root;
    AppRequest = protobufRoot.lookupType("rustplus.AppRequest");
    AppMessage = protobufRoot.lookupType("rustplus.AppMessage");
    protobufRootDefer.resolve(root);
  }
});

function sdLogMessage(message, quiet = false) {
  if (!quiet) {
    console.log(message);
  }
  const json = {
    event: "logMessage",
    payload: {
      message,
    },
  };
  sdWebsocket.send(JSON.stringify(json));
}

function unhandledError(err, contexts = new Set()) {
  console.error("Unhandled error:", err);
  const errString = err.stack ?? String(err);
  sdLogMessage(
    `Got unhandled error (${Array.from(contexts).join(", ")}): ${errString}`,
    true
  );
  for (const context of contexts) {
    const json = {
      event: "showAlert",
      context,
    };
    sdWebsocket.send(JSON.stringify(json));
  }
}

function getConnectionKey(parsedConnectionConfig) {
  return JSON.stringify([
    parsedConnectionConfig.ip,
    parsedConnectionConfig.port,
  ]);
}

function getWebsocketUrl(parsedConnectionConfig) {
  return `ws://${parsedConnectionConfig.ip}:${parsedConnectionConfig.port}`;
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
    connection.contexts.add(context);
    if (connection.contextsByEntityId[parsedConnectionConfig.entityId]) {
      connection.contextsByEntityId[parsedConnectionConfig.entityId].add(
        context
      );
    } else {
      connection.contextsByEntityId[parsedConnectionConfig.entityId] = new Set([
        context,
      ]);
    }
    if (connection.websocket?.readyState === WebSocket.OPEN) {
      refreshSmartSwitchEntityInfo(connection, context);
    }
  } else {
    const connection = {
      websocket: null,
      websocketReadyDefer: newPromiseDefer(),
      seq: 1,
      reconnectTimer: null,
      disconnectTimer: null,
      contexts: new Set([context]),
      contextsByEntityId: Object.assign(Object.create(null), {
        [parsedConnectionConfig.entityId]: new Set([context]),
      }),
      seqCallbacks: Object.create(null),
    };
    connections[connectionKey] = connection;

    function setupWebsocket() {
      const websocketUrl = getWebsocketUrl(parsedConnectionConfig);
      const websocket = (connection.websocket = new WebSocket(websocketUrl));
      websocket.binaryType = "arraybuffer";
      sdLogMessage(`Connecting to ${websocketUrl}...`);
      connection.websocketReadyDefer.resolve(
        new Promise((resolve, reject) => {
          websocket.addEventListener("open", () => {
            resolve(websocket);
            sdLogMessage(`Successfully opened connection to ${websocketUrl}`);
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
        sdLogMessage(
          `Connection to ${websocketUrl} closed unexpectedly, scheduling reconnect`
        );
        connection.seq = 0;
        connection.websocket = null;
        connection.websocketReadyDefer = newPromiseDefer();
        for (const seqCallback of Object.values(connection.seqCallbacks)) {
          seqCallback(new Error("Connection closed"), null);
        }
        connection.seqCallbacks = Object.create(null);
        connection.reconnectTimer = setTimeout(() => {
          try {
            setupWebsocket();
          } catch (err) {
            unhandledError(err, connection.contexts);
          }
        }, 30 * 1000);
      });

      // query for entity states at start
      websocket.addEventListener("open", () => {
        connection.contexts.forEach((context) => {
          refreshSmartSwitchEntityInfo(connection, context);
        });
      });

      websocket.onmessage = (event) => {
        try {
          const message = AppMessage.decode(new Uint8Array(event.data));
          console.log("got message", message);
          if (message.response) {
            const seqCallback = connection.seqCallbacks[message.response.seq];
            if (seqCallback) {
              delete connection.seqCallbacks[message.response.seq];
              seqCallback(null, message.response);
            }
          }
          if (message.broadcast?.entityChanged) {
            const entityContexts =
              connection.contextsByEntityId[
                message.broadcast.entityChanged.entityId
              ] || new Set();
            for (const entityContext of entityContexts) {
              const { value } = message.broadcast.entityChanged.payload;
              const json = {
                event: "setState",
                context: entityContext,
                payload: {
                  state: value ? 0 : 1,
                },
              };
              sdWebsocket.send(JSON.stringify(json));
            }
          }
        } catch (err) {
          unhandledError(err, connection.contexts);
        }
      };
    }

    protobufRootDefer.promise
      .then(() => setupWebsocket())
      .catch((err) => unhandledError(err, connection.contexts));
  }
}

function handleDisconnect(context) {
  const { parsedConnectionConfig } = byContext[context];
  if (!parsedConnectionConfig) {
    return;
  }
  const websocketUrl = getWebsocketUrl(parsedConnectionConfig);
  const connectionKey = getConnectionKey(parsedConnectionConfig);
  const connection = connections[connectionKey];
  connection.contexts.delete(context);
  connection.contextsByEntityId[parsedConnectionConfig.entityId].delete(
    context
  );
  if (
    connection.contextsByEntityId[parsedConnectionConfig.entityId].size === 0
  ) {
    delete connection.contextsByEntityId[parsedConnectionConfig.entityId];
  }
  if (connection.contexts.size === 0) {
    connection.disconnectTimer = setTimeout(() => {
      sdLogMessage(`Cancelling connection to ${websocketUrl}`);
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
  for (const seqCallback of Object.values(connection.seqCallbacks)) {
    seqCallback(new Error("Connection removed"), null);
  }
  connection.websocket?.close();
}

function onKeyUp(context, state) {
  const { parsedConnectionConfig } = byContext[context];
  if (!parsedConnectionConfig) {
    unhandledError(
      new Error("No valid connection config for button"),
      new Set([context])
    );
    return;
  }
  const connection = connections[getConnectionKey(parsedConnectionConfig)];
  (async () => {
    const response = await runWithTimeout(async (signal) => {
      await connection.websocketReadyDefer.promise;
      return await sendToRustServer(
        connection,
        parsedConnectionConfig,
        {
          entityId: parsedConnectionConfig.entityId,
          setEntityValue: {
            value: state == 1,
          },
        },
        signal
      );
    }, 10 * 1000);

    if (!response.success) {
      throw new Error("response indicated setEntityValue was not successful");
    }
  })().catch((err) => unhandledError(err, new Set([context])));
}

function sendToRustServer(connection, parsedConnectionConfig, data, signal) {
  return new Promise((resolve, reject) => {
    if (connection.websocket?.readyState !== WebSocket.OPEN) {
      throw new Error(
        "sendToRustServer used on connection without active websocket"
      );
    }
    if (signal?.aborted) {
      throw new Error("Cancelled");
    }

    const request = {
      ...data,
      seq: connection.seq++,
      playerId: parsedConnectionConfig.playerId,
      playerToken: parsedConnectionConfig.playerToken,
    };

    function abortHandler() {
      delete connection.seqCallbacks[request.seq];
      reject(new Error("Cancelled"));
    }

    connection.seqCallbacks[request.seq] = (err, response) => {
      if (signal) {
        signal.removeEventListener("abort", abortHandler);
      }
      if (err) {
        reject(err);
      } else {
        resolve(response);
      }
    };
    if (signal) {
      signal.addEventListener("abort", abortHandler, { once: true });
    }

    const protoRequest = AppRequest.fromObject(request);
    connection.websocket.send(AppRequest.encode(protoRequest).finish());
  });
}

async function runWithTimeout(asyncFn, timeout) {
  const abortController = new AbortController();
  function timeHandler() {
    abortController.abort();
  }
  const timer = setTimeout(timeHandler, timeout);
  try {
    return await asyncFn(abortController.signal);
  } catch (err) {
    if (abortController.signal.aborted) {
      throw new Error("Function timed out", { cause: err });
    } else {
      throw err;
    }
  } finally {
    clearTimeout(timer);
  }
}

function refreshSmartSwitchEntityInfo(connection, context) {
  (async () => {
    const { parsedConnectionConfig } = byContext[context];

    const response = await sendToRustServer(
      connection,
      parsedConnectionConfig,
      {
        entityId: parsedConnectionConfig.entityId,
        getEntityInfo: {},
      }
    );

    if (!response.entityInfo) {
      throw new Error("Entity does not exist");
    }
    const { value } = response.entityInfo.payload;
    const json = {
      event: "setState",
      context,
      payload: {
        state: value ? 0 : 1,
      },
    };
    sdWebsocket.send(JSON.stringify(json));
  })().catch((err) => unhandledError(err, new Set([context])));
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

      try {
        if (action !== "tech.macil.rustplus.smartswitch") {
          return;
        }

        if (event === "keyUp") {
          const { payload } = jsonObj;
          const { state } = payload;
          onKeyUp(context, state);
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
              const parsedConnectionConfig = (byContext[
                context
              ].parsedConnectionConfig = parseConnectionConfig(value));
              handleConnect(context);

              if (parsedConnectionConfig) {
                const connection =
                  connections[getConnectionKey(parsedConnectionConfig)];
                if (connection) {
                  connection.websocketReadyDefer.promise
                    .then(() => {
                      const json = {
                        event: "showOk",
                        context,
                      };
                      sdWebsocket.send(JSON.stringify(json));
                    })
                    .catch((err) => {
                      unhandledError(err, new Set([context]));
                    });
                }
              }
            }
            saveSettings(context);
          }
        }
      } catch (err) {
        unhandledError(err, new Set([context]));
      }
    };

    sdWebsocket.onclose = () => {
      // Websocket is closed
    };
  };
