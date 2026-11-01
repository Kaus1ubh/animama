// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  useAvatarEffectImageUrls,
  type AvatarEffectImageUrls,
} from "./useAvatarEffectImageUrls";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let rendered: AvatarEffectImageUrls[] = [];
let events: string[] = [];
let created = 0;
const api = {
  createObjectURL: (file: Blob) => {
    created += 1;
    const url = `blob:${(file as File).name}-${created}`;
    events.push(`create ${url}`);
    return url;
  },
  revokeObjectURL: (url: string) => {
    // What the creator's preview could apply when this URL goes away.
    events.push(`revoke ${url} while showing ${rendered.at(-1)?.image}`);
  },
};

function Probe({ image }: { image: File | null }) {
  rendered.push(useAvatarEffectImageUrls(image, null, api));
  return null;
}

const file = (name: string) => new File(["x"], name, { type: "image/png" });

beforeEach(() => {
  rendered = [];
  events = [];
  created = 0;
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
});

describe("useAvatarEffectImageUrls", () => {
  it("revokes a replaced URL only once its replacement is shown", () => {
    const first = file("first.png");
    act(() => root.render(<Probe image={first} />));
    expect(rendered.at(-1)?.image).toBe("blob:first.png-1");

    act(() => root.render(<Probe image={file("second.png")} />));
    expect(rendered.at(-1)?.image).toBe("blob:second.png-2");
    expect(events).toEqual([
      "create blob:first.png-1",
      "create blob:second.png-2",
      "revoke blob:first.png-1 while showing blob:second.png-2",
    ]);
  });

  it("revokes a cleared URL once nothing shows it", () => {
    act(() => root.render(<Probe image={file("only.png")} />));
    expect(events).toEqual(["create blob:only.png-1"]);
    act(() => root.render(<Probe image={null} />));
    expect(rendered.at(-1)?.image).toBeNull();
    expect(events.at(-1)).toBe("revoke blob:only.png-1 while showing null");
  });

  it("revokes every URL on unmount", () => {
    act(() => root.render(<Probe image={file("kept.png")} />));
    act(() => root.unmount());
    expect(events.at(-1)).toBe(
      "revoke blob:kept.png-1 while showing blob:kept.png-1",
    );
    // afterEach unmounts again; give it a fresh root.
    root = createRoot(container);
  });
});
