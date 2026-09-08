export type AnimamaDesktopBridge = NonNullable<Window["animamaDesktop"]>;

export type RuntimePlatformCapabilities = {
  nativeFullscreen: boolean;
  nativePiP: boolean;
  nativeQuickChat: boolean;
  nativeShortcuts: boolean;
};

export type WebRuntimePlatform = {
  kind: "web";
  isDesktop: false;
  desktopBridgeVersion: null;
  os: null;
  capabilities: RuntimePlatformCapabilities;
};

export type DesktopRuntimePlatform = {
  kind: "desktop";
  isDesktop: true;
  desktopBridgeVersion: number | null;
  os: string | null;
  capabilities: RuntimePlatformCapabilities;
  desktopBridge: AnimamaDesktopBridge;
};

export type RuntimePlatform = WebRuntimePlatform | DesktopRuntimePlatform;

const WEB_RUNTIME_PLATFORM: WebRuntimePlatform = {
  kind: "web",
  isDesktop: false,
  desktopBridgeVersion: null,
  os: null,
  capabilities: {
    nativeFullscreen: false,
    nativePiP: false,
    nativeQuickChat: false,
    nativeShortcuts: false,
  },
};

function readAnimamaDesktopBridge(): AnimamaDesktopBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = window.animamaDesktop;
  if (!bridge) return null;
  if (bridge.isDesktop === true || typeof bridge.version === "number") {
    return bridge;
  }
  return null;
}

function readBridgeVersion(bridge: AnimamaDesktopBridge): number | null {
  return typeof bridge.version === "number" && Number.isFinite(bridge.version)
    ? bridge.version
    : null;
}

function readBridgeOs(bridge: AnimamaDesktopBridge): string | null {
  return typeof bridge.platform === "string" && bridge.platform.length > 0
    ? bridge.platform
    : null;
}

function hasNativeFullscreen(bridge: AnimamaDesktopBridge): boolean {
  const fullscreen = bridge.fullscreen;
  return Boolean(
    fullscreen &&
    typeof fullscreen.enter === "function" &&
    typeof fullscreen.exit === "function" &&
    typeof fullscreen.isFullscreen === "function" &&
    typeof fullscreen.onChange === "function",
  );
}

function hasNativePiP(bridge: AnimamaDesktopBridge): boolean {
  const pip = bridge.pip;
  return Boolean(
    pip &&
    typeof pip.open === "function" &&
    typeof pip.close === "function" &&
    typeof pip.toggle === "function" &&
    typeof pip.isOpen === "function" &&
    typeof pip.getState === "function" &&
    typeof pip.setBackgroundMode === "function" &&
    typeof pip.setSizeScale === "function" &&
    typeof pip.onStateChange === "function" &&
    typeof pip.publishRuntimeMessage === "function" &&
    typeof pip.onRuntimeMessage === "function",
  );
}

function hasNativeQuickChat(bridge: AnimamaDesktopBridge): boolean {
  const quickChat = bridge.quickChat;
  return Boolean(
    quickChat &&
    typeof quickChat.open === "function" &&
    typeof quickChat.prepare === "function" &&
    typeof quickChat.close === "function" &&
    typeof quickChat.toggle === "function" &&
    typeof quickChat.getState === "function" &&
    typeof quickChat.publishRuntimeMessage === "function" &&
    typeof quickChat.onRuntimeMessage === "function" &&
    typeof quickChat.onStateChange === "function" &&
    typeof quickChat.setInteractiveRegions === "function" &&
    typeof quickChat.setLayoutMetrics === "function",
  );
}

function hasNativeShortcuts(bridge: AnimamaDesktopBridge): boolean {
  const shortcuts = bridge.shortcuts;
  return Boolean(
    shortcuts &&
    typeof shortcuts.configure === "function" &&
    typeof shortcuts.setContext === "function" &&
    typeof shortcuts.requestPermissions === "function" &&
    typeof shortcuts.getStatus === "function" &&
    typeof shortcuts.onEvent === "function" &&
    typeof shortcuts.onStatusChange === "function",
  );
}

export function getRuntimePlatformSnapshot(): RuntimePlatform {
  const bridge = readAnimamaDesktopBridge();
  if (!bridge) return WEB_RUNTIME_PLATFORM;

  return {
    kind: "desktop",
    isDesktop: true,
    desktopBridgeVersion: readBridgeVersion(bridge),
    os: readBridgeOs(bridge),
    capabilities: {
      nativeFullscreen: hasNativeFullscreen(bridge),
      nativePiP: hasNativePiP(bridge),
      nativeQuickChat: hasNativeQuickChat(bridge),
      nativeShortcuts: hasNativeShortcuts(bridge),
    },
    desktopBridge: bridge,
  };
}
