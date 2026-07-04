// Fuel Guard BLE hardware button support.
// Web Bluetooth requires a supported browser and a user tap on the connect button.
(() => {
  const DEVICE_NAME = "FuelGuard-Button";
  const SERVICE_UUID = "12345678-1234-1234-1234-123456789abc";
  const CHARACTERISTIC_UUID = "abcd1234-5678-90ab-cdef-123456789abc";

  let device = null;
  let characteristic = null;
  let bleState = "disconnected";

  function statusElement() {
    return document.getElementById("fgButtonStatus");
  }

  function connectButton() {
    return document.getElementById("connectFgButton");
  }

  function isBleSupported() {
    return Boolean(navigator.bluetooth?.requestDevice);
  }

  function fuelLogCount() {
    try {
      return Array.isArray(fuelGapState?.().logs) ? fuelGapState().logs.length : 0;
    } catch {
      return 0;
    }
  }

  function setBleStatus(state, message) {
    bleState = state;
    const status = statusElement();
    const button = connectButton();
    if (status) {
      status.dataset.bleState = state;
      status.textContent = `FG Button: ${state}. ${message || ""}`.trim();
    }
    if (button) {
      button.disabled = state === "scanning" || state === "connected" || !isBleSupported();
      button.textContent = state === "connected" ? "FG Button Connected" : "Connect FG Button";
    }
  }

  function logFuelFromButton() {
    const before = fuelLogCount();
    if (typeof recordFuelled !== "function") {
      setBleStatus("error", "Fuel logging is not ready yet.");
      return;
    }

    recordFuelled({ source: "bluetooth" });
    const after = fuelLogCount();
    if (after > before) {
      setBleStatus("connected", `Fuel logged at ${new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}.`);
    } else {
      setBleStatus("connected", "Button press received. Log not added because tracking is closed or cooldown is active.");
    }
  }

  function handleNotification(event) {
    const value = event.target?.value;
    if (!value) return;
    const message = new TextDecoder().decode(value).trim();
    if (message.startsWith("FUEL_LOG:")) {
      logFuelFromButton();
      return;
    }
    setBleStatus("connected", "Message received but ignored.");
  }

  function handleDisconnect() {
    characteristic = null;
    setBleStatus("disconnected", "Hardware button disconnected.");
  }

  async function connectFuelGuardButton() {
    if (!isBleSupported()) {
      setBleStatus("error", "BLE is not supported in this browser/app environment.");
      return;
    }

    try {
      setBleStatus("scanning", "Choose FuelGuard-Button from the Bluetooth prompt.");
      device = await navigator.bluetooth.requestDevice({
        filters: [{ name: DEVICE_NAME }],
        optionalServices: [SERVICE_UUID]
      });

      device.addEventListener("gattserverdisconnected", handleDisconnect);
      setBleStatus("scanning", "Connecting to hardware button...");
      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(SERVICE_UUID);
      characteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);
      characteristic.addEventListener("characteristicvaluechanged", handleNotification);
      await characteristic.startNotifications();
      setBleStatus("connected", "Listening for button presses.");
    } catch (error) {
      const message = error?.name === "NotFoundError"
        ? "Connection cancelled. Tap connect to try again."
        : `Could not connect: ${error?.message || "unknown BLE error"}`;
      setBleStatus("error", message);
    }
  }

  function initBleButton() {
    const button = connectButton();
    if (!button || button.dataset.bleHandler === "true") return;
    button.dataset.bleHandler = "true";
    button.addEventListener("click", connectFuelGuardButton);
    if (isBleSupported()) {
      setBleStatus("disconnected", "Tap connect to pair the hardware button.");
    } else {
      setBleStatus("error", "BLE is not supported in this browser/app environment.");
    }
  }

  document.addEventListener("DOMContentLoaded", initBleButton);
  requestAnimationFrame(initBleButton);

  window.fuelGuardBleButton = {
    connect: connectFuelGuardButton,
    get state() {
      return bleState;
    },
    get deviceName() {
      return device?.name || "";
    }
  };
})();
