"use strict";

// this is our global websocket, used to communicate from/to Stream Deck software
// and some info about our plugin, as sent by Stream Deck software
let sdWebsocket = null,
  uuid = null,
  actionInfo = {},
  settings = {};

const websocketReady = newPromiseDefer();

const isQT = navigator.appVersion.includes("QtWebEngine");

window.connectElgatoStreamDeckSocket = function connectElgatoStreamDeckSocket(
  inPort,
  inUUID,
  inRegisterEvent,
  inInfo,
  inActionInfo
) {
  uuid = inUUID;
  // please note: the incoming arguments are of type STRING, so
  // in case of the inActionInfo, we must parse it into JSON first
  actionInfo = JSON.parse(inActionInfo); // cache the info
  inInfo = JSON.parse(inInfo);
  sdWebsocket = new WebSocket("ws://127.0.0.1:" + inPort);

  /** Since the PI doesn't have access to your OS native settings
   * Stream Deck sends some color settings to PI
   * We use these to adjust some styles (e.g. highlight-colors for checkboxes)
   */
  addDynamicStyles(inInfo.colors, "connectElgatoStreamDeckSocket");

  /** let's see, if we have some settings */
  settings = actionInfo?.payload?.settings;
  console.log({ settings, actionInfo });
  initPropertyInspector();

  // if connection was established, the websocket sends
  // an 'onopen' event, where we need to register our PI
  sdWebsocket.onopen = () => {
    const json = {
      event: inRegisterEvent,
      uuid: inUUID,
    };
    // register property inspector to Stream Deck
    sdWebsocket.send(JSON.stringify(json));
    websocketReady.resolve(sdWebsocket);
  };

  // websocket.onmessage = (evt) => {
  //   // Received message from Stream Deck
  //   const jsonObj = JSON.parse(evt.data);
  //   const {event} = jsonObj;
  //   if (event === "sendToPropertyInspector") {
  //   }
  // };

  sdWebsocket.onerror = (event) => {
    websocketReady.reject(event.error || event);
    console.error("got error from websocket", event);
  };
};

function initPropertyInspector() {
  prepareDOMElements(document);
}

// our method to pass values to the plugin
async function sendValueToPlugin(param, value) {
  if (!sdWebsocket || sdWebsocket.readyState !== 1) {
    await websocketReady;
  }
  const json = {
    action: actionInfo["action"],
    event: "sendToPlugin",
    context: uuid,
    payload: {
      [param]: value,
    },
  };
  sdWebsocket.send(JSON.stringify(json));
}

if (!isQT) {
  // force init if we're in a regular browser for testing
  document.addEventListener("DOMContentLoaded", () => {
    initPropertyInspector();
  });
}

function prepareDOMElements(baseElement = document) {
  Array.from(
    baseElement.querySelectorAll(
      "input.sdpi-item-value, .sdpi-item-value.textarea > textarea"
    )
  ).forEach((el) => {
    if (settings[el.id] != null) {
      el.value = settings[el.id];
    }
    el.addEventListener("input", (event) => {
      const e = event.target;
      const returnValue = {
        key: e.id,
        value: e.value,
      };
      sendValueToPlugin("sdpi_collection", returnValue);
    });
  });

  if (isQT) {
    baseElement.addEventListener("click", (event) => {
      const anchorElement = event.target.closest("a");
      if (
        anchorElement &&
        anchorElement.href &&
        anchorElement.target === "_blank"
      ) {
        event.preventDefault();
        const json = {
          event: "openUrl",
          payload: {
            url: new URL(anchorElement.href, document.location.href).href,
          },
        };
        sdWebsocket.send(JSON.stringify(json));
      }
    });
  }
}

/** Stream Deck software passes system-highlight color information
 * to Property Inspector. Here we 'inject' the CSS styles into the DOM
 * when we receive this information. */

function addDynamicStyles(clrs, fromWhere) {
  const node =
    document.getElementById("#sdpi-dynamic-styles") ||
    document.createElement("style");
  if (!clrs.mouseDownColor)
    clrs.mouseDownColor = fadeColor(clrs.highlightColor, -100);
  const clr = clrs.highlightColor.slice(0, 7);
  const clr1 = fadeColor(clr, 100);
  const clr2 = fadeColor(clr, 60);
  const metersActiveColor = fadeColor(clr, -60);

  node.setAttribute("id", "sdpi-dynamic-styles");
  node.innerHTML = `

    input[type="radio"]:checked + label span,
    input[type="checkbox"]:checked + label span {
        background-color: ${clrs.highlightColor};
    }

    input[type="radio"]:active:checked + label span,
    input[type="radio"]:active + label span,
    input[type="checkbox"]:active:checked + label span,
    input[type="checkbox"]:active + label span {
      background-color: ${clrs.mouseDownColor};
    }

    input[type="radio"]:active + label span,
    input[type="checkbox"]:active + label span {
      background-color: ${clrs.buttonPressedBorderColor};
    }

    td.selected,
    td.selected:hover,
    li.selected:hover,
    li.selected {
      color: white;
      background-color: ${clrs.highlightColor};
    }

    .sdpi-file-label > label:active,
    .sdpi-file-label.file:active,
    label.sdpi-file-label:active,
    label.sdpi-file-info:active,
    input[type="file"]::-webkit-file-upload-button:active,
    button:active {
      background-color: ${clrs.buttonPressedBackgroundColor};
      color: ${clrs.buttonPressedTextColor};
      border-color: ${clrs.buttonPressedBorderColor};
    }

    ::-webkit-progress-value,
    meter::-webkit-meter-optimum-value {
        background: linear-gradient(${clr2}, ${clr1} 20%, ${clr} 45%, ${clr} 55%, ${clr2})
    }

    ::-webkit-progress-value:active,
    meter::-webkit-meter-optimum-value:active {
        background: linear-gradient(${clr}, ${clr2} 20%, ${metersActiveColor} 45%, ${metersActiveColor} 55%, ${clr})
    }
    `;
  document.body.appendChild(node);
}

/** UTILITIES */

/*
    Quick utility to lighten or darken a color (doesn't take color-drifting, etc. into account)
    Usage:
    fadeColor('#061261', 100); // will lighten the color
    fadeColor('#200867'), -100); // will darken the color
*/
function fadeColor(col, amt) {
  const min = Math.min,
    max = Math.max;
  const num = parseInt(col.replace(/#/g, ""), 16);
  const r = min(255, max((num >> 16) + amt, 0));
  const g = min(255, max((num & 0x0000ff) + amt, 0));
  const b = min(255, max(((num >> 8) & 0x00ff) + amt, 0));
  return "#" + (g | (b << 8) | (r << 16)).toString(16).padStart(6, 0);
}
