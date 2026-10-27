import { describe, expect, it, vi } from "vitest";
import {
  LoginItem,
  type LoginItemHost,
} from "../src/main-process/login-item/login-item.js";

type Settings = ReturnType<LoginItemHost["getLoginItemSettings"]>;

function host(settings: Partial<Settings>, isPackaged = true) {
  const current: Settings = {
    openAtLogin: false,
    status: "not-registered",
    executableWillLaunchAtLogin: false,
    ...settings,
  };
  return {
    current,
    isPackaged,
    getLoginItemSettings: () => ({ ...current }),
    setLoginItemSettings: vi.fn(),
  } satisfies LoginItemHost & { current: Settings };
}

describe("open at login", () => {
  it("is unavailable in unpackaged runs and on Linux", () => {
    const unpackaged = host({}, false);
    expect(new LoginItem(unpackaged, "darwin").status()).toEqual({
      available: false,
    });
    expect(new LoginItem(host({}), "linux").status()).toEqual({
      available: false,
    });
    expect(() => new LoginItem(unpackaged, "darwin").setEnabled(true)).toThrow(
      "feature_unavailable",
    );
    expect(unpackaged.setLoginItemSettings).not.toHaveBeenCalled();
  });

  it("reads the macOS service status, including one waiting for approval", () => {
    const mac = host({ status: "enabled", openAtLogin: true });
    expect(new LoginItem(mac, "darwin").status()).toEqual({
      available: true,
      enabled: true,
      blockedBySystem: false,
    });
    mac.current.status = "requires-approval";
    expect(new LoginItem(mac, "darwin").status()).toEqual({
      available: true,
      enabled: true,
      blockedBySystem: true,
    });
    mac.current.status = "not-found";
    expect(new LoginItem(mac, "darwin").status()).toMatchObject({
      enabled: false,
    });
  });

  it("reports a Windows entry turned off in Startup apps", () => {
    const windows = host({
      openAtLogin: true,
      executableWillLaunchAtLogin: false,
    });
    expect(new LoginItem(windows, "win32").status()).toEqual({
      available: true,
      enabled: true,
      blockedBySystem: true,
    });
    windows.current.executableWillLaunchAtLogin = true;
    expect(new LoginItem(windows, "win32").status()).toMatchObject({
      blockedBySystem: false,
    });
  });

  it("changes the OS setting and rejects a change the OS did not keep", () => {
    const windows = host({});
    windows.setLoginItemSettings.mockImplementation(({ openAtLogin }) => {
      windows.current.openAtLogin = openAtLogin;
      windows.current.executableWillLaunchAtLogin = openAtLogin;
    });
    const loginItem = new LoginItem(windows, "win32");
    expect(loginItem.setEnabled(true)).toEqual({
      available: true,
      enabled: true,
      blockedBySystem: false,
    });
    expect(windows.setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: true,
    });

    const mac = host({});
    expect(() => new LoginItem(mac, "darwin").setEnabled(true)).toThrow(
      "login_item_unchanged",
    );
  });

  it("keeps a macOS item that is waiting for approval as a successful change", () => {
    const mac = host({});
    mac.setLoginItemSettings.mockImplementation(() => {
      mac.current.status = "requires-approval";
    });
    expect(new LoginItem(mac, "darwin").setEnabled(true)).toEqual({
      available: true,
      enabled: true,
      blockedBySystem: true,
    });
  });
});
